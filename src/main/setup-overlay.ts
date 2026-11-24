import type { WebContents } from "electron";
import type { Rect } from "../shared/schema/browser";
import type { SetupOptions } from "../shared/setup";

/** What main says to the wizard's document. All of it is replayed to a late subscriber. */
export interface SetupSenders {
  opened(seq: number, options: SetupOptions): void;
  status(saving: boolean, error: string | undefined): void;
  css(css: string): void;
}

export interface SetupHost {
  webContents: Pick<WebContents, "once" | "isDestroyed" | "focus">;
  setVisible(visible: boolean): void;
  setBounds(bounds: Rect): void;
}

/** A mounted view with loading started. Release removes it and closes its webContents. */
export interface SetupLease {
  host: SetupHost;
  link: SetupSenders;
  release(): void;
}

/** The setup slice joined with where page content sits: the view's whole state. */
export interface SetupView {
  readonly open: boolean;
  readonly seq: number;
  readonly options: SetupOptions | null;
  readonly saving: boolean;
  readonly error: string | undefined;
  readonly bounds: Rect;
}

/**
 * Paints the first-run wizard in a native view over the page, because
 * chrome HTML cannot cover a tab. The chrome stays visible around it, and
 * that chrome is the live preview of every choice.
 */
export class SetupOverlay {
  #open: () => SetupLease;
  #css: () => string;
  #lease: SetupLease | null = null;
  /** The opening the document last heard about; -1 sends the next one whatever it is. */
  #seq = -1;
  #status = "";

  constructor(open: () => SetupLease, css: () => string) {
    this.#open = open;
    this.#css = css;
  }

  render(view: SetupView): void {
    // Closed for good once written, so the view and its renderer process go too.
    if (!view.open) {
      this.release();

      return;
    }

    const lease = this.#lease ?? this.#start();

    // Shown before anything is sent: a hidden view's rendering is stalled.
    lease.host.setBounds(view.bounds);
    lease.host.setVisible(true);

    const status = JSON.stringify([view.saving, view.error]);

    if (status !== this.#status) {
      this.#status = status;
      lease.link.status(view.saving, view.error);
    }

    if (view.options === null || view.seq === this.#seq) return;
    this.#seq = view.seq;
    lease.link.opened(view.seq, view.options);
    lease.host.webContents.focus();
  }

  applyCss(): void {
    this.#lease?.link.css(this.#css());
  }

  release(): void {
    const lease = this.#lease;
    this.#lease = null;
    this.#seq = -1;
    this.#status = "";
    lease?.release();
  }

  #start(): SetupLease {
    const lease = this.#open();
    this.#lease = lease;
    lease.link.css(this.#css());

    const retire = (): void => {
      if (this.#lease !== lease) return;
      this.release();
    };

    lease.host.webContents.once("render-process-gone", retire);
    lease.host.webContents.once("destroyed", retire);

    return lease;
  }
}
