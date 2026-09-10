/**
 * The context menu lives in the tab's page — its view is a native layer
 * over the chrome. Shadow root for style isolation; main ships tokens and
 * config.css, so it themes like the chrome. Closed root: only trusted
 * clicks.
 */

import { ipcRenderer } from "electron";
import { type ContextMenuState, fromPage, senders } from "../shared/ipc";

const pageToMain = senders(fromPage, (channel, payload) => ipcRenderer.send(channel, payload));

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
  pageToMain.contextMenuPick(id);
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
    element.setAttribute("role", "separator");
    return element;
  }

  element.className = item.enabled ? "kv-menu__item" : "kv-menu__item is-disabled";
  element.setAttribute("role", "menuitem");
  element.setAttribute("aria-disabled", String(!item.enabled));

  const icon = document.createElement("span");
  icon.className = "kv-menu__icon";
  const label = document.createElement("span");
  label.className = "kv-menu__label";
  label.textContent = item.label;
  const hint = document.createElement("span");
  hint.className = "kv-menu__hint";
  hint.textContent = item.hint ?? "";
  element.append(icon, label, hint);

  element.addEventListener("click", (event) => {
    // A scripted click carries no trust; only a real mouse may pick.
    if (!event.isTrusted || !item.enabled) return;
    pick(item.id);
  });
  return element;
}

export function show(state: ContextMenuState): void {
  hide();

  host = document.createElement("div");
  // all: initial, because the page's inheritance stops at the shadow host.
  host.style.cssText = "all: initial; position: fixed; left: 0; top: 0; z-index: 2147483647;";
  // Closed, so the page cannot reach in and click a privileged item itself.
  const shadow = host.attachShadow({ mode: "closed" });

  const style = document.createElement("style");
  style.textContent = state.css;

  const list = document.createElement("ul");
  list.className = "kv-menu";
  list.setAttribute("role", "menu");
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
