// Phase 20.32 — VoiceStudio speech runtime tests.
// Covers the confined workspace guard (doc §7), fail-closed license guard
// (§10), consent-gated cloning (§9, §18), Adobe Stock Safe Mode (§11, §46),
// retry rules (§14.1), provenance manifests without secrets (§12), secret
// redaction (§26), MCP file-mode enforcement (§6.2), and the mock-provider
// job pipeline end-to-end.

import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { closeAgentOsDbForTests, openAgentOsDb } from "../src/agent-os/db";
import { SpeechService, resetSpeechServiceForTests } from "../src/agent-os/speech/service";
import { MockSpeechProvider } from "../src/agent-os/speech/provider";
import { SpeechError } from "../src/agent-os/speech/errors";
import { resolveInSpeechWorkspace, speechWorkspaceRoot } from "../src/agent-os/speech/workspace";
import { evaluateModelLicense, evaluateCloneGate, evaluateSpeechStockExport, isHumanActor } from "../src/agent-os/speech/policy";
import { buildSpeechMcpConfig } from "../src/agent-os/speech/mcp-config";
import { speechFlags } from "../src/agent-os/speech/flags";

let testDir: string;
let service: SpeechService;

beforeEach(() => {
  closeAgentOsDbForTests();
  resetSpeechServiceForTests();
  testDir = mkdtempSync(join(tmpdir(), "ocx-speech-test-"));
  process.env.OPENCODEX_HOME = testDir;
  process.env.PAO_SPEECH_WORKSPACE = join(testDir, "workspace", "pao-speech");
  process.env.SPEECH_PROVIDER = "mock";
  process.env.SPEECH_MAX_RETRIES = "2";
  delete process.env.FEATURE_SPEECH_CLONE;
  delete process.env.OMNIVOICE_MCP_OUTPUT_MODE;
  delete process.env.VOICESTUDIO_API_KEY;
  service = new SpeechService(new MockSpeechProvider());
});

afterEach(() => {
  closeAgentOsDbForTests();
  resetSpeechServiceForTests();
  rmSync(testDir, { recursive: true, force: true });
});

async function seedApprovedVoice(): Promise<string> {
  await service.syncProviderVoices("dashboard");
  const voice = service.listVoices()[0]!;
  service.registerConsent({
    voiceId: voice.id,
    subjectType: "self",
    subjectAlias: "operator",
    consentBasis: "self_voice",
    commercialUseAllowed: true,
    stockUseAllowed: true,
    voiceCloneAllowed: true,
  }, "dashboard");
  service.registerLicense({ provider: "mock", engine: "tts-default", modelId: "tts-default" }, "dashboard");
  const license = service.listLicenses()[0]!;
  service.reviewLicense(license.id, { status: "approved", commercialUse: true, stockUse: true }, "dashboard");
  service.approveVoiceForStock(voice.id, "dashboard", "operator reviewed sample renders");
  return voice.id;
}

// --- Feature flags ------------------------------------------------------------

describe("Phase 20.32 feature flags", () => {
  test("cloning and dubbing default off; stock-safe mode defaults on", () => {
    const flags = speechFlags();
    expect(flags.runtime).toBe(true);
    expect(flags.tts).toBe(true);
    expect(flags.stt).toBe(true);
    expect(flags.clone).toBe(false);
    expect(flags.dubbing).toBe(false);
    expect(flags.stockSafeMode).toBe(true);
    expect(flags.cloneRequireConsent).toBe(true);
    expect(flags.unknownLicensePolicy).toBe("block");
  });
});

// --- Confined workspace (doc §7) ------------------------------------------------

describe("Phase 20.32 workspace boundary", () => {
  test("paths inside the workspace resolve; sibling paths are refused", () => {
    const inside = resolveInSpeechWorkspace(join("projects", "demo", "audio", "a.wav"));
    expect(inside.startsWith(speechWorkspaceRoot())).toBe(true);
    const outside = join(dirname(speechWorkspaceRoot()), "outside.wav");
    expect(() => resolveInSpeechWorkspace(outside)).toThrow("outside the confined speech workspace");
  });

  test("symlink escapes are rejected", () => {
    if (process.platform === "win32") {
      // Symlink creation needs elevated/dev-mode privileges on Windows; the
      // containment logic is covered by the sibling-path case above.
      expect(true).toBe(true);
      return;
    }
    const root = speechWorkspaceRoot();
    mkdirSync(join(root, "linkdir"), { recursive: true });
    const outsideDir = join(dirname(root), "escape-target");
    mkdirSync(outsideDir, { recursive: true });
    symlinkSync(outsideDir, join(root, "linkdir", "esc"));
    expect(() => resolveInSpeechWorkspace(join("linkdir", "esc", "x.wav"), { mustExist: false })).toThrow("symlink escape");
  });
});

