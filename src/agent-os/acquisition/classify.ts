import { validateAndNormalizeUrl } from "../media-acquisition/url-policy";
import type { AcquisitionIntent, AcquisitionRequest, AuthClass } from "./types";
import { AcquisitionError, looksLikeSecretPayload } from "./types";

const DRM_HINTS = ["netflix.com", "disneyplus.com", "primevideo.com", "hbomax.com", "spotify.com"];
const AUTH_HINTS = ["udemy.com", "coursera.com", "skillshare.com", "patreon.com", "substack.com"];
const GALLERY_HINTS = ["instagram.com", "pinterest.com", "flickr.com", "deviantart.com"];

export function assertNoSecretsInRequest(req: AcquisitionRequest): void {
  if (looksLikeSecretPayload(req) || looksLikeSecretPayload(req.authContext) || looksLikeSecretPayload(req.source)) {
    throw new AcquisitionError("SECRET_IN_REQUEST", 400, "raw cookies/credentials must not appear on acquisition requests; use opaque session refs");
  }
  const blob = JSON.stringify(req);
  if (/cookie\s*=|Set-Cookie|browserCookies/i.test(blob)) {
    throw new AcquisitionError("SECRET_IN_REQUEST", 400, "cookie material is not allowed on acquisition requests");
  }
}

export function primarySource(req: AcquisitionRequest): string {
  const value = req.source.value;
  if (Array.isArray(value)) return String(value[0] ?? "");
  return String(value ?? "");
}

export function classifySource(url: string): {
  host: string;
  platform: string;
  authClass: AuthClass;
  sourceClass: string;
} {
  let policy;
  try {
    policy = validateAndNormalizeUrl(url);
  } catch (err) {
    throw new AcquisitionError("INVALID_SOURCE", 400, err instanceof Error ? err.message : "invalid source");
  }
  const host = policy.domain.toLowerCase();
  let authClass: AuthClass = "PUBLIC";
  if (DRM_HINTS.some((h) => host.includes(h))) authClass = "BLOCKED_OR_DRM";
  else if (AUTH_HINTS.some((h) => host.includes(h))) authClass = "SESSION_REQUIRED";
  else if (GALLERY_HINTS.some((h) => host.includes(h))) authClass = "SESSION_OPTIONAL";
  return { host, platform: policy.platform, authClass, sourceClass: policy.platform };
}

export function inferIntent(raw: string): AcquisitionIntent {
  const t = raw.toLowerCase();
  if (/ถอดเสียง|transcrib|whisper|subtitle/.test(t) && /ศึกษา|research|สรุป|summar/.test(t)) return "research";
  if (/gallery|instagram|album/.test(t)) return "gallery";
  if (/batch|หลายลิงก์|list of/.test(t)) return "batch";
  if (/transcrib|ถอดเสียง/.test(t)) return "transcribe";
  if (/audio only|เสียงอย่างเดียว/.test(t)) return "audio_extract";
  if (/pdf|document|ocr/.test(t)) return "document_extract";
  if (/archive|เก็บต้นฉบับ/.test(t)) return "archive";
  if (/inspect|metadata|ดูข้อมูล/.test(t)) return "inspect";
  if (/ศึกษา|research|สรุป/.test(t)) return "research";
  return "download";
}
