/**
 * Pao Agent Platform — id helpers, event ledger, cryptographic receipts
 * (Phase 20.54 §31-33) and the secure tool executor (§28-29).
 *
 * Receipts: Ed25519 signatures over canonical JSON, hash-chained per scope.
 * A valid receipt proves attribution/integrity/order of recorded action data
 * — it does NOT prove the action was correct, safe or policy-optimal.
 */

import { createHash, createPublicKey, generateKeyPairSync, sign as cryptoSign, verify as cryptoVerify, KeyObject } from "node:crypto";
import { canonicalJson } from "./governance";
import { PlatformError, type ReceiptPayload, type ReceiptRecord, type ToolExecutionEnvelope, type ToolExecutionResult } from "./types";
import { nextId } from "./events";

// ---------------------------------------------------------------------------
// Ids
// ---------------------------------------------------------------------------
export { nextId };

export function sha256Hex(data: string | Uint8Array): string {
  return `sha256:${createHash("sha256").update(data).digest("hex")}`;
}

// ---------------------------------------------------------------------------
// Receipt keys
// ---------------------------------------------------------------------------

export interface ReceiptKeyPair {
  readonly keyId: string;
  readonly privateKey: KeyObject;
  readonly publicKey: KeyObject;
}

export function generateReceiptKeyPair(keyId = "pao-receipt-v1"): ReceiptKeyPair {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  return { keyId, privateKey, publicKey };
}

// ---------------------------------------------------------------------------
// Receipt service with hash chaining
// ---------------------------------------------------------------------------

export class ReceiptService {
  private readonly keys: Map<string, ReceiptKeyPair> = new Map();
  private readonly chain: Map<string, string> = new Map(); // scope -> last hash
  private readonly records: ReceiptRecord[] = [];
  private readonly defaultKeyId: string;
  private readonly enabled: boolean;

  constructor(options: { defaultKeyId?: string; enabled?: boolean } = {}) {
    this.defaultKeyId = options.defaultKeyId ?? "pao-receipt-v1";
    this.enabled = options.enabled ?? true;
    if (this.enabled) this.addKey(generateReceiptKeyPair(this.defaultKeyId));
  }

  get isEnabled(): boolean {
    return this.enabled;
  }

  addKey(pair: ReceiptKeyPair): void {
    this.keys.set(pair.keyId, pair);
  }

  getPublicKeyPem(keyId = this.defaultKeyId): string | null {
    const pair = this.keys.get(keyId);
    if (!pair) return null;
    return pair.publicKey.export({ type: "spki", format: "pem" }).toString();
  }

  /**
   * Create a signed, chained receipt for a privileged action. Chain scope is
   * the agent id — the operational unit whose action order matters.
   */
  createReceipt(payload: Omit<ReceiptPayload, "version" | "receiptId" | "previousHash" | "timestamp">): ReceiptRecord | null {
    if (!this.enabled) return null;
    const previousHash = this.chain.get(payload.agentId) ?? "sha256:genesis";
    const full: ReceiptPayload = {
      version: "pao.receipt/v1",
      receiptId: nextId("rcpt"),
      previousHash,
      timestamp: new Date().toISOString(),
      ...payload,
    };
    const payloadJson = canonicalJson(full);
    const payloadHash = sha256Hex(payloadJson);
    const pair = this.keys.get(this.defaultKeyId);
    if (!pair) throw new PlatformError("RECEIPT_VERIFICATION_FAILED", "no signing key configured", 500);
    const signature = cryptoSign(null, Buffer.from(payloadJson, "utf-8"), pair.privateKey).toString("base64");
    const record: ReceiptRecord = { payload: full, payloadHash, signature, signingKeyId: this.defaultKeyId };
    this.records.push(record);
    this.chain.set(payload.agentId, payloadHash);
    return record;
  }

  /** Verify one receipt against a known public key. */
  verifyReceipt(record: ReceiptRecord, publicKeyPem?: string): { valid: boolean; reason?: string } {
    const pair = publicKeyPem ? null : this.keys.get(record.signingKeyId);
    let publicKey: KeyObject;
    try {
      publicKey = pair ? pair.publicKey : createPublicKey(publicKeyPem ?? "");
    } catch {
      return { valid: false, reason: "unknown signing key" };
    }
    const recomputed = sha256Hex(canonicalJson(record.payload));
    if (recomputed !== record.payloadHash) {
      return { valid: false, reason: "payload hash mismatch (payload altered)" };
    }
    const valid = cryptoVerify(
      null,
      Buffer.from(canonicalJson(record.payload), "utf-8"),
      publicKey instanceof KeyObject ? publicKey : createPublicKey(publicKey),
      Buffer.from(record.signature, "base64"),
    );
    return valid ? { valid: true } : { valid: false, reason: "signature verification failed" };
  }

