import { join } from "node:path";
import { app, BrowserWindow, ipcMain, session } from "electron";
import type { UserConfig } from "../shared/config";
import { refreshCosmeticStyles, setAdblockEnabled } from "./adblock";
import {
  registerKvistProtocol,
  registerKvistScheme,
  updateLocalPageCss,
  updateNewtabConfig,
} from "./local-pages";
import { createActions } from "./actions";
import { CHANNELS, type Mode, type Point, type Rect, type TabId } from "../shared/ipc";
import { registerCommands } from "./commands";
import { composeContextMenuCss } from "./context-menu";
import { loadConfig, watchConfig } from "./config";
import { Downloads } from "./downloads";
import { DEFAULT_KEYBINDS } from "./keybinds";
import { applyXdgPaths } from "./paths";
import { TabManager } from "./tab-manager";
import { Vim } from "./vim";

applyXdgPaths();
registerKvistScheme();

const preload = join(import.meta.dirname, "../preload/index.cjs");
const pagePreload = join(import.meta.dirname, "../preload/page.cjs");
const rendererHtml = join(import.meta.dirname, "../renderer/index.html");
const iconPath = join(app.getAppPath(), "images/kvist-logo.png");

function createWindow(config: UserConfig, downloads: Downloads): void {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    frame: false,
    backgroundColor: "#1d1d1d",
    icon: iconPath,
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
    downloads.configuredDir = next.settings.downloadDir;
    tabs.contextMenuCss = composeContextMenuCss(next.css);
    void setAdblockEnabled(next.settings.adblock);
    updateLocalPageCss(next.css);
    updateNewtabConfig({
      links: next.settings.newtabLinks,
      timezone: next.settings.newtabTimezone,
    });
    if (!win.isDestroyed()) win.webContents.send(CHANNELS.config, next);
  };

  const send = (channel: string, payload: unknown): void => {
    if (!win.isDestroyed()) win.webContents.send(channel, payload);
  };

  downloads.observe((list) => send(CHANNELS.downloads, list));
  downloads.observeTabDownload((contents) => tabs.closeIfUncommitted(contents));

  const actions = createActions(tabs, downloads, win, () => app.quit());
  const commands = registerCommands(actions);

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

  // The sender is a tab, like the hint channels — a webContents that owns no
  // tab gets no answer to its pick.
  ipcMain.on(CHANNELS.contextMenuPick, (event, id: string | null) => {
    if (tabs.ownsTab(event.sender)) tabs.pickContextMenu(id);
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
    // A transfer can outlive the window it started in, so the chrome is told
    // what is already going rather than only what starts from now on.
    send(CHANNELS.downloads, downloads.list);
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
  on(CHANNELS.downloadCancel, (id: number) => downloads.cancel(id));
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
  updateLocalPageCss(config.css);
  updateNewtabConfig({
    links: config.settings.newtabLinks,
    timezone: config.settings.newtabTimezone,
  });
  registerKvistProtocol();

  // Session-scoped, so it is attached once and outlives the window; the window
  // only subscribes. Must be in place before the first tab can start a transfer.
  const downloads = new Downloads();
  downloads.configuredDir = config.settings.downloadDir;
  downloads.attach(session.defaultSession);

  createWindow(config, downloads);

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow(config, downloads);
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
