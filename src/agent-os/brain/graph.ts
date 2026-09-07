// Phase 20.5 — Persistent Knowledge Graph Engine

import { openAgentOsDb } from "../db";
import { getEntity, listEntities } from "./entities";
import { listRelations } from "./relations";
import type { EntityType, KnowledgeEntity, KnowledgeRelation, RelationType } from "./types";

export interface KnowledgeGraphNode {
  id: string;
  label: string;
  type: EntityType;
  projectId?: string | null;
  status: string;
}

export interface KnowledgeGraphEdge {
  id: string;
  source: string;
  target: string;
  relationType: RelationType;
  status: string;
}

export interface KnowledgeGraphView {
  nodes: KnowledgeGraphNode[];
  edges: KnowledgeGraphEdge[];
  stats: {
    nodeCount: number;
    edgeCount: number;
    relationTypes: Record<string, number>;
    entityTypes: Record<string, number>;
  };
}

export function getKnowledgeGraph(
  rootOrFilters?: string | {
    projectId?: string | null;
    entityType?: EntityType;
    relationType?: RelationType;
  },
  depth = 2,
): KnowledgeGraphView {
  const db = openAgentOsDb();

  if (typeof rootOrFilters === "string") {
    const rootId = rootOrFilters;
    const visitedNodes = new Set<string>([rootId]);
    const visitedEdges = new Set<string>();
    const edges: KnowledgeGraphEdge[] = [];
    const queue: Array<{ id: string; currentDepth: number }> = [{ id: rootId, currentDepth: 0 }];

    while (queue.length > 0) {
      const { id, currentDepth } = queue.shift()!;
      if (currentDepth >= depth) continue;

      const relRows = db.query(`
        SELECT * FROM knowledge_relations
        WHERE (from_entity_id = ? OR to_entity_id = ?) AND status = 'ACTIVE'
      `).all(id, id) as Record<string, unknown>[];

      for (const row of relRows) {
        const edgeId = String(row.id);
        const fromId = String(row.from_entity_id);
        const toId = String(row.to_entity_id);

        if (!visitedEdges.has(edgeId)) {
          visitedEdges.add(edgeId);
          edges.push({
            id: edgeId,
            source: fromId,
            target: toId,
            relationType: row.relation_type as RelationType,
            status: String(row.status),
          });
        }

        const neighborId = fromId === id ? toId : fromId;
        if (!visitedNodes.has(neighborId)) {
          visitedNodes.add(neighborId);
          queue.push({ id: neighborId, currentDepth: currentDepth + 1 });
        }
      }
    }

    const nodes: KnowledgeGraphNode[] = [];
    const entityTypes: Record<string, number> = {};
    const relationTypes: Record<string, number> = {};

    for (const nid of visitedNodes) {
      const ent = getEntity(nid);
      if (ent) {
        nodes.push({
          id: ent.id,
          label: ent.canonicalName,
          type: ent.entityType,
          projectId: ent.projectId,
          status: ent.status,
        });
        entityTypes[ent.entityType] = (entityTypes[ent.entityType] ?? 0) + 1;
      }
    }

    for (const e of edges) {
      relationTypes[e.relationType] = (relationTypes[e.relationType] ?? 0) + 1;
    }

    return {
      nodes,
      edges,
      stats: {
        nodeCount: nodes.length,
        edgeCount: edges.length,
        relationTypes,
        entityTypes,
      },
    };
  }

  const filters = rootOrFilters;
  const entities = listEntities({
    projectId: filters?.projectId,
    entityType: filters?.entityType,
    status: "active",
  });

  const entityMap = new Map<string, KnowledgeEntity>();
  for (const ent of entities) entityMap.set(ent.id, ent);

  const relations = listRelations({
    relationType: filters?.relationType,
    status: "ACTIVE",
  });

  const nodes: KnowledgeGraphNode[] = [];
  const edges: KnowledgeGraphEdge[] = [];
  const entityTypes: Record<string, number> = {};
  const relationTypes: Record<string, number> = {};

  for (const ent of entities) {
    nodes.push({
      id: ent.id,
      label: ent.canonicalName,
      type: ent.entityType,
      projectId: ent.projectId,
      status: ent.status,
    });
    entityTypes[ent.entityType] = (entityTypes[ent.entityType] ?? 0) + 1;
  }

  for (const rel of relations) {
    // Include edge if both endpoints exist (or fetch endpoints)
    let src = entityMap.get(rel.fromEntityId);
    if (!src) {
      src = getEntity(rel.fromEntityId) ?? undefined;
      if (src) {
        entityMap.set(src.id, src);
        nodes.push({ id: src.id, label: src.canonicalName, type: src.entityType, projectId: src.projectId, status: src.status });
      }
    }

    let tgt = entityMap.get(rel.toEntityId);
    if (!tgt) {
      tgt = getEntity(rel.toEntityId) ?? undefined;
      if (tgt) {
        entityMap.set(tgt.id, tgt);
        nodes.push({ id: tgt.id, label: tgt.canonicalName, type: tgt.entityType, projectId: tgt.projectId, status: tgt.status });
      }
    }

    if (src && tgt) {
      edges.push({
        id: rel.id,
        source: rel.fromEntityId,
        target: rel.toEntityId,
        relationType: rel.relationType,
        status: rel.status,
      });
      relationTypes[rel.relationType] = (relationTypes[rel.relationType] ?? 0) + 1;
    }
  }

  return {
    nodes,
    edges,
    stats: {
      nodeCount: nodes.length,
      edgeCount: edges.length,
      relationTypes,
      entityTypes,
    },
  };
}

