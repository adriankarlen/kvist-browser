import { contextBridge, ipcRenderer } from "electron";
import { fromOverlay, listeners, type OverlayApi, senders, toOverlay } from "../shared/ipc";

/**
 * `window.kvistOverlay`, for the view that paints the completion menu over
 * the page.
 *
 * Deliberately not `window.kvist`: this document renders a list of rows and
 * reports which one was clicked. Handing it the chrome's bridge would let a
 * dropdown navigate tabs, cancel downloads and answer prompts.
 */
const api: OverlayApi = {
  ...senders(fromOverlay, (channel, payload) => ipcRenderer.send(channel, payload)),
  ...listeners(toOverlay, (channel, listener) => {
    const handler = (_event: unknown, payload: unknown): void => listener(payload);
    ipcRenderer.on(channel, handler);
    return () => void ipcRenderer.off(channel, handler);
  }),
};

contextBridge.exposeInMainWorld("kvistOverlay", api);
