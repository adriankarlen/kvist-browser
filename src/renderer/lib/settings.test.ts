import { expect, test, vi } from "vite-plus/test";
import { DEFAULT_SETTINGS, type Settings, type UserConfig } from "../../shared/config";
import { createUi } from "./settings.svelte";

function createBridge() {
  let broadcast: (config: UserConfig) => void = () => {};
  const applyCss = vi.fn<(css: string) => void>();

  return {
    ui: createUi(
      {
        onConfig: (listener: (config: UserConfig) => void) => {
          broadcast = listener;
          return () => {};
        },
      },
      applyCss,
    ),
    send: (settings: Partial<Settings>, css = "") =>
      broadcast({ css, settings: { ...DEFAULT_SETTINGS, ...settings } }),
    applyCss,
  };
}

test("orientation follows the config until the chrome flips it", () => {
  const { ui, send } = createBridge();

  send({ tabOrientation: "vertical" });
  expect(ui.tabOrientation).toBe("vertical");

  ui.toggleTabOrientation();
  expect(ui.tabOrientation).toBe("horizontal");
});

test("an unrelated save leaves a flip alone", () => {
  const { ui, send } = createBridge();

  send({ tabOrientation: "vertical" });
  ui.toggleTabOrientation();

  // Saving config.toml for any other reason must not undo what the user just
  // did in the chrome.
  send({ tabOrientation: "vertical", homepage: "https://example.com" });
  expect(ui.tabOrientation).toBe("horizontal");
});

test("editing the field itself is the last word", () => {
  const { ui, send } = createBridge();

  send({ tabOrientation: "vertical" });
  ui.toggleTabOrientation();
  expect(ui.tabOrientation).toBe("horizontal");

  // The user wrote it down; the file wins over the flip.
  send({ tabOrientation: "horizontal" });
  expect(ui.tabOrientation).toBe("horizontal");

  send({ tabOrientation: "vertical" });
  expect(ui.tabOrientation).toBe("vertical");
});

test("the user's stylesheet is applied on every broadcast", () => {
  const { send, applyCss } = createBridge();

  send({}, ".kv-tab { color: red }");
  send({}, "");

  expect(applyCss.mock.calls).toEqual([[".kv-tab { color: red }"], [""]]);
});
