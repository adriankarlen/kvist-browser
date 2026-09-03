import type { WebContents } from "electron";

/**
 * Everything a Tab uses from Chromium, and nothing else. Narrowed with `Pick`
 * so the production adapter is the real `WebContentsView` with no translation
 * layer: an adapter that cannot contain logic is an adapter a fake cannot
 * drift from.
 */
export type PageContents = Pick<
  WebContents,
  | "on"
  // `once`/`removeListener` back a `destroyed` watch: a still-pending
  // external-protocol ask must not outlive the tab that made it, or a
  // second window inherits a question about a page that is gone.
  | "once"
  | "removeListener"
  | "send"
  | "loadURL"
  | "getURL"
  | "reload"
  | "navigationHistory"
  | "findInPage"
  | "stopFindInPage"
  | "focus"
  | "isFocused"
  | "sendInputEvent"
  | "cut"
  | "copy"
  | "paste"
  | "selectAll"
  | "inspectElement"
  | "close"
  | "isDestroyed"
  | "forcefullyCrashRenderer"
  | "setWindowOpenHandler"
  | "isDevToolsOpened"
  | "openDevTools"
  | "closeDevTools"
  // The page's own stylesheet surface, which the cosmetic filters write to.
  | "insertCSS"
  | "removeInsertedCSS"
  // The zoom surface: setZoomLevel mutates, getZoomLevel reads. zoom-changed
  // is the only way the page can land a new level without us calling it.
  | "setZoomLevel"
  | "getZoomLevel"
>;

export interface PageHost {
  webContents: PageContents;
  setVisible(visible: boolean): void;
  setBounds(bounds: { x: number; y: number; width: number; height: number }): void;
}
