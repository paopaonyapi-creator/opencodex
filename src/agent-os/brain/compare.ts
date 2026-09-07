// Phase 20.5 — Comparison & Duplicate Capability Detection Engine

import { listClaims } from "./claims";
import { getEntity, registerEntity, resolveEntity } from "./entities";
import { listRelations } from "./relations";
import type { KnowledgeClaim } from "./types";

export interface SharedRelationItem {
  relationType: string;
  targetEntityId: string;
  targetName: string;
}

export interface EntityComparisonResult {
  entityA: { id: string; name: string; type: string };
  entityB: { id: string; name: string; type: string };
  sharedCapabilities: string[];
  sharedRelations: SharedRelationItem[];
  uniqueToA: string[];
  uniqueToB: string[];
  differences: Array<{ attribute: string; valueA: string; valueB: string }>;
  conflicts: string[];
  overlapPercentage: number;
  recommendation: string;
}

export function compareEntities(nameOrIdA: string, nameOrIdB: string): EntityComparisonResult {
  const entA = getEntity(nameOrIdA) ?? resolveEntity(nameOrIdA) ?? registerEntity({ canonicalName: nameOrIdA, slug: nameOrIdA });
  const entB = getEntity(nameOrIdB) ?? resolveEntity(nameOrIdB) ?? registerEntity({ canonicalName: nameOrIdB, slug: nameOrIdB });

  const claimsA = listClaims({ subjectEntityId: entA.id, status: "ACTIVE" });
  const claimsB = listClaims({ subjectEntityId: entB.id, status: "ACTIVE" });

  const capsA = new Set(
    claimsA
      .filter((c) => c.claimType === "CAPABILITY" || c.predicate.toLowerCase().includes("capab") || c.predicate.toLowerCase().includes("feature"))
      .map((c) => c.objectValue.toLowerCase()),
  );
  const capsB = new Set(
    claimsB
      .filter((c) => c.claimType === "CAPABILITY" || c.predicate.toLowerCase().includes("capab") || c.predicate.toLowerCase().includes("feature"))
      .map((c) => c.objectValue.toLowerCase()),
  );

  const sharedCapabilities: string[] = [];
  const uniqueToA: string[] = [];
  const uniqueToB: string[] = [];

  for (const cap of capsA) {
    if (capsB.has(cap)) sharedCapabilities.push(cap);
    else uniqueToA.push(cap);
  }
  for (const cap of capsB) {
    if (!capsA.has(cap)) uniqueToB.push(cap);
  }

  // Relations comparison
  const relsA = listRelations({ fromEntityId: entA.id });
  const relsB = listRelations({ fromEntityId: entB.id });
  const sharedRelations: SharedRelationItem[] = [];

  for (const ra of relsA) {
    const match = relsB.find(
      (rb) => rb.relationType === ra.relationType && rb.toEntityId === ra.toEntityId,
    );
    if (match) {
      const tgt = resolveEntity(ra.toEntityId);
      sharedRelations.push({
        relationType: ra.relationType,
        targetEntityId: ra.toEntityId,
        targetName: tgt?.canonicalName ?? ra.toEntityId,
      });
    }
  }

  // Compare common predicates
  const mapPredA = new Map<string, string>();
  for (const c of claimsA) mapPredA.set(c.predicate.toLowerCase(), c.objectValue);

  const differences: Array<{ attribute: string; valueA: string; valueB: string }> = [];
  const conflicts: string[] = [];

  for (const c of claimsB) {
    const p = c.predicate.toLowerCase();
    if (mapPredA.has(p)) {
      const valA = mapPredA.get(p)!;
      if (valA.trim().toLowerCase() !== c.objectValue.trim().toLowerCase()) {
        differences.push({ attribute: c.predicate, valueA: valA, valueB: c.objectValue });
        if (p.includes("status") || p.includes("version") || p.includes("owner")) {
          conflicts.push(`Attribute '${c.predicate}' has conflicting values: '${valA}' vs '${c.objectValue}'`);
        }
      }
    }
  }

  const totalDistinctCaps = new Set([...capsA, ...capsB]).size;
  let overlapPercentage = 0;
  if (totalDistinctCaps > 0) {
    overlapPercentage = Math.round((sharedCapabilities.length / totalDistinctCaps) * 100);
  } else if (sharedRelations.length > 0) {
    const totalRels = new Set([
      ...relsA.map((r) => `${r.relationType}:${r.toEntityId}`),
      ...relsB.map((r) => `${r.relationType}:${r.toEntityId}`),
    ]).size;
    overlapPercentage = totalRels > 0 ? Math.round((sharedRelations.length / totalRels) * 100) : 50;
  }

  let recommendation = "Both entities have distinct scopes and can coexist without overlap.";
  if (overlapPercentage >= 70) {
    recommendation = `High capability overlap (${overlapPercentage}%). Consider extending ${entA.canonicalName} instead of building a duplicate component.`;
  } else if (overlapPercentage > 30) {
    recommendation = `Moderate capability overlap (${overlapPercentage}%). Ensure clear interface boundaries between ${entA.canonicalName} and ${entB.canonicalName}.`;
  }

  return {
    entityA: { id: entA.id, name: entA.canonicalName, type: entA.entityType },
    entityB: { id: entB.id, name: entB.canonicalName, type: entB.entityType },
    sharedCapabilities,
    sharedRelations,
    uniqueToA,
    uniqueToB,
    differences,
    conflicts,
    overlapPercentage,
    recommendation,
  };
}