// --- Fail-closed license guard (doc §10) ------------------------------------------

describe("Phase 20.32 license guard", () => {
  test("unknown, missing and unapproved licenses block; approved allows", () => {
    expect(evaluateModelLicense(null, { forStock: true }).reasonCode).toBe("MODEL_LICENSE_UNVERIFIED");
    const unverified = {
      id: "lic_x", provider: "voicestudio", engine: "tts-default", modelId: "tts-default",
      modelVersion: null, codeLicense: null, weightsLicense: null, commercialUse: false, stockUse: false,
      attributionRequired: false, status: "unknown" as const, sourceUrl: null, verifiedAt: null, verifiedBy: null, updatedAt: "",
    };
    expect(evaluateModelLicense(unverified, { forStock: false }).allowed).toBe(false);
    expect(evaluateModelLicense(unverified, { forStock: true }).reasonCode).toBe("MODEL_LICENSE_UNVERIFIED");
    const approved = { ...unverified, status: "approved" as const, commercialUse: true, stockUse: true };
    expect(evaluateModelLicense(approved, { forStock: true }).allowed).toBe(true);
    const noStock = { ...approved, stockUse: false };
    expect(evaluateModelLicense(noStock, { forStock: true }).reasonCode).toBe("MODEL_STOCK_USE_BLOCKED");
    const noCommercial = { ...approved, commercialUse: false };
    expect(evaluateModelLicense(noCommercial, { forStock: false }).reasonCode).toBe("MODEL_COMMERCIAL_USE_BLOCKED");
  });

  test("registering a license never auto-approves it", () => {
    service.registerLicense({ provider: "mock", engine: "tts-default", modelId: "tts-default" }, "dashboard");
    expect(service.listLicenses()[0]?.status).toBe("unknown");
  });
});

// --- Consent gate (doc §9) ----------------------------------------------------------

describe("Phase 20.32 consent gate", () => {
  test("missing, revoked, expired, out-of-scope and rejected-basis consents block cloning", () => {
    expect(evaluateCloneGate({ consent: null }).reasonCode).toBe("VOICE_CONSENT_REQUIRED");
    const base = {
      id: "consent_x", voiceId: null, subjectType: "self", subjectAlias: "pao",
      consentBasis: "self_voice" as const, consentDocumentRef: null, allowedUses: [],
      commercialUseAllowed: true, stockUseAllowed: true, voiceCloneAllowed: true,
      expiresAt: null, revokedAt: null, createdAt: "", updatedAt: "",
    };
    expect(evaluateCloneGate({ consent: { ...base, revokedAt: "2026-01-01T00:00:00Z" } }).reasonCode).toBe("VOICE_CONSENT_REVOKED");
    expect(evaluateCloneGate({ consent: { ...base, expiresAt: "2020-01-01T00:00:00Z" } }).reasonCode).toBe("VOICE_CONSENT_REVOKED");
    expect(evaluateCloneGate({ consent: { ...base, voiceCloneAllowed: false } }).reasonCode).toBe("VOICE_CLONE_NOT_ALLOWED");
    expect(evaluateCloneGate({ consent: { ...base, consentBasis: "celebrity_voice" as never } }).reasonCode).toBe("VOICE_CLONE_NOT_ALLOWED");
    expect(evaluateCloneGate({ consent: base }).allowed).toBe(true);
  });

  test("rejected impersonation bases are refused at registration", () => {
    expect(() => service.registerConsent({
      subjectType: "public_figure", subjectAlias: "someone famous", consentBasis: "celebrity_voice",
    }, "dashboard")).toThrow("not an acceptable production basis");
  });
});

// --- Stock-safe pipeline (doc §11, §46) ----------------------------------------------

