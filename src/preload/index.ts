import { contextBridge, ipcRenderer } from "electron";
import type { UserConfig } from "../shared/config";
import {
  type BrowserState,
  CHANNELS,
  type FindResult,
  type KvistApi,
  type Mode,
} from "../shared/ipc";

const api: KvistApi = {
  onState(listener) {
    const handler = (_event: unknown, state: BrowserState): void => listener(state);
    ipcRenderer.on(CHANNELS.state, handler);
    return () => void ipcRenderer.off(CHANNELS.state, handler);
  },
  onConfig(listener) {
    const handler = (_event: unknown, config: UserConfig): void => listener(config);
    ipcRenderer.on(CHANNELS.config, handler);
    return () => void ipcRenderer.off(CHANNELS.config, handler);
  },
  onMode(listener) {
    const handler = (_event: unknown, mode: Mode): void => listener(mode);
    ipcRenderer.on(CHANNELS.mode, handler);
    return () => void ipcRenderer.off(CHANNELS.mode, handler);
  },
  onFocusOmnibox(listener) {
    const handler = (): void => listener();
    ipcRenderer.on(CHANNELS.focusOmnibox, handler);
    return () => void ipcRenderer.off(CHANNELS.focusOmnibox, handler);
  },
  onFindResult(listener) {
    const handler = (_event: unknown, result: FindResult | null): void => listener(result);
    ipcRenderer.on(CHANNELS.findResult, handler);
    return () => void ipcRenderer.off(CHANNELS.findResult, handler);
  },
  setMode: (mode) => ipcRenderer.send(CHANNELS.setMode, mode),
  find: (query) => ipcRenderer.send(CHANNELS.find, query),
  stopFind: () => ipcRenderer.send(CHANNELS.findStop),
  runCommand: (line) => ipcRenderer.send(CHANNELS.runCommand, line),
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
