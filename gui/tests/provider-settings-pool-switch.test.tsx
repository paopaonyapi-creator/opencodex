import { afterEach, beforeEach, expect, mock, test } from "bun:test";
import { Window } from "happy-dom";
import { act } from "react";
import type { Root } from "react-dom/client";
import ProviderSettings from "../src/components/provider-workspace/ProviderSettings";
import type { ProviderPoolSwitchInput, ProviderPoolSwitchResult } from "../src/components/provider-workspace/types";
import { LanguageProvider } from "../src/i18n/provider";
import type { WorkspaceItem } from "../src/provider-workspace/catalog";

const globals = ["document", "window", "navigator", "localStorage", "IS_REACT_ACT_ENVIRONMENT"] as const;
let previousGlobals: Record<(typeof globals)[number], unknown>;
let testWindow: Window;

beforeEach(() => {
  previousGlobals = Object.fromEntries(globals.map(key => [key, Reflect.get(globalThis, key)])) as typeof previousGlobals;
  testWindow = new Window({ url: "http://localhost/#providers/workspace" });
  Object.defineProperty(testWindow.navigator, "language", { configurable: true, value: "en-US" });
  Object.defineProperties(globalThis, {
    document: { configurable: true, value: testWindow.document },
    window: { configurable: true, value: testWindow },
    navigator: { configurable: true, value: testWindow.navigator },
    localStorage: { configurable: true, value: testWindow.localStorage },
  });
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(() => {
  testWindow.close();
  for (const key of globals) Object.defineProperty(globalThis, key, { configurable: true, value: previousGlobals[key] });
});

const item: WorkspaceItem = {
  name: "maxplus-fff",
  adapter: "openai-responses",
  baseUrl: "https://old.example.test/v1",
  defaultModel: "old-model",
  authMode: "key",
  liveModels: true,
};

async function setInput(input: HTMLInputElement, value: string): Promise<void> {
  await act(async () => {
    Object.getOwnPropertyDescriptor(testWindow.HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new testWindow.Event("input", { bubbles: true }));
  });
}

async function mount(onSwitchPool: (name: string, input: ProviderPoolSwitchInput) => Promise<ProviderPoolSwitchResult>) {
  const container = document.createElement("div");
  document.body.append(container);
  const { createRoot } = await import("react-dom/client");
  let root!: Root;
  await act(async () => {
    root = createRoot(container);
    root.render(
      <LanguageProvider>
        <ProviderSettings item={item} onSwitchPool={onSwitchPool} />
      </LanguageProvider>,
    );
  });
  return { root, container };
}

test("tests and switches a supported API-key provider as one explicit action", async () => {
  const onSwitchPool = mock(async (): Promise<ProviderPoolSwitchResult> => ({ ok: true, models: 7 }));
  const { root, container } = await mount(onSwitchPool);
  const card = container.querySelector<HTMLElement>(".pwi-pool-switch-card")!;
  const inputs = card.querySelectorAll<HTMLInputElement>("input");

  expect(card).toBeTruthy();
  expect(inputs[0]?.value).toBe("https://old.example.test/v1");
  expect(inputs[1]?.value).toBe("old-model");
  expect(inputs[2]?.type).toBe("password");

  await setInput(inputs[0]!, "https://new.example.test/nonono/v1");
  await setInput(inputs[1]!, "new-model");
  await setInput(inputs[2]!, "candidate-secret");
  await act(async () => {
    card.querySelector<HTMLButtonElement>('button[type="submit"]')!.click();
    await Promise.resolve();
  });

  expect(onSwitchPool).toHaveBeenCalledWith("maxplus-fff", {
    baseUrl: "https://new.example.test/nonono/v1",
    defaultModel: "new-model",
    apiKey: "candidate-secret",
  });
  expect(inputs[2]?.value).toBe("");
  expect(card.textContent).toContain("7 models");
  expect(container.textContent).not.toContain("candidate-secret");
  await act(async () => { root.unmount(); });
});

test("keeps the attempted pool editable and offers probed models after a default-model rejection", async () => {
  const onSwitchPool = mock(async (): Promise<ProviderPoolSwitchResult> => ({
    ok: false,
    code: "default_model_unavailable",
    availableModelCount: 2,
    availableModels: ["new-a", "new-b"],
  }));
  const { root, container } = await mount(onSwitchPool);
  const card = container.querySelector<HTMLElement>(".pwi-pool-switch-card")!;
  const inputs = card.querySelectorAll<HTMLInputElement>("input");

  await setInput(inputs[1]!, "missing-model");
  await setInput(inputs[2]!, "candidate-secret");
  await act(async () => {
    card.querySelector<HTMLButtonElement>('button[type="submit"]')!.click();
    await Promise.resolve();
  });

  expect(inputs[0]?.value).toBe("https://old.example.test/v1");
  expect(inputs[1]?.value).toBe("missing-model");
  expect(inputs[2]?.value).toBe("");
  expect([...card.querySelectorAll("datalist option")].map(option => option.getAttribute("value"))).toEqual(["new-a", "new-b"]);
  expect(card.querySelector('[role="alert"]')?.textContent).toContain("2");
  await act(async () => { root.unmount(); });
});

test("does not show pool switching for providers the atomic endpoint cannot accept", async () => {
  const container = document.createElement("div");
  document.body.append(container);
  const { createRoot } = await import("react-dom/client");
  let root!: Root;
  await act(async () => {
    root = createRoot(container);
    root.render(
      <LanguageProvider>
        <ProviderSettings item={{ ...item, adapter: "anthropic" }} onSwitchPool={async () => ({ ok: true })} />
      </LanguageProvider>,
    );
  });

  expect(container.querySelector(".pwi-pool-switch-card")).toBeNull();
  await act(async () => { root.unmount(); });
});
