// Phase 20.15 — Cloud Sandbox Plane: capability registry and service fidelity table.
//
// Source spec §8.2 (capability shape) and §41/§42 (waves + fidelity markers). The fidelity
// column is data, not documentation, because §42 forbids concluding "local passed =
// production guaranteed" and the only way to enforce that is for every resource and every
// health report to carry the marker that produced it.

import type {
  ApprovalMode,
  CloudCapability,
  CloudEnvironment,
  CloudProvider,
  RiskLevel,
  ServiceFidelity,
} from "./types";

export type AdoptionWave = 1 | 2 | 3;

export interface CloudServiceDefinition {
  service: string;
  /** Fidelity when every dependency the service needs is actually present on the host. */
  baselineFidelity: ServiceFidelity;
  requiresDocker: boolean;
  risk: RiskLevel;
  approvalMode: ApprovalMode;
  wave: AdoptionWave;
  operations: string[];
}

const GENERIC_OPERATIONS = ["create", "list", "get", "delete"] as const;

/**
 * Wave 1 is deliberately only the services Floci can serve in-process.
 *
 * Lambda and RDS appear in source spec §75 as a recommended starting set, but §1.3 of the
 * same document lists both as Docker-backed. On a host without a Docker daemon they cannot
 * be delivered honestly, so they sit in wave 2 behind the Docker gate. Recorded as decision
 * 3 in docs/Phase-20.15 §13.
 */
const SERVICE_DEFINITIONS: readonly CloudServiceDefinition[] = [
  {
    service: "s3",
    baselineFidelity: "IN_PROCESS",
    requiresDocker: false,
    risk: "low",
    approvalMode: "none",
    wave: 1,
    operations: [...GENERIC_OPERATIONS],
  },
  {
    service: "dynamodb",
    baselineFidelity: "IN_PROCESS",
    requiresDocker: false,
    risk: "low",
    approvalMode: "none",
    wave: 1,
    operations: [...GENERIC_OPERATIONS],
  },
  {
    service: "sqs",
    baselineFidelity: "IN_PROCESS",
    requiresDocker: false,
    risk: "low",
    approvalMode: "none",
    wave: 1,
    operations: [...GENERIC_OPERATIONS, "send", "receive"],
  },
  {
    service: "sns",
    baselineFidelity: "IN_PROCESS",
    requiresDocker: false,
    risk: "low",
    approvalMode: "none",
    wave: 1,
    operations: [...GENERIC_OPERATIONS, "publish", "subscribe"],
  },
  {
    service: "secretsmanager",
    baselineFidelity: "IN_PROCESS",
    requiresDocker: false,
    risk: "medium",
    approvalMode: "none",
    wave: 1,
    operations: [...GENERIC_OPERATIONS],
  },
  {
    service: "ssm",
    baselineFidelity: "IN_PROCESS",
    requiresDocker: false,
    risk: "medium",
    approvalMode: "none",
    wave: 1,
    operations: [...GENERIC_OPERATIONS],
  },
  {
    service: "logs",
    baselineFidelity: "IN_PROCESS",
    requiresDocker: false,
    risk: "low",
    approvalMode: "none",
    wave: 1,
    operations: [...GENERIC_OPERATIONS],
  },
  {
    service: "eventbridge",
    // Upstream lists EventBridge as in-process with custom buses, rules and SQS/SNS/Lambda
    // targets, so the marker is IN_PROCESS rather than a defensive PARTIAL.
    baselineFidelity: "IN_PROCESS",
    requiresDocker: false,
    risk: "medium",
    approvalMode: "none",
    wave: 2,
    operations: [...GENERIC_OPERATIONS, "putEvents"],
  },
  {
    service: "stepfunctions",
    baselineFidelity: "PARTIAL",
    requiresDocker: false,
    risk: "medium",
    approvalMode: "none",
    wave: 2,
    operations: [...GENERIC_OPERATIONS, "startExecution"],
  },
  {
    service: "apigateway",
    // API Gateway REST is documented in-process, including Lambda proxy and MOCK
    // integrations. Step Functions is left PARTIAL because upstream documentation does not
    // state its execution class, and an unverified claim here would be worse than a cautious one.
    baselineFidelity: "IN_PROCESS",
    requiresDocker: false,
    risk: "medium",
    approvalMode: "none",
    wave: 2,
    operations: [...GENERIC_OPERATIONS],
  },
  {
    service: "lambda",
    baselineFidelity: "DOCKER_BACKED",
    requiresDocker: true,
    risk: "medium",
    approvalMode: "none",
    wave: 2,
    operations: [...GENERIC_OPERATIONS, "invoke"],
  },
  {
    service: "rds",
    baselineFidelity: "DOCKER_BACKED",
    requiresDocker: true,
    risk: "medium",
    approvalMode: "none",
    wave: 2,
    operations: [...GENERIC_OPERATIONS],
  },
  {
    service: "opensearch",
    baselineFidelity: "DOCKER_BACKED",
    requiresDocker: true,
    risk: "medium",
    approvalMode: "none",
    wave: 2,
    operations: [...GENERIC_OPERATIONS],
  },
  {
    service: "ec2",
    baselineFidelity: "DOCKER_BACKED",
    requiresDocker: true,
    risk: "medium",
    approvalMode: "conditional",
    wave: 3,
    operations: [...GENERIC_OPERATIONS],
  },
  {
    service: "ecs",
    baselineFidelity: "DOCKER_BACKED",
    requiresDocker: true,
    risk: "high",
    approvalMode: "conditional",
    wave: 3,
    operations: [...GENERIC_OPERATIONS],
  },
  {
    service: "eks",
    baselineFidelity: "DOCKER_BACKED",
    requiresDocker: true,
    risk: "high",
    approvalMode: "required",
    wave: 3,
    operations: [...GENERIC_OPERATIONS],
  },
  {
    service: "msk",
    baselineFidelity: "DOCKER_BACKED",
    requiresDocker: true,
    risk: "high",
    approvalMode: "required",
    wave: 3,
    operations: [...GENERIC_OPERATIONS],
  },
];

