// Phase 20.11 — Browser Policy Engine
//
// Evaluates domain-specific and global browser action policies,
// enforcing strict prohibitions on credential dumps, arbitrary shell,
// and unauthorized high-impact browser operations.

import { existsSync, readFileSync } from "node:fs";
import { getBrowserConfig } from "../config";
import type { BrowserPolicy, DomainPolicyRule } from "../types";

export interface PolicyEvaluationResult {
  status: "allow" | "confirm" | "deny";
  reason?: string;
}

export class BrowserPolicyEngine {
  private policy: BrowserPolicy;

  constructor() {
    this.policy = this.loadPolicy();
  }

  private loadPolicy(): BrowserPolicy {
    const config = getBrowserConfig();
    if (existsSync(config.policyPath)) {
      try {
        const raw = readFileSync(config.policyPath, "utf-8");
        return this.parseYaml(raw);
      } catch {
        // Fallback to safe defaults
      }
    }

    return this.getDefaultPolicy();
  }

  public reloadPolicy(): void {
    this.policy = this.loadPolicy();
  }

  public getPolicy(): BrowserPolicy {
    return this.policy;
  }

  private getDefaultPolicy(): BrowserPolicy {
    return {
      defaultPolicy: "safe",
      allow: {
        read: ["*"],
        navigate: ["*"],
      },
      confirm: {
        actions: [
          "submit",
          "publish",
          "send_message",
          "delete",
          "purchase",
          "payment",
          "account_change",
          "credential_submission",
        ],
      },
      deny: {
        actions: [
          "export_passwords",
          "read_browser_password_store",
          "dump_cookies",
          "dump_auth_tokens",
          "arbitrary_shell",
          "browser.execute_javascript",
          "execute_javascript",
        ],
      },
      domains: {
        "stock.adobe.com": {
          allow: ["read", "click", "type", "upload"],
          confirm: ["submit", "publish"],
        },
        "github.com": {
          allow: ["read", "navigate"],
          confirm: ["create_issue", "merge", "delete"],
        },
      },
    };
  }

  private parseYaml(raw: string): BrowserPolicy {
    const policy = this.getDefaultPolicy();
    const lines = raw.split("\n");
    let currentSection = "";
    let currentDomain = "";

    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line || line.startsWith("#")) continue;

      if (line.startsWith("default_policy:")) {
        const val = line.split(":")[1]?.trim();
        if (val === "safe" || val === "strict" || val === "permissive") {
          policy.defaultPolicy = val;
        }
        continue;
      }

      if (line === "confirm:") {
        currentSection = "confirm";
        currentDomain = "";
        continue;
      }
      if (line === "deny:") {
        currentSection = "deny";
        currentDomain = "";
        continue;
      }
      if (line === "domains:") {
        currentSection = "domains";
        continue;
      }

      if (currentSection === "domains" && line.endsWith(":") && !line.startsWith("-")) {
        currentDomain = line.replace(":", "").trim();
        if (!policy.domains[currentDomain]) {
          policy.domains[currentDomain] = {};
        }
        continue;
      }

      if (line.startsWith("- ")) {
        const item = line.replace("- ", "").trim();
        if (currentSection === "confirm") {
          policy.confirm.actions = policy.confirm.actions || [];
          if (!policy.confirm.actions.includes(item)) policy.confirm.actions.push(item);
        } else if (currentSection === "deny") {
          policy.deny.actions = policy.deny.actions || [];
          if (!policy.deny.actions.includes(item)) policy.deny.actions.push(item);
        } else if (currentDomain && policy.domains[currentDomain]) {
          // Domain rules handled by defaults or additions
        }
      }
    }

    return policy;
  }

  public evaluateAction(action: string, urlString?: string): PolicyEvaluationResult {
    const normalizedAction = action.toLowerCase().trim();

    // 1. Invariable Deny List (Zero tolerance per Spec section 29 & 30)
    const strictDeny = [
      "export_passwords",
      "read_browser_password_store",
      "dump_cookies",
      "dump_auth_tokens",
      "arbitrary_shell",
      "browser.execute_javascript",
      "execute_javascript",
      "raw_javascript",
    ];
    if (
      strictDeny.some(
        (denied) => normalizedAction === denied || normalizedAction.includes(denied),
      )
    ) {
      return {
        status: "deny",
        reason: `Action '${action}' violates security policy (prohibited credential/code execution).`,
      };
    }

    // Check configured deny actions
    if (this.policy.deny.actions?.some((d) => normalizedAction.includes(d.toLowerCase()))) {
      return {
        status: "deny",
        reason: `Action '${action}' is denied by global security policy.`,
      };
    }

    // 2. Domain-specific policy checks
    if (urlString) {
      try {
        const parsed = new URL(urlString.startsWith("http") ? urlString : `https://${urlString}`);
        const hostname = parsed.hostname.toLowerCase();

        for (const [domain, rules] of Object.entries(this.policy.domains)) {
          if (hostname === domain || hostname.endsWith(`.${domain}`)) {
            if (rules.deny?.some((d) => d && (normalizedAction === d.toLowerCase() || normalizedAction.endsWith(d.toLowerCase())))) {
              return {
                status: "deny",
                reason: `Action '${action}' is denied on domain '${domain}'.`,
              };
            }
            if (rules.confirm?.some((c) => c && (normalizedAction === c.toLowerCase() || normalizedAction.endsWith(c.toLowerCase())))) {
              return {
                status: "confirm",
                reason: `Action '${action}' requires confirmation on domain '${domain}'.`,
              };
            }
            if (rules.allow?.some((a) => a && (a === "*" || normalizedAction === a.toLowerCase() || normalizedAction.endsWith(a.toLowerCase())))) {
              return { status: "allow" };
            }
          }
        }
      } catch {
        // Invalid URL, fall back to global
      }
    }

    // 3. Global allow check for read and navigate
    const readActions = ["read", "read_page", "snapshot", "get_text", "get_links", "get_title", "get_url", "screenshot"];
    if (readActions.includes(normalizedAction) || readActions.includes(normalizedAction.replace("browser.", ""))) {
      if (this.policy.allow.read?.includes("*") || this.policy.allow.read?.some((a) => a.toLowerCase() === normalizedAction)) {
        return { status: "allow" };
      }
    }

    const navActions = ["navigate", "scroll", "back", "forward", "reload", "stop"];
    if (navActions.includes(normalizedAction) || navActions.includes(normalizedAction.replace("browser.", ""))) {
      if (this.policy.allow.navigate?.includes("*") || this.policy.allow.navigate?.some((a) => a.toLowerCase() === normalizedAction)) {
        return { status: "allow" };
      }
    }

    // 4. Global confirmation checks
    if (
      this.policy.confirm.actions?.some(
        (c) => c && (normalizedAction === c.toLowerCase() || normalizedAction.endsWith(c.toLowerCase())),
      )
    ) {
      return {
        status: "confirm",
        reason: `Action '${action}' requires human confirmation by policy.`,
      };
    }

    return { status: "allow" };
  }
}

let policyEngineInstance: BrowserPolicyEngine | null = null;
export function getBrowserPolicyEngine(): BrowserPolicyEngine {
  if (!policyEngineInstance) {
    policyEngineInstance = new BrowserPolicyEngine();
  }
  return policyEngineInstance;
}
