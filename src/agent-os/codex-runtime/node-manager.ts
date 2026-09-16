// Phase 20.21 — Pao-hubPro x OpenAI Codex Native Runtime Integration
// Remote Node Model & Node Registry (Windows PC, Linux VPS).

import { hostname } from "node:os";
import { CodexRuntimeStore } from "./store";
import { CodexDetector } from "./detector";
import type { RuntimeNode } from "./types";

export class NodeManager {
  constructor(private store = new CodexRuntimeStore()) {}

  ensureLocalNode(): RuntimeNode {
    const localId = "local_pc";
    let node = this.store.getNode(localId);

    const platform = CodexDetector.detectPlatform();
    const bin = CodexDetector.getCodexBinaryPath();
    const version = CodexDetector.probeCodexVersion(bin);
    const cap = CodexDetector.detectCapabilities();
    const now = new Date().toISOString();

    if (!node) {
      node = {
        id: localId,
        name: `Local ${platform === "windows" ? "Windows PC" : "Linux Host"}`,
        platform,
        hostname: hostname(),
        codexVersion: version,
        runtimeMode: "auto",
        connectionState: cap.codexInstalled ? "online" : "degraded",
        lastSeen: now,
        capabilityReport: cap,
        policyProfile: "NORMAL",
        enabled: true,
        createdAt: now,
        updatedAt: now,
      };
      this.store.upsertNode(node);
    } else {
      node.codexVersion = version;
      node.connectionState = cap.codexInstalled ? "online" : "degraded";
      node.capabilityReport = cap;
      node.lastSeen = now;
      node.updatedAt = now;
      this.store.upsertNode(node);
    }

    return node;
  }

  registerNode(nodeData: Partial<RuntimeNode> & { id: string; name: string }): RuntimeNode {
    const platform = nodeData.platform || CodexDetector.detectPlatform();
    const now = new Date().toISOString();

    const node: RuntimeNode = {
      id: nodeData.id,
      name: nodeData.name,
      platform,
      hostname: nodeData.hostname || "unknown",
      codexVersion: nodeData.codexVersion || null,
      runtimeMode: nodeData.runtimeMode || "auto",
      connectionState: nodeData.connectionState || "online",
      lastSeen: now,
      capabilityReport: nodeData.capabilityReport || CodexDetector.detectCapabilities(),
      policyProfile: nodeData.policyProfile || "NORMAL",
      enabled: nodeData.enabled ?? true,
      createdAt: now,
      updatedAt: now,
    };

    this.store.upsertNode(node);
    return node;
  }

  getNode(id: string): RuntimeNode | null {
    return this.store.getNode(id);
  }

  listNodes(): RuntimeNode[] {
    const list = this.store.listNodes();
    if (list.length === 0) {
      this.ensureLocalNode();
      return this.store.listNodes();
    }
    return list;
  }
}
