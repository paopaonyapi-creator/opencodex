import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { OmniGetAdapter } from "../media-acquisition/omniget-adapter";
import { acquisitionMockForced } from "./flags";
import type {
  AcquisitionAdapter,
  AdapterHealth,
  AdapterJob,
  AdapterJobRef,
  AdapterJobStatus,
  CapabilityDescriptor,
} from "./types";
import { AcquisitionError } from "./types";

const jobs = new Map<string, AdapterJobStatus>();

export class MockAcquisitionAdapter implements AcquisitionAdapter {
  readonly id = "mock" as const;

  async probe(): Promise<AdapterHealth> {
    return { id: "mock", status: "healthy", detail: "deterministic mock worker for tests and unconfigured OmniGet", capabilityCount: 8 };
  }

  async capabilities(): Promise<CapabilityDescriptor[]> {
    return [
      { id: "media.download", aliases: ["download", "download_video", "queue_url"], risk: "medium", enabled: true, transport: "mock" },
      { id: "media.transcribe", aliases: ["transcribe", "whisper_transcribe"], risk: "low", enabled: true, transport: "mock" },
      { id: "media.inspect", aliases: ["info", "inspect"], risk: "low", enabled: true, transport: "mock" },
    ];
  }

  async submit(job: AdapterJob): Promise<AdapterJobRef> {
    mkdirSync(job.outputRoot, { recursive: true });
    const files: string[] = [];
    const host = job.plan.sourceHost ?? "example.com";
    writeFileSync(join(job.outputRoot, "manifest.json"), JSON.stringify({
      jobId: job.jobId,
      host,
      intent: job.request.intent,
      commercialRights: "unknown",
      trust: "untrusted_external_content",
      adapter: "mock",
    }, null, 2));
    files.push("manifest.json");

    if (job.request.intent === "inspect" || job.plan.preferSubtitles) {
      writeFileSync(join(job.outputRoot, "inspect.json"), JSON.stringify({ title: "Source on " + host, host, durationSec: 120 }, null, 2));
      files.push("inspect.json");
    }
    if (job.plan.preferSubtitles) {
      writeFileSync(join(job.outputRoot, "subtitles.vtt"), "WEBVTT\n\n00:00:01.000 --> 00:00:04.000\nHello from " + host + "\n");
      files.push("subtitles.vtt");
    }
    if (job.request.intent === "download" || job.request.intent === "archive" || job.request.options?.preserveOriginal) {
      writeFileSync(join(job.outputRoot, "original.bin"), "mock-original:" + host);
      files.push("original.bin");
    }
    if (job.request.intent === "gallery") {
      writeFileSync(join(job.outputRoot, "gallery-index.json"), JSON.stringify({ items: 3, host }, null, 2));
      files.push("gallery-index.json");
    }
    if (job.request.intent === "document_extract") {
      writeFileSync(join(job.outputRoot, "document.md"), "# Extracted\n\nuntrusted_external_content from " + host + "\n");
      files.push("document.md");
    }
    if (job.plan.postProcessors.includes("transcribe_local")) {
      writeFileSync(join(job.outputRoot, "transcript.md"), "# Transcript\n\n[00:00:01] Hello from " + host + "\n");
      files.push("transcript.md");
    }
    if (job.plan.postProcessors.includes("research_note")) {
      writeFileSync(join(job.outputRoot, "research.md"), [
        "# Research Note",
        "",
        "## Source",
        "- URL: " + (typeof job.request.source.value === "string" ? job.request.source.value : job.request.source.value[0]),
        "- Host: " + host,
        "",
        "## Executive Summary",
        "Local acquisition produced subtitle-first research material. Content is untrusted_external_content.",
        "",
        "## Key Findings",
        "- Finding `[00:00:01]` greeting from source host",
        "",
        "## Commercial rights",
        "unknown — technically retrievable is not a commercial license",
      ].join("\n"));
      files.push("research.md");
    }
    jobs.set(job.jobId, { state: "completed", progressPercent: 100, files });
    return { adapter: "mock", externalId: job.jobId };
  }

  async status(ref: AdapterJobRef): Promise<AdapterJobStatus> {
    return jobs.get(ref.externalId) ?? { state: "failed", progressPercent: 0, files: [], errorClass: "UNKNOWN", errorMessage: "unknown mock job" };
  }

  async cancel(ref: AdapterJobRef): Promise<void> {
    jobs.set(ref.externalId, { state: "cancelled", progressPercent: 0, files: [] });
  }
}

