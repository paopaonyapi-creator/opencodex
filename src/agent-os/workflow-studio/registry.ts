// Phase 20.93 — Node registry facade.
//
// The catalog (catalog.ts) holds the definition list as pure functions; this
// facade exposes a small object API for call sites that prefer it. Built-in
// definitions are installed on first access.

import { definitionFor, findNode, listNodes, registerAll } from "./catalog";
import { BUILT_IN_NODES } from "./built-in";
import type { WorkflowNodeDefinition } from "./types";

let installed = false;

function ensureInstalled(): void {
  if (installed) return;
  registerAll(BUILT_IN_NODES);
  installed = true;
}

export class NodeRegistry {
  constructor() {
    ensureInstalled();
  }

  get(type: string): WorkflowNodeDefinition | null {
    ensureInstalled();
    return findNode(type);
  }

  require(type: string): WorkflowNodeDefinition {
    ensureInstalled();
    return definitionFor(type);
  }

  list(): WorkflowNodeDefinition[] {
    ensureInstalled();
    return listNodes();
  }
}

let singleton: NodeRegistry | null = null;

export function getNodeRegistry(): NodeRegistry {
  if (!singleton) singleton = new NodeRegistry();
  return singleton;
}
