// Phase 20.3 — Desktop Vision Control MCP Tools
//
// Exposes the 21 canonical Desktop MCP tools for high-level agent interaction,
// session lifecycle, application skills, observation, and emergency controls.

import {
  createDesktopSession,
  getDesktopSession,
  listDesktopSessions,
  updateSessionStatus,
  triggerEmergencyStop,
} from "./session";
import {
  createDesktopGoal,
  getDesktopGoal,
  listDesktopGoals,
  updateGoalStatus,
  cancelGoal,
  getGoalSteps,
} from "./goals";
import { getProfileRegistry } from "./profiles";
import { getSkillRegistry, getSkillRunner } from "./skills";
import { getObservationEngine } from "./observation";
import { getEmergencyStop } from "./safety";
import { openAgentOsDb } from "../db";
import { DESKTOP_AGENT_VERSION, DESKTOP_PROTOCOL_VERSION } from "./types";
import type { ExecutionMode, DesktopRiskLevel } from "./types";

export interface WebMcpToolDefinition {
  name: string;
  description: string;
  riskTier: "R0" | "R1" | "R2" | "R3" | "R4";
  readOnly: boolean;
  execute: (args: Record<string, unknown>) => Promise<unknown> | unknown;
}

export const DESKTOP_MCP_TOOLS: WebMcpToolDefinition[] = [
  // 1. desktop_agent_status
  {
    name: "desktop_agent_status",
    description: "Get Desktop Realtime Agent status, active sessions, foreground profile, and health.",
    riskTier: "R0",
    readOnly: true,
    execute: () => {
      const stopInfo = getEmergencyStop().getStopInfo();
      const observation = getObservationEngine();
      const fg = observation.getForeground();
      const profileRegistry = getProfileRegistry();
      const matched = fg ? profileRegistry.matchWindow(fg) : null;
      const activeSessions = listDesktopSessions("RUNNING");

      return {
        agentVersion: DESKTOP_AGENT_VERSION,
        protocolVersion: DESKTOP_PROTOCOL_VERSION,
        status: stopInfo.stopped ? "EMERGENCY_STOPPED" : "HEALTHY",
        emergencyStopped: stopInfo.stopped,
        emergencyStopReason: stopInfo.reason,
        activeSessionsCount: activeSessions.length,
        foregroundWindow: fg ? { id: fg.windowId, title: fg.title, process: fg.processName } : null,
        matchedProfile: matched?.profile ? { id: matched.profile.id, confidence: matched.confidence } : null,
      };
    },
  },

  // 2. desktop_list_profiles
  {
    name: "desktop_list_profiles",
    description: "List all registered application profiles (Windows, ComfyUI, Chromium).",
    riskTier: "R0",
    readOnly: true,
    execute: () => {
      return { profiles: getProfileRegistry().list() };
    },
  },

  // 3. desktop_list_skills
  {
    name: "desktop_list_skills",
    description: "List application skills, optionally filtered by profile ID.",
    riskTier: "R0",
    readOnly: true,
    execute: (args) => {
      const profileId = args.profileId ? String(args.profileId) : undefined;
      return { skills: getSkillRegistry().list(profileId) };
    },
  },

  // 4. desktop_create_session
  {
    name: "desktop_create_session",
    description: "Create a new desktop automation session with specified mode and dryRun flag.",
    riskTier: "R1",
    readOnly: false,
    execute: (args) => {
      return createDesktopSession({
        ownerUserId: args.ownerUserId ? String(args.ownerUserId) : "local",
        machineId: args.machineId ? String(args.machineId) : "local",
        mode: (args.mode as ExecutionMode) ?? "ASSISTED",
        dryRun: Boolean(args.dryRun),
        policyProfile: args.policyProfile ? String(args.policyProfile) : "default",
        metadata: (args.metadata as Record<string, unknown>) ?? {},
      });
    },
  },

  // 5. desktop_start_session
  {
    name: "desktop_start_session",
    description: "Start or activate an existing desktop session.",
    riskTier: "R1",
    readOnly: false,
    execute: (args) => {
      const sessionId = String(args.sessionId ?? "");
      updateSessionStatus(sessionId, "STARTING");
      return updateSessionStatus(sessionId, "RUNNING");
    },
  },

  // 6. desktop_pause_session
  {
    name: "desktop_pause_session",
    description: "Pause an active desktop session and release active inputs.",
    riskTier: "R1",
    readOnly: false,
    execute: (args) => {
      const sessionId = String(args.sessionId ?? "");
      return updateSessionStatus(sessionId, "PAUSED");
    },
  },

  // 7. desktop_resume_session
  {
    name: "desktop_resume_session",
    description: "Resume a paused desktop session.",
    riskTier: "R1",
    readOnly: false,
    execute: (args) => {
      const sessionId = String(args.sessionId ?? "");
      return updateSessionStatus(sessionId, "RUNNING");
    },
  },

  // 8. desktop_stop_session
  {
    name: "desktop_stop_session",
    description: "Gracefully stop a desktop automation session.",
    riskTier: "R1",
    readOnly: false,
    execute: (args) => {
      const sessionId = String(args.sessionId ?? "");
      updateSessionStatus(sessionId, "STOPPING");
      return updateSessionStatus(sessionId, "STOPPED");
    },
  },

  // 9. desktop_emergency_stop
  {
    name: "desktop_emergency_stop",
    description: "Emergency killswitch: halts loop immediately, cancels actions, and releases all inputs.",
    riskTier: "R1",
    readOnly: false,
    execute: (args) => {
      const sessionId = args.sessionId ? String(args.sessionId) : undefined;
      const reason = args.reason ? String(args.reason) : "MCP emergency stop trigger";
      triggerEmergencyStop(reason);
      return { success: true, emergencyStopped: true, reason };
    },
  },

  // 10. desktop_observe
  {
    name: "desktop_observe",
    description: "Capture desktop observation snapshot (screen hash, visible windows, foreground window).",
    riskTier: "R0",
    readOnly: true,
    execute: async (args) => {
      const sessionId = String(args.sessionId ?? "default");
      const persist = Boolean(args.persistEvidence);
      return await getObservationEngine().observe(sessionId, persist);
    },
  },

  // 11. desktop_list_windows
  {
    name: "desktop_list_windows",
    description: "List currently visible and allowed Windows desktop application windows.",
    riskTier: "R0",
    readOnly: true,
    execute: () => {
      return { windows: getObservationEngine().listWindows() };
    },
  },

  // 12. desktop_get_foreground
  {
    name: "desktop_get_foreground",
    description: "Get details and matched profile of the active foreground window.",
    riskTier: "R0",
    readOnly: true,
    execute: () => {
      const fg = getObservationEngine().getForeground();
      const profile = fg ? getProfileRegistry().matchWindow(fg) : null;
      return { foreground: fg, matchedProfile: profile };
    },
  },

  // 13. desktop_focus_app
  {
    name: "desktop_focus_app",
    description: "Set focus to target window ID or title substring.",
    riskTier: "R1",
    readOnly: false,
    execute: (args) => {
      const windowId = String(args.windowId ?? "");
      const fg = getObservationEngine().setForeground(windowId);
      return { success: fg !== null, foregroundWindow: fg };
    },
  },

  // 14. desktop_run_skill
  {
    name: "desktop_run_skill",
    description: "Run an application skill (e.g. comfyui.open_workflow_ui) with arguments.",
    riskTier: "R2",
    readOnly: false,
    execute: async (args) => {
      const runner = getSkillRunner();
      return await runner.execute({
        sessionId: String(args.sessionId ?? ""),
        skillId: String(args.skillId ?? ""),
        goalId: args.goalId ? String(args.goalId) : undefined,
        arguments: (args.arguments as Record<string, unknown>) ?? {},
        mode: (args.mode as ExecutionMode) ?? "ASSISTED",
        dryRun: Boolean(args.dryRun),
      });
    },
  },

  // 15. desktop_get_skill_run
  {
    name: "desktop_get_skill_run",
    description: "Get status, duration, and step index of an existing skill execution run.",
    riskTier: "R0",
    readOnly: true,
    execute: (args) => {
      const runId = String(args.runId ?? "");
      const db = openAgentOsDb();
      const row = db.query("SELECT * FROM desktop_skill_runs WHERE id = ?").get(runId);
      return { skillRun: row ?? null };
    },
  },

  // 16. desktop_cancel_skill_run
  {
    name: "desktop_cancel_skill_run",
    description: "Cancel an in-progress skill execution run.",
    riskTier: "R2",
    readOnly: false,
    execute: (args) => {
      const runId = String(args.runId ?? "");
      const db = openAgentOsDb();
      db.query("UPDATE desktop_skill_runs SET status = 'CANCELLED', completed_at = ? WHERE id = ?").run(
        new Date().toISOString(),
        runId,
      );
      return { success: true, runId, status: "CANCELLED" };
    },
  },

  // 17. desktop_create_goal
  {
    name: "desktop_create_goal",
    description: "Formulate a high-level goal in a session for execution planning.",
    riskTier: "R1",
    readOnly: false,
    execute: (args) => {
      return createDesktopGoal({
        sessionId: String(args.sessionId ?? ""),
        goalType: String(args.goalType ?? "task"),
        title: String(args.title ?? "Untitled Goal"),
        description: args.description ? String(args.description) : undefined,
        arguments: (args.arguments as Record<string, unknown>) ?? {},
        constraints: (args.constraints as Record<string, unknown>) ?? {},
        riskLevel: (args.riskLevel as DesktopRiskLevel) ?? "MEDIUM",
        createdBy: args.createdBy ? String(args.createdBy) : "operator",
      });
    },
  },

  // 18. desktop_get_goal
  {
    name: "desktop_get_goal",
    description: "Retrieve goal details, execution status, and sequential steps.",
    riskTier: "R0",
    readOnly: true,
    execute: (args) => {
      const goalId = String(args.goalId ?? "");
      const goal = getDesktopGoal(goalId);
      const steps = goal ? getGoalSteps(goalId) : [];
      return { goal, steps };
    },
  },

  // 19. desktop_cancel_goal
  {
    name: "desktop_cancel_goal",
    description: "Cancel a pending or running high-level desktop goal.",
    riskTier: "R1",
    readOnly: false,
    execute: (args) => {
      const goalId = String(args.goalId ?? "");
      const reason = args.reason ? String(args.reason) : undefined;
      return cancelGoal(goalId, reason);
    },
  },

  // 20. desktop_capture_evidence
  {
    name: "desktop_capture_evidence",
    description: "Capture and persist screenshot / window state evidence for audit logging.",
    riskTier: "R0",
    readOnly: true,
    execute: async (args) => {
      const sessionId = String(args.sessionId ?? "default");
      const observation = await getObservationEngine().observe(sessionId, true);
      return { success: true, evidenceId: observation.snapshotId, screenHash: observation.screenHash };
    },
  },

  // 21. desktop_get_action_log
  {
    name: "desktop_get_action_log",
    description: "Query desktop action attempts and execution ledger from database.",
    riskTier: "R0",
    readOnly: true,
    execute: (args) => {
      const sessionId = args.sessionId ? String(args.sessionId) : undefined;
      const limit = Number(args.limit ?? 20);
      const db = openAgentOsDb();

      let query = "SELECT * FROM desktop_action_attempts";
      const params: (string | number | boolean | null)[] = [];
      if (sessionId) {
        query += " WHERE action_id IN (SELECT id FROM desktop_actions WHERE session_id = ?)";
        params.push(sessionId);
      }
      query += " ORDER BY started_at DESC LIMIT ?";
      params.push(limit);

      const attempts = db.query(query).all(...params);
      return { attempts };
    },
  },
];
