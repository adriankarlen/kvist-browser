const USER_STYLE_ID = "kv-user-config";

/**
 * Injected without a cascade layer, which beats every layer Kvist ships
 * regardless of specificity — so config.css never needs !important.
 *
 * Shared rather than renderer-owned: the completion overlay is a document of
 * its own, and a retheme that reached the chrome but not the dropdown would
 * leave the two looking like different programs.
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
