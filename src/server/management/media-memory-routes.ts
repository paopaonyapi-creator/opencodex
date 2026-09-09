// Phase 20.14 — Pao-hubPro Visual Knowledge & Media Memory: Management REST API Routes

import { jsonResponse } from "../auth-cors";
import type { ManagementContext } from "./context";
import { getMediaMemoryIndex, getMediaMemoryRetriever } from "../../agent-os/media-memory";
import type { MediaMemoryItem, MediaType } from "../../agent-os/media-memory/types";

function notFound(req: Request, message: string): Response {
  return jsonResponse({ error: { code: "not_found", message } }, 404, req, {});
}

function badRequest(req: Request, message: string): Response {
  return jsonResponse({ error: { code: "bad_request", message } }, 400, req, {});
}

export async function handleMediaMemoryRoutes(ctx: ManagementContext): Promise<Response | null> {
  const { url, req } = ctx;
  const rawPath = url.pathname;

  // Normalize path prefixes: support both /api/agent-os/media-memory/* and /api/media-memory/*
  let path = rawPath;
  if (path.startsWith("/api/agent-os/media-memory")) {
    path = path.slice("/api/agent-os/media-memory".length);
  } else if (path.startsWith("/api/media-memory")) {
    path = path.slice("/api/media-memory".length);
  } else {
    return null;
  }

  // Trim leading slash
  if (path.startsWith("/")) path = path.slice(1);

  const index = getMediaMemoryIndex();
  const retriever = getMediaMemoryRetriever();

  // GET /stats
  if (path === "stats" || path === "") {
    if (req.method === "GET") {
      const stats = index.getStats();
      return jsonResponse({ stats }, 200, req, {});
    }
    return badRequest(req, `Method ${req.method} not allowed for /stats.`);
  }

  // POST /search
  if (path === "search") {
    if (req.method === "POST") {
      try {
        const body = (await req.json()) as Record<string, unknown>;
        const queryText = body.query as string | undefined;
        const mediaType = body.mediaType as MediaType | undefined;
        const tags = body.tags as string[] | undefined;
        const concepts = body.concepts as string[] | undefined;
        const minScore = body.minScore !== undefined ? Number(body.minScore) : 0.15;
        const limit = body.limit !== undefined ? Number(body.limit) : 10;

        const results = retriever.search({
          queryText,
          mediaType,
          tags,
          concepts,
          minScore,
          limit,
        });

        return jsonResponse(
          {
            query: queryText,
            totalMatches: results.length,
            results: results.map((r) => ({
              id: r.item.id,
              title: r.item.title,
              similarityScore: r.similarityScore,
              mediaType: r.item.mediaType,
              summary: r.item.summary,
              concepts: r.item.concepts,
              tags: r.item.tags,
              specs: r.item.technicalSpecs,
              pacing: r.item.pacing,
              hook: r.item.hook,
              highlights: r.highlights,
            })),
          },
          200,
          req,
          {},
        );
      } catch (err) {
        return badRequest(req, `Invalid search payload: ${String(err)}`);
      }
    }
    return badRequest(req, `Method ${req.method} not allowed for /search.`);
  }

  // POST /rag
  if (path === "rag") {
    if (req.method === "POST") {
      try {
        const body = (await req.json()) as Record<string, unknown>;
        const query = body.query as string;
        if (!query) {
          return badRequest(req, "Field 'query' is required for /rag context generation.");
        }
        const maxItems = body.maxItems !== undefined ? Number(body.maxItems) : 3;
        const minScore = body.minScore !== undefined ? Number(body.minScore) : 0.2;

        const pack = retriever.buildRagContext(query, maxItems, minScore);
        return jsonResponse({ pack }, 200, req, {});
      } catch (err) {
        return badRequest(req, `Invalid RAG payload: ${String(err)}`);
      }
    }
    return badRequest(req, `Method ${req.method} not allowed for /rag.`);
  }

  // POST /similar/:id
  if (path.startsWith("similar/")) {
    const itemId = decodeURIComponent(path.slice("similar/".length));
    if (req.method === "POST" || req.method === "GET") {
      const limit = Number(url.searchParams.get("limit") || 5);
      const minScore = Number(url.searchParams.get("minScore") || 0.2);
      const results = retriever.findSimilar(itemId, limit, minScore);
      return jsonResponse(
        {
          referenceItemId: itemId,
          totalSimilar: results.length,
          results: results.map((r) => ({
            id: r.item.id,
            title: r.item.title,
            similarityScore: r.similarityScore,
            mediaType: r.item.mediaType,
            summary: r.item.summary,
          })),
        },
        200,
        req,
        {},
      );
    }
    return badRequest(req, `Method ${req.method} not allowed for /similar.`);
  }

  // Collection: /items
  if (path === "items") {
    if (req.method === "GET") {
      const limit = Number(url.searchParams.get("limit") || 50);
      const offset = Number(url.searchParams.get("offset") || 0);
      const items = index.listItems(limit, offset);
      return jsonResponse({ total: items.length, items }, 200, req, {});
    }

    if (req.method === "POST") {
      try {
        const body = (await req.json()) as Record<string, unknown>;
        const now = new Date().toISOString();
        const item: MediaMemoryItem = {
          id: (body.id as string) || `mitem_${Date.now().toString(36)}`,
          mediaType: (body.mediaType as MediaType) || "video",
          title: String(body.title || "Untitled Media"),
          summary: String(body.summary || ""),
          sourceUrl: body.sourceUrl ? String(body.sourceUrl) : undefined,
          localPath: body.localPath ? String(body.localPath) : undefined,
          tags: Array.isArray(body.tags) ? (body.tags as string[]) : [],
          concepts: Array.isArray(body.concepts) ? (body.concepts as string[]) : [],
          entities: Array.isArray(body.entities) ? (body.entities as string[]) : [],
          technicalSpecs: (body.technicalSpecs as any) || { width: 1920, height: 1080 },
          pacing: body.pacing as any,
          hook: body.hook as any,
          transcriptText: body.transcriptText ? String(body.transcriptText) : undefined,
          metadata: (body.metadata as Record<string, unknown>) || {},
          createdAt: now,
          updatedAt: now,
        };

        const result = index.indexItem(item);
        return jsonResponse(
          {
            success: true,
            itemId: result.item.id,
            vectorsCreated: result.vectors.length,
            item: result.item,
          },
          201,
          req,
          {},
        );
      } catch (err) {
        return badRequest(req, `Failed to index item: ${String(err)}`);
      }
    }
    return badRequest(req, `Method ${req.method} not allowed for /items.`);
  }

  // Single Item: /items/:id
  if (path.startsWith("items/")) {
    const id = decodeURIComponent(path.slice("items/".length));

    if (req.method === "GET") {
      const item = index.getItem(id);
      if (!item) {
        return notFound(req, `Media memory item '${id}' not found.`);
      }
      const vectors = index.getDb().getVectorsForItem(item.id);
      return jsonResponse({ item, vectors }, 200, req, {});
    }

    if (req.method === "DELETE") {
      const deleted = index.deleteItem(id);
      if (!deleted) {
        return notFound(req, `Media memory item '${id}' not found.`);
      }
      return jsonResponse({ id, deleted: true }, 200, req, {});
    }

    return badRequest(req, `Method ${req.method} not allowed for /items/:id.`);
  }

  return notFound(req, `Media Memory endpoint '/${path}' not found.`);
}
