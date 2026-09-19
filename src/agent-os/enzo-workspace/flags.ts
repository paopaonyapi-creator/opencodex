// Phase 20.94 feature flag. Default ON; set PAO_ENZO_WORKSPACE=0 to disable.

export function enzoWorkspaceEnabled(): boolean {
  const raw = (process.env.PAO_ENZO_WORKSPACE ?? "1").trim().toLowerCase();
  return raw !== "0" && raw !== "false" && raw !== "off" && raw !== "disabled";
}
