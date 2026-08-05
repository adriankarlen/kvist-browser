import { join } from "node:path";
import { app, BrowserWindow, ipcMain } from "electron";
import type { UserConfig } from "../shared/config";
import { CHANNELS, type Rect, type TabId } from "../shared/ipc";
import { loadConfig, watchConfig } from "./config";
import { applyXdgPaths } from "./paths";
import { TabManager } from "./tab-manager";

applyXdgPaths();

const preload = join(import.meta.dirname, "../preload/index.cjs");
const rendererHtml = join(import.meta.dirname, "../renderer/index.html");

function createWindow(config: UserConfig): void {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    frame: false,
    backgroundColor: "#1d1d1d",
    webPreferences: { preload },
  });

  const tabs = new TabManager(win, (state) => {
    if (!win.isDestroyed()) win.webContents.send(CHANNELS.state, state);
  });

  if (process.env.VITE_DEV_SERVER_URL) {
    void win.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else {
    void win.loadFile(rendererHtml);
  }

  tabs.homepage = config.settings.homepage;

  const applyConfig = (next: UserConfig): void => {
    tabs.homepage = next.settings.homepage;
    if (!win.isDestroyed()) win.webContents.send(CHANNELS.config, next);
  };

  win.webContents.once("did-finish-load", () => {
    applyConfig(config);
    tabs.create();
  });

  void watchConfig(applyConfig);

  const on = (channel: string, handler: (...args: never[]) => void): void => {
    ipcMain.on(channel, (event, ...args) => {
      if (event.sender === win.webContents) handler(...(args as never[]));
    });
  };

  on(CHANNELS.contentRect, (rect: Rect) => tabs.setContentRect(rect));
  on(CHANNELS.createTab, (url?: string) => tabs.create(url));
  on(CHANNELS.closeTab, (id: TabId) => tabs.close(id));
  on(CHANNELS.activateTab, (id: TabId) => tabs.activate(id));
  on(CHANNELS.navigate, (url: string) => tabs.navigate(url));
  on(CHANNELS.goBack, () => tabs.goBack());
  on(CHANNELS.goForward, () => tabs.goForward());
  on(CHANNELS.reload, () => tabs.reload());
  on(CHANNELS.toggleDevTools, () => tabs.toggleDevTools());
}

void app.whenReady().then(async () => {
  const config = await loadConfig();
  createWindow(config);

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow(config);
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
