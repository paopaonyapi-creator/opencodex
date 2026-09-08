// Phase 21 — Knowledge Provider Interface (spec sections 10, 19).

import type { KnowledgeDocument, KnowledgeQuery, ProviderHealth, SearchResult } from "../types";

export interface KnowledgeProvider {
  readonly name: string;
  search(query: KnowledgeQuery): Promise<SearchResult[]>;
  getDocument(id: string): Promise<KnowledgeDocument | null>;
  healthCheck(): Promise<ProviderHealth>;
}
