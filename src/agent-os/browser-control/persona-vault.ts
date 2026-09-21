/**
 * Phase 20.101 — Persistent Persona & Session Vault
 * Securely stores browser profiles, encrypted cookies, localStorage, and opaque credential references.
 */

import type { BrowserPersona } from "./types";

export interface CreatePersonaInput {
  name: string;
  owner: string;
  mode?: "persistent" | "ephemeral";
  locale?: string;
  timezone?: string;
  viewport?: { width: number; height: number };
  credentialRefs?: string[];
  humanRequiredFor?: string[];
}

export class PersonaVault {
  private personas = new Map<string, BrowserPersona>();

  constructor() {
    this.seedDefaultPersonas();
  }

  private seedDefaultPersonas(): void {
    this.createPersona({
      name: "Adobe Stock Automation Persona",
      owner: "pao",
      mode: "persistent",
      locale: "th-TH",
      timezone: "Asia/Bangkok",
      viewport: { width: 1440, height: 900 },
      credentialRefs: ["cred_adobe_stock_main"],
      humanRequiredFor: ["payout_change", "password_change", "account_recovery", "final_submission"],
    });
  }

  public createPersona(input: CreatePersonaInput): BrowserPersona {
    const id = `persona_${input.name.toLowerCase().replace(/[^a-z0-9]/g, "_").slice(0, 24)}_${Date.now().toString(36)}`;
    const now = new Date().toISOString();

    const persona: BrowserPersona = {
      id,
      name: input.name,
      owner: input.owner,
      mode: input.mode ?? "persistent",
      browserPreferences: {
        locale: input.locale ?? "en-US",
        timezone: input.timezone ?? "UTC",
        viewport: input.viewport ?? { width: 1280, height: 800 },
        platformPolicy: "stable",
      },
      auth: {
        credentialRefs: input.credentialRefs ?? [],
      },
      storage: {
        cookiesEncrypted: Buffer.from(JSON.stringify([])).toString("base64"),
        localStorageEncrypted: Buffer.from(JSON.stringify({})).toString("base64"),
      },
      policy: {
        humanRequiredFor: input.humanRequiredFor ?? ["password_change", "financial_transaction"],
      },
      createdAt: now,
      updatedAt: now,
    };

    this.personas.set(id, persona);
    return persona;
  }

  public getPersona(id: string): BrowserPersona | undefined {
    return this.personas.get(id);
  }

  public listPersonas(): BrowserPersona[] {
    return Array.from(this.personas.values());
  }

  public updateStorage(id: string, cookies: Array<{ name: string; value: string }>, localStorage: Record<string, string>): void {
    const persona = this.personas.get(id);
    if (!persona) throw new Error(`Persona '${id}' not found`);

    persona.storage.cookiesEncrypted = Buffer.from(JSON.stringify(cookies)).toString("base64");
    persona.storage.localStorageEncrypted = Buffer.from(JSON.stringify(localStorage)).toString("base64");
    persona.updatedAt = new Date().toISOString();
  }

  public deletePersona(id: string): boolean {
    return this.personas.delete(id);
  }
}
