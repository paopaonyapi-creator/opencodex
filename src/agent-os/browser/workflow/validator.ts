// Phase 20.12 — Browser Workflow Postcondition & Semantic Validator
//
// Evaluates validation rules against active page snapshots, URLs, and DOM elements
// to ensure workflow steps achieve intended deterministic outcomes before proceeding.

import { getBrowserBridge } from "../bridge/browser-bridge";
import { getElementResolver } from "../extraction/element-resolver";
import type { ValidationRule } from "./types";

export interface ValidationResult {
  passed: boolean;
  rule?: ValidationRule;
  message?: string;
  actual?: unknown;
}

export class WorkflowValidator {
  /**
   * Evaluates a list of validation rules against a given tab (or current active tab).
   */
  public async validate(
    rules: ValidationRule[] | undefined,
    tabId?: string,
  ): Promise<ValidationResult> {
    if (!rules || rules.length === 0) {
      return { passed: true };
    }

    const bridge = getBrowserBridge();
    const activeTab = tabId
      ? bridge.listTabs().find((t) => t.id === tabId)
      : bridge.getActiveTab();

    if (!activeTab) {
      return {
        passed: false,
        message: "No active browser tab found for validation.",
      };
    }

    const snapshot = bridge.getSnapshot(activeTab.id);

    for (const rule of rules) {
      const singleRes = this.validateRule(rule, activeTab.url, snapshot);
      if (!singleRes.passed) {
        return singleRes;
      }
    }

    return { passed: true };
  }

  /**
   * Evaluates an individual validation rule.
   */
  public validateRule(
    rule: ValidationRule,
    currentUrl: string,
    snapshot: ReturnType<typeof getBrowserBridge>["getSnapshot"] extends (tabId?: string) => infer R ? R : never,
  ): ValidationResult {
    switch (rule.type) {
      case "url_contains": {
        const passed = currentUrl.toLowerCase().includes(rule.expected.toLowerCase());
        return {
          passed,
          rule,
          message: passed
            ? undefined
            : `URL validation failed: expected URL to contain '${rule.expected}', got '${currentUrl}'`,
          actual: currentUrl,
        };
      }

      case "url_matches": {
        try {
          const regex = new RegExp(rule.expected);
          const passed = regex.test(currentUrl);
          return {
            passed,
            rule,
            message: passed
              ? undefined
              : `URL validation failed: URL '${currentUrl}' did not match pattern '${rule.expected}'`,
            actual: currentUrl,
          };
        } catch (e: any) {
          return {
            passed: false,
            rule,
            message: `Invalid regex pattern in url_matches: ${e.message}`,
            actual: currentUrl,
          };
        }
      }

      case "element_present": {
        const target = rule.selector || rule.ref || rule.expected;
        const resolved = getElementResolver().resolve(target, snapshot);
        const passed = resolved !== null;
        return {
          passed,
          rule,
          message: passed
            ? undefined
            : `Element validation failed: target '${target}' was not found on page.`,
          actual: resolved ? resolved.element.ref : null,
        };
      }

      case "text_visible": {
        const search = rule.expected.toLowerCase().trim();
        // Check in snapshot text or elements
        let found = false;
        if (snapshot.title && snapshot.title.toLowerCase().includes(search)) {
          found = true;
        } else if (
          snapshot.elements &&
          snapshot.elements.some(
            (el) =>
              (el.name && el.name.toLowerCase().includes(search)) ||
              (el.text && el.text.toLowerCase().includes(search)) ||
              (el.value && el.value.toLowerCase().includes(search)),
          )
        ) {
          found = true;
        }

        return {
          passed: found,
          rule,
          message: found
            ? undefined
            : `Text validation failed: text '${rule.expected}' not visible on page.`,
          actual: found,
        };
      }

      case "element_value": {
        const target = rule.selector || rule.ref || "input";
        const resolved = getElementResolver().resolve(target, snapshot);
        if (!resolved) {
          return {
            passed: false,
            rule,
            message: `Element value validation failed: target '${target}' not found.`,
            actual: null,
          };
        }

        const actualVal = String(resolved.element.value || resolved.element.text || "");
        const passed = actualVal.includes(rule.expected);
        return {
          passed,
          rule,
          message: passed
            ? undefined
            : `Element value mismatch for '${target}': expected '${rule.expected}', got '${actualVal}'`,
          actual: actualVal,
        };
      }

      default:
        return {
          passed: true,
          rule,
          message: `Unknown validation type '${(rule as any).type}', ignored.`,
        };
    }
  }
}

let validatorInstance: WorkflowValidator | null = null;
export function getWorkflowValidator(): WorkflowValidator {
  if (!validatorInstance) {
    validatorInstance = new WorkflowValidator();
  }
  return validatorInstance;
}
