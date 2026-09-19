export function acquisitionEnabled(): boolean {
  const raw = (process.env.PAO_ACQUISITION_ENABLED ?? "1").trim().toLowerCase();
  return raw !== "0" && raw !== "false" && raw !== "off";
}

export function acquisitionMockForced(): boolean {
  return process.env.PAO_ACQUISITION_MOCK === "1" || Boolean(process.env.BUN_TEST);
}

export function acquisitionRoot(): string {
  const fromEnv = (process.env.PAO_ACQUISITION_ROOT ?? "").trim();
  if (fromEnv) return fromEnv;
  return "runtime/acquisition";
}
