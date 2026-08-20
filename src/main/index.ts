import { join } from "node:path";
import { app, BrowserWindow, ipcMain, session } from "electron";
import type { UserConfig } from "../shared/config";
import { applySettings as applyAdblockSettings, refreshCosmeticStyles } from "./adblock";
import {
  applySettings as applyLocalPageSettings,
  registerKvistProtocol,
  registerKvistScheme,
} from "./local-pages";
import { createActions } from "./actions";
import { CHANNELS, type Mode, type Point, type Rect, type TabId } from "../shared/ipc";
import { registerCommands } from "./commands";
import { loadConfig, watchConfig } from "./config";
import { Downloads } from "./downloads";
import { DEFAULT_KEYBINDS } from "./keybinds";
import { applyXdgPaths } from "./paths";
import { interceptKeys } from "./keys";
import { TabManager } from "./tab-manager";
import { Vim } from "./vim";

applyXdgPaths();
registerKvistScheme();

const preload = join(import.meta.dirname, "../preload/index.cjs");
const pagePreload = join(import.meta.dirname, "../preload/page.cjs");
const rendererHtml = join(import.meta.dirname, "../renderer/index.html");
const iconPath = join(app.getAppPath(), "images/kvist-logo.png");

/**
 * Session-scoped, so it is attached once and outlives every window; a window
 * only subscribes. Must be in place before the first tab can start a transfer.
 */
const downloads = new Downloads();

/**
 * The windows' own share of a config change. A window subscribes once it has
 * loaded and drops out when it closes, so a second window neither misses a
 * change nor keeps answering after it is gone.
 */
const windows = new Set<(config: UserConfig) => void>();

/** The config as it stands, for a window opened after the last change. */
let current: UserConfig;

/**
 * Applies run one at a time. Blocking has to fetch its lists, which can take
 * seconds, and two saves during that would otherwise race — leaving whichever
 * config finished last in charge rather than whichever the user wrote last.
 */
let applying: Promise<void> = Promise.resolve();

/**
 * Fans a config change out to everything that cares. The order is
 * load-bearing: blocking attaches to the session before the first tab can
 * load, and the local pages are configured before one can be served. Startup
 * and reload are the same call.
 */
function applyConfig(config: UserConfig): Promise<void> {
  applying = applying.then(async () => {
    current = config;
    await applyAdblockSettings(config);
    applyLocalPageSettings(config);
    downloads.applySettings(config);
    for (const apply of windows) apply(config);
  });
  return applying;
}

function createWindow(): void {
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

  tabs.applySettings(current);

  const applyToWindow = (next: UserConfig): void => {
    tabs.applySettings(next);
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
  // The chrome needs the same treatment as a page: it is a separate
  // webContents, so without this every key pressed while the chrome holds
  // focus is invisible to the mode machine.
  interceptKeys(win.webContents, "chrome", (input, source) => vim.handleKey(input, source));
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
    tabs.tabFor(event.sender)?.click(point);
  });

  // The sender is a tab, like the hint channels — a webContents that owns no
  // tab gets no answer to its pick.
  ipcMain.on(CHANNELS.contextMenuPick, (event, id: string | null) => {
    tabs.tabFor(event.sender)?.pickContextMenu(id);
  });

  const runCommand = (line: string): void => {
    const [name = "", ...rest] = line.trim().split(/\s+/);
    if (name === "") return;
    const arg = rest.join(" ") || undefined;
    if (!commands.execute(name, arg)) {
      console.error(`kvist: unknown command :${name}`);
    }
  };

  win.on("closed", () => windows.delete(applyToWindow));

  win.webContents.once("did-finish-load", () => {
    windows.add(applyToWindow);
    applyToWindow(current);
    send(CHANNELS.mode, vim.mode);
    // A transfer can outlive the window it started in, so the chrome is told
    // what is already going rather than only what starts from now on.
    send(CHANNELS.downloads, downloads.list);
    tabs.create();
  });

  const on = (channel: string, handler: (...args: never[]) => void): void => {
    ipcMain.on(channel, (event, ...args) => {
      if (event.sender === win.webContents) handler(...(args as never[]));
    });
  };

  on(CHANNELS.contentRect, (rect: Rect) => tabs.setContentRect(rect));
  on(CHANNELS.createTab, (url?: string) => tabs.create(url));
  on(CHANNELS.closeTab, (id: TabId) => tabs.close(id));
  on(CHANNELS.activateTab, (id: TabId) => tabs.activate(id));
  on(CHANNELS.navigate, (url: string) => tabs.active?.navigate(url));
  on(CHANNELS.goBack, () => tabs.active?.goBack());
  on(CHANNELS.goForward, () => tabs.active?.goForward());
  on(CHANNELS.reload, () => tabs.active?.reload());
  on(CHANNELS.toggleDevTools, () => tabs.active?.toggleDevTools());
  on(CHANNELS.find, (query: string) => tabs.active?.find(query));
  on(CHANNELS.findStop, () => tabs.active?.stopFind());
  on(CHANNELS.setMode, (mode: Mode) => vim.requestMode(mode));
  on(CHANNELS.downloadCancel, (id: number) => downloads.cancel(id));
  on(CHANNELS.runCommand, (line: string) => {
    runCommand(line);
    // Commands come from a typed `:foo` and end in normal mode. UI-driven
    // chrome→main channels (`downloadCancel` etc.) must not call this path,
    // or clicking a button would drop mode out from under a user who is
    // typing.
    vim.requestMode("normal");
  });
}

void app.whenReady().then(async () => {
  downloads.attach(session.defaultSession);
  await applyConfig(await loadConfig());
  registerKvistProtocol();

  createWindow();
  void watchConfig((next) => void applyConfig(next));

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
