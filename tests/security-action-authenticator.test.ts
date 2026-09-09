import { describe, expect, test } from "bun:test";
import { ActionAuthenticator } from "../src/agent-os/security/action-authenticator";

describe("Phase 25 — ActionAuthenticator", () => {
  const authenticator = new ActionAuthenticator(30_000); // 30s window
  const testSecret = "pao-hubpro-agent-cryptographic-secret-2026";
  const agentId = "agent-lead-architect";

  test("creates and verifies a valid cryptographic ActionProof", () => {
    const payload = { action: "deploy_model", model: "qwen-2.5-coder", costLimit: 2.5 };
    const proof = authenticator.createProof(agentId, "deploy_action", payload, testSecret);

    expect(proof.id).toBeDefined();
    expect(proof.agentId).toBe(agentId);
    expect(proof.signature).toBeDefined();
    expect(proof.nonce).toBeDefined();

    const result = authenticator.verifyProof(proof, agentId, payload, testSecret);
    expect(result.valid).toBe(true);
    expect(result.proof?.id).toBe(proof.id);
  });

  test("rejects verification when payload has been tampered with", () => {
    const originalPayload = { action: "transfer_funds", amountUsd: 10 };
    const tamperedPayload = { action: "transfer_funds", amountUsd: 10000 };

    const proof = authenticator.createProof(agentId, "transfer_action", originalPayload, testSecret);
    const result = authenticator.verifyProof(proof, agentId, tamperedPayload, testSecret);

    expect(result.valid).toBe(false);
    expect(result.reason).toContain("Payload integrity violation");
  });

  test("rejects verification on replay attack (nonce reuse)", () => {
    const payload = { task: "execute_migration" };
    const proof = authenticator.createProof(agentId, "migration_action", payload, testSecret);

    // First verification should pass
    const firstCheck = authenticator.verifyProof(proof, agentId, payload, testSecret);
    expect(firstCheck.valid).toBe(true);

    // Second verification with identical nonce must be rejected
    const secondCheck = authenticator.verifyProof(proof, agentId, payload, testSecret);
    expect(secondCheck.valid).toBe(false);
    expect(secondCheck.reason).toContain("Replay attack detected");
  });

  test("rejects verification when secret is incorrect", () => {
    const payload = { task: "read_database" };
    const proof = authenticator.createProof(agentId, "db_read", payload, testSecret);

    const result = authenticator.verifyProof(proof, agentId, payload, "wrong-compromised-secret");
    expect(result.valid).toBe(false);
    expect(result.reason).toContain("Cryptographic signature verification failed");
  });

  test("rejects verification when agent ID does not match expectation", () => {
    const payload = { task: "compile_binary" };
    const proof = authenticator.createProof("rogue-agent-x", "compile", payload, testSecret);

    const result = authenticator.verifyProof(proof, "agent-lead-architect", payload, testSecret);
    expect(result.valid).toBe(false);
    expect(result.reason).toContain("Agent mismatch");
  });

  test("rejects expired proofs", () => {
    const payload = { task: "restart_node" };
    const proof = authenticator.createProof(agentId, "restart", payload, testSecret);

    // Simulate verification 40 seconds later (exceeds 30s limit)
    const futureTime = proof.timestamp + 40_000;
    const result = authenticator.verifyProof(proof, agentId, payload, testSecret, futureTime);

    expect(result.valid).toBe(false);
    expect(result.reason).toContain("Proof expired");
  });
});
