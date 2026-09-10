import { DEFAULT_SETTINGS, type Settings, type TabOrientation } from "../../shared/config";
import type { KvistApi } from "../../shared/ipc";

export type Ui = ReturnType<typeof createUi>;

/**
 * Settings the chrome reads, plus the ones it can flip. An override stands
 * until that field is edited in config.toml — Kvist never writes the file.
 * The override round-trips to main via `orientationOverride`, so the
 * session persists it across relaunch.
 */
export function createUi(
  bridge: Pick<KvistApi, "onConfig" | "onRestoreSession" | "orientationOverride">,
  applyCss: (css: string) => void,
) {
  const state = $state<{ settings: Settings; orientation: TabOrientation | null }>({
    settings: { ...DEFAULT_SETTINGS },
    orientation: null,
  });

  bridge.onConfig((config) => {
    // Only a field that actually changed drops its override; an unrelated save
    // must not undo something the user just did in the chrome.
    if (config.settings.tabOrientation !== state.settings.tabOrientation) {
      state.orientation = null;
      bridge.orientationOverride(null);
    }
    state.settings = config.settings;
    applyCss(config.css);
  });

  bridge.onRestoreSession((restored) => {
    // The saved orientation is the user's last flip from a previous run;
    // seeding it before the first paint avoids a horizontal-default
    // flash that the override would then undo a frame later.
    //
    // The push back to main is load-bearing. Main seeds its mirror from the
    // saved row, but the chrome's first `onConfig` broadcast reads as a
    // field change (DEFAULT_SETTINGS vs the user's config.toml value) and
    // clears the override, sending `null` to main and overwriting that
    // seed. Without this push the mirror ends at null while the chrome
    // shows the restored flip, and the next close persists null — the
    // flip survives exactly one relaunch.
    state.orientation = restored.orientation;
    bridge.orientationOverride(restored.orientation);
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
      bridge.orientationOverride(state.orientation);
    },
  };
}
