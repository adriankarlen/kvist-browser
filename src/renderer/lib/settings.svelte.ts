import { DEFAULT_SETTINGS, type Settings, type TabOrientation } from "../../shared/config";
import type { KvistApi } from "../../shared/ipc";

export type Ui = ReturnType<typeof createUi>;

const USER_STYLE_ID = "kv-user-config";

/**
 * Injected without a cascade layer, which beats every layer Kvist ships
 * regardless of specificity — so config.css never needs !important.
 */
export function injectUserCss(css: string): void {
  let element = document.getElementById(USER_STYLE_ID);
  if (!element) {
    element = document.createElement("style");
    element.id = USER_STYLE_ID;
    document.head.append(element);
  }
  element.textContent = css;
}

/**
 * The settings the chrome itself reads, plus the ones it can flip on its own.
 * An override stands until the user edits that same field in config.toml:
 * Kvist never writes to their file, so the file is always the last word on
 * anything they have actually written there.
 */
export function createUi(bridge: Pick<KvistApi, "onConfig">, applyCss: (css: string) => void) {
  const state = $state<{ settings: Settings; orientation: TabOrientation | null }>({
    settings: { ...DEFAULT_SETTINGS },
    orientation: null,
  });

  bridge.onConfig((config) => {
    // Only a field that actually changed drops its override; an unrelated save
    // must not undo something the user just did in the chrome.
    if (config.settings.tabOrientation !== state.settings.tabOrientation) {
      state.orientation = null;
    }
    state.settings = config.settings;
    applyCss(config.css);
  });

  return {
    get tabOrientation(): TabOrientation {
      return state.orientation ?? state.settings.tabOrientation;
    },
    get searchUrl(): string {
      return state.settings.searchUrl;
    },
    toggleTabOrientation(): void {
      state.orientation = this.tabOrientation === "horizontal" ? "vertical" : "horizontal";
    },
  };
}
