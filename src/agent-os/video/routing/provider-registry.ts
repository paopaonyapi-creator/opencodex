// Video Provider Registry & Capability Store
import type { VideoProviderId, VideoProductionAdapter, VideoProviderCapabilities } from "../domain/types";
import { MoneyPrinterTurboAdapter } from "../adapters/moneyprinterturbo/mpt-adapter";
import { MockMptProvider } from "../adapters/moneyprinterturbo/mock-mpt-provider";
import { ComfyUiVideoAdapter } from "../adapters/comfyui-video-adapter";
import { LocalMediaAdapter } from "../adapters/local-media-adapter";

export class VideoProviderRegistry {
  private adapters = new Map<VideoProviderId, VideoProductionAdapter>();

  constructor() {
    this.registerAdapter(new MoneyPrinterTurboAdapter());
    this.registerAdapter(new MockMptProvider("success"));
    this.registerAdapter(new ComfyUiVideoAdapter());
    this.registerAdapter(new LocalMediaAdapter());
  }

  registerAdapter(adapter: VideoProductionAdapter): void {
    this.adapters.set(adapter.id, adapter);
  }

  getAdapter(id: VideoProviderId): VideoProductionAdapter | undefined {
    return this.adapters.get(id);
  }

  listAdapters(): VideoProductionAdapter[] {
    return Array.from(this.adapters.values());
  }

  async getAllCapabilities(): Promise<VideoProviderCapabilities[]> {
    const list = this.listAdapters();
    return Promise.all(list.map((a) => a.getCapabilities()));
  }

  async listCapabilities(): Promise<VideoProviderCapabilities[]> {
    return this.getAllCapabilities();
  }

  async checkAllHealth(): Promise<Array<{ providerId: VideoProviderId; status: string; latencyMs: number; error?: string }>> {
    const list = this.listAdapters();
    return Promise.all(
      list.map(async (a) => {
        const h = await a.healthCheck();
        return {
          providerId: a.id,
          status: h.status,
          latencyMs: h.latencyMs,
          error: h.error,
        };
      }),
    );
  }

  async runAllHealthChecks(): Promise<Array<{ providerId: VideoProviderId; status: string; latencyMs: number; error?: string }>> {
    return this.checkAllHealth();
  }
}

let globalRegistry: VideoProviderRegistry | null = null;

export function getVideoProviderRegistry(): VideoProviderRegistry {
  if (!globalRegistry) {
    globalRegistry = new VideoProviderRegistry();
  }
  return globalRegistry;
}
