import { describe, expect, test, beforeAll } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import vm from 'node:vm';

/**
 * Phase 20.19 — extension content-script tests.
 *
 * The content scripts are plain JavaScript loaded by Chrome, so they cannot be imported like
 * the TypeScript modules. They are loaded into a VM sandbox instead, which is enough to
 * exercise the adapter runtime the way a page would.
 *
 * This file exists because READING the code did not find the defect it now covers: the gate
 * loop checked only the first keyword of each gate, so "Too many requests" was not detected
 * as a rate limit and a job would have typed into a rate-limited page.
 */

const CONTENT_DIR = join(import.meta.dir, '..', 'apps', 'pao-universal-ai-extension', 'src', 'content');

let sandbox: { window: Record<string, unknown> };
let universal: {
  detect: (context: unknown) => { adapterId: string | null; pageType: string; confidence: number; ambiguous: boolean; detail: string };
  claimsHost: (manifest: { hosts: string[] }, host: string) => boolean;
  detectCommonGates: (context: unknown) => { gate: string | null; evidence: string[] };
  getAdapter: (id: string) => { manifest: { id: string }; targets: string[] } | null;
  listManifests: () => { manifest: { id: string } }[];
};
let profiles: { targetsFor: (adapterId: string) => string[] };

function context(overrides: Record<string, unknown> = {}) {
  return {
    url: 'https://example.test/',
    host: 'example.test',
    title: '',
    documentState: 'complete',
    visibleText: [],
    ariaLabels: [],
    roles: [],
    ...overrides,
  };
}

beforeAll(() => {
  const loaded: Record<string, unknown> = {};
  const stub = {
    window: loaded as Record<string, unknown>,
    console,
    Node: { TEXT_NODE: 3 },
    document: { querySelectorAll: () => [], body: null, title: '' },
  };
  (stub.window as Record<string, unknown>).document = stub.document;
  vm.createContext(stub);
  for (const file of ['selector-profiles.js', 'adapter-runtime.js']) {
    vm.runInContext(readFileSync(join(CONTENT_DIR, file), 'utf8'), stub);
  }
  sandbox = stub as unknown as { window: Record<string, unknown> };
  universal = loaded.PaoUniversal as typeof universal;
  profiles = loaded.PaoSelectorProfiles as typeof profiles;
});

describe('Phase 20.19 — extension host claiming', () => {
  test('an exact host is claimed', () => {
    expect(universal.claimsHost({ hosts: ['grok.com', '*.grok.com'] }, 'grok.com')).toBe(true);
  });

  test('a subdomain is claimed by a wildcard', () => {
    expect(universal.claimsHost({ hosts: ['grok.com', '*.grok.com'] }, 'www.grok.com')).toBe(true);
  });

  test('a SUFFIX-TRICK host is not claimed', () => {
    // A substring test would let an attacker register either name and receive prompts meant
    // for the trusted site.
    expect(universal.claimsHost({ hosts: ['grok.com', '*.grok.com'] }, 'evil-grok.com')).toBe(false);
    expect(universal.claimsHost({ hosts: ['grok.com', '*.grok.com'] }, 'grok.com.evil.test')).toBe(false);
  });

  test('an unrelated host is not claimed', () => {
    expect(universal.claimsHost({ hosts: ['grok.com'] }, 'example.com')).toBe(false);
  });
});

describe('Phase 20.19 — extension adapter detection', () => {
  test('each of the four adapters is detected on its own host', () => {
    const hosts: [string, string][] = [
      ['grok', 'grok.com'],
      ['chatgpt', 'chatgpt.com'],
      ['gemini', 'gemini.google.com'],
      ['claude', 'claude.ai'],
    ];
    for (const [id, host] of hosts) {
      const detection = universal.detect(
        context({ url: 'https://' + host + '/', host, title: id + ' test', visibleText: [id], roles: ['textbox'] }),
      );
      expect(detection.adapterId, id).toBe(id);
    }
  });

  test('an unclaimed host is unsupported with full confidence in that answer', () => {
    const detection = universal.detect(context());
    expect(detection.pageType).toBe('unsupported');
    expect(detection.adapterId).toBeNull();
    expect(detection.confidence).toBe(1);
  });

  test('a claimed host with no signal is unknown, not a guess', () => {
    const detection = universal.detect(context({ url: 'https://grok.com/x', host: 'grok.com' }));
    expect(detection.pageType).toBe('unknown');
    expect(detection.confidence).toBe(0);
  });
});

describe('Phase 20.19 — extension gate detection', () => {
  test('EVERY keyword of a gate is checked, not just the first', () => {
    // The defect this test exists for: checking only hits[0] meant "Too many requests" was
    // not detected as a rate limit, so a job would have typed into a rate-limited page.
    const cases: [string, string][] = [
      ['Verify you are human', 'captcha'],
      ['captcha', 'captcha'],
      ['rate limit', 'rate_limited'],
      ['Too many requests', 'rate_limited'],
      ['Try again later', 'rate_limited'],
      ['Upgrade to continue', 'subscription_upgrade'],
      ['plus plan required', 'subscription_upgrade'],
      ['Add a payment method', 'payment_required'],
      ['Verify your account', 'account_verification'],
      ['Accept the terms to continue', 'terms_confirmation'],
      ['Delete permanently', 'publish_or_delete_confirm'],
      ['Sign in to continue', 'login_required'],
    ];
    for (const [text, expected] of cases) {
      const result = universal.detectCommonGates(context({ visibleText: [text] }));
      expect(result.gate, text).toBe(expected);
    }
  });

  test('a hard gate outranks a softer one on the same page', () => {
    const result = universal.detectCommonGates(
      context({ visibleText: ['Sign in to continue', 'Verify you are human'] }),
    );
    expect(result.gate).toBe('captcha');
  });

  test('a login URL is a gate even without text', () => {
    expect(universal.detectCommonGates(context({ url: 'https://grok.com/login' })).gate).toBe('login_required');
  });

  test('a clean page has no gate', () => {
    expect(universal.detectCommonGates(context({ visibleText: ['Projects', 'New project'] })).gate).toBeNull();
  });
});

describe('Phase 20.19 — extension adapters expose their targets', () => {
  test('every adapter has a selector profile with at least a prompt and a submit', () => {
    for (const entry of universal.listManifests()) {
      const targets = profiles.targetsFor(entry.manifest.id);
      expect(targets.length, entry.manifest.id).toBeGreaterThan(0);
      expect(targets, entry.manifest.id).toContain('promptInput');
      expect(targets, entry.manifest.id).toContain('submitButton');
    }
  });

  test('every adapter is retrievable by id', () => {
    for (const entry of universal.listManifests()) {
      expect(universal.getAdapter(entry.manifest.id)?.manifest.id).toBe(entry.manifest.id);
    }
  });

  test('an unknown adapter id resolves to null rather than throwing', () => {
    expect(universal.getAdapter('does-not-exist')).toBeNull();
  });
});
