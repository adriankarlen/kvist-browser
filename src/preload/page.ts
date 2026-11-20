import * as hints from "./hints";
import * as menu from "./menu";
import { fromMain, pageToMain } from "./page-link";

/**
 * Runs in every tab, exposing nothing over contextBridge — a page must
 * never reach the kvist API. It reports focus landing on something typable,
 * so normal mode steps aside, and owns the DOM half of vim: scrolling and
 * link hints.
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

  // SAFETY: the preload runs in its own world, so instanceof cannot be trusted;
  // the probed properties are optional and read with `=== true`.
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
  pageToMain.pageEditable(editable);
}

// focusout fires before the next element takes focus, so let focus settle
// before reading it or every tab between two fields looks like a blur.
document.addEventListener("focusin", report, true);

document.addEventListener("focusout", () => setTimeout(report, 0), true);

fromMain.on("BlurRequested", () => {
  // SAFETY: activeElement is an Element; blur() exists on any focusable (HTMLElement).
  (document.activeElement as HTMLElement | null)?.blur();
  report();
});

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", report, { once: true });
} else {
  report();
}

const LINE = 60;

fromMain.on("ScrollRequested", ({ command }) => {
  switch (command) {
    case "down":
      scrollBy(0, LINE);
      break;
    case "up":
      scrollBy(0, -LINE);
      break;
    case "half-down":
      scrollBy(0, innerHeight / 2);
      break;
    case "half-up":
      scrollBy(0, -innerHeight / 2);
      break;
    case "top":
      scrollTo(0, 0);
      break;
    case "bottom":
      scrollTo(0, document.body.scrollHeight);
      break;
  }
});

fromMain.on("HintsShown", () => {
  if (!hints.show()) pageToMain.hintsDone();
});

fromMain.on("HintKeyPressed", ({ key }) => {
  const { done, click } = hints.key(key);

  if (click) pageToMain.hintsClick(click);

  if (done) pageToMain.hintsDone();
});

fromMain.on("HintsHidden", () => hints.hide());

fromMain.on("ContextMenuChanged", ({ menu: state }) => {
  if (state === null) menu.hide();
  else menu.show(state);
});

// Hints are positioned against the document, so anything that moves the page
// under them leaves them pointing at the wrong things.
document.addEventListener(
  "scroll",
  () => {
    if (hints.hide()) pageToMain.hintsDone();
  },
  true,
);
