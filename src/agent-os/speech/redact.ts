// Phase 20.32 — shared header/credential helpers. Kept in its own tiny module
// so neither the HTTP client nor the MCP client ever duplicates the key path
// and neither can accidentally log it.

export function authHeadersShape(): Record<string, string> {
  const headers: Record<string, string> = {
    "X-VoiceStudio-Client-Id": process.env.VOICESTUDIO_CLIENT_ID || "pao-hubpro",
  };
  const key = process.env.VOICESTUDIO_API_KEY;
  if (key) headers.Authorization = `Bearer ${key}`;
  return headers;
}
