import { expect, test, vi } from "vite-plus/test";
import { DEFAULT_SETTINGS, type Settings, type UserConfig } from "../../shared/config";
import { createUi } from "./settings.svelte";

function createBridge() {
  let broadcast: (config: UserConfig) => void = () => {};
  let onRestore: (state: import("../../shared/ipc").RestoreSessionState) => void = () => {};
  const applyCss = vi.fn<(css: string) => void>();
  const orientationOverride = vi.fn<(value: "horizontal" | "vertical" | null) => void>();

  return {
    ui: createUi(
      {
        onConfig: (listener: (config: UserConfig) => void) => {
          broadcast = listener;
          return () => {};
        },
        onRestoreSession: (listener) => {
          onRestore = listener;
          return () => {};
        },
        orientationOverride,
      },
      applyCss,
    ),
    send: (settings: Partial<Settings>, css = "") =>
      broadcast({ css, settings: { ...DEFAULT_SETTINGS, ...settings } }),
    applyCss,
    orientationOverride,
    restore: (state: import("../../shared/ipc").RestoreSessionState) => onRestore(state),
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

test("a flip in the chrome is pushed to main as the override", () => {
  const { ui, orientationOverride } = createBridge();

  ui.toggleTabOrientation();
  expect(orientationOverride.mock.calls).toEqual([["vertical"]]);

  ui.toggleTabOrientation();
  expect(orientationOverride.mock.calls).toEqual([["vertical"], ["horizontal"]]);
});

test("a config-driven clear of the override pushes null to main", () => {
  const { ui, send, orientationOverride } = createBridge();

  send({ tabOrientation: "vertical" });
  ui.toggleTabOrientation();
  orientationOverride.mockClear();

  // The user edits the same field in config.toml; the chrome drops the
  // override and has to tell main, so the next save does not write a stale
  // value to disk.
  send({ tabOrientation: "horizontal" });
  expect(orientationOverride.mock.calls).toEqual([[null]]);
});

test("a saved session seeds the chrome's override before the first paint", () => {
  const { ui, restore, send } = createBridge();

  send({ tabOrientation: "horizontal" });
  expect(ui.tabOrientation).toBe("horizontal");

  restore({
    orientation: "vertical",
  });
  expect(ui.tabOrientation).toBe("vertical");
});

test("a saved session pushes its orientation back to main, surviving the first config broadcast's spurious clear", () => {
  // Reproduces the exact wire order on a relaunch: main sends `config` first
  // (with the user's actual orientation in config.toml), then `restoreSession`.
  // The chrome's initial state.settings is DEFAULT_SETTINGS, so the first
  // `onConfig` reads as a field change and clears the override — wiping the
  // mirror main seeded from the saved row. The `onRestoreSession` handler
  // must push the orientation back to main, or the next close persists null
  // and the flip survives exactly one relaunch.
  const { ui, send, restore, orientationOverride } = createBridge();

  send({ tabOrientation: "vertical" });
  expect(orientationOverride.mock.calls).toEqual([[null]]);
  orientationOverride.mockClear();

  restore({
    orientation: "horizontal",
  });
  expect(ui.tabOrientation).toBe("horizontal");
  expect(orientationOverride.mock.calls).toEqual([["horizontal"]]);
});
