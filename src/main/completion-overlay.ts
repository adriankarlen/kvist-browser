import type { WebContents } from "electron";
import { type CompletionOverlayState, type Rect, senders, toOverlay } from "../shared/ipc";
import { type ContentSize, placeCompletion } from "./completion-bounds";
import type { OverlayLease } from "./overlay-host";

const HIDDEN: Rect = { x: 0, y: 0, width: 0, height: 0 };
const EMPTY: CompletionOverlayState = {
  candidates: [],
  index: -1,
  grow: "down",
  anchor: HIDDEN,
};

/**
 * Chrome HTML cannot paint above tab views, so the dropdown uses a cached native view.
 * Chrome supplies the anchor; the overlay measures its own height.
 */
export class CompletionOverlay {
  #open: () => OverlayLease;
  #contentSize: () => ContentSize;
  #css: () => string;

  #lease: OverlayLease | null = null;
  #loaded = false;
  #state: CompletionOverlayState | null = null;
  #restoreFocus: () => void;
  /**
   * Keep the last positive height across openings: unchanged sizes may produce no new report.
   * Preserve fractions to keep borders aligned.
   */
  #height: number | null = null;

  constructor(
    open: () => OverlayLease,
    contentSize: () => ContentSize,
    css: () => string,
    restoreFocus: () => void,
  ) {
    this.#open = open;
    this.#contentSize = contentSize;
    this.#css = css;
    this.#restoreFocus = restoreFocus;
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

  setHeight(height: number): void {
    // An empty slot reports zero before rows arrive, including after reopening.
    // Hiding on that report would stall the observer needed to measure the rows.
    if (height === 0) return;
    this.#height = height;
    this.#place();
  }

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
    // A newly mounted view takes keyboard focus. Restore it next turn;
    // Chromium ignores restoration during the focus event.
    lease.host.webContents.once("focus", () => {
      setTimeout(this.#restoreFocus, 0);
    });
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
    const retire = (): void => {
      if (this.#lease !== lease) return;
      this.#lease = null;
      this.#loaded = false;
      lease.release();
    };
    lease.host.webContents.once("render-process-gone", retire);
    lease.host.webContents.once("destroyed", retire);
    return lease;
  }

  #send(lease: OverlayLease) {
    return senders(toOverlay, (channel, payload) => {
      if (!lease.host.webContents.isDestroyed()) lease.host.webContents.send(channel, payload);
    });
  }

  /**
   * Hidden views cannot measure their content. Show unmeasured lists at the available size,
   * then shrink after the height report.
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
