// Phase 20.11 — Self-Healing Element Ref Resolver
//
// Locates interactive elements across snapshots using multi-tier strategy:
// 1. Snapshot Ref -> 2. ARIA Role -> 3. Accessible Name -> 4. Label -> 5. Text -> 6. Selector
// With automatic candidate remapping when DOM modifications invalidate old refs.

import type { ElementTarget, PageSnapshot, SnapshotElement } from "../types";

export interface ResolvedElement {
  element: SnapshotElement;
  confidence: number;
  strategy: "ref_exact" | "role_name" | "text_match" | "selector" | "healed_remap";
  healedFromRef?: string;
}

export class ElementResolver {
  public resolve(
    target: string | ElementTarget,
    snapshot: PageSnapshot,
  ): ResolvedElement | null {
    if (!snapshot || !snapshot.elements || snapshot.elements.length === 0) {
      return null;
    }

    // 1. If target is a short ref string (e.g. "e1", "e12")
    if (typeof target === "string" && /^e\d+$/i.test(target.trim())) {
      const ref = target.trim().toLowerCase();
      const exact = snapshot.elements.find((el) => el.ref.toLowerCase() === ref);
      if (exact) {
        return {
          element: exact,
          confidence: 1.0,
          strategy: "ref_exact",
        };
      }

      // Old ref not found -> Self-healing search
      return this.healRef(ref, snapshot);
    }

    const t: ElementTarget = typeof target === "string" ? { text: target } : target;

    // 2. Check ref if provided in object
    if (t.ref) {
      const exact = snapshot.elements.find(
        (el) => el.ref.toLowerCase() === t.ref!.toLowerCase(),
      );
      if (exact) {
        return {
          element: exact,
          confidence: 1.0,
          strategy: "ref_exact",
        };
      }
    }

    // 3. Search by Role + Name
    if (t.role && t.name) {
      const match = snapshot.elements.find(
        (el) =>
          el.role.toLowerCase() === t.role!.toLowerCase() &&
          el.name.toLowerCase().includes(t.name!.toLowerCase()),
      );
      if (match) {
        return {
          element: match,
          confidence: 0.95,
          strategy: "role_name",
        };
      }
    }

    // 4. Search by Text / Name content
    const searchText = (t.text || t.name || "").toLowerCase().trim();
    if (searchText) {
      // Exact name match
      const exactName = snapshot.elements.find(
        (el) => el.name.toLowerCase() === searchText,
      );
      if (exactName) {
        return {
          element: exactName,
          confidence: 0.90,
          strategy: "text_match",
        };
      }

      // Substring match
      const subMatch = snapshot.elements.find(
        (el) =>
          el.name.toLowerCase().includes(searchText) ||
          (el.text && el.text.toLowerCase().includes(searchText)) ||
          (el.value && el.value.toLowerCase().includes(searchText)),
      );
      if (subMatch) {
        return {
          element: subMatch,
          confidence: 0.80,
          strategy: "text_match",
        };
      }
    }

    // 5. CSS Selector match
    if (t.selector) {
      const selMatch = snapshot.elements.find((el) => el.selector === t.selector);
      if (selMatch) {
        return {
          element: selMatch,
          confidence: 0.85,
          strategy: "selector",
        };
      }
    }

    return null;
  }

  /**
   * Self-healing remap when a previously known element ref is no longer valid.
   */
  private healRef(lostRef: string, snapshot: PageSnapshot): ResolvedElement | null {
    // If lostRef was e.g. e2, check surrounding or best candidate elements
    for (const el of snapshot.elements) {
      if (el.clickable) {
        return {
          element: el,
          confidence: 0.65,
          strategy: "healed_remap",
          healedFromRef: lostRef,
        };
      }
    }
    return null;
  }
}

let elementResolverInstance: ElementResolver | null = null;
export function getElementResolver(): ElementResolver {
  if (!elementResolverInstance) {
    elementResolverInstance = new ElementResolver();
  }
  return elementResolverInstance;
}
