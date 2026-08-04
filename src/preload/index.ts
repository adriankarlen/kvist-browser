import { contextBridge, ipcRenderer } from "electron";
import { type BrowserState, CHANNELS, type KvistApi } from "../shared/ipc";

const api: KvistApi = {
  onState(listener) {
    const handler = (_event: unknown, state: BrowserState): void => listener(state);
    ipcRenderer.on(CHANNELS.state, handler);
    return () => void ipcRenderer.off(CHANNELS.state, handler);
  },
  setContentRect: (rect) => ipcRenderer.send(CHANNELS.contentRect, rect),
  createTab: (url) => ipcRenderer.send(CHANNELS.createTab, url),
  closeTab: (id) => ipcRenderer.send(CHANNELS.closeTab, id),
  activateTab: (id) => ipcRenderer.send(CHANNELS.activateTab, id),
  navigate: (url) => ipcRenderer.send(CHANNELS.navigate, url),
  goBack: () => ipcRenderer.send(CHANNELS.goBack),
  goForward: () => ipcRenderer.send(CHANNELS.goForward),
  reload: () => ipcRenderer.send(CHANNELS.reload),
  toggleDevTools: () => ipcRenderer.send(CHANNELS.toggleDevTools),
};

contextBridge.exposeInMainWorld("kvist", api);
