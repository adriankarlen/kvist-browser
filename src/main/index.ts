import { join } from "node:path";
import { app, BrowserWindow, ipcMain } from "electron";
import type { UserConfig } from "../shared/config";
import { refreshCosmeticStyles, setAdblockEnabled } from "./adblock";
import { registerNewtabProtocol, registerNewtabScheme, updateNewtabCss } from "./newtab";
import { createApi } from "./api";
import { CHANNELS, type Mode, type Point, type Rect, type TabId } from "../shared/ipc";
import { registerCommands } from "./commands";
import { loadConfig, watchConfig } from "./config";
import { DEFAULT_KEYBINDS } from "./keybinds";
import { applyXdgPaths } from "./paths";
import { TabManager } from "./tab-manager";
import { Vim } from "./vim";

applyXdgPaths();
registerNewtabScheme();

const preload = join(import.meta.dirname, "../preload/index.cjs");
const pagePreload = join(import.meta.dirname, "../preload/page.cjs");
const rendererHtml = join(import.meta.dirname, "../renderer/index.html");

function createWindow(config: UserConfig): void {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    frame: false,
    backgroundColor: "#1d1d1d",
    webPreferences: { preload },
  });

  const tabs = new TabManager(win, pagePreload, (state) => {
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
    void setAdblockEnabled(next.settings.adblock);
    updateNewtabCss(next.css);
    if (!win.isDestroyed()) win.webContents.send(CHANNELS.config, next);
  };

  const send = (channel: string, payload: unknown): void => {
    if (!win.isDestroyed()) win.webContents.send(channel, payload);
  };

  const api = createApi(tabs, win, () => app.quit());
  const commands = registerCommands(api);

  const vim = new Vim(
    DEFAULT_KEYBINDS,
    (name, arg) => {
      if (!commands.execute(name, arg)) {
        console.error(`kvist: unknown command ${name}`);
      }
    },
    (mode) => send(CHANNELS.mode, mode),
  );

  tabs.interceptKeys((input, source) => vim.handleKey(input, source));
  tabs.interceptChromeKeys(win.webContents);
  tabs.observeEditable((editable) => vim.setEditable(editable));
  tabs.observeFind((result) => send(CHANNELS.findResult, result));
  tabs.observeInPageNavigation((contents, url) => refreshCosmeticStyles(contents, url));

  // Not routed through `on`: the sender is a tab, not the chrome. TabManager
  // rejects any webContents that does not own a tab.
  ipcMain.on(CHANNELS.pageEditable, (event, editable: boolean) => {
    tabs.setEditable(event.sender, editable);
  });

  ipcMain.on(CHANNELS.hintsDone, (event) => {
    if (tabs.ownsTab(event.sender)) vim.endHints();
  });

  ipcMain.on(CHANNELS.hintsClick, (event, point: Point) => {
    if (tabs.ownsTab(event.sender)) tabs.clickActive(point);
  });

  const runCommand = (line: string): void => {
    const [name = "", ...rest] = line.trim().split(/\s+/);
    if (name === "") return;
    const arg = rest.join(" ") || undefined;
    if (!commands.execute(name, arg)) {
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
  on(CHANNELS.find, (query: string) => tabs.find(query));
  on(CHANNELS.findStop, () => tabs.stopFind());
  on(CHANNELS.setMode, (mode: Mode) => vim.requestMode(mode));
  on(CHANNELS.runCommand, (line: string) => {
    runCommand(line);
    vim.requestMode("normal");
  });
}

void app.whenReady().then(async () => {
  const config = await loadConfig();
  // Attaches to the default session, so it has to be in place before the first
  // tab starts loading.
  await setAdblockEnabled(config.settings.adblock);
  updateNewtabCss(config.css);
  await registerNewtabProtocol();
  createWindow(config);

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow(config);
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