  /**
   * Verify the full chain for an agent scope: each receipt's previousHash
   * must link to the prior receipt's payload hash, in order.
   */
  verifyChain(agentId: string): { valid: boolean; brokenAt?: string; reason?: string } {
    const chain = this.records.filter(r => r.payload.agentId === agentId);
    if (chain.length === 0) return { valid: true };
    let expectedPrevious = "sha256:genesis";
    for (const record of chain) {
      if (record.payload.previousHash !== expectedPrevious) {
        return { valid: false, brokenAt: record.payload.receiptId, reason: "chain link broken (removed or reordered receipt)" };
      }
      const single = this.verifyReceipt(record);
      if (!single.valid) {
        return { valid: false, brokenAt: record.payload.receiptId, reason: single.reason };
      }
      expectedPrevious = record.payloadHash;
    }
    return { valid: true };
  }

  list(agentId?: string): ReceiptRecord[] {
    return agentId ? this.records.filter(r => r.payload.agentId === agentId) : [...this.records];
  }
}

// ---------------------------------------------------------------------------
// Secure tool executor (§28-29)
// ---------------------------------------------------------------------------

export type ToolImplementation = (args: Readonly<Record<string, unknown>>) => Promise<unknown> | unknown;

export interface ExecutorSandbox {
  /** Allowed path prefixes for filesystem-style tools (canonicalized). */
  readonly allowedPaths?: readonly string[];
  /** Allowed shell command prefixes, when shell capability is granted. */
  readonly allowedCommandPrefixes?: readonly string[];
  readonly maxOutputChars: number;
  readonly timeoutMs: number;
  /** Shell metacharacters that indicate chaining/injection attempts. */
  readonly denyShellMetacharacters?: boolean;
}

export interface SecureExecutorDeps {
  readonly sandbox: ExecutorSandbox;
  readonly tools: Readonly<Record<string, ToolImplementation>>;
  readonly now?: () => number;
}

