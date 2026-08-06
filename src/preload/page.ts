import { ipcRenderer } from "electron";
import { CHANNELS } from "../shared/ipc";

/**
 * Runs in every tab, and deliberately exposes nothing over contextBridge — a
 * page must never reach the kvist API. Its only job is telling main when focus
 * lands on something that accepts typing, so normal mode can step out of the
 * way instead of swallowing the keys.
 */

// Blocklisted rather than allowlisted: anything that is not one of these takes
// text, including the date and time inputs that keep getting added.
const UNTYPABLE = new Set([
  "button",
  "checkbox",
  "color",
  "file",
  "hidden",
  "image",
  "radio",
  "range",
  "reset",
  "submit",
]);

// tagName rather than instanceof: the preload runs in its own world, so the
// DOM constructors it sees need not be the ones that built these nodes.
function isEditable(node: Element | null): boolean {
  if (!node) return false;

  const element = node as HTMLElement & { disabled?: boolean; readOnly?: boolean; type?: string };
  if (element.disabled === true || element.readOnly === true) return false;

  switch (element.tagName) {
    case "TEXTAREA":
      return true;
    case "INPUT":
      return !UNTYPABLE.has((element.type ?? "text").toLowerCase());
    default:
      return element.isContentEditable === true;
  }
}

// null rather than false, so the first report always reaches main: a fresh
// preload after navigation has to clear whatever the previous page left set.
let last: boolean | null = null;

function report(): void {
  const editable = isEditable(document.activeElement);
  if (editable === last) return;
  last = editable;
  ipcRenderer.send(CHANNELS.pageEditable, editable);
}

// focusout fires before the next element takes focus, so let focus settle
// before reading it or every tab between two fields looks like a blur.
document.addEventListener("focusin", report, true);
document.addEventListener("focusout", () => setTimeout(report, 0), true);

ipcRenderer.on(CHANNELS.pageBlur, () => {
  (document.activeElement as HTMLElement | null)?.blur();
  report();
});

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", report, { once: true });
} else {
  report();
}
