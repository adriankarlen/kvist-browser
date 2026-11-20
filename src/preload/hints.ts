/**
 * Link hinting, in every tab's preload. Main owns the mode and feeds keys;
 * this file renders labels and decides what a keystroke selected. Matching
 * here keeps a keystroke from costing a round trip.
 */

import type { Point } from "../shared/schema/browser";
import { HINT_ALPHABET } from "./page.program";

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

  return wasShowing;
}

/** True when there was anything to hint; main leaves hint mode if not. */
function show(): boolean {
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
 * Where main should click. A scripted `.click()` has no user activation,
 * so the history entry would be marked skippable and the back button
 * break; main injects a real click. Only an overlapped point falls back to
 * the scripted click.
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

/** Puts a marker on every target; the labels, in order, or none when there is nothing to hint. */
export function render(): ReadonlyArray<string> {
  return show() ? hints.map((hint) => hint.label) : [];
}

/** Dims every marker that no longer matches what has been typed. */
export function dim(typed: string): void {
  for (const hint of hints) {
    hint.marker.style.opacity = hint.label.startsWith(typed) ? "1" : "0.25";
  }
}

/**
 * Hides the markers, then activates the labelled element: where main
 * should click, or nothing when the page handled it here.
 */
export function activateLabel(label: string): Point | undefined {
  const element = hints.find((hint) => hint.label === label)?.element;

  hide();

  return element === undefined ? undefined : activate(element);
}
