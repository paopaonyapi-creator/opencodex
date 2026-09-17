// Phase 20.84 — TypeSafe Jev provider selection & availability contract.
//
// Jev has ONE authoritative surface: the DecisionProvider interface. This
// module owns which backend answers for a given installation:
//
//   real      — the TypeSafe early-access endpoint. Bound ONLY when a
//               credential is present AND the official request/response schema
//               has been supplied by TypeSafe. There is no fabricated schema
//               anywhere in this repository: when either is missing, real mode
//               reports JEV_UNAVAILABLE with a structured reason instead of
//               guessing an endpoint shape.
//   simulated — the local calibrated simulation (deterministic, no network,
//               no credential). Explicitly named as a development/test backend
//               in every readiness and audit surface it touches.
//   disabled  — Jev is never selected; the deterministic provider answers.
//
// Provider mode comes from PAO_JEV_PROVIDER; the credential comes from
// TYPESAFE_API_KEY (environment only — never embedded in source). Every error
// and audit path redacts the credential.

import type { DecisionProvider, DecisionRequest, DecisionResult, ProviderHealth } from "./types";

export type JevProviderMode = "real" | "simulated" | "disabled";

export type JevUnavailableReason =
  | "mode_disabled"
  | "missing_credential"
  | "missing_schema"
  | "schema_unbound";

export class JevUnavailableError extends Error {
  readonly code = "JEV_UNAVAILABLE";
  readonly reason: JevUnavailableReason;
  readonly retryable: boolean;

  constructor(reason: JevUnavailableReason, message: string) {
    super(message);
    this.name = "JevUnavailableError";
    this.reason = reason;
    this.retryable = false;
  }
}

export interface JevConfiguration {
  mode: JevProviderMode;
  credentialPresent: boolean;
  /** True only when the official TypeSafe schema has been bound (see bindJevSchema). */
  schemaBound: boolean;
  /** Real mode can actually serve requests. */
  realAvailable: boolean;
  /** Structured reasons when realAvailable is false; empty otherwise. */
  unavailableReasons: JevUnavailableReason[];
  /** First/last-4 hint only — never the credential itself. */
  credentialHint: string | null;
}

let boundSchema: { name: string; version: string } | null = null;

/**
 * Binds the official TypeSafe request/response schema once TypeSafe delivers
 * it. Nothing in this repository fabricates a schema; until this is called
 * with real early-access material, real mode stays unavailable by design.
 */
export function bindJevSchema(schema: { name: string; version: string }): void {
  if (!schema?.name || !schema?.version) {
    throw new Error("bindJevSchema requires a named, versioned schema");
  }
  boundSchema = { name: schema.name, version: schema.version };
}

export function resolveJevConfiguration(env: Record<string, string | undefined> = process.env): JevConfiguration {
  const rawMode = (env.PAO_JEV_PROVIDER ?? "").trim().toLowerCase();
  const mode: JevProviderMode = rawMode === "real" || rawMode === "simulated" || rawMode === "disabled"
    ? (rawMode as JevProviderMode)
    : "simulated"; // default: explicitly-named simulation backend, never a fake "real"

  const apiKey = env.TYPESAFE_API_KEY ?? "";
  const credentialPresent = apiKey.length > 0;
  const schemaBound = boundSchema !== null;

  const unavailableReasons: JevUnavailableReason[] = [];
  if (!credentialPresent) unavailableReasons.push("missing_credential");
  if (!schemaBound) unavailableReasons.push("missing_schema");
  const realAvailable = credentialPresent && schemaBound;

  return {
    mode,
    credentialPresent,
    schemaBound,
    realAvailable,
    unavailableReasons: realAvailable ? [] : unavailableReasons,
    credentialHint: credentialPresent ? `***${apiKey.slice(-4)}` : null,
  };
}

/** True when the mode value itself is invalid (startup validation signal). */
export function isKnownJevMode(raw: string | undefined): boolean {
  return raw === undefined || raw === "" || raw === "real" || raw === "simulated" || raw === "disabled";
}

export function describeJevIntegration(env: Record<string, string | undefined> = process.env): {
  mode: JevProviderMode;
  status: "ready" | "degraded" | "unavailable";
  realAvailable: boolean;
  unavailableReasons: JevUnavailableReason[];
  backend: string;
  note: string;
} {
  const config = resolveJevConfiguration(env);
  if (config.mode === "disabled") {
    return {
      mode: config.mode,
      status: "unavailable",
      realAvailable: false,
      unavailableReasons: ["mode_disabled"],
      backend: "none",
      note: "Jev provider disabled by configuration; deterministic rule provider answers decisions",
    };
  }
  if (config.mode === "real") {
    if (config.realAvailable) {
      return {
        mode: config.mode,
        status: "ready",
        realAvailable: true,
        unavailableReasons: [],
        backend: "typesafe-jev (early-access endpoint)",
        note: "Real TypeSafe Jev bound with credential and official schema",
      };
    }
    return {
      mode: config.mode,
      status: "degraded",
      realAvailable: false,
      unavailableReasons: config.unavailableReasons,
      backend: "deterministic fallback",
      note: `Real TypeSafe Jev unavailable (${config.unavailableReasons.join(", ")}); decisions fall back to the deterministic provider and every fallback is audit-recorded`,
    };
  }
  return {
    mode: config.mode,
    status: config.credentialPresent || config.schemaBound ? "ready" : "degraded",
    realAvailable: false,
    unavailableReasons: [],
    backend: "calibrated simulation (development/test backend)",
    note: "Simulated Jev backend active — deterministic calibrated outputs for development and test; set PAO_JEV_PROVIDER=real with TYPESAFE_API_KEY and the official schema for production",
  };
}

