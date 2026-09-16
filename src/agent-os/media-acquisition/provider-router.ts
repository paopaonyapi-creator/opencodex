// Phase 20.24 — Pao-hubPro × OmniGet Local Media Acquisition & MCP Engine
// Dynamic Media Provider Router & Fallback Coordinator

import type {
  MediaProvider,
  ProviderName,
  ProviderHealth,
  InspectRequest,
  InspectResult,
  MediaJob,
} from "./types";
import { OmniGetAdapter } from "./omniget-adapter";
import { YtDlpAdapter } from "./ytdlp-adapter";
import { NativeMediaAdapter } from "./native-adapter";
import { MediaError } from "./errors";
import { DouyinProvider } from "../douyin/adapter";
import { isDouyinUrl } from "../douyin/url-policy";

export class MediaProviderRouter {
  private providers = new Map<ProviderName, MediaProvider>();
  private preferredOrder: ProviderName[] = ["omniget", "ytdlp", "native"];

  constructor() {
    this.registerProvider(new OmniGetAdapter());
    this.registerProvider(new YtDlpAdapter());
    this.registerProvider(new NativeMediaAdapter());
    // Phase 20.26: Douyin is a first-class provider beneath the media core.
    // It is selected ONLY for Douyin-family URLs (platform routing below) and
    // degrades to unavailable when its upstream runtime is absent.
    this.registerProvider(new DouyinProvider());
  }

  registerProvider(provider: MediaProvider): void {
    this.providers.set(provider.name, provider);
  }

  getProvider(name: ProviderName): MediaProvider | undefined {
    return this.providers.get(name);
  }

  listProviders(): MediaProvider[] {
    return Array.from(this.providers.values());
  }

  setPreferredOrder(order: ProviderName[]): void {
    this.preferredOrder = order;
  }

  async checkAllHealth(): Promise<Record<ProviderName, ProviderHealth>> {
    const results: Record<ProviderName, ProviderHealth> = {};
    for (const [name, provider] of this.providers.entries()) {
      results[name] = await provider.healthCheck();
    }
    return results;
  }

  async selectProvider(preferred?: ProviderName): Promise<MediaProvider> {
    if (preferred && this.providers.has(preferred)) {
      const p = this.providers.get(preferred)!;
      const h = await p.healthCheck();
      if (h.available) return p;
    }

    for (const name of this.preferredOrder) {
      const p = this.providers.get(name);
      if (p) {
        const health = await p.healthCheck();
        if (health.available) {
          return p;
        }
      }
    }

    // Always fallback to native if everything else is offline
    const native = this.providers.get("native");
    if (native) return native;

    throw new MediaError(
      "MEDIA_PROVIDER_OFFLINE",
      "No healthy media acquisition providers are available.",
      true,
    );
  }

  async inspect(request: InspectRequest): Promise<InspectResult> {
    // Phase 20.26 platform routing: a Douyin URL belongs to the Douyin
    // provider. Generic providers must not fabricate metadata for it.
    if (!request.preferredProvider && isDouyinUrl(request.url)) {
      const douyin = this.providers.get("douyin");
      if (douyin) {
        const health = await douyin.healthCheck();
        if (health.available) {
          return douyin.inspect(request);
        }
        throw new MediaError(
          "MEDIA_PROVIDER_OFFLINE",
          `Douyin provider unavailable: ${health.errorMessage ?? "upstream runtime missing"}`,
          true,
        );
      }
    }
    const provider = await this.selectProvider(request.preferredProvider);
    try {
      return await provider.inspect(request);
    } catch (err) {
      // If primary failed and was not native, attempt fallback to next provider
      if (provider.name !== "native") {
        const fallback = this.providers.get("native");
        if (fallback) {
          return await fallback.inspect(request);
        }
      }
      throw err;
    }
  }

  async download(
    job: MediaJob,
    onProgress?: (progress: Partial<MediaJob>) => void,
  ): Promise<{ outputPath: string; metadata?: Record<string, unknown> }> {
    let provider = this.providers.get(job.provider);
    if (!provider) {
      provider = await this.selectProvider();
      job.provider = provider.name;
    }

    const health = await provider.healthCheck();
    if (!health.available && provider.name !== "native") {
      const fallback = await this.selectProvider();
      job.provider = fallback.name;
      provider = fallback;
    }

    return await provider.download(job, onProgress);
  }
}
