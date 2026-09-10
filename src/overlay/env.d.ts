import type { OverlayApi } from "../shared/ipc";

declare global {
  interface Window {
    kvistOverlay: OverlayApi;
  }
}

export {};
