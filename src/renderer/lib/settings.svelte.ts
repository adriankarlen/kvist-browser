import { DEFAULT_SETTINGS, type Settings, type TabOrientation } from "../../shared/config";

const USER_STYLE_ID = "kv-user-config";

const settings = $state<Settings>({ ...DEFAULT_SETTINGS });

/**
 * Injected without a cascade layer, which beats every layer Kvist ships
 * regardless of specificity — so config.css never needs !important.
 */
function applyUserCss(css: string): void {
  let element = document.getElementById(USER_STYLE_ID);
  if (!element) {
    element = document.createElement("style");
    element.id = USER_STYLE_ID;
    document.head.append(element);
  }
  element.textContent = css;
}

window.kvist.onConfig((config) => {
  Object.assign(settings, config.settings);
  applyUserCss(config.css);
});

export const ui = {
  get tabOrientation(): TabOrientation {
    return settings.tabOrientation;
  },
  toggleTabOrientation(): void {
    settings.tabOrientation = settings.tabOrientation === "horizontal" ? "vertical" : "horizontal";
  },
};