const SHELL_METACHARACTERS = /[;&|`$><\n]/;

export function canonicalizePath(path: string, workspaceRoot = ""): string {
  const normalized = path.replace(/\\/g, "/");
  const parts = normalized.split("/");
  const stack: string[] = [];
  for (const part of parts) {
    if (part === "" || part === ".") continue;
    if (part === "..") {
      stack.pop();
      continue;
    }
    stack.push(part);
  }
  const joined = stack.join("/");
  return workspaceRoot ? `${workspaceRoot.replace(/\/$/, "")}/${joined}` : `/${joined}`;
}

function redactSecrets(text: string): string {
  // Deterministic redaction of common credential shapes before persistence.
  return text
    .replace(/sk-[A-Za-z0-9_-]{8,}/g, "[REDACTED]")
    .replace(/gh[pousr]_[A-Za-z0-9]{8,}/g, "[REDACTED]")
    .replace(/(authorization\s*:\s*bearer\s+)\S+/gi, "$1[REDACTED]")
    .replace(/(password|passwd|secret)\s*[=:]\s*\S+/gi, "$1=[REDACTED]");
}

export class SecureToolExecutor {
  private readonly sandbox: ExecutorSandbox;
  private readonly tools: Readonly<Record<string, ToolImplementation>>;
  private readonly now: () => number;
  private readonly recentCalls: Map<string, { hash: string; count: number; at: number }> = new Map();

  constructor(deps: SecureExecutorDeps) {
    this.sandbox = deps.sandbox;
    this.tools = deps.tools;
    this.now = deps.now ?? Date.now;
  }

  /**
   * Repeated identical tool calls within a short window indicate a loop
   * (spec §51). Six identical calls fail closed with LOOP_LIMIT_EXCEEDED.
   */
  private checkLoop(agentId: string, envelope: ToolExecutionEnvelope): void {
    const key = `${agentId}:${envelope.capability}`;
    const recent = this.recentCalls.get(key);
    if (recent && recent.hash === envelope.argumentsHash && this.now() - recent.at < 60_000) {
      recent.count += 1;
      recent.at = this.now();
      if (recent.count >= 6) {
        throw new PlatformError("LOOP_LIMIT_EXCEEDED", `Repeated identical tool call ${envelope.capability} detected`, 429);
      }
      return;
    }
    this.recentCalls.set(key, { hash: envelope.argumentsHash, count: 1, at: this.now() });
  }

  async dispatch(envelope: ToolExecutionEnvelope, sandboxAllowed: boolean): Promise<ToolExecutionResult> {
    const startedAt = new Date(this.now()).toISOString();
    const implementation = this.tools[envelope.toolId];
    if (!implementation) {
      return this.fail(envelope, startedAt, "CAPABILITY_MISSING", `No tool implementation for ${envelope.toolId}`);
    }

    try {
      // 1. Argument schema sanity: arguments must be an object with a hash.
      if (envelope.arguments === null || typeof envelope.arguments !== "object" || Array.isArray(envelope.arguments)) {
        return this.fail(envelope, startedAt, "TOOL_SCHEMA_INVALID", "arguments must be an object");
      }

      // 2. Loop protection.
      this.checkLoop(envelope.agentId, envelope);

      // 3. Sandbox enforcement.
      if (this.sandbox.allowedPaths && !sandboxAllowed) {
        return this.fail(envelope, startedAt, "SECURITY_VIOLATION", "Sandbox profile does not permit this execution");
      }
      const path = typeof envelope.arguments.path === "string" ? envelope.arguments.path : null;
      if (path && this.sandbox.allowedPaths) {
        const canonical = canonicalizePath(path);
        const within = this.sandbox.allowedPaths.some(root => canonical.startsWith(canonicalizePath(root)));
        if (!within) {
          return this.fail(envelope, startedAt, "SECURITY_VIOLATION", `Path ${canonical} escapes the sandbox allowlist`);
        }
      }
      const command = typeof envelope.arguments.command === "string" ? envelope.arguments.command : null;
      if (command) {
        if (this.sandbox.denyShellMetacharacters && SHELL_METACHARACTERS.test(command)) {
          return this.fail(envelope, startedAt, "SECURITY_VIOLATION", "Shell metacharacters are not permitted");
        }
        if (this.sandbox.allowedCommandPrefixes) {
          const within = this.sandbox.allowedCommandPrefixes.some(prefix => command.trim().startsWith(prefix));
          if (!within) {
            return this.fail(envelope, startedAt, "SECURITY_VIOLATION", `Command does not match the allowlist`);
          }
        }
      }

      // 4. Execute with timeout.
      const timeoutMs = this.sandbox.timeoutMs;
      const result = await Promise.race([
        Promise.resolve(implementation(envelope.arguments)),
        new Promise((_resolve, reject) => setTimeout(() => reject(new Error("timeout")), timeoutMs)),
      ]);

      // 5. Output limits + redaction.
      let serialized = typeof result === "string" ? result : JSON.stringify(result) ?? "";
      if (serialized.length > this.sandbox.maxOutputChars) {
        serialized = serialized.slice(0, this.sandbox.maxOutputChars);
      }
      serialized = redactSecrets(serialized);

      return {
        toolCallId: envelope.toolCallId,
        status: "success",
        result: serialized,
        resultHash: sha256Hex(serialized),
        startedAt,
        completedAt: new Date(this.now()).toISOString(),
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : "execution failed";
      if (err instanceof PlatformError) {
        return this.fail(envelope, startedAt, err.code as ToolExecutionResult["errorCode"] ?? "TOOL_EXECUTION_FAILED", message);
      }
      return this.fail(envelope, startedAt, message === "timeout" ? "TOOL_TIMEOUT" : "TOOL_EXECUTION_FAILED", message.slice(0, 200));
    }
  }

  private fail(envelope: ToolExecutionEnvelope, startedAt: string, errorCode: NonNullable<ToolExecutionResult["errorCode"]>, message: string): ToolExecutionResult {
    return {
      toolCallId: envelope.toolCallId,
      status: errorCode === "SECURITY_VIOLATION" || errorCode === "POLICY_DENIED" || errorCode === "APPROVAL_REQUIRED" || errorCode === "APPROVAL_EXPIRED" ? "denied" : "failed",
      errorCode,
      result: message,
      resultHash: sha256Hex(message),
      startedAt,
      completedAt: new Date(this.now()).toISOString(),
    };
  }
}