describe("Phase 20.32 stock-safe generation", () => {
  test("unknown license blocks a stock-safe job with a clear reason and audit trail", async () => {
    await service.syncProviderVoices("dashboard");
    const voice = service.listVoices()[0]!;
    const job = await service.enqueueSynthesis({ projectId: "p1", text: "hello world", voiceId: voice.id, stockSafe: true });
    const terminal = await service.processJob(job.id);
    expect(terminal.status).toBe("blocked");
    expect(terminal.errorCode).toBe("MODEL_LICENSE_UNVERIFIED");
    const audit = service.listAudit(5);
    expect(audit.some((entry) => entry.action === "speech.job_blocked")).toBe(true);
  });

  test("unsafe scenario: unreviewed voice + stock mode blocks generation before runtime", async () => {
    await service.syncProviderVoices("dashboard");
    const voice = service.listVoices()[0]!;
    expect(voice.status).toBe("unreviewed");
    service.registerLicense({ provider: "mock", engine: "tts-default", modelId: "tts-default" }, "dashboard");
    const license = service.listLicenses()[0]!;
    service.reviewLicense(license.id, { status: "approved", commercialUse: true, stockUse: true }, "dashboard");
    const job = await service.enqueueSynthesis({ projectId: "p1", text: "hello", voiceId: voice.id, stockSafe: true });
    const terminal = await service.processJob(job.id);
    expect(terminal.status).toBe("blocked");
    expect(terminal.errorCode).toBe("VOICE_NOT_APPROVED_FOR_STOCK");
  });

  test("approved voice + approved license completes and writes provenance artifacts", async () => {
    const voiceId = await seedApprovedVoice();
    process.env.VOICESTUDIO_API_KEY = "mock-key-value";
    const job = await service.enqueueSynthesis({ projectId: "stock-demo", text: "ทดสอบเสียงสำหรับงานวิดีโอ", voiceId, stockSafe: true });
    const terminal = await service.processJob(job.id);
    expect(terminal.status).toBe("completed");
    const artifact = service.getArtifact(terminal.outputArtifactId!)!;
    expect(artifact.role).toBe("narration");
    expect(readFileSync(artifact.finalPath!).byteLength).toBeGreaterThan(44);
    expect(readFileSync(artifact.rawPath!).byteLength).toBeGreaterThan(44);
    expect(artifact.manifest).not.toBeNull();
    expect(artifact.manifest!.operation).toBe("tts");
    expect(artifact.manifest!.voiceId).toBe(voiceId);
    expect(artifact.manifest!.output.sha256).toBe(artifact.sha256);
    // The manifest never embeds secret material (doc §12).
    expect(JSON.stringify(artifact.manifest)).not.toContain("mock-key-value");
    // The artifact-ready event reaches the agent event trail (doc §20).
    const events = openAgentOsDb()
      .query("SELECT payload_json FROM agent_events WHERE kind = ? ORDER BY id DESC LIMIT 1")
      .get("speech.artifact.ready") as { payload_json: string } | null;
    expect(events).not.toBeNull();
    const payload = JSON.parse(events!.payload_json) as Record<string, unknown>;
    expect(payload.role).toBe("narration");
    expect(payload.path).toBe(artifact.finalPath);
  });
});

// --- Human-only governance --------------------------------------------------------------

describe("Phase 20.32 human-only governance", () => {
  test("agents cannot approve stock, block voices or review licenses", async () => {
    await service.syncProviderVoices("dashboard");
    const voice = service.listVoices()[0]!;
    service.registerConsent({
      voiceId: voice.id, subjectType: "self", subjectAlias: "pao",
      consentBasis: "self_voice", commercialUseAllowed: true, stockUseAllowed: true, voiceCloneAllowed: true,
    }, "dashboard");
    expect(() => service.approveVoiceForStock(voice.id, "agent_codex", "self-approved")).toThrow("invariant");
    expect(() => service.blockVoice(voice.id, "agent_codex", "self-blocked")).toThrow("invariant");
    expect(isHumanActor("dashboard")).toBe(true);
    expect(isHumanActor("agent_codex")).toBe(false);
  });

  test("cloned voices land pending review and never auto-activate (doc §18)", async () => {
    process.env.FEATURE_SPEECH_CLONE = "true";
    const refPath = join(speechWorkspaceRoot(), "reference.wav");
    mkdirSync(speechWorkspaceRoot(), { recursive: true });
    writeFileSync(refPath, Buffer.alloc(1600, 7));
    const consent = service.registerConsent({
      subjectType: "self", subjectAlias: "pao", consentBasis: "self_voice",
      commercialUseAllowed: true, stockUseAllowed: true, voiceCloneAllowed: true,
    }, "dashboard");
    const job = await service.enqueueClone({ projectId: "p1", voiceName: "pao-voice", referencePath: refPath, consentId: consent.id });
    const terminal = await service.processJob(job.id);
    expect(terminal.status).toBe("completed");
    const cloned = service.listVoices().find((voice) => voice.origin === "cloned")!;
    expect(cloned.status).toBe("pending_review");
    expect(cloned.commercialUseStatus).toBe("unknown");
    expect(cloned.stockApprovedAt).toBeNull();
  });

  test("cloning is disabled by default flag (doc §32)", async () => {
    const refPath = join(speechWorkspaceRoot(), "reference.wav");
    mkdirSync(speechWorkspaceRoot(), { recursive: true });
    writeFileSync(refPath, Buffer.alloc(64, 1));
    const consent = service.registerConsent({
      subjectType: "self", subjectAlias: "pao", consentBasis: "self_voice", voiceCloneAllowed: true,
    }, "dashboard");
    const job = await service.enqueueClone({ projectId: "p1", voiceName: "x", referencePath: refPath, consentId: consent.id });
    const terminal = await service.processJob(job.id);
    expect(terminal.status).toBe("blocked");
    expect(terminal.errorCode).toBe("SPEECH_DISABLED_BY_FLAG");
  });
});

