/**
 * The context menu, rendered in the tab's own page.
 *
 * It has to live here: the tab's WebContentsView is a native layer painted
 * over the chrome, so chrome HTML can never overlap page content. Rendering
 * in a shadow root keeps the page's stylesheet out (a class is one
 * `!important` away from being hidden — the same reason hint labels are
 * inline-styled), and main ships the tokens, the menu styles and the user's
 * config.css with the payload, so the menu still themes like the chrome.
 */

import { ipcRenderer } from "electron";
import { CHANNELS, type ContextMenuState } from "../shared/ipc";

let host: HTMLElement | undefined;

function removeListeners(): void {
  window.removeEventListener("mousedown", onOutside, true);
  window.removeEventListener("scroll", onAway, true);
  window.removeEventListener("resize", onAway, true);
}

function close(id: string | null): void {
  if (host === undefined) return;
  host.remove();
  host = undefined;
  removeListeners();
  ipcRenderer.send(CHANNELS.contextMenuPick, id);
}

function onOutside(event: MouseEvent): void {
  // Shadow retargeting makes composedPath the only reliable "was it us?".
  if (host !== undefined && !event.composedPath().includes(host)) close(null);
}

// Anything that moves the page under the menu leaves it pointing at the
// wrong thing, as with hints — scrolling or resizing dismisses it.
function onAway(): void {
  close(null);
}

function row(item: ContextMenuState["items"][number], pick: (id: string) => void): HTMLElement {
  const element = document.createElement("li");
  if (item.type === "separator") {
    element.className = "kv-menu__separator";
    return element;
  }

  element.className = item.enabled ? "kv-menu__item" : "kv-menu__item is-disabled";

  const icon = document.createElement("span");
  icon.className = "kv-menu__icon";
  const label = document.createElement("span");
  label.className = "kv-menu__label";
  label.textContent = item.label;
  const hint = document.createElement("span");
  hint.className = "kv-menu__hint";
  hint.textContent = item.hint ?? "";
  element.append(icon, label, hint);

  if (item.enabled) element.addEventListener("click", () => pick(item.id));
  return element;
}

export function show(state: ContextMenuState): void {
  hide();

  host = document.createElement("div");
  // all: initial, because the page's inheritance stops at the shadow host.
  host.style.cssText = "all: initial; position: fixed; left: 0; top: 0; z-index: 2147483647;";
  const shadow = host.attachShadow({ mode: "open" });

  const style = document.createElement("style");
  style.textContent = state.css;

  const list = document.createElement("ul");
  list.className = "kv-menu";
  for (const item of state.items) {
    list.appendChild(row(item, (id) => close(id)));
  }

  // Swallowing the mousedown keeps the page's focus and selection where they
  // are — Cut and Paste need the field to still be focused when main runs
  // the editing command, and Copy needs the selection intact.
  list.addEventListener("mousedown", (event) => event.preventDefault());
  // A right-click on the menu itself is not a new menu.
  list.addEventListener("contextmenu", (event) => {
    event.preventDefault();
    event.stopPropagation();
  });

  shadow.append(style, list);
  document.documentElement.appendChild(host);

  // Clamp into the viewport; the cursor can be anywhere, including a corner.
  const rect = list.getBoundingClientRect();
  host.style.left = `${Math.max(0, Math.min(state.x, innerWidth - rect.width))}px`;
  host.style.top = `${Math.max(0, Math.min(state.y, innerHeight - rect.height))}px`;

  window.addEventListener("mousedown", onOutside, true);
  window.addEventListener("scroll", onAway, true);
  window.addEventListener("resize", onAway, true);
}

/** Main-initiated hide; the stash is already dropped, so nothing is sent. */
export function hide(): void {
  if (host === undefined) return;
  host.remove();
  host = undefined;
  removeListeners();
}
