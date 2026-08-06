import { join } from "node:path";
import { app, BrowserWindow, ipcMain } from "electron";
import type { UserConfig } from "../shared/config";
import { CHANNELS, type Mode, type Rect, type TabId } from "../shared/ipc";
import { resolveUrl } from "../shared/url";
import { loadConfig, watchConfig } from "./config";
import { applyXdgPaths } from "./paths";
import { TabManager } from "./tab-manager";
import { Vim } from "./vim";

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
  tabs.focusPage = config.settings.tabFocusPage;

  const applyConfig = (next: UserConfig): void => {
    tabs.homepage = next.settings.homepage;
    tabs.focusPage = next.settings.tabFocusPage;
    if (!win.isDestroyed()) win.webContents.send(CHANNELS.config, next);
  };

  const send = (channel: string, payload: unknown): void => {
    if (!win.isDestroyed()) win.webContents.send(channel, payload);
  };

  const vim = new Vim(
    {
      newTab: () => tabs.create(),
      closeTab: () => tabs.closeActive(),
      nextTab: () => tabs.step(1),
      prevTab: () => tabs.step(-1),
      back: () => tabs.goBack(),
      forward: () => tabs.goForward(),
      reload: () => tabs.reload(),
      focusPage: () => tabs.focusActive(),
      focusChrome: () => win.webContents.focus(),
      focusOmnibox: () => {
        win.webContents.focus();
        send(CHANNELS.focusOmnibox, null);
      },
    },
    (mode) => send(CHANNELS.mode, mode),
  );

  tabs.interceptKeys((input, source) => vim.handleKey(input, source));
  tabs.interceptChromeKeys(win.webContents);

  const runCommand = (line: string): void => {
    const [name = "", ...args] = line.trim().split(/\s+/);
    const argument = args.join(" ");

    switch (name) {
      case "":
        break;
      case "q":
      case "quit":
        tabs.closeActive();
        break;
      case "qa":
        app.quit();
        break;
      case "tabnew":
        tabs.create(argument === "" ? undefined : resolveUrl(argument));
        break;
      case "o":
      case "open":
        if (argument !== "") tabs.navigate(resolveUrl(argument));
        break;
      case "r":
      case "reload":
        tabs.reload();
        break;
      default:
        console.error(`kvist: unknown command :${name}`);
    }
  };

  win.webContents.once("did-finish-load", () => {
    applyConfig(config);
    send(CHANNELS.mode, vim.mode);
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
  on(CHANNELS.setMode, (mode: Mode) => vim.requestMode(mode));
  on(CHANNELS.runCommand, (line: string) => {
    runCommand(line);
    vim.requestMode("normal");
  });
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