// --- Retry rules (doc §14.1) -----------------------------------------------------------------

describe("Phase 20.32 retry rules", () => {
  test("transient runtime failures are retried; policy failures never are", async () => {
    const voiceId = await seedApprovedVoice();
    let calls = 0;
    const flaky = new (class extends MockSpeechProvider {
      override async synthesize(req: { text: string; voiceProfileId: string; format: string }): Promise<{ bytes: Uint8Array }> {
        calls += 1;
        if (calls === 1) throw new SpeechError("SPEECH_RUNTIME_UNAVAILABLE", "runtime briefly down");
        return super.synthesize(req);
      }
    })();
    const flakyService = new SpeechService(flaky);
    const job = await flakyService.enqueueSynthesis({ projectId: "p1", text: "retry me", voiceId, stockSafe: false });
    const first = await flakyService.processJob(job.id);
    expect(first.status).toBe("queued");
    expect(first.attempt).toBe(1);
    const second = await flakyService.processJob(job.id);
    expect(second.status).toBe("completed");

    const terminal = new SpeechError("VOICE_CONSENT_REQUIRED", "no");
    const policyProvider = new (class extends MockSpeechProvider {
      override async synthesize(): Promise<{ bytes: Uint8Array }> {
        throw terminal;
      }
    })();
    const policyService = new SpeechService(policyProvider);
    const job2 = await policyService.enqueueSynthesis({ projectId: "p1", text: "no retry", voiceId, stockSafe: false });
    const failed = await policyService.processJob(job2.id);
    expect(failed.status).toBe("failed");
    expect(failed.attempt).toBe(0);
    expect(failed.errorCode).toBe("VOICE_CONSENT_REQUIRED");
  });
});

// --- Transcription + MCP config --------------------------------------------------------------

describe("Phase 20.32 transcription and MCP", () => {
  test("transcription writes transcript plus srt/vtt subtitles inside the workspace", async () => {
    const refPath = join(speechWorkspaceRoot(), "input.wav");
    mkdirSync(speechWorkspaceRoot(), { recursive: true });
    writeFileSync(refPath, Buffer.alloc(32_000, 3));
    const job = await service.enqueueTranscription({ projectId: "p1", audioPath: refPath });
    const terminal = await service.processJob(job.id);
    expect(terminal.status).toBe("completed");
    const artifact = service.getArtifact(terminal.outputArtifactId!)!;
    expect(artifact.role).toBe("transcript");
    expect(artifact.finalPath!.endsWith(".json")).toBe(true);
  });

  test("MCP config enforces file mode and lists only documented tools", () => {
    process.env.OMNIVOICE_MCP_OUTPUT_MODE = "base64";
    expect(() => buildSpeechMcpConfig()).toThrow("mandatory");
    delete process.env.OMNIVOICE_MCP_OUTPUT_MODE;
    const config = buildSpeechMcpConfig();
    expect(config.outputMode).toBe("files");
    expect(config.basePath).toBe(speechWorkspaceRoot());
    expect(config.documentedTools).toContain("generate_speech");
    expect(config.documentedTools).toContain("list_voices");
  });

  test("credential material is redacted from error surfaces", () => {
    const token = "tok_" + "value123";
    const err = new SpeechError("REMOTE_AUTH_FAILED", `VoiceStudio rejected Bearer ${token}`);
    expect(err.message).toContain("[REDACTED]");
    expect(err.message).not.toContain(token);
  });
});
