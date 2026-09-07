// Phase 20.5 — Living Knowledge Brain Management API Routes

import { jsonResponse } from "../auth-cors";
import type { ManagementContext } from "./context";
import {
  bootstrapKnowledgeBrain,
  compareEntities,
  compileWikiPage,
  createClaim,
  createRelation,
  createSourceVersion,
  detectContradictions,
  getBrainHealthStatus,
  getClaim,
  getDecision,
  getEntity,
  getSource,
  getWikiPage,
  getWikiRevision,
  listClaims,
  listContradictions,
  listDecisions,
  listEntities,
  listRelations,
  listSources,
  listSourceVersions,
  listWikiPages,
  listWikiRevisions,
  pruneKnowledgeBrain,
  queryKnowledgeBrain,
  rebuildKnowledgeBrain,
  recordDecision,
  registerEntity,
  registerSource,
  resolveContradiction,
  runKnowledgeLint,
  searchBrain,
  tombstoneSource,
} from "../../agent-os/brain";

export async function handleBrainRoutes(ctx: ManagementContext): Promise<Response | null> {
  const { url, req } = ctx;

  let path = "";
  if (url.pathname.startsWith("/api/brain/")) {
    path = url.pathname.slice("/api/brain/".length);
  } else if (url.pathname === "/api/brain") {
    path = "";
  } else if (url.pathname.startsWith("/api/agent-os/brain/")) {
    path = url.pathname.slice("/api/agent-os/brain/".length);
  } else if (url.pathname === "/api/agent-os/brain") {
    path = "";
  } else {
    return null;
  }

  // 1. Health & Status
  if ((path === "health" || path === "") && req.method === "GET") {
    return jsonResponse(getBrainHealthStatus(), 200, req, {});
  }

  // 2. Sources
  if (path === "sources" && req.method === "GET") {
    const projectId = url.searchParams.get("projectId") ?? undefined;
    const sourceType = url.searchParams.get("sourceType") as never;
    const status = url.searchParams.get("status") as never;
    return jsonResponse({ sources: listSources({ projectId, sourceType, status }) }, 200, req, {});
  }
  if (path === "sources" && req.method === "POST") {
    const body = await req.json().catch(() => null) as {
      sourceType?: string; title?: string; uriOrPath?: string; projectId?: string; content?: string;
    } | null;
    if (!body?.title || !body?.uriOrPath) {
      return jsonResponse({ error: { code: "invalid_body", message: "title and uriOrPath are required" } }, 400, req, {});
    }
    const source = registerSource({
      sourceType: (body.sourceType as never) ?? "MANUAL_NOTE",
      title: body.title,
      uriOrPath: body.uriOrPath,
      projectId: body.projectId ?? null,
    });
    if (body.content) {
      createSourceVersion({ sourceId: source.id, content: body.content });
    }
    return jsonResponse({ source: getSource(source.id) }, 201, req, {});
  }

  const sourceRefreshMatch = path.match(/^sources\/([^/]+)\/refresh$/);
  if (sourceRefreshMatch && req.method === "POST") {
    const body = await req.json().catch(() => null) as { content?: string } | null;
    const source = getSource(sourceRefreshMatch[1]!);
    if (!source) return jsonResponse({ error: { code: "not_found", message: "source not found" } }, 404, req, {});
    if (body?.content) {
      const { version, isNew } = createSourceVersion({ sourceId: source.id, content: body.content });
      return jsonResponse({ source: getSource(source.id), version, isNew }, 200, req, {});
    }
    return jsonResponse({ source }, 200, req, {});
  }

  const sourceDeleteMatch = path.match(/^sources\/([^/]+)$/);
  if (sourceDeleteMatch && req.method === "DELETE") {
    const deleted = tombstoneSource(sourceDeleteMatch[1]!);
    return jsonResponse({ deleted }, deleted ? 200 : 404, req, {});
  }

  // 3. Living Wiki
  if (path === "wiki" && req.method === "GET") {
    const pageType = url.searchParams.get("pageType") as never;
    const status = url.searchParams.get("status") as never;
    return jsonResponse({ pages: listWikiPages({ pageType, status }) }, 200, req, {});
  }

  const wikiCompileMatch = path.match(/^wiki\/([^/]+)\/compile$/);
  if (wikiCompileMatch && req.method === "POST") {
    const body = await req.json().catch(() => null) as {
      title?: string; pageType?: string; canonicalEntityId?: string; humanNotes?: string; sourceIds?: string[];
    } | null;
    const slug = wikiCompileMatch[1]!;
    const compiled = compileWikiPage({
      slug,
      title: body?.title ?? slug,
      pageType: (body?.pageType as never) ?? "CONCEPT",
      canonicalEntityId: body?.canonicalEntityId ?? null,
      humanNotes: body?.humanNotes,
      sourceIds: body?.sourceIds,
    });
    return jsonResponse(compiled, 200, req, {});
  }

  const wikiRevisionsMatch = path.match(/^wiki\/([^/]+)\/revisions$/);
  if (wikiRevisionsMatch && req.method === "GET") {
    const page = getWikiPage(wikiRevisionsMatch[1]!);
    if (!page) return jsonResponse({ error: { code: "not_found", message: "wiki page not found" } }, 404, req, {});
    return jsonResponse({ page, revisions: listWikiRevisions(page.id) }, 200, req, {});
  }

  const wikiGetMatch = path.match(/^wiki\/([^/]+)$/);
  if (wikiGetMatch && req.method === "GET") {
    const page = getWikiPage(wikiGetMatch[1]!);
    if (!page) return jsonResponse({ error: { code: "not_found", message: "wiki page not found" } }, 404, req, {});
    const revision = page.currentRevisionId ? getWikiRevision(page.currentRevisionId) : null;
    return jsonResponse({ page, revision }, 200, req, {});
  }

  // 4. Entities
  if (path === "entities" && req.method === "GET") {
    const entityType = url.searchParams.get("entityType") as never;
    return jsonResponse({ entities: listEntities({ entityType }) }, 200, req, {});
  }
  const entityGetMatch = path.match(/^entities\/([^/]+)$/);
  if (entityGetMatch && req.method === "GET") {
    const entity = getEntity(entityGetMatch[1]!);
    if (!entity) return jsonResponse({ error: { code: "not_found", message: "entity not found" } }, 404, req, {});
    return jsonResponse({ entity }, 200, req, {});
  }

  // 5. Claims & Relations
  if (path === "claims" && req.method === "GET") {
    const subjectEntityId = url.searchParams.get("subjectEntityId") ?? undefined;
    const predicate = url.searchParams.get("predicate") ?? undefined;
    const status = url.searchParams.get("status") as never;
    return jsonResponse({ claims: listClaims({ subjectEntityId, predicate, status }) }, 200, req, {});
  }
  if (path === "relations" && req.method === "GET") {
    const fromEntityId = url.searchParams.get("fromEntityId") ?? undefined;
    const toEntityId = url.searchParams.get("toEntityId") ?? undefined;
    const relationType = url.searchParams.get("relationType") as never;
    return jsonResponse({ relations: listRelations({ fromEntityId, toEntityId, relationType }) }, 200, req, {});
  }

  // 6. Decisions
  if (path === "decisions" && req.method === "GET") {
    const status = url.searchParams.get("status") as never;
    return jsonResponse({ decisions: listDecisions({ status }) }, 200, req, {});
  }
  if (path === "decisions" && req.method === "POST") {
    const body = await req.json().catch(() => null) as {
      title?: string; decision?: string; rationaleSummary?: string; alternatives?: string[]; supersedesId?: string;
    } | null;
    if (!body?.title || !body?.decision) {
      return jsonResponse({ error: { code: "invalid_body", message: "title and decision are required" } }, 400, req, {});
    }
    const dec = recordDecision({
      title: body.title,
      decision: body.decision,
      rationaleSummary: body.rationaleSummary,
      alternatives: body.alternatives,
      supersedesId: body.supersedesId,
    });
    return jsonResponse({ decision: dec }, 201, req, {});
  }

  // 7. Contradictions
  if (path === "contradictions" && req.method === "GET") {
    const status = url.searchParams.get("status") as never;
    return jsonResponse({ contradictions: listContradictions({ status }) }, 200, req, {});
  }
  const contradictionResolveMatch = path.match(/^contradictions\/([^/]+)\/resolve$/);
  if (contradictionResolveMatch && req.method === "POST") {
    const body = await req.json().catch(() => null) as {
      chosenClaimId?: string; resolution?: string; decidedBy?: string;
    } | null;
    if (!body?.chosenClaimId || !body?.resolution) {
      return jsonResponse({ error: { code: "invalid_body", message: "chosenClaimId and resolution are required" } }, 400, req, {});
    }
    const resolved = resolveContradiction({
      caseId: contradictionResolveMatch[1]!,
      chosenClaimId: body.chosenClaimId,
      resolution: body.resolution,
      decidedBy: body.decidedBy,
    });
    return jsonResponse({ contradiction: resolved }, 200, req, {});
  }

  // 8. Query & Search
  if (path === "query" && req.method === "POST") {
    const body = await req.json().catch(() => null) as { question?: string; query?: string; mode?: "CANONICAL" | "HISTORICAL" } | null;
    const queryText = body?.query ?? body?.question;
    if (!queryText) {
      return jsonResponse({ error: { code: "invalid_body", message: "query or question is required" } }, 400, req, {});
    }
    const result = queryKnowledgeBrain({ query: queryText, mode: body?.mode });
    return jsonResponse(result, 200, req, {});
  }
  if (path === "search" && (req.method === "GET" || req.method === "POST")) {
    const q = req.method === "POST"
      ? ((await req.json().catch(() => null)) as { query?: string })?.query ?? ""
      : url.searchParams.get("q") ?? "";
    const hits = searchBrain(q);
    return jsonResponse({ query: q, hits }, 200, req, {});
  }

  // 9. Compare, Lint, Rebuild, Prune, Bootstrap
  if (path === "compare" && (req.method === "GET" || req.method === "POST")) {
    let entityA = url.searchParams.get("entityA") ?? "";
    let entityB = url.searchParams.get("entityB") ?? "";
    if (req.method === "POST") {
      const body = await req.json().catch(() => null) as { entityA?: string; entityB?: string } | null;
      if (body?.entityA) entityA = body.entityA;
      if (body?.entityB) entityB = body.entityB;
    }
    if (!entityA || !entityB) {
      return jsonResponse({ error: { code: "invalid_body", message: "entityA and entityB are required" } }, 400, req, {});
    }
    try {
      const comparison = compareEntities(entityA, entityB);
      return jsonResponse(comparison, 200, req, {});
    } catch (err) {
      return jsonResponse({ error: { code: "compare_failed", message: err instanceof Error ? err.message : String(err) } }, 400, req, {});
    }
  }

  if (path === "lint" && (req.method === "GET" || req.method === "POST")) {
    return jsonResponse(runKnowledgeLint(), 200, req, {});
  }

  if (path === "rebuild" && req.method === "POST") {
    return jsonResponse(rebuildKnowledgeBrain(), 200, req, {});
  }

  if (path === "prune" && req.method === "POST") {
    return jsonResponse(pruneKnowledgeBrain(), 200, req, {});
  }

  if (path === "bootstrap" && req.method === "POST") {
    const result = bootstrapKnowledgeBrain();
    return jsonResponse({ bootstrap: result }, 200, req, {});
  }

  return jsonResponse({ error: { code: "not_found", message: `unknown brain route: ${path}` } }, 404, req, {});
}
