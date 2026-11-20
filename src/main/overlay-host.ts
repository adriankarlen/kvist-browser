import type { WebContents } from "electron";
import type { Rect } from "../shared/schema/browser";
import type { OverlaySenders } from "./links";

/** Everything the completion overlay uses from Chromium. */
export type OverlayContents = Pick<WebContents, "once" | "isDestroyed">;

export interface OverlayHost {
  webContents: OverlayContents;
  setVisible(visible: boolean): void;
  setBounds(bounds: Rect): void;
}

/**
 * A mounted view with loading started.
 * Release removes it from the stack and closes its webContents.
 */
export interface OverlayLease {
  host: OverlayHost;
  /** What main says to this view's document. */
  link: OverlaySenders;
  release(): void;
}
