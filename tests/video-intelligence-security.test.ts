import { describe, expect, test } from "bun:test";
import { VideoSecurityValidator } from "../src/agent-os/video-intelligence/security";

describe("Phase 20.13 — Video Intelligence Security", () => {
  const validator = new VideoSecurityValidator();

  test("allows public valid HTTPS video URLs", () => {
    const res = validator.validateUrl("https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4");
    expect(res.valid).toBe(true);
    expect(res.sanitizedUrl).toBeDefined();
  });

  test("blocks SSRF loopback and private IP hosts", () => {
    expect(validator.validateUrl("http://localhost:8000/video.mp4").valid).toBe(false);
    expect(validator.validateUrl("http://127.0.0.1:3000/test.mp4").valid).toBe(false);
    expect(validator.validateUrl("http://192.168.1.50/stream.mp4").valid).toBe(false);
    expect(validator.validateUrl("http://10.0.0.1/clip.mp4").valid).toBe(false);
  });

  test("blocks non-HTTP/HTTPS protocols", () => {
    expect(validator.validateUrl("file:///c:/secret/video.mp4").valid).toBe(false);
    expect(validator.validateUrl("javascript:alert(1)").valid).toBe(false);
  });

  test("blocks CLI option injection attempts", () => {
    expect(validator.validateUrl("--output /etc/cron.d/malicious").valid).toBe(false);
    expect(validator.validateUrl("-v http://example.com").valid).toBe(false);
  });

  test("validates local paths and blocks path traversal", () => {
    expect(validator.validateLocalPath("C:\\Videos\\sample.mp4").valid).toBe(true);
    expect(validator.validateLocalPath("../../secret/video.mp4").valid).toBe(false);
    expect(validator.validateLocalPath("video.exe").valid).toBe(false);
  });

  test("generates safe yt-dlp argument array with '--' boundary", () => {
    const args = validator.makeSafeYtDlpArgs("https://example.com/video.mp4", ["-f", "best"]);
    expect(args).toContain("--");
    expect(args[args.length - 1]).toBe("https://example.com/video.mp4");
  });
});