export class OmniGetCliAdapter implements AcquisitionAdapter {
  readonly id = "omniget_cli" as const;
  private inner = new OmniGetAdapter();

  async probe(): Promise<AdapterHealth> {
    if (acquisitionMockForced()) {
      return { id: "omniget_cli", status: "unconfigured", detail: "CLI probe skipped under test/mock flag" };
    }
    const health = await this.inner.healthCheck();
    return {
      id: "omniget_cli",
      status: health.status === "healthy" ? "healthy" : health.status === "degraded" ? "degraded" : "offline",
      latencyMs: health.latencyMs,
      version: health.version,
      binary: health.binaryPath,
      detail: health.errorMessage ?? "omniget CLI probe",
    };
  }

  async capabilities(): Promise<CapabilityDescriptor[]> {
    return [
      { id: "media.download", aliases: ["download"], risk: "medium", enabled: true, transport: "cli" },
      { id: "media.inspect", aliases: ["info"], risk: "low", enabled: true, transport: "cli" },
    ];
  }

  async submit(): Promise<AdapterJobRef> {
    const probe = await this.probe();
    if (probe.status === "offline") throw new AcquisitionError("ADAPTER_UNAVAILABLE", 503, "omniget CLI is not installed");
    throw new AcquisitionError("ADAPTER_UNAVAILABLE", 503, "CLI submit requires a live omniget binary; use mock adapter in tests");
  }

  async status(): Promise<AdapterJobStatus> {
    return { state: "failed", progressPercent: 0, files: [], errorClass: "TOOL_CRASH", errorMessage: "no CLI job" };
  }

  async cancel(): Promise<void> {}
}

export class OmniGetMcpAdapter implements AcquisitionAdapter {
  readonly id = "omniget_mcp" as const;

  async probe(): Promise<AdapterHealth> {
    if (acquisitionMockForced()) {
      return { id: "omniget_mcp", status: "unconfigured", detail: "MCP probe skipped under test/mock flag" };
    }
    const endpoints = [
      process.env.PAO_OMNIGET_MCP_URL,
      "http://127.0.0.1:18790",
      "http://127.0.0.1:8765",
    ].filter((u): u is string => Boolean(u));
    for (const endpoint of endpoints) {
      const started = Date.now();
      try {
        const res = await fetch(endpoint.replace(/\/+$/, "") + "/health", { signal: AbortSignal.timeout(800) });
        if (res.ok) {
          return { id: "omniget_mcp", status: "healthy", latencyMs: Date.now() - started, detail: "MCP healthy at configured/discovered endpoint", capabilityCount: 0 };
        }
      } catch {
        // try next
      }
    }
    return { id: "omniget_mcp", status: "unconfigured", detail: "OmniGet MCP not discovered; set PAO_OMNIGET_MCP_URL" };
  }

  async capabilities(): Promise<CapabilityDescriptor[]> {
    return [];
  }

  async submit(): Promise<AdapterJobRef> {
    throw new AcquisitionError("ADAPTER_UNAVAILABLE", 503, "OmniGet MCP is not connected");
  }

  async status(): Promise<AdapterJobStatus> {
    return { state: "failed", progressPercent: 0, files: [], errorClass: "TOOL_CRASH" };
  }

  async cancel(): Promise<void> {}
}

export class LegacyPhase2024Adapter implements AcquisitionAdapter {
  readonly id = "legacy_20_24" as const;

  async probe(): Promise<AdapterHealth> {
    return { id: "legacy_20_24", status: "healthy", detail: "Phase 20.24 MediaAcquisitionService compatibility wrapper" };
  }

  async capabilities(): Promise<CapabilityDescriptor[]> {
    return [{ id: "media.inspect", aliases: ["inspect"], risk: "low", enabled: true, transport: "native" }];
  }

  async submit(): Promise<AdapterJobRef> {
    throw new AcquisitionError("UNSUPPORTED", 501, "legacy adapter is inspect/compat only; submit through CAG mock/MCP/CLI");
  }

  async status(): Promise<AdapterJobStatus> {
    return { state: "failed", progressPercent: 0, files: [] };
  }

  async cancel(): Promise<void> {}
}

export function defaultAdapters(): AcquisitionAdapter[] {
  return [new OmniGetMcpAdapter(), new OmniGetCliAdapter(), new MockAcquisitionAdapter(), new LegacyPhase2024Adapter()];
}
