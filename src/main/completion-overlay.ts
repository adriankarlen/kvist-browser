import type { WebContents } from "electron";
import { type CompletionOverlayState, type Rect, senders, toOverlay } from "../shared/ipc";
import { type ContentSize, placeCompletion } from "./completion-bounds";
import type { OverlayLease } from "./overlay-host";

const HIDDEN: Rect = { x: 0, y: 0, width: 0, height: 0 };
/** What the overlay is left showing while it is closed: nothing. */
const EMPTY: CompletionOverlayState = {
  candidates: [],
  index: -1,
  grow: "down",
  anchor: HIDDEN,
};

/**
 * The completion menu's own view: a window-scoped overlay that paints the
 * chrome's dropdown above the page.
 *
 * It exists because a tab's `WebContentsView` is a native layer composited
 * over the chrome, so a list rendered in the chrome's document is hidden by
 * the page no matter what CSS says. Rendering it in the page instead — the
 * way the context menu does — was rejected: the page rect starts below the
 * omnibox, so a list anchored to that input could never touch it.
 *
 * The view is built on first use and then kept, hidden between openings
 * rather than destroyed. That is the same choice `TabManager` makes for
 * inactive tabs, and for the same reason: building a renderer costs process
 * startup, and doing it per opening would put that cost in the path of a
 * keystroke.
 *
 * Sizing runs the opposite way to the content rect. The chrome reports the
 * anchor it is completing for, the overlay reports how tall it rendered, and
 * this puts the two together — so main never has to model row heights.
 */
export class CompletionOverlay {
  #open: () => OverlayLease;
  #contentSize: () => ContentSize;
  #css: () => string;

  #lease: OverlayLease | null = null;
  #loaded = false;
  #state: CompletionOverlayState | null = null;
  /**
   * The last positive height the overlay reported, kept across openings. A list with
   * the same height as the one before it triggers no `ResizeObserver` and so
   * no new report, and reusing the last answer is what makes that silence
   * correct rather than a stall.
   *
   * Fractional, because the list is laid out at the input's true sub-pixel
   * width — rounding here would put the bottom border a pixel out.
   */
  #height: number | null = null;

  constructor(open: () => OverlayLease, contentSize: () => ContentSize, css: () => string) {
    this.#open = open;
    this.#contentSize = contentSize;
    this.#css = css;
  }

  /** The overlay's own webContents, for the sender check on `fromOverlay`. */
  owns(sender: WebContents): boolean {
    return this.#lease !== null && sender === this.#lease.host.webContents;
  }

  show(state: CompletionOverlayState): void {
    this.#state = state;
    const lease = this.#lease ?? this.#start();
    if (!this.#loaded) return;
    // Placed before the rows are sent, not after: a hidden view's rendering
    // lifecycle is stalled, so a list that arrived while it was down would
    // not be measured until something else woke it.
    this.#place();
    this.#send(lease).completionState(state);
  }

  hide(): void {
    this.#state = null;
    // Emptied as well as concealed, so re-opening cannot show the previous
    // query's rows for the frame before the new ones arrive.
    if (this.#lease !== null && this.#loaded) {
      this.#send(this.#lease).completionState(EMPTY);
    }
    this.#conceal();
  }

  #conceal(): void {
    if (this.#lease === null) return;
    this.#lease.host.setVisible(false);
    // Zero-sized as well as hidden: a view that still covers the page would
    // be one Chromium hit-testing quirk away from eating clicks meant for it.
    this.#lease.host.setBounds(HIDDEN);
  }

  /** How tall the overlay rendered, which is the half of its bounds only it knows. */
  setHeight(height: number): void {
    // An empty slot reports zero before rows arrive, including after reopening.
    // Hiding on that report would stall the observer needed to measure the rows.
    if (height === 0) return;
    this.#height = height;
    this.#place();
  }

  /** A retheme, so the dropdown does not go on looking like the old config. */
  applyCss(): void {
    if (this.#lease === null || !this.#loaded) return;
    this.#send(this.#lease).completionCss(this.#css());
  }

  release(): void {
    const lease = this.#lease;
    this.#lease = null;
    this.#loaded = false;
    this.#state = null;
    lease?.release();
  }

  #start(): OverlayLease {
    const lease = this.#open();
    this.#lease = lease;
    // Registered before the load can finish: `loadURL` is asynchronous, so
    // this cannot miss the event it is waiting for.
    lease.host.webContents.once("did-finish-load", () => {
      if (this.#lease !== lease) return;
      this.#loaded = true;
      const send = this.#send(lease);
      send.completionCss(this.#css());
      if (this.#state === null) return;
      this.#place();
      send.completionState(this.#state);
    });
    lease.host.webContents.once("render-process-gone", () => {
      if (this.#lease !== lease) return;
      this.#lease = null;
      this.#loaded = false;
      lease.release();
    });
    lease.host.webContents.once("destroyed", () => {
      if (this.#lease !== lease) return;
      this.#lease = null;
      this.#loaded = false;
      lease.release();
    });
    return lease;
  }

  #send(lease: OverlayLease) {
    return senders(toOverlay, (channel, payload) => {
      if (!lease.host.webContents.isDestroyed()) lease.host.webContents.send(channel, payload);
    });
  }

  /**
   * A view with nothing to show is concealed. One that has rows but no
   * measurement yet is given every pixel it could use, and shown at that
   * size until the overlay answers with the real height.
   *
   * Waiting for the measurement before showing anything would deadlock: a
   * hidden view has no viewport, so it never lays out, so it never reports.
   * The oversized rectangle costs nothing to look at — the document is
   * transparent, and only the rows themselves are painted.
   */
  #place(): void {
    if (this.#lease === null) return;
    if (this.#state === null) {
      this.#conceal();
      return;
    }
    const height = this.#height ?? Number.POSITIVE_INFINITY;
    const placed = placeCompletion(
      this.#state.anchor,
      height,
      this.#state.grow,
      this.#contentSize(),
    );
    this.#lease.host.setBounds(placed.bounds);
    this.#lease.host.setVisible(placed.bounds.height > 0);
    if (this.#loaded) this.#send(this.#lease).completionInset(placed.inset);
  }
}