export function findEntityNeighborhood(entityId: string, maxHops = 2): KnowledgeGraphView {
  const visitedNodes = new Set<string>([entityId]);
  const frontier = [entityId];
  const edges: KnowledgeGraphEdge[] = [];
  const edgeSet = new Set<string>();

  for (let hop = 0; hop < maxHops; hop++) {
    const nextFrontier: string[] = [];
    for (const currentId of frontier) {
      const outgoing = listRelations({ fromEntityId: currentId, status: "ACTIVE" });
      for (const rel of outgoing) {
        if (!edgeSet.has(rel.id)) {
          edgeSet.add(rel.id);
          edges.push({
            id: rel.id,
            source: rel.fromEntityId,
            target: rel.toEntityId,
            relationType: rel.relationType,
            status: rel.status,
          });
        }
        if (!visitedNodes.has(rel.toEntityId)) {
          visitedNodes.add(rel.toEntityId);
          nextFrontier.push(rel.toEntityId);
        }
      }

      const incoming = listRelations({ toEntityId: currentId, status: "ACTIVE" });
      for (const rel of incoming) {
        if (!edgeSet.has(rel.id)) {
          edgeSet.add(rel.id);
          edges.push({
            id: rel.id,
            source: rel.fromEntityId,
            target: rel.toEntityId,
            relationType: rel.relationType,
            status: rel.status,
          });
        }
        if (!visitedNodes.has(rel.fromEntityId)) {
          visitedNodes.add(rel.fromEntityId);
          nextFrontier.push(rel.fromEntityId);
        }
      }
    }
    frontier.length = 0;
    frontier.push(...nextFrontier);
  }

  const nodes: KnowledgeGraphNode[] = [];
  const entityTypes: Record<string, number> = {};
  const relationTypes: Record<string, number> = {};

  for (const id of visitedNodes) {
    const ent = getEntity(id);
    if (ent) {
      nodes.push({ id: ent.id, label: ent.canonicalName, type: ent.entityType, projectId: ent.projectId, status: ent.status });
      entityTypes[ent.entityType] = (entityTypes[ent.entityType] ?? 0) + 1;
    }
  }

  for (const edge of edges) {
    relationTypes[edge.relationType] = (relationTypes[edge.relationType] ?? 0) + 1;
  }

  return {
    nodes,
    edges,
    stats: {
      nodeCount: nodes.length,
      edgeCount: edges.length,
      relationTypes,
      entityTypes,
    },
  };
}