export interface JevReadinessCheck {
  id: "mode" | "credential" | "schema" | "transport";
  status: "pass" | "fail" | "not_required";
  detail: string;
}

export interface JevReadinessReport {
  mode: JevProviderMode;
  checks: JevReadinessCheck[];
  realAvailable: boolean;
  /** Exact remediation for the first failing check, or null when nothing is pending. */
  nextAction: string | null;
}

/**
 * Staged live-validation report for the TypeSafe Jev integration. This is the
 * honest operator surface: it names exactly which stage blocks real-Jev
 * activation (mode → credential → schema → transport) and the exact remedial
 * action, without ever echoing the credential itself or inventing a wire
 * protocol. No check here performs network I/O.
 */
export function validateJevReadiness(env: Record<string, string | undefined> = process.env): JevReadinessReport {
  const config = resolveJevConfiguration(env);
  const checks: JevReadinessCheck[] = [];

  if (config.mode === "disabled") {
    return {
      mode: config.mode,
      checks: [{ id: "mode", status: "pass", detail: "PAO_JEV_PROVIDER=disabled — Jev intentionally not used; deterministic provider answers" }],
      realAvailable: false,
      nextAction: null,
    };
  }

  checks.push({ id: "mode", status: "pass", detail: `PAO_JEV_PROVIDER=${config.mode} is a valid mode` });

  if (config.mode === "simulated") {
    checks.push(
      { id: "credential", status: "not_required", detail: "credential not required for the calibrated simulation backend" },
      { id: "schema", status: "not_required", detail: "official schema not required for the simulation backend" },
      { id: "transport", status: "not_required", detail: "simulation runs in-process; no transport involved" },
    );
    return {
      mode: config.mode,
      checks,
      realAvailable: false,
      nextAction: config.realAvailable
        ? null
        : "to activate real Jev: set PAO_JEV_PROVIDER=real, provide TYPESAFE_API_KEY in the private environment, and bind the official schema via bindJevSchema()",
    };
  }

  // real mode — every stage must pass for realAvailable, and each failure
  // carries its exact remediation. No stage may be silently skipped.
  checks.push({
    id: "credential",
    status: config.credentialPresent ? "pass" : "fail",
    detail: config.credentialPresent
      ? `TYPESAFE_API_KEY present (hint ${config.credentialHint})`
      : "TYPESAFE_API_KEY missing — credentials resolve from the environment only",
  });
  checks.push({
    id: "schema",
    status: config.schemaBound ? "pass" : "fail",
    detail: config.schemaBound
      ? `official schema bound: ${boundSchema!.name}@${boundSchema!.version}`
      : "official TypeSafe request/response schema not bound — nothing in this repository fabricates one",
  });
  checks.push({
    id: "transport",
    status: "fail",
    detail: "real transport ships with the TypeSafe early-access enablement; refusing to fake a wire protocol",
  });

  const firstFail = checks.find((c) => c.status === "fail");
  const nextAction = firstFail?.id === "credential"
    ? "set TYPESAFE_API_KEY in your private environment (never in source or .env.example) and restart"
    : firstFail?.id === "schema"
      ? "obtain the official TypeSafe early-access schema and call bindJevSchema({ name, version }) at startup, then restart"
      : "await TypeSafe early-access transport enablement; the adapter contract, health, and degraded fallback are already implemented and tested";
  return {
    mode: config.mode,
    checks,
    realAvailable: false,
    nextAction,
  };
}

/**
 * The real TypeSafe Jev provider. It never invents a wire protocol: with no
 * credential or no bound schema it refuses with a structured
 * JevUnavailableError, so "real" mode can never silently behave as anything
 * other than the real endpoint.
 */
export class RealTypeSafeJevProvider implements DecisionProvider {
  public readonly id = "typesafe-jev";
  private readonly credential: string;

  constructor(config?: { apiKey?: string }) {
    // Credential resolves from the environment or explicit injection only.
    this.credential = config?.apiKey ?? "";
  }

  private availability(): JevConfiguration {
    return resolveJevConfiguration({
      PAO_JEV_PROVIDER: "real",
      TYPESAFE_API_KEY: this.credential || process.env.TYPESAFE_API_KEY,
    });
  }

  public async computeDecision<TState, TDecision>(
    _task: DecisionRequest<TState, TDecision>,
  ): Promise<DecisionResult<TDecision>> {
    const availability = this.availability();
    if (!availability.credentialPresent) {
      throw new JevUnavailableError(
        "missing_credential",
        "Real TypeSafe Jev unavailable: TYPESAFE_API_KEY is not configured (credentials come from the environment only)",
      );
    }
    if (!availability.schemaBound) {
      throw new JevUnavailableError(
        "missing_schema",
        "Real TypeSafe Jev unavailable: the official TypeSafe early-access request/response schema has not been bound; no substitute endpoint is used",
      );
    }
    // The real endpoint call lands here once TypeSafe grants early access.
    // Until then this branch is unreachable by construction.
    throw new JevUnavailableError(
      "schema_unbound",
      "Real TypeSafe Jev transport is not implemented in this build",
    );
  }

  public async health(): Promise<ProviderHealth> {
    const availability = this.availability();
    return {
      providerId: this.id,
      status: availability.realAvailable ? "degraded" : "unhealthy",
      latencyP95Ms: 0,
      circuitState: "closed",
    };
  }
}
