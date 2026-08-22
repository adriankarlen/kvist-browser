/**
 * Link hinting, running in every tab's preload.
 *
 * Main owns the mode and feeds keys in one at a time; this file only renders
 * labels and decides what a keystroke selected. Keeping the matching here
 * means a keystroke never costs a round trip.
 */

import type { Point } from "../shared/ipc";

const HINT_ALPHABET = "asdfghjkl";

const CLICKABLE = [
  "a[href]",
  "button",
  "input",
  "select",
  "textarea",
  "summary",
  "[contenteditable]",
  "[role=button]",
  "[role=link]",
  "[role=checkbox]",
  "[role=tab]",
  "[onclick]",
  "[tabindex]",
].join(",");

interface Hint {
  label: string;
  element: HTMLElement;
  marker: HTMLElement;
}

let container: HTMLElement | undefined;
let hints: Hint[] = [];
let typed = "";

/**
 * Labels are drawn from a fixed alphabet and all share a length, so no label
 * is a prefix of another and a match never has to wait for a further key.
 */
function labels(count: number): string[] {
  const alphabet = HINT_ALPHABET.split("");
  let width = 1;
  while (alphabet.length ** width < count) width += 1;

  const out: string[] = [];
  for (let index = 0; index < count; index += 1) {
    let label = "";
    let remaining = index;
    for (let position = 0; position < width; position += 1) {
      label = alphabet[remaining % alphabet.length]! + label;
      remaining = Math.floor(remaining / alphabet.length);
    }
    out.push(label);
  }
  return out;
}

function isVisible(element: Element, rect: DOMRect): boolean {
  if (rect.width === 0 || rect.height === 0) return false;
  if (rect.bottom < 0 || rect.top > innerHeight) return false;
  if (rect.right < 0 || rect.left > innerWidth) return false;

  const style = getComputedStyle(element);
  return style.visibility !== "hidden" && style.display !== "none" && style.opacity !== "0";
}

function targets(): HTMLElement[] {
  const out: HTMLElement[] = [];
  for (const element of document.querySelectorAll<HTMLElement>(CLICKABLE)) {
    if (element.getAttribute("tabindex") === "-1") continue;
    // SAFETY: the preload runs in its own world; `disabled` is probed optionally with `=== true`.
    if ((element as HTMLElement & { disabled?: boolean }).disabled === true) continue;
    if (isVisible(element, element.getBoundingClientRect())) out.push(element);
  }
  return out;
}

// Inline styles throughout: the page's own stylesheet is hostile territory, and
// a class would be one `!important` away from being restyled or hidden.
function marker(label: string, rect: DOMRect): HTMLElement {
  const element = document.createElement("div");
  element.textContent = label;
  element.style.cssText = [
    "all: initial",
    "position: absolute",
    `left: ${rect.left + scrollX}px`,
    `top: ${rect.top + scrollY}px`,
    "padding: 0 3px",
    "font: bold 11px monospace",
    "color: #191724",
    "background: #f6c177",
    "border: 1px solid #191724",
    "z-index: 2147483647",
  ].join(";");
  return element;
}

/** True when hints were actually up, so callers can tell main hinting ended. */
export function hide(): boolean {
  const wasShowing = container !== undefined;
  container?.remove();
  container = undefined;
  hints = [];
  typed = "";
  return wasShowing;
}

/** True when there was anything to hint; main leaves hint mode if not. */
export function show(): boolean {
  hide();

  const elements = targets();
  if (elements.length === 0) return false;

  container = document.createElement("div");
  container.style.cssText = "all: initial; position: absolute; top: 0; left: 0";

  hints = elements.map((element, index) => {
    const label = labels(elements.length)[index]!;
    const element_ = marker(label, element.getBoundingClientRect());
    container!.appendChild(element_);
    return { label, element, marker: element_ };
  });

  document.documentElement.appendChild(container);
  return true;
}

/**
 * Returns where main should click, if anywhere.
 *
 * A scripted `.click()` carries no user activation, and Chromium then marks
 * any history entry it creates as skippable — following a hint would quietly
 * break the back button. So the click is handed to main, which can inject a
 * real one. Only when the point does not actually hit the element, because
 * something overlaps it, is the scripted click used instead.
 */
function activate(element: HTMLElement): Point | undefined {
  // Focusing rather than clicking a field, so hinting into a search box lands
  // the caret instead of toggling something.
  const tag = element.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || element.isContentEditable) {
    element.focus();
    return undefined;
  }

  const rect = element.getBoundingClientRect();
  const point = {
    x: Math.round(Math.min(Math.max(rect.left + rect.width / 2, 0), innerWidth - 1)),
    y: Math.round(Math.min(Math.max(rect.top + rect.height / 2, 0), innerHeight - 1)),
  };

  const hit = document.elementFromPoint(point.x, point.y);
  if (hit === element || (hit !== null && element.contains(hit))) return point;

  element.focus({ preventScroll: true });
  element.click();
  return undefined;
}

export interface HintResult {
  /** Hinting is over, either because something matched or nothing can. */
  done: boolean;
  click?: Point;
}

export function key(input: string): HintResult {
  if (input === "Backspace") {
    typed = typed.slice(0, -1);
  } else if (HINT_ALPHABET.includes(input)) {
    typed += input;
  } else {
    return { done: false };
  }

  const matches = hints.filter((hint) => hint.label.startsWith(typed));
  if (matches.length === 0) {
    hide();
    return { done: true };
  }

  // Labels are fixed width, so a single match on a full-length prefix is the one.
  const only = matches[0]!;
  if (matches.length === 1 && only.label === typed) {
    const { element } = only;
    // Before activating, so the markers cannot intercept the click.
    hide();
    return { done: true, click: activate(element) };
  }

  for (const hint of hints) {
    hint.marker.style.opacity = hint.label.startsWith(typed) ? "1" : "0.25";
  }
  return { done: false };
}
