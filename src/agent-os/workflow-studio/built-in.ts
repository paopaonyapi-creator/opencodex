// Phase 20.93 — Built-in node definitions.
//
// Handlers are referenced through the executor maps of nodes.ts using static
// (deterministic) property access. Every definition declares typed ports,
// config schema, required capabilities, risk level and side-effect class —
// the compiler expands these into the policy plan before any execution.

import { z } from "zod";
import type { WorkflowNodeDefinition, PortType } from "./types";
import { EXECUTORS, REMOTE_EXECUTORS } from "./nodes";

const P = (name: string, type: PortType, required = false) => ({ name, type, required });
const FLEX = z.record(z.string(), z.unknown());

export const BUILT_IN_NODES: WorkflowNodeDefinition[] = [
  // Triggers
  { type: "trigger.manual", version: "1.0.0", category: "trigger", title: "Manual Trigger", description: "Starts the workflow on demand.", inputPorts: [], outputPorts: [P("output", "any", true)], configSchema: z.object({}).passthrough(), requiredCapabilities: [], riskLevel: "low", executionMode: "local", supportsRetry: false, supportsResume: false, timeoutMs: 5_000, sideEffect: "none", execute: EXECUTORS.jsonInput },
  { type: "input.json", version: "1.0.0", category: "control", title: "JSON Input", description: "Provides a structured payload (optionally sequenced after a trigger).", inputPorts: [P("input", "json")], outputPorts: [P("output", "json", true)], configSchema: FLEX, requiredCapabilities: [], riskLevel: "low", executionMode: "local", supportsRetry: false, supportsResume: false, timeoutMs: 5_000, sideEffect: "none", execute: EXECUTORS.jsonInput },
  // Control
  { type: "control.condition", version: "1.0.0", category: "control", title: "Condition", description: "Routes execution on true/false ports.", inputPorts: [P("input", "any", true)], outputPorts: [P("true", "any"), P("false", "any")], configSchema: FLEX, requiredCapabilities: [], riskLevel: "low", executionMode: "local", supportsRetry: true, supportsResume: false, timeoutMs: 5_000, sideEffect: "none", execute: EXECUTORS.runCondition },
  { type: "control.delay", version: "1.0.0", category: "control", title: "Delay", description: "Waits a bounded duration.", inputPorts: [P("input", "any")], outputPorts: [P("output", "any")], configSchema: FLEX, requiredCapabilities: [], riskLevel: "low", executionMode: "local", supportsRetry: true, supportsResume: false, timeoutMs: 65_000, sideEffect: "none", execute: EXECUTORS.runDelay },
  // Data
  { type: "data.transform", version: "1.0.0", category: "control", title: "JSON Transform", description: "Applies pick/set/stringify/uppercase operations.", inputPorts: [P("input", "any", true)], outputPorts: [P("output", "json", true)], configSchema: FLEX, requiredCapabilities: [], riskLevel: "low", executionMode: "local", supportsRetry: true, supportsResume: false, timeoutMs: 10_000, sideEffect: "none", execute: EXECUTORS.jsonTransform },
  { type: "data.validate", version: "1.0.0", category: "control", title: "Validation", description: "Asserts required fields exist (dot paths).", inputPorts: [P("input", "any", true)], outputPorts: [P("output", "json", true)], configSchema: FLEX, requiredCapabilities: [], riskLevel: "low", executionMode: "local", supportsRetry: true, supportsResume: false, timeoutMs: 10_000, sideEffect: "none", execute: EXECUTORS.validateFields },
  // Knowledge
  { type: "memory.write", version: "1.0.0", category: "knowledge", title: "Memory Write", description: "Stores a run-scoped value.", inputPorts: [P("value", "any")], outputPorts: [P("output", "json", true)], configSchema: FLEX, requiredCapabilities: [], riskLevel: "low", executionMode: "local", supportsRetry: true, supportsResume: false, timeoutMs: 5_000, sideEffect: "none", execute: EXECUTORS.writeMemory },
  { type: "memory.read", version: "1.0.0", category: "knowledge", title: "Memory Read", description: "Reads a run-scoped value.", inputPorts: [], outputPorts: [P("output", "any", true)], configSchema: FLEX, requiredCapabilities: [], riskLevel: "low", executionMode: "local", supportsRetry: true, supportsResume: false, timeoutMs: 5_000, sideEffect: "none", execute: EXECUTORS.readMemory },
  // AI
  { type: "ai.agent", version: "1.0.0", category: "ai", title: "Agent", description: "Runs a model prompt through the provider gateway.", inputPorts: [P("input", "any")], outputPorts: [P("output", "agent-message", true)], configSchema: FLEX, requiredCapabilities: ["model.invoke"], riskLevel: "medium", executionMode: "remote", supportsRetry: true, supportsResume: false, timeoutMs: 120_000, sideEffect: "none", execute: REMOTE_EXECUTORS.callModel },
  // Tools
  { type: "tool.mcp", version: "1.0.0", category: "tool", title: "MCP Tool", description: "Invokes a tool through the MCP gateway.", inputPorts: [P("input", "any")], outputPorts: [P("output", "json", true)], configSchema: FLEX, requiredCapabilities: ["mcp.call"], riskLevel: "medium", executionMode: "local", supportsRetry: true, supportsResume: false, timeoutMs: 60_000, sideEffect: "local-write", execute: REMOTE_EXECUTORS.callMcpTool },
  { type: "tool.http", version: "1.0.0", category: "tool", title: "HTTP Request", description: "Calls an HTTP/HTTPS endpoint (SSRF-guarded).", inputPorts: [P("input", "json")], outputPorts: [P("output", "json", true)], configSchema: FLEX, requiredCapabilities: ["network.outbound"], riskLevel: "medium", executionMode: "remote", supportsRetry: true, supportsResume: false, timeoutMs: 35_000, sideEffect: "external", execute: REMOTE_EXECUTORS.callHttp },
  // Human
  { type: "human.approval", version: "1.0.0", category: "human", title: "Human Approval", description: "Pauses the run until a human decides (APPROVE/REJECT).", inputPorts: [P("input", "any", true)], outputPorts: [P("approved", "any"), P("rejected", "any")], configSchema: z.object({ proposedAction: z.string().default("review payload") }).passthrough(), requiredCapabilities: [], riskLevel: "low", executionMode: "local", supportsRetry: false, supportsResume: true, timeoutMs: 86_400_000, sideEffect: "none", execute: EXECUTORS.resolveApproval },
  // Outputs
  { type: "output.artifact", version: "1.0.0", category: "output", title: "Save Artifact", description: "Persists the payload with lineage + SHA-256 (runtime-owned IO).", inputPorts: [P("input", "any", true)], outputPorts: [P("artifact", "artifact", true)], configSchema: FLEX, requiredCapabilities: [], riskLevel: "low", executionMode: "local", supportsRetry: true, supportsResume: false, timeoutMs: 10_000, sideEffect: "local-write", execute: EXECUTORS.prepareArtifact },
  { type: "output.notify", version: "1.0.0", category: "output", title: "Notify", description: "Emits a notification event on the run stream.", inputPorts: [P("input", "any")], outputPorts: [P("output", "any")], configSchema: FLEX, requiredCapabilities: [], riskLevel: "low", executionMode: "local", supportsRetry: true, supportsResume: false, timeoutMs: 5_000, sideEffect: "none", execute: EXECUTORS.emitNotify },
];
