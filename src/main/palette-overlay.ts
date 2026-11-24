import type { WebContents } from "electron";
import type { Rect } from "../shared/schema/browser";

const HIDDEN: Rect = { x: 0, y: 0, width: 0, height: 0 };

/** What main says to the palette's document. Both are replayed to a late subscriber. */
export interface PaletteSenders {
  opened(text: string, seq: number, size: string | undefined): void;
  css(css: string): void;
}

export interface PaletteHost {
  webContents: Pick<WebContents, "once" | "isDestroyed" | "focus">;
  setVisible(visible: boolean): void;
  setBounds(bounds: Rect): void;
}

/** A mounted view with loading started. Release removes it and closes its webContents. */
export interface PaletteLease {
  host: PaletteHost;
  link: PaletteSenders;
  release(): void;
}

/** The palette slice joined with where page content sits: the view's whole state. */
export interface PaletteView {
  readonly open: boolean;
  readonly text: string;
  readonly seq: number;
  readonly bounds: Rect;
  /** The panel's width from `[layout.omnibox] size`. */
  readonly size: string | undefined;
}

/**
 * Paints the command palette in a native view of its own, because chrome
 * HTML cannot cover a tab. The view spans the page and its document is
 * transparent, so a click beside the panel reaches the palette and dismisses it.
 */
export class PaletteOverlay {
  #open: () => PaletteLease;
  #css: () => string;
  #lease: PaletteLease | null = null;
  /** The opening the document last heard about; -1 sends the next one whatever it is. */
  #seq = -1;

  constructor(open: () => PaletteLease, css: () => string) {
    this.#open = open;
    this.#css = css;
  }

  render(view: PaletteView): void {
    if (!view.open) {
      this.#conceal();

      return;
    }

    const lease = this.#lease ?? this.#start();

    // Shown before the text is sent: a hidden view's rendering is stalled,
    // so it would not draw the opening until something else woke it.
    lease.host.setBounds(view.bounds);
    lease.host.setVisible(true);

    if (view.seq === this.#seq) return;
    this.#seq = view.seq;
    lease.link.opened(view.text, view.seq, view.size);
    lease.host.webContents.focus();
  }

  applyCss(): void {
    this.#lease?.link.css(this.#css());
  }

  release(): void {
    const lease = this.#lease;
    this.#lease = null;
    this.#seq = -1;
    lease?.release();
  }

  #conceal(): void {
    if (this.#lease === null) return;
    this.#lease.host.setVisible(false);
    // Zero-sized as well as hidden, so a view left over the page cannot eat its clicks.
    this.#lease.host.setBounds(HIDDEN);
  }

  #start(): PaletteLease {
    const lease = this.#open();
    this.#lease = lease;
    lease.link.css(this.#css());

    const retire = (): void => {
      if (this.#lease !== lease) return;
      this.#lease = null;
      this.#seq = -1;
      lease.release();
    };

    lease.host.webContents.once("render-process-gone", retire);
    lease.host.webContents.once("destroyed", retire);

    return lease;
  }
}
