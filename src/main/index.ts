import { basename, join } from "node:path";
import { app, BrowserWindow, session, shell } from "electron";
import type { UserConfig } from "../shared/config";
import { applySettings as applyAdblockSettings, refreshCosmeticStyles } from "./adblock";
import {
  applySettings as applyLocalPageSettings,
  registerKvistProtocol,
  registerKvistScheme,
} from "./local-pages";
import { createActions } from "./actions";
import { Database } from "./db/database";
import { systemClipboard } from "./clipboard";
import {
  fromPage,
  type PermissionAnswer,
  type Point,
  senders,
  toChrome,
  toMain,
} from "../shared/ipc";
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
import { applyXdgPaths, dbPath } from "./paths";
import { interceptKeys } from "./keys";
import { Permissions } from "./permissions";
import { TabManager } from "./tab-manager";
import { type KeyInput, type KeySource, Vim } from "./vim";
import { UserStyles, type UserStyleProblem } from "./user-styles";
import { readStyleFiles, watchStyleFiles } from "./user-style-files";
import { flushOnQuit, ZoomStore } from "./zoom";

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
 * Permission prompts, session-scoped like the downloads: the session allows
 * only one handler pair, a remembered answer belongs to no window, and a
 * window only subscribes to the queue.
 */
const permissions = new Permissions();

/**
 * The user's own stylesheets, session-scoped for the same reason as the rest:
 * a style belongs to no window, and every tab gets the same answer for the
 * same URL. Filled from the watched styles directory on startup and on every
 * change to it (KVI-22), and applied on every navigation from here.
 */
const userStyles = new UserStyles();

/**
 * The windows' own share of a config change. A window subscribes once it has
 * loaded and drops out when it closes, so a second window neither misses a
 * change nor keeps answering after it is gone.
 */
const windows = new Set<(config: UserConfig) => void>();

/**
 * Every open window's tabs, so a styles-directory change can reach pages
 * already open rather than waiting for their next navigation. Separate from
 * `windows`: that fan-out is the chrome and each tab's *next* navigation,
 * this one is restyling what is on screen right now.
 */
const tabManagers = new Set<TabManager>();

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

/**
 * Same shape as reportProblems, one file's worth at a time: a style file is
 * hand-edited and hot-reloaded exactly like config.toml, so a typo in one
 * block must not blank out every style file that still parses.
 */
function reportStyleProblems(problems: UserStyleProblem[]): void {
  const [first, ...rest] = problems;
  if (first === undefined) return;
  for (const problem of rest) console.error(`kvist: ${problem.id}: ${problem.reason}`);
  const more = rest.length === 0 ? "" : ` (+${rest.length} more)`;
  // The echo area names the file, not the full path — the log line above
  // already carries that, and a config directory nested a few levels deep
  // pushes the reason itself off the end of the line.
  messages.warn(`${basename(first.id)}: ${first.reason}${more}`);
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
    // oxlint-disable-next-line anti-slop/no-unknown-parameters -- a rejection reason is unknown; it is only logged
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
  // SAFETY: just checked value is a non-null object; x and y are validated below.
  const { x, y } = value as Point;
  return Number.isFinite(x) && Number.isFinite(y);
}

/** Same lesson as isPoint: a payload that is not an answer is ignored, not destructured. */
function isPermissionAnswer(value: unknown): value is PermissionAnswer {
  if (typeof value !== "object" || value === null) return false;
  // SAFETY: just checked value is a non-null object; id and allow are validated below.
  const { id, allow } = value as PermissionAnswer;
  return Number.isInteger(id) && typeof allow === "boolean";
}

function createWindow(zoom: ZoomStore): void {
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

  const tabs = new TabManager(win, pagePreload, zoom, (state) => chrome.state(state));
  tabManagers.add(tabs);

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

  const actions = createActions(
    tabs,
    downloads,
    permissions,
    zoom,
    win,
    messages,
    systemClipboard,
    shell,
    userStyles,
    () => app.quit(),
    // Read at call time, so a config save changes where the next search goes
    // without the window being recreated.
    () => current.settings.searchUrl,
  );
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

  // The prompt the window shows and the mode the keyboard is in both follow
  // the one queue: a pending question captures normal mode, and answering it
  // hands normal back.
  const releasePermissions = permissions.observe((pending) => {
    chrome.permission(pending[0] ?? null);
    vim.setPromptPending(pending.length > 0);
  });

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
  // A scheme the desktop owns — already allowlisted by the time it arrives
  // here — goes to the OS. A rejection (no app registered, etc.) is the
  // echo area's to show: a message that disappears on its own can vanish
  // before the user has read it, and the one thing worth saying is usually
  // what they were trying to open.
  tabs.observeExternal((url) => {
    void shell.openExternal(url).catch(() => messages.warn(`no application handles ${url}`));
  });
  tabs.observeEditable((editable) => vim.setEditable(editable));
  tabs.observeFind((result) => chrome.findResult(result));
  // Both halves of "the URL changed": a committed navigation and a history-API
  // one. The user's styles are keyed to the URL rather than the document, so a
  // SPA moving between routes has to be restyled with nothing reloading.
  tabs.observeNavigation((contents, url) => userStyles.applyTo(contents, url));
  tabs.observeInPageNavigation((contents, url) => {
    refreshCosmeticStyles(contents, url);
    userStyles.applyTo(contents, url);
  });

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

  win.on("closed", () => {
    windows.delete(applyToWindow);
    tabManagers.delete(tabs);
  });

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
    // Nor could the prompt line have been: a question asked while the window
    // was loading is still waiting for its answer.
    chrome.permission(permissions.pending[0] ?? null);
    vim.setPromptPending(permissions.pending.length > 0);
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
      answerPermission: (answer) => {
        if (isPermissionAnswer(answer)) permissions.answer(answer.id, answer.allow);
      },
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
    releasePermissions();
  });
}

void app.whenReady().then(async () => {
  downloads.attach(session.defaultSession);
  permissions.attach(session.defaultSession);
  // A bad migration, corrupted DB, or missing migrations folder is a
  // real failure — log and quit rather than leave the user staring at
  // a window that never appears, which is what an unhandled rejection
  // here would do.
  let db: Database;
  try {
    db = Database.open(dbPath);
  } catch (error) {
    console.error("kvist: could not open the storage layer:", error);
    app.quit();
    return;
  }
  const config = createConfigStore();
  const loaded = await loadConfig(config);
  reportProblems(loaded);
  await applyConfig(loaded.config);
  registerKvistProtocol();

  reportStyleProblems(userStyles.setSources(await readStyleFiles()));

  const zoom = await ZoomStore.load();
  createWindow(zoom);
  const releaseConfig = await watchConfig(config, (next) => {
    reportProblems(next);
    void applyConfig(next.config);
  });
  const releaseStyleFiles = await watchStyleFiles((sources) => {
    reportStyleProblems(userStyles.setSources(sources));
    // A rescan otherwise only reaches a page on its next navigation — an edit
    // or a removed file has to take effect on what is already open, not just
    // on what loads afterward.
    for (const tabs of tabManagers) {
      tabs.forEachTab((contents, url) => userStyles.applyTo(contents, url));
    }
  });
  // The config watcher and the zoom store are both acquired once and released
  // on quit. The store additionally holds the quit until its queued write has
  // landed: a Ctrl-wheel nudge inside the debounce window is otherwise lost.
  app.on("will-quit", releaseConfig);
  app.on("will-quit", releaseStyleFiles);
  app.on("will-quit", () => db.close());
  flushOnQuit(app, zoom);

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow(zoom);
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
