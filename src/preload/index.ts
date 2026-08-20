import { contextBridge, ipcRenderer } from "electron";
import { type KvistApi, listeners, senders, toChrome, toMain } from "../shared/ipc";

/**
 * `window.kvist`, built from the channel tables rather than written out: every
 * method here is the same four lines, and the only thing that varies is the
 * channel.
 */
const api: KvistApi = {
  ...senders(toMain, (channel, payload) => ipcRenderer.send(channel, payload)),
  ...listeners(toChrome, (channel, listener) => {
    const handler = (_event: unknown, payload: unknown): void => listener(payload);
    ipcRenderer.on(channel, handler);
    return () => void ipcRenderer.off(channel, handler);
  }),
};

contextBridge.exposeInMainWorld("kvist", api);