export class CloudCapabilityRegistry {
  private readonly byService = new Map<string, CloudServiceDefinition>();

  constructor(definitions: readonly CloudServiceDefinition[] = SERVICE_DEFINITIONS) {
    for (const definition of definitions) {
      this.byService.set(definition.service, definition);
    }
  }

  static capabilityId(provider: CloudProvider, service: string): string {
    return `${provider}.${service}`;
  }

  definitions(): CloudServiceDefinition[] {
    return [...this.byService.values()];
  }

  /** Services an install can actually use right now, given what the host offers. */
  servicesForWave(wave: AdoptionWave, dockerAvailable: boolean): string[] {
    return this.definitions()
      .filter((d) => d.wave === wave && (dockerAvailable || !d.requiresDocker))
      .map((d) => d.service);
  }

  isKnown(service: string): boolean {
    return this.byService.has(service);
  }

  definition(service: string): CloudServiceDefinition | undefined {
    return this.byService.get(service);
  }

  requiresDocker(service: string): boolean {
    return this.byService.get(service)?.requiresDocker ?? true;
  }

  /**
   * Fidelity as the host can actually deliver it.
   *
   * A Docker-backed service with no reachable daemon reports UNAVAILABLE rather than its
   * baseline, so a caller cannot mistake "we did not run it" for "it passed".
   */
  effectiveFidelity(service: string, dockerAvailable: boolean): ServiceFidelity {
    const definition = this.byService.get(service);
    if (!definition) return "UNKNOWN";
    if (definition.requiresDocker && !dockerAvailable) return "UNAVAILABLE";
    return definition.baselineFidelity;
  }

  riskOf(service: string): RiskLevel {
    return this.byService.get(service)?.risk ?? "high";
  }

  approvalModeOf(service: string): ApprovalMode {
    // Unknown services default to the strictest mode: a service nobody classified must not
    // inherit the most permissive verdict by accident.
    return this.byService.get(service)?.approvalMode ?? "required";
  }

  build(
    provider: CloudProvider,
    service: string,
    dockerAvailable: boolean,
    environments: CloudEnvironment[] = ["local"],
  ): CloudCapability | null {
    const definition = this.byService.get(service);
    if (!definition) return null;

    return {
      id: CloudCapabilityRegistry.capabilityId(provider, service),
      provider,
      service,
      operations: [...definition.operations],
      environments,
      risk: definition.risk,
      approvalMode: definition.approvalMode,
      fidelity: this.effectiveFidelity(service, dockerAvailable),
      requiresDocker: definition.requiresDocker,
      networkPolicy: "sandbox-internal",
      credentialProfile: environments.includes("production")
        ? "PRODUCTION_APPROVAL_ONLY"
        : environments.includes("staging")
          ? "STAGING_LIMITED"
          : "LOCAL_FAKE",
    };
  }
}

let singleton: CloudCapabilityRegistry | null = null;

export function getCloudCapabilityRegistry(): CloudCapabilityRegistry {
  if (!singleton) singleton = new CloudCapabilityRegistry();
  return singleton;
}

export function resetCloudCapabilityRegistryForTests(): void {
  singleton = null;
}
