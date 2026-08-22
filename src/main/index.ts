import { join } from "node:path";
import { app, BrowserWindow, session } from "electron";
import type { UserConfig } from "../shared/config";
import { applySettings as applyAdblockSettings, refreshCosmeticStyles } from "./adblock";
import {
  applySettings as applyLocalPageSettings,
  registerKvistProtocol,
  registerKvistScheme,
} from "./local-pages";
import { createActions } from "./actions";
import { fromPage, type Point, senders, toChrome, toMain } from "../shared/ipc";
import { handle } from "./ipc";
import { createCommands } from "./commands";
import {
  createConfigStore,
  describeProblem,
  type LoadedConfig,
  loadConfig,
  watchConfig,
} from "./config";
import { Downloads } from "./downloads";
import { Messages } from "./messages";
import { DEFAULT_KEYBINDS } from "./keybinds";
import { applyXdgPaths } from "./paths";
import { interceptKeys } from "./keys";
import { TabManager } from "./tab-manager";
import { type KeyInput, type KeySource, Vim } from "./vim";

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
/**
 * The echo area, app-scoped like the downloads: what main has to say outlives
 * any one window, and a window subscribes while it is open.
 */
const messages = new Messages();

const downloads = new Downloads((text) => messages.warn(text));

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
/**
 * Everything wrong with the file, as one line. The echo area holds one message,
 * so the first problem is shown and the rest are counted; the log has them all.
 */
function reportProblems({ problems }: LoadedConfig): void {
  const [first, ...rest] = problems;
  if (first === undefined) return;
  for (const problem of rest) console.error(`kvist: ${describeProblem(problem)}`);
  const more = rest.length === 0 ? "" : ` (+${rest.length} more)`;
  messages.warn(`${describeProblem(first)}${more}`);
}

function applyConfig(config: UserConfig): Promise<void> {
  applying = applying
    .then(async () => {
      await applyAdblockSettings(config);
      applyLocalPageSettings(config);
      downloads.applySettings(config);
      // Published only once everything process-wide has taken it, so a window
      // opened mid-apply cannot configure itself from a config the local pages
      // and the blocker have not seen yet.
      current = config;
      for (const apply of windows) apply(config);
    })
    // A failure must not poison the queue: the next save has to be applied
    // even if this one could not be.
    .catch((error: unknown) => console.error("kvist: could not apply the config:", error));
  return applying;
}

/**
 * The one payload that is destructured the moment it lands. Everything on
 * these channels comes from our own preload, but a click point that is not a
 * point would take the main process down with it rather than being ignored.
 */
function isPoint(value: unknown): value is Point {
  if (typeof value !== "object" || value === null) return false;
  const { x, y } = value as Point;
  return Number.isFinite(x) && Number.isFinite(y);
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

  const chrome = senders(toChrome, (channel, payload) => {
    if (!win.isDestroyed()) win.webContents.send(channel, payload);
  });

  const tabs = new TabManager(win, pagePreload, (state) => chrome.state(state));

  if (process.env.VITE_DEV_SERVER_URL) {
    void win.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else {
    void win.loadFile(rendererHtml);
  }

  tabs.applySettings(current);

  const applyToWindow = (next: UserConfig): void => {
    tabs.applySettings(next);
    chrome.config(next);
  };

  downloads.observe((list) => chrome.downloads(list));
  const releaseMessages = messages.observe((message) => chrome.message(message));
  downloads.observeTabDownload((contents) => tabs.closeIfUncommitted(contents));

  const actions = createActions(tabs, downloads, win, messages, () => app.quit());
  const commands = createCommands(actions);

  const vim = new Vim(
    DEFAULT_KEYBINDS,
    (name, arg) => {
      if (!commands.execute(name, arg)) {
        messages.warn(`unknown command ${name}`);
      }
    },
    (mode) => chrome.mode(mode),
  );

  // Any key at all ends whatever the echo area is showing, wherever it came
  // from — the page's keys and the chrome's both arrive here.
  const onKey = (input: KeyInput, source: KeySource): boolean => {
    messages.keyPressed();
    return vim.handleKey(input, source);
  };

  tabs.interceptKeys(onKey);
  // The chrome needs the same treatment as a page: it is a separate
  // webContents, so without this every key pressed while the chrome holds
  // focus is invisible to the mode machine.
  interceptKeys(win.webContents, "chrome", onKey);
  tabs.observeEditable((editable) => vim.setEditable(editable));
  tabs.observeFind((result) => chrome.findResult(result));
  tabs.observeInPageNavigation((contents, url) => refreshCosmeticStyles(contents, url));

  // A tab's own channels, accepted from a webContents that owns one and from
  // nothing else.
  const releasePage = handle(
    fromPage,
    {
      pageEditable: (editable, sender) => tabs.setEditable(sender, editable),
      hintsDone: () => vim.endHints(),
      hintsClick: (point, sender) => {
        if (isPoint(point)) tabs.tabFor(sender)?.click(point);
      },
      contextMenuPick: (id, sender) => tabs.tabFor(sender)?.pickContextMenu(id),
    },
    (sender) => tabs.ownsTab(sender),
  );

  const runCommand = (line: string): void => {
    const [name = "", ...rest] = line.trim().split(/\s+/);
    if (name === "") return;
    const arg = rest.join(" ") || undefined;
    if (!commands.execute(name, arg)) {
      messages.warn(`unknown command :${name}`);
    }
  };

  win.on("closed", () => windows.delete(applyToWindow));

  win.webContents.once("did-finish-load", () => {
    windows.add(applyToWindow);
    applyToWindow(current);
    chrome.mode(vim.mode);
    // A transfer can outlive the window it started in, so the chrome is told
    // what is already going rather than only what starts from now on.
    chrome.downloads(downloads.list);
    // Same for anything already said: a config the user has broken is found
    // while the window is still loading, and the echo area was not there yet.
    chrome.message(messages.current);
    tabs.create();
  });

  const releaseChrome = handle(
    toMain,
    {
      setContentRect: (rect) => tabs.setContentRect(rect),
      createTab: (url) => tabs.create(url),
      closeTab: (id) => tabs.close(id),
      activateTab: (id) => tabs.activate(id),
      navigate: (url) => tabs.active?.navigate(url),
      goBack: () => tabs.active?.goBack(),
      goForward: () => tabs.active?.goForward(),
      reload: () => tabs.active?.reload(),
      toggleDevTools: () => tabs.active?.toggleDevTools(),
      find: (query) => tabs.active?.find(query),
      stopFind: () => tabs.active?.stopFind(),
      setMode: (mode) => vim.requestMode(mode),
      cancelDownload: (id) => downloads.cancel(id),
      runCommand: (line) => {
        runCommand(line);
        // Commands come from a typed `:foo` and end in normal mode. UI-driven
        // chrome→main channels (`cancelDownload` etc.) must not call this path,
        // or clicking a button would drop mode out from under a user who is
        // typing.
        vim.requestMode("normal");
      },
    },
    (sender) => sender === win.webContents,
  );

  // ipcMain is process-global; these belong to this window.
  win.on("closed", () => {
    releaseChrome();
    releasePage();
    releaseMessages();
  });
}

void app.whenReady().then(async () => {
  downloads.attach(session.defaultSession);
  const config = createConfigStore();
  const loaded = await loadConfig(config);
  reportProblems(loaded);
  await applyConfig(loaded.config);
  registerKvistProtocol();

  createWindow();
  const releaseConfig = await watchConfig(config, (next) => {
    reportProblems(next);
    void applyConfig(next.config);
  });
  app.on("will-quit", releaseConfig);

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
