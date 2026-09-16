// Phase 20.31 — Prompt/IP guard + versioned Adobe technical policy tests
// (the net-new delta over the existing Phase 20.7 video factory).

import { describe, expect, test } from "bun:test";
import {
  lintStockPrompt,
  isPolicyStale,
  evaluateTechnicalGate,
  ADOBE_VIDEO_TECHNICAL_POLICY,
} from "../src/agent-os/video/policy/prompt-ip-guard";

describe("Phase 20.31 prompt/IP guard (doc §39)", () => {
  test("clean commercial prompts pass", () => {
    const result = lintStockPrompt("slow motion of ocean waves at sunset, wide angle, calm mood");
    expect(result.verdict).toBe("clear");
    expect(result.findings.length).toBe(0);
  });

  test("fictional characters and franchises are blocked", () => {
    expect(lintStockPrompt("pikachu running through a forest").verdict).toBe("blocked");
    expect(lintStockPrompt("a disney-style castle at dawn").verdict).toBe("blocked");
  });

  test("named artists are blocked; style imitation is flagged", () => {
    expect(lintStockPrompt("a painting by van gogh of sunflowers").verdict).toBe("blocked");
    const flagged = lintStockPrompt("colorful swirls in the style of post-impressionists");
    expect(flagged.verdict).toBe("flagged");
  });

  test("real people are blocked", () => {
    expect(lintStockPrompt("portrait of a businesswoman like taylor swift").verdict).toBe("blocked");
  });

  test("brands/agencies/news framing are flagged for compliance review", () => {
    expect(lintStockPrompt("a coca-cola bottle on a table").verdict).toBe("flagged");
    expect(lintStockPrompt("breaking news scene in a city").verdict).toBe("flagged");
    expect(lintStockPrompt("add text saying sale 50% off").verdict).toBe("flagged");
  });

  test("summary is audit-safe (no prompt content echoed)", () => {
    const result = lintStockPrompt("pikachu in a coca-cola ad");
    expect(result.summary).not.toContain("pikachu");
    expect(result.summary).toContain("categories:");
  });
});

describe("Phase 20.31 versioned Adobe technical policy (doc §16)", () => {
  test("valid 1080p H.264 clip passes the technical gate", () => {
    const result = evaluateTechnicalGate({
      durationSec: 30, width: 1920, height: 1080, fps: 30,
      codec: "h264", container: "mp4", fileSizeBytes: 50 * 1024 * 1024, decodeOk: true,
    });
    expect(result.pass).toBe(true);
    expect(result.policyStale).toBe(false);
  });

  test("violations produce specific reasons", () => {
    const result = evaluateTechnicalGate({
      durationSec: 3, width: 1280, height: 720, fps: 15,
      codec: "vp9", container: "webm", fileSizeBytes: 5 * 1024 * 1024 * 1024, decodeOk: false,
    });
    expect(result.pass).toBe(false);
    expect(result.reasons.some((r) => r.includes("duration"))).toBe(true);
    expect(result.reasons.some((r) => r.includes("resolution"))).toBe(true);
    expect(result.reasons.some((r) => r.includes("frame rate"))).toBe(true);
    expect(result.reasons.some((r) => r.includes("container"))).toBe(true);
    expect(result.reasons.some((r) => r.includes("decode"))).toBe(true);
  });

  test("POLICY_REVIEW_REQUIRED fires when the verified date is stale (doc §16)", () => {
    const stalePolicy = {
      ...ADOBE_VIDEO_TECHNICAL_POLICY,
      verifiedAt: new Date(Date.now() - 400 * 24 * 60 * 60 * 1000).toISOString(),
    };
    expect(isPolicyStale(stalePolicy)).toBe(true);
    const result = evaluateTechnicalGate({
      durationSec: 30, width: 1920, height: 1080, fps: 30,
      codec: "h264", container: "mp4", fileSizeBytes: 1024, decodeOk: true,
    }, stalePolicy);
    expect(result.policyStale).toBe(true);
  });
});
