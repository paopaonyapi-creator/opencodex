import { describe, expect, test } from "bun:test";
import { ComfyUiProviderAdapter } from "../src/agent-os/providers/comfyui-adapter";
import { MiniMaxH3ProviderAdapter } from "../src/agent-os/providers/minimax-h3-adapter";
import { ProviderRegistry, BudgetGovernor } from "../src/agent-os/providers/provider-registry";

describe("Phase 16 — ComfyUI Provider Adapter", () => {
  const adapter = new ComfyUiProviderAdapter({ baseUrl: "http://127.0.0.1:8188" });

  test("builds ComfyUI prompt node graph correctly", () => {
    const graph = adapter.buildPromptGraph({
      positivePrompt: "industrial robotic assembly line, photoreal, clean",
      negativePrompt: "blur, text, watermark",
      aspectRatio: "16:9",
      seed: 42,
      model: "sd_xl_base_1.0.safetensors",
    });

    expect(graph["3"]).toBeDefined();
    expect((graph["3"] as { class_type: string }).class_type).toBe("KSampler");
    expect((graph["5"] as { inputs: { width: number; height: number } }).inputs.width).toBe(3840);
    expect((graph["5"] as { inputs: { width: number; height: number } }).inputs.height).toBe(2160);
    expect((graph["6"] as { inputs: { text: string } }).inputs.text).toContain("industrial robotic");
  });

  test("generates standard stock image metadata and lineage", async () => {
    const result = await adapter.generate({
      positivePrompt: "commercial stock photography of solar panel array",
      aspectRatio: "16:9",
      batchCount: 2,
    });

    expect(result.provider).toBe("comfyui");
    expect(result.imagePaths).toHaveLength(2);
    expect(result.width).toBe(3840);
    expect(result.height).toBe(2160);
    expect(result.megapixels).toBe(8.29);
    expect(result.format).toBe("jpeg");
    expect(result.hasAlpha).toBe(false);
    expect(result.lineage.workflowId).toBe("image_stock_photo_v1");
  });

  test("generates transparent PNG with alpha channel flag", async () => {
    const result = await adapter.generate({
      positivePrompt: "isolated electric car battery cell on transparent background",
      transparentBackground: true,
      aspectRatio: "1:1",
    });

    expect(result.format).toBe("png");
    expect(result.hasAlpha).toBe(true);
    expect(result.lineage.workflowId).toBe("image_stock_png_v1");
  });
});

describe("Phase 16 — MiniMax H3 Video Provider Adapter", () => {
  const adapter = new MiniMaxH3ProviderAdapter();

  test("generates 1080p stock clip with dual routing modes", async () => {
    const localResult = await adapter.generate({
      positivePrompt: "slow camera move past robotic arm welding chassis",
      aspectRatio: "16:9",
      durationSeconds: 12.0,
      cameraMotion: "slow_dolly",
      routingMode: "LOCAL",
    });

    expect(localResult.provider).toBe("minimax_h3");
    expect(localResult.routingMode).toBe("LOCAL");
    expect(localResult.width).toBe(1920);
    expect(localResult.height).toBe(1080);
    expect(localResult.durationSeconds).toBe(12.0);
    expect(localResult.codec).toBe("h264");
    expect(localResult.container).toBe("mp4");
    expect(localResult.posterFramePath).toContain("_poster.jpg");

    const cloudResult = await adapter.generate({
      positivePrompt: "vertical vertical b-roll of server racks",
      aspectRatio: "9:16",
      routingMode: "RUNPOD",
    });

    expect(cloudResult.routingMode).toBe("RUNPOD");
    expect(cloudResult.width).toBe(1080);
    expect(cloudResult.height).toBe(1920);
  });

  test("clamps duration within Adobe Stock 5s–60s bounds", async () => {
    const shortResult = await adapter.generate({
      positivePrompt: "quick motion",
      durationSeconds: 2.0, // below 5s
    });
    expect(shortResult.durationSeconds).toBe(5.0);

    const longResult = await adapter.generate({
      positivePrompt: "lengthy clip",
      durationSeconds: 90.0, // above 60s
    });
    expect(longResult.durationSeconds).toBe(60.0);
  });
});

describe("Phase 16 — Budget Governor & Registry", () => {
  test("enforces concept generation limit to prevent runaway loops", () => {
    const governor = new BudgetGovernor({
      maxGenerationsPerConcept: 3,
      maxAutoRetries: 1,
      maxConcurrentJobs: 2,
      maxCostPerBatchUsd: 10.0,
    });

    expect(governor.checkAndRecordGeneration("cpt_1").allowed).toBe(true);
    expect(governor.checkAndRecordGeneration("cpt_1").allowed).toBe(true);
    expect(governor.checkAndRecordGeneration("cpt_1").allowed).toBe(true);

    // 4th attempt must be blocked
    const fourth = governor.checkAndRecordGeneration("cpt_1");
    expect(fourth.allowed).toBe(false);
    expect(fourth.reason).toContain("exceeded maximum generation limit");
  });

  test("enforces batch cost ceiling", () => {
    const governor = new BudgetGovernor({
      maxGenerationsPerConcept: 10,
      maxAutoRetries: 1,
      maxConcurrentJobs: 2,
      maxCostPerBatchUsd: 1.0,
    });

    expect(governor.checkAndRecordGeneration("cpt_1", "batch_test", 0.60).allowed).toBe(true);
    // Next 0.60 would reach 1.20 (> 1.00 cap)
    const second = governor.checkAndRecordGeneration("cpt_1", "batch_test", 0.60);
    expect(second.allowed).toBe(false);
    expect(second.reason).toContain("exceeded cost ceiling");
  });

  test("selects providers based on routing strategy", () => {
    const registry = new ProviderRegistry();
    const imageProvider = registry.selectImageProvider("LOCAL_FIRST");
    expect(imageProvider.name).toBe("comfyui");

    const videoProvider = registry.selectVideoProvider("LOCAL_FIRST");
    expect(videoProvider.name).toBe("minimax_h3");
  });
});
