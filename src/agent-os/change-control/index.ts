/**
 * Phase 22 — Pao Autonomous Change Control (ACC) Module
 */

export * from "./types";
export * from "./analyzer";
export * from "./sandbox";
export * from "./controller";
export * from "./watchdog";

import { ChangeAnalyzer } from "./analyzer";
import { SandboxRunner } from "./sandbox";
import { ChangeControlController, DEFAULT_CHANGE_CONTROL_CONFIG } from "./controller";
import { ChangeWatchdog } from "./watchdog";

let globalController: ChangeControlController | null = null;
let globalWatchdog: ChangeWatchdog | null = null;

export function getChangeControlController(): ChangeControlController {
  if (!globalController) {
    const analyzer = new ChangeAnalyzer();
    const sandbox = new SandboxRunner();
    globalController = new ChangeControlController(DEFAULT_CHANGE_CONTROL_CONFIG, analyzer, sandbox);
  }
  return globalController;
}

export function getChangeWatchdog(): ChangeWatchdog {
  if (!globalWatchdog) {
    globalWatchdog = new ChangeWatchdog({
      onRollbackTriggered: (proposalId, reason) => {
        const controller = getChangeControlController();
        controller.rollback(proposalId, "watchdog-automated-safety");
      },
    });
  }
  return globalWatchdog;
}
