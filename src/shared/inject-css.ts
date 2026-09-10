const USER_STYLE_ID = "kv-user-config";

/**
 * Injected without a cascade layer: unlayered beats every layer the
 * project ships, so config.css never needs !important.
 *
 * Shared rather than renderer-owned: the overlay is its own document, and
 * a retheme that missed it would split the look.
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
