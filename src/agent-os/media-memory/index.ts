// Phase 20.14 — Pao-hubPro Visual Knowledge & Media Memory: Barrel Exports & Singletons

import { MediaMemoryIndex } from "./memory-index";
import { MediaMemoryRetriever } from "./memory-retriever";

export * from "./types";
export * from "./embedding-engine";
export * from "./db-store";
export * from "./memory-index";
export * from "./video-adapter";
export * from "./memory-retriever";
export * from "./mcp-tools";

let globalMediaIndex: MediaMemoryIndex | null = null;
let globalMediaRetriever: MediaMemoryRetriever | null = null;

export function getMediaMemoryIndex(): MediaMemoryIndex {
  if (!globalMediaIndex) {
    globalMediaIndex = new MediaMemoryIndex();
  }
  return globalMediaIndex;
}

export function getMediaMemoryRetriever(): MediaMemoryRetriever {
  if (!globalMediaRetriever) {
    globalMediaRetriever = new MediaMemoryRetriever(getMediaMemoryIndex());
  }
  return globalMediaRetriever;
}

export function resetMediaMemory(): void {
  if (globalMediaIndex) {
    globalMediaIndex.getDb().close();
    globalMediaIndex = null;
  }
  globalMediaRetriever = null;
}
