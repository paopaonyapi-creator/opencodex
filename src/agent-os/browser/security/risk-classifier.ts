// Phase 20.11 — Browser Action Risk Classifier
//
// Categorizes browser actions into 4 security risk levels:
// Level 0 (READ), Level 1 (LOW), Level 2 (CONTROLLED), Level 3 (CONFIRM_REQUIRED).

import type { ActionProposal, BrowserRiskLevel } from "../types";

export class BrowserRiskClassifier {
  private static readonly READ_TOOLS = new Set([
    "browser.status",
    "browser.list_tabs",
    "browser.get_active_tab",
    "browser.read_page",
    "browser.get_text",
    "browser.get_title",
    "browser.get_url",
    "browser.get_links",
    "browser.get_elements",
    "browser.get_forms",
    "browser.get_buttons",
    "browser.get_inputs",
    "browser.snapshot",
    "browser.screenshot",
    "browser.screenshot_element",
    "browser.get_downloads",
  ]);

  private static readonly LOW_RISK_TOOLS = new Set([
    "browser.new_tab",
    "browser.close_tab",
    "browser.activate_tab",
    "browser.duplicate_tab",
    "browser.navigate",
    "browser.back",
    "browser.forward",
    "browser.reload",
    "browser.stop",
    "browser.scroll",
    "browser.hover",
    "browser.focus",
  ]);

  private static readonly CONTROLLED_TOOLS = new Set([
    "browser.click",
    "browser.double_click",
    "browser.type",
    "browser.fill",
    "browser.clear",
    "browser.select",
    "browser.check",
    "browser.uncheck",
    "browser.press_key",
    "browser.wait_download",
    "browser.upload_file",
  ]);

  private static readonly CONFIRM_REQUIRED_KEYWORDS = [
    "submit",
    "publish",
    "checkout",
    "purchase",
    "pay",
    "order",
    "buy",
    "delete",
    "destroy",
    "remove",
    "transfer",
    "password",
    "credential",
    "send_message",
  ];

  public classify(proposal: ActionProposal): BrowserRiskLevel {
    const tool = proposal.tool.toLowerCase().trim();

    // 1. Check if tool or target text matches confirm-required triggers
    const targetDesc = typeof proposal.target === "string"
      ? proposal.target.toLowerCase()
      : [proposal.target?.name, proposal.target?.text, proposal.target?.role]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();

    for (const kw of BrowserRiskClassifier.CONFIRM_REQUIRED_KEYWORDS) {
      if (tool.includes(kw) || targetDesc.includes(kw)) {
        return "CONFIRM_REQUIRED";
      }
    }

    // If sensitive flag is set
    if (proposal.sensitive) {
      return "CONFIRM_REQUIRED";
    }

    // 2. Classify by canonical tool set
    if (BrowserRiskClassifier.READ_TOOLS.has(tool)) {
      return "READ";
    }

    if (BrowserRiskClassifier.LOW_RISK_TOOLS.has(tool)) {
      return "LOW";
    }

    if (BrowserRiskClassifier.CONTROLLED_TOOLS.has(tool)) {
      return "CONTROLLED";
    }

    // Default unknown actions to CONTROLLED
    return "CONTROLLED";
  }
}

let riskClassifierInstance: BrowserRiskClassifier | null = null;
export function getBrowserRiskClassifier(): BrowserRiskClassifier {
  if (!riskClassifierInstance) {
    riskClassifierInstance = new BrowserRiskClassifier();
  }
  return riskClassifierInstance;
}
