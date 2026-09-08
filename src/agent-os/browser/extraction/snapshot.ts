// Phase 20.11 — Accessibility Semantic Page Snapshot
//
// Generates compact, numbered accessibility element trees ([e1], [e2]...)
// to allow AI agents to navigate and interact reliably without raw DOM guesswork.

import type { PageSnapshot, SnapshotElement } from "../types";

export class PageSnapshotEngine {
  /**
   * Generates structured SnapshotElements from an HTML page or DOM fragment.
   */
  public generateSnapshot(html: string, url = "about:blank", title = ""): PageSnapshot {
    const elements: SnapshotElement[] = [];
    let refCounter = 1;

    // Helper to add element
    const addElem = (
      role: string,
      name: string,
      tag: string,
      clickable: boolean,
      extra: Partial<SnapshotElement> = {},
    ) => {
      const cleanName = name.trim();
      if (!cleanName && role !== "textbox") return;
      const ref = `e${refCounter++}`;
      elements.push({
        ref,
        role,
        name: cleanName,
        tag,
        clickable,
        ...extra,
      });
    };

    // 1. Links
    const linkRegex = /<a\s+([^>]*)>([\s\S]*?)<\/a>/gi;
    let match: RegExpExecArray | null;
    while ((match = linkRegex.exec(html)) !== null) {
      const text = match[2].replace(/<[^>]+>/g, "").trim();
      const hrefMatch = /href=["']([^"']*)["']/i.exec(match[1]);
      const href = hrefMatch ? hrefMatch[1] : "";
      if (text) {
        addElem("link", text, "a", true, {
          text,
          selector: href ? `a[href="${href}"]` : "a",
        });
      }
    }

    // 2. Buttons
    const buttonRegex = /<button\s*([^>]*)>([\s\S]*?)<\/button>/gi;
    while ((match = buttonRegex.exec(html)) !== null) {
      const text = match[2].replace(/<[^>]+>/g, "").trim();
      if (text) {
        addElem("button", text, "button", true, {
          text,
          selector: `button:has-text("${text}")`,
        });
      }
    }

    // 3. Inputs & Textboxes
    const inputRegex = /<input\s+([^>]*)\/?>/gi;
    while ((match = inputRegex.exec(html)) !== null) {
      const attrs = match[1];
      const typeMatch = /type=["']([^"']*)["']/i.exec(attrs);
      const nameMatch = /name=["']([^"']*)["']/i.exec(attrs);
      const idMatch = /id=["']([^"']*)["']/i.exec(attrs);
      const placeholderMatch = /placeholder=["']([^"']*)["']/i.exec(attrs);
      const valueMatch = /value=["']([^"']*)["']/i.exec(attrs);

      const type = typeMatch ? typeMatch[1].toLowerCase() : "text";
      const name = placeholderMatch?.[1] || nameMatch?.[1] || idMatch?.[1] || type;

      if (type === "button" || type === "submit") {
        addElem("button", valueMatch?.[1] || name, "input", true);
      } else if (type === "checkbox") {
        addElem("checkbox", name, "input", true, { checked: attrs.includes("checked") });
      } else if (type === "radio") {
        addElem("radio", name, "input", true);
      } else if (type !== "hidden") {
        addElem("textbox", name, "input", false, {
          value: valueMatch?.[1],
          selector: idMatch ? `#${idMatch[1]}` : `input[name="${nameMatch?.[1]}"]`,
        });
      }
    }

    // 4. Textareas
    const textareaRegex = /<textarea\s+([^>]*)>([\s\S]*?)<\/textarea>/gi;
    while ((match = textareaRegex.exec(html)) !== null) {
      const attrs = match[1];
      const nameMatch = /name=["']([^"']*)["']/i.exec(attrs);
      const placeholderMatch = /placeholder=["']([^"']*)["']/i.exec(attrs);
      const label = placeholderMatch?.[1] || nameMatch?.[1] || "textarea";
      addElem("textbox", label, "textarea", false, {
        value: match[2].trim(),
      });
    }

    return {
      url,
      title: title || "Page Snapshot",
      tabId: "tab_001",
      timestamp: new Date().toISOString(),
      elements,
    };
  }

  /**
   * Formats the page snapshot into the concise markdown text representation
   * expected by AI agents.
   */
  public formatSnapshotText(snapshot: PageSnapshot): string {
    const lines = [
      `Snapshot: ${snapshot.title} (${snapshot.url})`,
      `Interactive Elements (${snapshot.elements.length}):`,
    ];

    for (const el of snapshot.elements) {
      let desc = `[${el.ref}] ${el.role} "${el.name}"`;
      if (el.value) desc += ` value="${el.value}"`;
      if (el.disabled) desc += " (disabled)";
      if (el.checked) desc += " (checked)";
      lines.push(desc);
    }

    return lines.join("\n");
  }
}

let snapshotEngineInstance: PageSnapshotEngine | null = null;
export function getPageSnapshotEngine(): PageSnapshotEngine {
  if (!snapshotEngineInstance) {
    snapshotEngineInstance = new PageSnapshotEngine();
  }
  return snapshotEngineInstance;
}
