// Phase 20.32 — SpeechService: the Pao-hubPro-side orchestration layer
// (doc §13, §14, §16, §17, §18, §27, §36). Speech generation always runs as
// jobs with policy preflight, transient-only retries, provenance manifests and
// governance audit. Governance mutations (license review, stock approval,
// consent lifecycle, voice blocking) are human-only.

import { copyFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { recordAgentEvent } from "../events";
import { runProcessSafely } from "../media-acquisition/process-runner";
import { SpeechError } from "./errors";
import { speechFlags } from "./flags";
import {
  VOICESTUDIO_VERSION_PIN,
  checkVoiceStudioConfig,
  speechConnectionDiagnostics,
} from "./http-client";
import { assertManifestHasNoSecrets, buildSpeechManifest, sha256HexBytes, sha256HexFile, sha256HexText } from "./manifest";
import { assertMcpFileMode } from "./mcp";
import { MockSpeechProvider, VoiceStudioProvider } from "./provider";
import { evaluateCloneGate, evaluateModelLicense, evaluateSpeechStockExport, isHumanActor } from "./policy";
import { SpeechStore } from "./store";
import { ensureSpeechProjectDirs, resolveInSpeechWorkspace, workspaceDiagnostics } from "./workspace";
import type {
  CloneRequest,
  ModelLicenseRecord,
  SpeechArtifactRecord,
  SpeechCapabilities,
  SpeechHealth,
  SpeechJobRecord,
  SpeechJobType,
  SpeechProvider,
  SynthesisRequest,
  TranscriptionRequest,
  VoiceConsentRecord,
  VoiceProfileRecord,
} from "./types";
import { ALLOWED_CONSENT_BASES as CONSENT_BASES } from "./types";

const STOCK_DEFAULT = "tts-default";

function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  const parsed = raw ? Number.parseInt(raw, 10) : Number.NaN;
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function nowIso(): string {
  return new Date().toISOString();
}

function newJobId(): string {
  return `spjob_${crypto.randomUUID().replace(/-/g, "").slice(0, 20)}`;
}

function newArtifactId(): string {
  return `spart_${crypto.randomUUID().replace(/-/g, "").slice(0, 20)}`;
}

function newVoiceId(): string {
  return `voice_${crypto.randomUUID().replace(/-/g, "").slice(0, 20)}`;
}

function newConsentId(): string {
  return `consent_${crypto.randomUUID().replace(/-/g, "").slice(0, 20)}`;
}

function newLicenseId(): string {
  return `lic_${crypto.randomUUID().replace(/-/g, "").slice(0, 20)}`;
}

export class SpeechService {
  private store = new SpeechStore();
  private provider: SpeechProvider;

  constructor(provider?: SpeechProvider) {
    this.provider = provider ?? defaultSpeechProvider();
  }

  // --- health / capabilities ------------------------------------------------

  async health(): Promise<SpeechHealth & { flags: Record<string, boolean>; queueDepth: number }> {
    const base = await this.provider.healthCheck();
    const flags = speechFlags();
    if (!flags.runtime) {
      base.state = "policy_blocked";
      base.reasons = [...base.reasons, "Speech runtime is disabled by flag"];
    }
    if (base.state === "version_mismatch") {
      // warn_and_disable_risky_features (doc §42): health stays visible, the
      // service refuses risky operations while versions are unverified.
      base.reasons = [...base.reasons, "Clone/dubbing stay disabled until the version pin is re-approved"];
    }
    this.store.insertHealthRecord({
      state: base.state,
      provider: base.provider,
      versionDetected: base.versionDetected,
      versionPin: base.versionPin,
      detail: { reasons: base.reasons },
    });
    return { ...base, flags: { ...flags } as unknown as Record<string, boolean>, queueDepth: this.store.countActiveJobs() };
  }

  async capabilities(): Promise<SpeechCapabilities> {
    const caps = await this.provider.capabilities();
    const flags = speechFlags();
    return {
      ...caps,
      tts: caps.tts && flags.tts,
      stt: caps.stt && flags.stt,
      cloning: caps.cloning && flags.clone,
      dubbing: caps.dubbing && flags.dubbing,
      mcp: caps.mcp && flags.mcp,
    };
  }

  // --- provider voice sync (never auto-approves; doc §30, §45) ----------------

  async syncProviderVoices(actor: string): Promise<{ synced: number; created: number }> {
    const listings = await this.provider.listProviderVoices();
    let created = 0;
    const existing = new Set(this.store.listVoices().map((voice) => voice.providerProfileId));
    for (const listing of listings) {
      if (existing.has(listing.profileId)) continue;
      const now = nowIso();
      this.store.insertVoice({
        id: newVoiceId(),
        provider: this.provider.id,
        providerProfileId: listing.profileId,
        name: listing.name,
        language: listing.language ?? null,
        purposes: [],
        origin: "synced",
        status: "unreviewed",
        commercialUseStatus: "unknown",
        consentStatus: "none",
        licenseStatus: "unknown",
        impersonatesPublicFigure: false,
        stockApprovedAt: null,
        createdFrom: null,
        metadata: {},
        lastUsedAt: null,
        createdAt: now,
        updatedAt: now,
      });
      created += 1;
    }
    this.store.appendAudit({
      actor,
      action: "voice.synced",
      target: `provider:${this.provider.id}`,
      after: { synced: listings.length, created },
    });
    return { synced: listings.length, created };
  }

  // --- enqueue ------------------------------------------------------------------

  async enqueueSynthesis(req: SynthesisRequest): Promise<SpeechJobRecord> {
    if (!req.projectId || !req.text?.trim() || !req.voiceId) {
      throw new SpeechError("SPEECH_INVALID_ARGUMENT", "projectId, text and voiceId are required");
    }
    const stockSafe = req.stockSafe ?? speechFlags().stockSafeMode;
    return this.createJob({
      type: "tts",
      projectId: req.projectId,
      voiceId: req.voiceId,
      request: {
        text: req.text,
        language: req.language ?? null,
        format: req.format ?? "wav",
        purpose: req.purpose ?? "narration",
        requestedBy: req.requestedBy ?? "dashboard",
        stockSafe,
      },
    });
  }

  async enqueueTranscription(req: TranscriptionRequest): Promise<SpeechJobRecord> {
    if (!req.projectId || !req.audioPath) {
      throw new SpeechError("SPEECH_INVALID_ARGUMENT", "projectId and audioPath are required");
    }
    return this.createJob({
      type: "stt",
      projectId: req.projectId,
      voiceId: null,
      request: {
        audioPath: req.audioPath,
        language: req.language ?? null,
        responseFormat: req.responseFormat ?? "verbose_json",
        requestedBy: req.requestedBy ?? "dashboard",
      },
    });
  }

  async enqueueClone(req: CloneRequest): Promise<SpeechJobRecord> {
    if (!req.projectId || !req.voiceName || !req.referencePath || !req.consentId) {
      throw new SpeechError("SPEECH_INVALID_ARGUMENT", "projectId, voiceName, referencePath and consentId are required");
    }
    return this.createJob({
      type: "clone",
      projectId: req.projectId,
      voiceId: null,
      request: {
        voiceName: req.voiceName,
        referencePath: req.referencePath,
        consentId: req.consentId,
        language: req.language ?? null,
        requestedBy: req.requestedBy ?? "dashboard",
      },
    });
  }

  async enqueueDubbing(projectId: string, requestedBy?: string): Promise<SpeechJobRecord> {
    return this.createJob({
      type: "dubbing",
      projectId,
      voiceId: null,
      request: { requestedBy: requestedBy ?? "dashboard" },
    });
  }

  private createJob(input: { type: SpeechJobType; projectId: string; voiceId: string | null; request: Record<string, unknown> }): SpeechJobRecord {
    const now = nowIso();
    const job: SpeechJobRecord = {
      id: newJobId(),
      projectId: input.projectId,
      type: input.type,
      provider: this.provider.id,
      engine: null,
      modelId: null,
      voiceId: input.voiceId,
      request: input.request,
      policySnapshot: {},
      status: "queued",
      progress: 0,
      attempt: 0,
      maxAttempts: 1 + envInt("SPEECH_MAX_RETRIES", 2),
      errorCode: null,
      errorMessage: null,
      outputArtifactId: null,
      createdAt: now,
      startedAt: null,
      completedAt: null,
    };
    this.store.insertJob(job);
    return job;
  }

  // --- job execution ---------------------------------------------------------------

  /** Runs a queued job synchronously and returns its terminal record. */
  async processJob(jobId: string): Promise<SpeechJobRecord> {
    let job = this.store.getJob(jobId);
    if (!job) throw new SpeechError("SPEECH_JOB_NOT_FOUND", `Speech job not found: ${jobId}`);
    if (job.status !== "queued") return job;

    // Preflight (doc §14: queued -> preflight -> policy gates).
    job.status = "preflight";
    job.startedAt = nowIso();
    this.store.saveJob(job);

    const preflight = this.preflight(job);
    if (!preflight.allowed) {
      this.store.insertPolicyCheck({
        jobId: job.id,
        gate: "preflight",
        decision: "blocked",
        reasonCode: preflight.reasonCode ?? null,
        requiredAction: preflight.requiredAction ?? null,
      });
      job.status = "blocked";
      job.errorCode = preflight.reasonCode ?? null;
      job.errorMessage = preflight.requiredAction ?? "Preflight policy gate blocked this job";
      job.completedAt = nowIso();
      this.store.saveJob(job);
      this.store.appendAudit({
        actor: String(job.request.requestedBy ?? "system"),
        action: "speech.job_blocked",
        target: job.id,
        after: { type: job.type, reason: preflight.reasonCode },
      });
      return job;
    }

    try {
      if (job.type === "tts") return await this.runTtsJob(job);
      if (job.type === "stt") return await this.runSttJob(job);
      if (job.type === "clone") return await this.runCloneJob(job);
      // dubbing never reaches here (blocked at preflight while flagged off).
      return job;
    } catch (err) {
      return this.handleJobFailure(job, err);
    }
  }

  private preflight(job: SpeechJobRecord): { allowed: boolean; reasonCode?: string; requiredAction?: string } {
    const flags = speechFlags();
    if (!flags.runtime) {
      return { allowed: false, reasonCode: "SPEECH_DISABLED_BY_FLAG", requiredAction: "Enable FEATURE_SPEECH_RUNTIME" };
    }
    if (job.type === "tts") {
      if (!flags.tts) return { allowed: false, reasonCode: "SPEECH_DISABLED_BY_FLAG", requiredAction: "TTS is disabled by flag" };
      const voice = this.store.getVoice(String(job.voiceId));
      if (!voice) return { allowed: false, reasonCode: "SPEECH_VOICE_NOT_FOUND", requiredAction: "Resolve the voice in the Pao-hubPro Voice Registry first" };
      if (voice.status === "blocked" || voice.status === "archived") {
        return { allowed: false, reasonCode: "SPEECH_POLICY_BLOCKED", requiredAction: `Voice is ${voice.status}` };
      }
      const stockSafe = job.request.stockSafe === true;
      const model = resolveVoiceModel(voice);
      const license = this.store.getLicenseByKey(voice.provider, model.engine, model.modelId);
      const licenseVerdict = evaluateModelLicense(license, { forStock: stockSafe });
      if (!licenseVerdict.allowed && (stockSafe || license?.status === "blocked")) {
        this.store.insertPolicyCheck({ jobId: job.id, gate: "license", decision: "blocked", reasonCode: licenseVerdict.reasonCode, requiredAction: licenseVerdict.requiredAction ?? null });
        return { allowed: false, reasonCode: licenseVerdict.reasonCode ?? "MODEL_LICENSE_UNVERIFIED", requiredAction: licenseVerdict.requiredAction };
      }
      if (!licenseVerdict.allowed) {
        // Non-stock use with an unverified license proceeds but the gap is
        // recorded — it can never silently become a stock approval.
        this.store.insertPolicyCheck({ jobId: job.id, gate: "license", decision: "warn", reasonCode: licenseVerdict.reasonCode, requiredAction: licenseVerdict.requiredAction ?? null });
      }
      if (stockSafe) {
        if (voice.status !== "active") {
          return { allowed: false, reasonCode: "VOICE_NOT_APPROVED_FOR_STOCK", requiredAction: "A human must approve this voice for stock use" };
        }
        if (voice.consentStatus !== "verified") {
          return { allowed: false, reasonCode: "VOICE_CONSENT_REQUIRED", requiredAction: "Cloned/reference voices need verified consent" };
        }
      }
      job.policySnapshot = { stockSafe, voiceStatus: voice.status, licenseStatus: license?.status ?? "unknown", model };
      return { allowed: true };
    }
    if (job.type === "stt") {
      if (!flags.stt) return { allowed: false, reasonCode: "SPEECH_DISABLED_BY_FLAG", requiredAction: "STT is disabled by flag" };
      try {
        resolveInSpeechWorkspace(String(job.request.audioPath), { mustExist: true });
      } catch {
        return { allowed: false, reasonCode: "SPEECH_PATH_OUTSIDE_WORKSPACE", requiredAction: "Audio must live inside the confined speech workspace" };
      }
      return { allowed: true };
    }
    if (job.type === "clone") {
      if (!flags.clone) return { allowed: false, reasonCode: "SPEECH_DISABLED_BY_FLAG", requiredAction: "Cloning is disabled by flag (FEATURE_SPEECH_CLONE)" };
      const consent = this.store.getConsent(String(job.request.consentId));
      const verdict = evaluateCloneGate({ consent });
      if (!verdict.allowed) {
        this.store.insertPolicyCheck({ jobId: job.id, gate: "consent", decision: "blocked", reasonCode: verdict.reasonCode, requiredAction: verdict.requiredAction ?? null });
        return { allowed: false, reasonCode: verdict.reasonCode ?? "VOICE_CONSENT_REQUIRED", requiredAction: verdict.requiredAction };
      }
      try {
        resolveInSpeechWorkspace(String(job.request.referencePath), { mustExist: true });
      } catch {
        return { allowed: false, reasonCode: "SPEECH_PATH_OUTSIDE_WORKSPACE", requiredAction: "Reference audio must live inside the confined speech workspace" };
      }
      job.policySnapshot = { consentId: consent!.id, consentBasis: consent!.consentBasis };
      return { allowed: true };
    }
    if (job.type === "dubbing") {
      return { allowed: false, reasonCode: "SPEECH_DISABLED_BY_FLAG", requiredAction: "Dubbing stays disabled until upstream ships a stable programmatic API (doc §19)" };
    }
    return { allowed: false, reasonCode: "SPEECH_INVALID_ARGUMENT", requiredAction: `Unsupported job type ${job.type}` };
  }

  private async runTtsJob(job: SpeechJobRecord): Promise<SpeechJobRecord> {
    const voice = this.store.getVoice(String(job.voiceId))!;
    const stockSafe = job.request.stockSafe === true;

    job.status = "waiting_for_runtime";
    job.progress = 10;
    this.store.saveJob(job);
    job.status = "running";
    job.progress = 30;
    this.store.saveJob(job);

    const synthesis = await this.provider.synthesize({
      text: String(job.request.text),
      voiceProfileId: voice.providerProfileId ?? voice.id,
      format: String(job.request.format ?? "wav"),
      language: job.request.language ? String(job.request.language) : undefined,
    });

    // Postprocessing (doc §15): raw is preserved; final is a separate artifact
    // version so downstream consumers never overwrite the generation.
    job.status = "postprocessing";
    job.progress = 70;
    this.store.saveJob(job);
    const dirs = ensureSpeechProjectDirs(job.projectId);
    const extension = String(job.request.format ?? "wav");
    const rawPath = join(dirs.audio, `raw_${job.id}.${extension}`);
    const finalPath = join(dirs.audio, `final_${job.id}.${extension}`);
    writeFileSync(rawPath, synthesis.bytes);
    copyFileSync(rawPath, finalPath);
    const probe = await probeAudio(finalPath);

    job.status = "policy_check";
    job.progress = 85;
    this.store.saveJob(job);

    const model = resolveVoiceModel(voice, synthesis);
    const license = this.store.getLicenseByKey(voice.provider, model.engine, model.modelId);
    const manifest = buildSpeechManifest({
      artifactId: "pending",
      projectId: job.projectId,
      provider: this.provider.id,
      voicestudioVersion: (await this.provider.healthCheck().catch(() => null))?.versionDetected ?? null,
      operation: "tts",
      engine: synthesis.engine ?? model.engine,
      modelId: synthesis.modelId ?? model.modelId,
      modelVersion: null,
      voiceId: voice.id,
      providerProfileId: voice.providerProfileId,
      language: job.request.language ? String(job.request.language) : voice.language,
      scriptSha256: sha256HexText(String(job.request.text)),
      sourceReferenceSha256: null,
      consentStatus: voice.consentStatus,
      licenseStatus: license?.status ?? "unknown",
      commercialUse: license?.commercialUse ?? false,
      stockUse: license?.stockUse ?? false,
      outputPath: finalPath,
      outputSha256: sha256HexBytes(synthesis.bytes),
      durationMs: probe.durationMs,
      sampleRate: probe.sampleRate,
      channels: probe.channels,
    });

    const artifactId = newArtifactId();
    manifest.artifactId = artifactId;
    assertManifestHasNoSecrets(manifest);

    let stockVerdict: { allowed: boolean; reasonCode: string | null; requiredAction?: string } = { allowed: true, reasonCode: null };
    if (stockSafe) {
      stockVerdict = evaluateSpeechStockExport({ voice, license, manifest });
      this.store.insertPolicyCheck({
        jobId: job.id,
        gate: "stock_export",
        decision: stockVerdict.allowed ? "allow" : "blocked",
        reasonCode: stockVerdict.reasonCode,
        requiredAction: stockVerdict.requiredAction ?? null,
      });
    }

    const artifact: SpeechArtifactRecord = {
      id: artifactId,
      jobId: job.id,
      projectId: job.projectId,
      role: "narration",
      rawPath,
      finalPath,
      sha256: manifest.output.sha256,
      durationMs: probe.durationMs,
      sampleRate: probe.sampleRate,
      channels: probe.channels,
      manifest,
      createdAt: nowIso(),
    };
    this.store.insertArtifact(artifact);

    job.outputArtifactId = artifactId;
    voice.lastUsedAt = nowIso();
    this.store.saveVoice(voice);

    if (!stockVerdict.allowed) {
      job.status = "blocked";
      job.errorCode = stockVerdict.reasonCode;
      job.errorMessage = stockVerdict.requiredAction ?? "Stock-safe policy blocked export";
      job.completedAt = nowIso();
      job.progress = 100;
      this.store.saveJob(job);
      this.store.appendAudit({
        actor: String(job.request.requestedBy ?? "system"),
        action: "speech.stock_export_blocked",
        target: artifactId,
        after: { jobId: job.id, reason: stockVerdict.reasonCode },
      });
      return job;
    }

    job.status = "completed";
    job.progress = 100;
    job.completedAt = nowIso();
    this.store.saveJob(job);
    recordAgentEvent({
      kind: "speech.artifact.ready",
      payload: {
        projectId: job.projectId,
        artifactId,
        role: "narration",
        path: finalPath,
        subtitlePath: null,
      },
    });
    return job;
  }

  private async runSttJob(job: SpeechJobRecord): Promise<SpeechJobRecord> {
    const audioPath = resolveInSpeechWorkspace(String(job.request.audioPath), { mustExist: true });
    job.status = "waiting_for_runtime";
    job.progress = 10;
    this.store.saveJob(job);
    job.status = "running";
    job.progress = 40;
    this.store.saveJob(job);

    const transcript = await this.provider.transcribe({
      audioPath,
      language: job.request.language ? String(job.request.language) : undefined,
      responseFormat: String(job.request.responseFormat ?? "verbose_json"),
    });

    job.status = "postprocessing";
    job.progress = 75;
    this.store.saveJob(job);
    const dirs = ensureSpeechProjectDirs(job.projectId);
    const jsonPath = join(dirs.transcripts, `transcript_${job.id}.json`);
    const txtPath = join(dirs.transcripts, `transcript_${job.id}.txt`);
    const srtPath = join(dirs.transcripts, `subtitles_${job.id}.srt`);
    const vttPath = join(dirs.transcripts, `subtitles_${job.id}.vtt`);
    writeFileSync(jsonPath, JSON.stringify(transcript, null, 2));
    writeFileSync(txtPath, transcript.text, "utf8");
    writeFileSync(srtPath, renderSrt(transcript.segments), "utf8");
    writeFileSync(vttPath, renderVtt(transcript.segments), "utf8");
    transcript.subtitlePaths = { json: jsonPath, txt: txtPath, srt: srtPath, vtt: vttPath };

    job.status = "policy_check";
    this.store.saveJob(job);
    const manifest = buildSpeechManifest({
      artifactId: "pending",
      projectId: job.projectId,
      provider: this.provider.id,
      voicestudioVersion: null,
      operation: "stt",
      engine: null,
      modelId: null,
      modelVersion: null,
      voiceId: null,
      providerProfileId: null,
      language: transcript.language,
      scriptSha256: null,
      sourceReferenceSha256: sha256HexFile(audioPath),
      consentStatus: "none",
      licenseStatus: "unknown",
      commercialUse: false,
      stockUse: false,
      outputPath: jsonPath,
      outputSha256: sha256HexFile(jsonPath),
      durationMs: transcript.segments.length > 0 ? Math.round(transcript.segments[transcript.segments.length - 1].end * 1000) : null,
      sampleRate: null,
      channels: null,
    });
    const artifactId = newArtifactId();
    manifest.artifactId = artifactId;
    assertManifestHasNoSecrets(manifest);
    const artifact: SpeechArtifactRecord = {
      id: artifactId,
      jobId: job.id,
      projectId: job.projectId,
      role: "transcript",
      rawPath: audioPath,
      finalPath: jsonPath,
      sha256: manifest.output.sha256,
      durationMs: manifest.output.durationMs,
      sampleRate: null,
      channels: null,
      manifest,
      createdAt: nowIso(),
    };
    this.store.insertArtifact(artifact);

    job.outputArtifactId = artifactId;
    job.status = "completed";
    job.progress = 100;
    job.completedAt = nowIso();
    this.store.saveJob(job);
    recordAgentEvent({
      kind: "speech.artifact.ready",
      payload: {
        projectId: job.projectId,
        artifactId,
        role: "transcript",
        path: jsonPath,
        subtitlePath: srtPath,
      },
    });
    return job;
  }

  private async runCloneJob(job: SpeechJobRecord): Promise<SpeechJobRecord> {
    const consent = this.store.getConsent(String(job.request.consentId))!;
    const referencePath = resolveInSpeechWorkspace(String(job.request.referencePath), { mustExist: true });
    job.status = "waiting_for_runtime";
    this.store.saveJob(job);
    job.status = "running";
    job.progress = 40;
    this.store.saveJob(job);

    const cloned = await this.provider.cloneVoice({
      referencePath,
      voiceName: String(job.request.voiceName),
    });

    // Cloned voices always start pending human review (doc §18): they never
    // become active or stock-safe automatically.
    const now = nowIso();
    const voiceId = newVoiceId();
    const voice: VoiceProfileRecord = {
      id: voiceId,
      provider: this.provider.id,
      providerProfileId: cloned.providerProfileId,
      name: String(job.request.voiceName),
      language: job.request.language ? String(job.request.language) : consent.allowedUses.includes("language_th") ? "th" : null,
      purposes: [],
      origin: "cloned",
      status: "pending_review",
      commercialUseStatus: "unknown",
      consentStatus: "verified",
      licenseStatus: "unknown",
      impersonatesPublicFigure: false,
      stockApprovedAt: null,
      createdFrom: { type: "consented_reference", consentId: consent.id },
      metadata: { referenceSha256: sha256HexFile(referencePath) },
      lastUsedAt: null,
      createdAt: now,
      updatedAt: now,
    };
    this.store.insertVoice(voice);
    job.outputArtifactId = null;
    job.status = "completed";
    job.progress = 100;
    job.completedAt = now;
    this.store.saveJob(job);
    this.store.appendAudit({
      actor: String(job.request.requestedBy ?? "system"),
      action: "voice.cloned",
      target: voiceId,
      after: { providerProfileId: cloned.providerProfileId, status: voice.status, consentId: consent.id },
      reason: "Cloned voice registered pending human review",
    });
    return job;
  }

  private handleJobFailure(job: SpeechJobRecord, err: unknown): SpeechJobRecord {
    const isSpeechError = err instanceof SpeechError;
    const code = isSpeechError ? err.code : "SPEECH_OUTPUT_INVALID";
    const message = err instanceof Error ? err.message : String(err);
    if (isSpeechError && err.retryable && job.attempt + 1 < job.maxAttempts) {
      job.attempt += 1;
      job.status = "queued";
      job.progress = 0;
      this.store.saveJob(job);
      return job;
    }
    job.status = "failed";
    job.errorCode = code;
    job.errorMessage = message;
    job.completedAt = nowIso();
    this.store.saveJob(job);
    this.store.appendAudit({
      actor: String(job.request.requestedBy ?? "system"),
      action: "speech.job_failed",
      target: job.id,
      after: { type: job.type, code },
    });
    return job;
  }

  async cancelJob(jobId: string, actor: string): Promise<SpeechJobRecord> {
    const job = this.store.getJob(jobId);
    if (!job) throw new SpeechError("SPEECH_JOB_NOT_FOUND", `Speech job not found: ${jobId}`);
    if (job.status !== "queued") {
      throw new SpeechError("SPEECH_INVALID_ARGUMENT", "Only queued jobs can be cancelled");
    }
    job.status = "cancelled";
    job.completedAt = nowIso();
    this.store.saveJob(job);
    this.store.appendAudit({ actor, action: "speech.job_cancelled", target: jobId });
    return job;
  }

  // --- governance (human-only) -----------------------------------------------------

  private assertHuman(actor: string): void {
    if (!isHumanActor(actor)) {
      throw new SpeechError("SPEECH_POLICY_BLOCKED", "invariant violation: only human actors may resolve speech governance state");
    }
  }

  approveVoiceForStock(voiceId: string, actor: string, reason: string): VoiceProfileRecord {
    this.assertHuman(actor);
    const voice = this.store.getVoice(voiceId);
    if (!voice) throw new SpeechError("SPEECH_VOICE_NOT_FOUND", `Voice not found: ${voiceId}`);
    if (voice.consentStatus !== "verified") {
      throw new SpeechError("VOICE_CONSENT_REQUIRED", "Voice needs verified consent before stock approval");
    }
    const before = { status: voice.status, commercialUseStatus: voice.commercialUseStatus };
    voice.status = "active";
    voice.commercialUseStatus = "approved";
    voice.stockApprovedAt = nowIso();
    this.store.saveVoice(voice);
    this.store.appendAudit({ actor, action: "voice.stock_approved", target: voiceId, before, after: { status: voice.status, commercialUseStatus: voice.commercialUseStatus }, reason });
    return voice;
  }

  blockVoice(voiceId: string, actor: string, reason: string): VoiceProfileRecord {
    this.assertHuman(actor);
    const voice = this.store.getVoice(voiceId);
    if (!voice) throw new SpeechError("SPEECH_VOICE_NOT_FOUND", `Voice not found: ${voiceId}`);
    const before = { status: voice.status };
    voice.status = "blocked";
    this.store.saveVoice(voice);
    this.store.appendAudit({ actor, action: "voice.blocked", target: voiceId, before, after: { status: "blocked" }, reason });
    return voice;
  }

  registerConsent(input: {
    voiceId?: string | null;
    subjectType: string;
    subjectAlias: string;
    consentBasis: string;
    consentDocumentRef?: string | null;
    allowedUses?: string[];
    commercialUseAllowed?: boolean;
    stockUseAllowed?: boolean;
    voiceCloneAllowed?: boolean;
    expiresAt?: string | null;
  }, actor: string): VoiceConsentRecord {
    this.assertHuman(actor);
    if (!CONSENT_BASES.includes(input.consentBasis as (typeof CONSENT_BASES)[number])) {
      throw new SpeechError("VOICE_CLONE_NOT_ALLOWED", "Consent basis is not an acceptable production basis (doc §9)");
    }
    const now = nowIso();
    const consent: VoiceConsentRecord = {
      id: newConsentId(),
      voiceId: input.voiceId ?? null,
      subjectType: input.subjectType,
      subjectAlias: input.subjectAlias,
      consentBasis: input.consentBasis as VoiceConsentRecord["consentBasis"],
      consentDocumentRef: input.consentDocumentRef ?? null,
      allowedUses: input.allowedUses ?? [],
      commercialUseAllowed: input.commercialUseAllowed ?? false,
      stockUseAllowed: input.stockUseAllowed ?? false,
      voiceCloneAllowed: input.voiceCloneAllowed ?? false,
      expiresAt: input.expiresAt ?? null,
      revokedAt: null,
      createdAt: now,
      updatedAt: now,
    };
    this.store.insertConsent(consent);
    if (consent.voiceId) {
      const voice = this.store.getVoice(consent.voiceId);
      if (voice) {
        voice.consentStatus = "verified";
        this.store.saveVoice(voice);
      }
    }
    this.store.appendAudit({ actor, action: "consent.registered", target: consent.id, after: { basis: consent.consentBasis, voiceId: consent.voiceId } });
    return consent;
  }

  revokeConsent(consentId: string, actor: string, reason: string): void {
    this.assertHuman(actor);
    const consent = this.store.getConsent(consentId);
    if (!consent) throw new SpeechError("SPEECH_INVALID_ARGUMENT", `Consent not found: ${consentId}`);
    this.store.revokeConsent(consentId, nowIso());
    if (consent.voiceId) {
      const voice = this.store.getVoice(consent.voiceId);
      if (voice) {
        voice.consentStatus = "revoked";
        this.store.saveVoice(voice);
      }
    }
    this.store.appendAudit({ actor, action: "consent.revoked", target: consentId, reason });
  }

  registerLicense(input: {
    provider: string;
    engine: string;
    modelId: string;
    modelVersion?: string | null;
    codeLicense?: string | null;
    weightsLicense?: string | null;
    sourceUrl?: string | null;
  }, actor: string): ModelLicenseRecord {
    this.assertHuman(actor);
    const now = nowIso();
    const license: ModelLicenseRecord = {
      id: newLicenseId(),
      provider: input.provider,
      engine: input.engine,
      modelId: input.modelId,
      modelVersion: input.modelVersion ?? null,
      codeLicense: input.codeLicense ?? null,
      weightsLicense: input.weightsLicense ?? null,
      commercialUse: false,
      stockUse: false,
      attributionRequired: false,
      status: "unknown",
      sourceUrl: input.sourceUrl ?? null,
      verifiedAt: null,
      verifiedBy: null,
      updatedAt: now,
    };
    this.store.insertLicense(license);
    this.store.appendAudit({ actor, action: "license.registered", target: license.id, after: { provider: license.provider, engine: license.engine, modelId: license.modelId, status: license.status } });
    return license;
  }

  reviewLicense(licenseId: string, review: {
    status: "approved" | "blocked" | "review_required" | "unknown";
    commercialUse: boolean;
    stockUse: boolean;
    attributionRequired?: boolean;
  }, actor: string): ModelLicenseRecord {
    this.assertHuman(actor);
    const license = this.store.getLicense(licenseId);
    if (!license) throw new SpeechError("SPEECH_INVALID_ARGUMENT", `License record not found: ${licenseId}`);
    const before = { status: license.status, commercialUse: license.commercialUse, stockUse: license.stockUse };
    license.status = review.status;
    license.commercialUse = review.commercialUse;
    license.stockUse = review.stockUse;
    license.attributionRequired = review.attributionRequired ?? license.attributionRequired;
    license.verifiedAt = nowIso();
    license.verifiedBy = actor;
    this.store.saveLicense(license);
    this.store.appendAudit({ actor, action: "license.status_changed", target: licenseId, before, after: { status: license.status, commercialUse: license.commercialUse, stockUse: license.stockUse } });
    return license;
  }

  // --- reads ---------------------------------------------------------------------------

  listVoices(): VoiceProfileRecord[] {
    return this.store.listVoices();
  }

  listJobs(limit = 50): SpeechJobRecord[] {
    return this.store.listJobs(limit);
  }

  getJobWithChecks(jobId: string): { job: SpeechJobRecord; policyChecks: ReturnType<SpeechStore["listPolicyChecks"]> } | null {
    const job = this.store.getJob(jobId);
    if (!job) return null;
    return { job, policyChecks: this.store.listPolicyChecks(jobId) };
  }

  getArtifact(id: string): SpeechArtifactRecord | null {
    return this.store.getArtifact(id);
  }

  listArtifacts(limit = 50): SpeechArtifactRecord[] {
    return this.store.listArtifacts(limit);
  }

  listLicenses(): ModelLicenseRecord[] {
    return this.store.listLicenses();
  }

  listConsents(): VoiceConsentRecord[] {
    return this.store.listConsents();
  }

  listAudit(limit = 50): ReturnType<SpeechStore["listAudit"]> {
    return this.store.listAudit(limit);
  }

  /** Redacted diagnostics bundle (doc §39, §41) — never prints the API key. */
  diagnostics(): Record<string, unknown> {
    const config = checkVoiceStudioConfig();
    return {
      provider: this.provider.id,
      versionPin: VOICESTUDIO_VERSION_PIN,
      connection: speechConnectionDiagnostics(),
      workspace: workspaceDiagnostics(),
      mcpFileModeEnforced: true,
      remoteMode: config.remoteMode,
      flags: speechFlags(),
      latestHealth: this.store.latestHealth(),
    };
  }

  /** Preflight for the dashboard Generate form (doc §28.1): policy status
   *  chips without executing anything. */
  voicePolicyStatus(voiceId: string, opts?: { forStock?: boolean }): {
    found: boolean;
    consent: string;
    license: string;
    commercial: string;
    stock: string;
    runtime: string;
  } {
    const voice = this.store.getVoice(voiceId);
    if (!voice) {
      return { found: false, consent: "none", license: "unknown", commercial: "unknown", stock: "blocked", runtime: "unknown" };
    }
    const model = resolveVoiceModel(voice);
    const license = this.store.getLicenseByKey(voice.provider, model.engine, model.modelId);
    const stockVerdict = evaluateSpeechStockExport({ voice, license, manifest: null });
    return {
      found: true,
      consent: voice.consentStatus,
      license: license?.status ?? "unknown",
      commercial: voice.commercialUseStatus,
      stock: stockVerdict.allowed ? "approved" : stockVerdict.reasonCode ?? "blocked",
      runtime: this.store.latestHealth()?.state ?? "unknown",
    };
  }
}

function resolveVoiceModel(voice: VoiceProfileRecord, synthesis?: { engine?: string; modelId?: string }): { engine: string; modelId: string } {
  return {
    engine: synthesis?.engine ?? (typeof voice.metadata.engine === "string" ? voice.metadata.engine : STOCK_DEFAULT),
    modelId: synthesis?.modelId ?? (typeof voice.metadata.modelId === "string" ? voice.metadata.modelId : STOCK_DEFAULT),
  };
}

/** Optional ffprobe metadata (doc §15); absence never fails a job. */
async function probeAudio(path: string): Promise<{ durationMs: number | null; sampleRate: number | null; channels: number | null }> {
  try {
    const result = await runProcessSafely({
      binary: process.platform === "win32" ? "ffprobe.exe" : "ffprobe",
      args: ["-v", "quiet", "-print_format", "json", "-show_streams", path],
      timeoutMs: 15_000,
    });
    if (result.exitCode !== 0) return { durationMs: null, sampleRate: null, channels: null };
    const parsed = JSON.parse(result.stdout) as { streams?: Array<Record<string, unknown>> };
    const stream = parsed.streams?.[0];
    if (!stream) return { durationMs: null, sampleRate: null, channels: null };
    const sampleRate = Number.parseInt(String(stream.sample_rate ?? ""), 10);
    const durationSec = Number.parseFloat(String(stream.duration ?? ""));
    return {
      durationMs: Number.isFinite(durationSec) ? Math.round(durationSec * 1000) : null,
      sampleRate: Number.isFinite(sampleRate) ? sampleRate : null,
      channels: typeof stream.channels === "number" ? stream.channels : null,
    };
  } catch {
    return { durationMs: null, sampleRate: null, channels: null };
  }
}

function pad(value: number, size = 2): string {
  return String(Math.floor(value)).padStart(size, "0");
}

function timestamp(seconds: number, msSeparator: string): string {
  const clamped = Math.max(0, seconds);
  const hours = Math.floor(clamped / 3600);
  const minutes = Math.floor((clamped % 3600) / 60);
  const secs = Math.floor(clamped % 60);
  const millis = Math.round((clamped - Math.floor(clamped)) * 1000);
  return `${pad(hours)}:${pad(minutes)}:${pad(secs)}${msSeparator}${pad(millis, 3)}`;
}

export function renderSrt(segments: Array<{ start: number; end: number; text: string }>): string {
  return segments
    .map((segment, index) => `${index + 1}\n${timestamp(segment.start, ",")} --> ${timestamp(segment.end, ",")}\n${segment.text}\n`)
    .join("\n");
}

export function renderVtt(segments: Array<{ start: number; end: number; text: string }>): string {
  const body = segments
    .map((segment) => `${timestamp(segment.start, ".")} --> ${timestamp(segment.end, ".")}\n${segment.text}\n`)
    .join("\n");
  return `WEBVTT\n\n${body}`;
}

function defaultSpeechProvider(): SpeechProvider {
  return process.env.SPEECH_PROVIDER === "mock" ? new MockSpeechProvider() : new VoiceStudioProvider();
}

let singleton: SpeechService | null = null;

export function getSpeechService(): SpeechService {
  if (!singleton) singleton = new SpeechService();
  return singleton;
}

export function resetSpeechServiceForTests(): void {
  singleton = null;
}
