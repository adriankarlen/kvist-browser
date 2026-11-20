import { basename, join } from "node:path";
import { app, BrowserWindow, session, shell, WebContentsView } from "electron";
import type { TabOrientation, UserConfig } from "../shared/config";
import { applySettings as applyAdblockSettings, refreshCosmeticStyles } from "./adblock";
import {
  applySettings as applyLocalPageSettings,
  registerKvistProtocol,
  registerKvistScheme,
} from "./local-pages";
import { createActions, type DownloadsAccess, type TabsAccess } from "./actions";
import { databaseLayer, prepareDatabaseFile } from "./db/database";
import { systemClipboard } from "./clipboard";
import { omniboxSuggestions } from "./omnibox";
import { BookmarksRepo } from "./services/bookmarks-repo";
import { HistoryRepo, type RecordInput } from "./services/history-repo";
import { SessionRepo, type SessionState } from "./services/session-repo";
import type { TabId } from "../shared/schema/browser";
import { completeCommand, createCommands } from "./commands";
import { ConfigFiles, describeProblem, type LoadedConfig } from "./services/config-files";
import { Msg as DownloadsMsg } from "./features/downloads/downloads.program";
import { DownloadsGate } from "./services/downloads-gate";
import { LiveDownloads } from "./services/live-downloads";
import { MainStore, project, projectThrottled } from "./app/store";
import { say, warn } from "./features/messages/messages.program";
import type { Messenger } from "./messenger";
import { applyXdgPaths, dataDir } from "./paths";
import { interceptKeys } from "./keys";
import {
  head as promptHead,
  Msg as PromptsMsg,
  sessionRestorePending,
} from "./features/prompts/prompts.program";
import { PromptsGate } from "./services/prompts-gate";
import { Requesters } from "./services/requesters";
import { Desktop } from "./services/desktop";
import { LegacyWindow, type WindowHooks } from "./services/legacy-window";
import { TabViews } from "./tab-views";
import { Msg as CompletionMsg } from "./features/completion/completion.program";
import {
  activeFind,
  layout,
  Msg as TabsMsg,
  sessionTabs,
  strip,
} from "./features/tabs/tabs.program";
import type { PageContents } from "./page-host";
import type { PageSenders } from "./links";
import { CompletionOverlay } from "./completion-overlay";
import { ViewStack } from "./view-stack";
import {
  type KeyInput,
  type KeySource,
  type Msg as VimMsg,
  Msg as VimMsgs,
  resolveKey,
} from "./features/vim/vim.program";
import { UserStyles, type UserStyleProblem } from "./user-styles";
import { StyleFiles } from "./services/style-files";
import { ZoomRepo } from "./services/zoom-repo";
import type { ZoomStoreAccess } from "./zoom";
import { AppLayer, disposeNow } from "./runtime";
import { Effect, Exit, Layer, ManagedRuntime, Stream } from "effect";
import type { Context } from "effect";
import { RpcServer } from "effect/rpc";
import { ChromeIntent, ChromeRpcs } from "../shared/rpc/chrome";
import { OverlayIntent, OverlayRpcs } from "../shared/rpc/overlay";
import { PageIntent, PageRpcs } from "../shared/rpc/page";
import { chromeLink, overlayLink, type OverlaySenders, pageLink } from "./links";
import { serve } from "./services/surface";

applyXdgPaths();

registerKvistScheme();

/** The app scope: closed on `quit`, never on `will-quit`, which can be cancelled. */
const runtime = ManagedRuntime.make(
  Layer.mergeAll(
    ConfigFiles.layer,
    StyleFiles.layer,
    Layer.mergeAll(PromptsGate.layer, DownloadsGate.layer).pipe(
      Layer.provideMerge(MainStore.layer),
    ),
    Layer.mergeAll(HistoryRepo.layer, BookmarksRepo.layer, SessionRepo.layer, ZoomRepo.layer).pipe(
      Layer.provide(Layer.unwrap(Effect.map(prepareDatabaseFile(dataDir), databaseLayer))),
    ),
  ).pipe(
    Layer.provideMerge(
      Layer.mergeAll(Requesters.layer, Desktop.layer, LegacyWindow.layer, LiveDownloads.layer),
    ),
    Layer.provideMerge(AppLayer),
  ),
);

type MainServices = ManagedRuntime.ManagedRuntime.Services<typeof runtime>;

/**
 * Runs one repository call to completion on this tick. `node:sqlite` is
 * synchronous, so the imperative code that has not moved onto the store yet
 * can keep calling the repositories as plain functions.
 */
function useSync<I extends MainServices, S, A>(
  tag: Context.Key<I, S>,
  call: (service: S) => Effect.Effect<A>,
): A {
  return runtime.runSync(Effect.flatMap(Effect.service(tag), call));
}

const history = {
  record: (input: RecordInput) => useSync(HistoryRepo, (repo) => repo.record(input)),
};

const bookmarks = {
  has: (url: string) => useSync(BookmarksRepo, (repo) => repo.has(url)),
  add: (input: { url: string; title: string }) => useSync(BookmarksRepo, (repo) => repo.add(input)),
  removeUrl: (url: string) => useSync(BookmarksRepo, (repo) => repo.removeUrl(url)),
  /** Calls `onChange` after every bookmark write, until the returned release. */
  observe: (onChange: () => void): (() => void) => {
    const fiber = runtime.runFork(
      Effect.flatMap(Effect.service(BookmarksRepo), (repo) =>
        Stream.runForEach(repo.changes, () => Effect.sync(onChange)),
      ),
    );

    return () => fiber.interruptUnsafe();
  },
};

type Bookmarks = typeof bookmarks;

const sessions = {
  save: (state: SessionState, savedAt: number) =>
    useSync(SessionRepo, (repo) => repo.save(state, savedAt)),
  clear: () => useSync(SessionRepo, (repo) => repo.clear),
  load: () => useSync(SessionRepo, (repo) => repo.load),
};

type Sessions = typeof sessions;

const zoom: ZoomStoreAccess = {
  get: (origin) => useSync(ZoomRepo, (repo) => repo.get(origin)),
  set: (origin, level) => useSync(ZoomRepo, (repo) => repo.set(origin, level)),
};

const preload = join(import.meta.dirname, "../preload/index.cjs");
const pagePreload = join(import.meta.dirname, "../preload/page.cjs");
const overlayPreload = join(import.meta.dirname, "../preload/overlay.cjs");
const rendererHtml = join(import.meta.dirname, "../renderer/index.html");
const overlayHtml = join(import.meta.dirname, "../renderer/overlay.html");
const iconPath = join(app.getAppPath(), "images/kvist-logo.png");

/** Main's loop. Built with the runtime, so only reached once startup has built it. */
const mainStore = () => runtime.runSync(Effect.service(MainStore));

/** The echo area, as the imperative code that has not moved onto the store calls it. */
const messages: Messenger = {
  say: (text) => mainStore().dispatch(say(text)),
  warn: (text) => mainStore().dispatch(warn(text)),
};

/** The download rows live in the store; these are the verbs the commands use. */
const downloads: DownloadsAccess = {
  clear: () => mainStore().dispatch(DownloadsMsg.cases.DownloadsCleared.make({})),
  cancelNth: (n) => mainStore().dispatch(DownloadsMsg.cases.DownloadCancelNthRequested.make({ n })),
};

/** Answers whatever prompt is up, for the `y`/`n` keybinds. */
const prompts = {
  answerHead: (allow: boolean) =>
    mainStore().dispatch(PromptsMsg.cases.HeadAnswered.make({ allow })),
};

/**
 * The user's stylesheets, session-scoped: a style belongs to no window,
 * and every tab gets the same answer for a URL. Filled from the watched
 * directory at startup and on change (KVI-22), and applied on every
 * navigation.
 */
const userStyles = new UserStyles();

/**
 * The windows' own share of a config change. A window subscribes once it has
 * loaded and drops out when it closes, so a second window neither misses a
 * change nor keeps answering after it is gone.
 */
const windows = new Set<(config: UserConfig) => void>();

/**
 * Every open window's tabs, so a styles-directory change reaches pages
 * already open, not just their next navigation. Separate from `windows`:
 * that feeds the chrome and each tab's next navigation; this restyles what
 * is on screen now.
 */
const tabManagers = new Set<TabViews>();

/** The config as it stands, for a window opened after the last change. */
let current: UserConfig;

/**
 * Applies run one at a time. Blocking has to fetch its lists, which can take
 * seconds, and two saves during that would otherwise race — leaving whichever
 * config finished last in charge rather than whichever the user wrote last.
 */
let applying: Promise<void> = Promise.resolve();

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

/**
 * Fans a config change out to everything that cares, in load-bearing
 * order: blocking attaches to the session before the first tab loads, and
 * local pages are configured before one is served. Startup and reload are
 * the same call.
 */
function applyConfig(config: UserConfig): Promise<void> {
  applying = applying
    .then(async () => {
      await applyAdblockSettings(config);
      applyLocalPageSettings(config);
      useSync(DownloadsGate, (gate) =>
        Effect.sync(() => gate.configure(config.settings.downloadDir)),
      );
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

function createWindow(
  zoom: ZoomStoreAccess,
  bookmarks: Bookmarks,
  sessions: Sessions,
  saved: SessionState | null,
): void {
  const win = new BrowserWindow({
    width: saved?.width ?? 1280,
    height: saved?.height ?? 800,
    x: saved?.x ?? undefined,
    y: saved?.y ?? undefined,
    frame: false,
    backgroundColor: "#1d1d1d",
    icon: iconPath,
    webPreferences: { preload },
  });

  /**
   * The chrome's runtime orientation override, kept here so it can be saved
   * with the rest of the session state on `win.on("close")`. The chrome
   * pushes it via `toMain.orientationOverride` whenever the override
   * changes — `null` means "no override, follow the config".
   */
  let orientationOverride: TabOrientation | null = saved?.orientation ?? null;

  const { events: chromeEvents, send: chrome } = chromeLink();

  const views = new ViewStack(win.contentView);

  const connectPage = (contents: PageContents): PageSenders => {
    const page = pageLink();

    serve(
      runtime,
      contents,
      RpcServer.make(PageRpcs).pipe(
        Effect.provide(
          PageRpcs.toLayer({
            Subscribe: () => page.events.stream,
            Dispatch: (message) =>
              Effect.sync(() =>
                PageIntent.match(message, {
                  EditableChanged: ({ editable }) => tabViews.setEditable(contents, editable),
                  HintClicked: ({ point }) => tabViews.tabFor(contents)?.click(point),
                  HintsEnded: () => vim.dispatch(VimMsgs.cases.HintsEnded.make({})),
                  ContextMenuPicked: ({ id }) => tabViews.tabFor(contents)?.pickContextMenu(id),
                }),
              ),
          }),
        ),
      ),
    );

    return page.send;
  };

  const tabViews = new TabViews(win, views, pagePreload, zoom, {
    dispatch: (msg) => mainStore().dispatch(msg),
    key: (input, source) => onKey(input, source),
    isBookmarked: (url) => bookmarks.has(url),
    connectPage,
    // Both halves of "the URL changed". Styles key on the URL, not the
    // document, so a SPA changing routes is restyled with nothing reloading.
    navigated: (contents, url) => {
      userStyles.applyTo(contents, url);
      // The title at commit time is still the previous page's; the URL is
      // the truthful answer until the real title lands.
      history.record({ url, title: url, visitedAt: Date.now() });
    },
    // SPA route changes are not history: every hash change would drown the
    // real visits.
    inPageNavigation: (contents, url) => {
      refreshCosmeticStyles(contents, url);
      userStyles.applyTo(contents, url);
    },
    external: (url, scheme, origin, selfInitiated, contents) =>
      useSync(PromptsGate, (gate) =>
        Effect.sync(() => gate.requestExternal(url, scheme, origin, selfInitiated, contents)),
      ),
  });

  /** The tab verbs as the commands call them; the collection lives in the store. */
  const tabs: TabsAccess & { create(url?: string, background?: boolean): void } = {
    get active() {
      return tabViews.tab(mainStore().get().tabs.activeId);
    },
    create: (url?: string, background: boolean = false) =>
      mainStore().dispatch(
        TabsMsg.cases.TabOpenRequested.make({
          url,
          after: undefined,
          background,
          origin: null,
          opener: null,
        }),
      ),
    closeActive: () => {
      const id = mainStore().get().tabs.activeId;

      if (id !== null) mainStore().dispatch(TabsMsg.cases.TabCloseRequested.make({ id }));
    },
    step: (offset) => mainStore().dispatch(TabsMsg.cases.TabStepped.make({ offset })),
  };

  const tabsFiber = runtime.runFork(
    Effect.all(
      [
        project(
          (model) => strip(model.tabs),
          (state) => chrome.state(state),
        ),
        project(
          (model) => activeFind(model.tabs),
          (result) => chrome.findResult(result),
        ),
        project(
          (model) => layout(model.tabs),
          (next) => tabViews.reconcile(next),
        ),
      ],
      { concurrency: "unbounded", discard: true },
    ),
  );

  const releaseBookmarks = bookmarks.observe(() => tabViews.refresh());
  tabManagers.add(tabViews);

  const completion = new CompletionOverlay(
    () => {
      const view = new WebContentsView({ webPreferences: { preload: overlayPreload } });
      // The view drops this reference during destruction; cleanup still needs it.
      const contents = view.webContents;
      view.setBackgroundColor("#00000000");
      views.addOverlay(view);

      const loaded = process.env.VITE_DEV_SERVER_URL
        ? contents.loadURL(new URL("overlay.html", process.env.VITE_DEV_SERVER_URL).href)
        : contents.loadFile(overlayHtml);

      // Destroy failed loads so the next completion can build a fresh view.
      void loaded.catch(() => {
        if (!contents.isDestroyed()) contents.close();
      });

      const overlay = pageOverlay(contents);

      return {
        host: view,
        link: overlay,
        release: () => {
          views.remove(view);

          if (!contents.isDestroyed()) contents.close();
        },
      };
    },
    () => win.getContentBounds(),
    () => current.css,
    () => {
      if (!win.isDestroyed()) win.webContents.focus();
    },
  );

  // The overlay is the completion slice's view: height first, so a list that
  // just arrived is placed at the size it last measured.
  const completionFiber = runtime.runFork(
    project(
      (model) => model.completion,
      ({ state, height }) => {
        if (height !== null) completion.setHeight(height);

        if (state === null) completion.hide();
        else completion.show(state);
      },
    ),
  );

  if (process.env.VITE_DEV_SERVER_URL) {
    void win.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else {
    void win.loadFile(rendererHtml);
  }

  const configureTabs = (config: UserConfig): void => {
    tabViews.applyCss(config.css);
    mainStore().dispatch(
      TabsMsg.cases.TabsConfigured.make({
        homepage: config.settings.homepage,
        focusPage: config.settings.tabFocusPage,
      }),
    );
  };

  configureTabs(current);

  const applyToWindow = (next: UserConfig): void => {
    configureTabs(next);
    chrome.config(next);
    completion.applyCss();
  };

  // Throttled: a transfer reports far more often than the panel can show.
  const downloadsFiber = runtime.runFork(
    projectThrottled(
      (model) => model.downloads.items,
      (list) => chrome.downloads(list),
      "100 millis",
    ),
  );

  const messageFiber = runtime.runFork(
    project(
      (model) => model.messages.current,
      (message) => chrome.message(message),
    ),
  );

  const releaseMessages = () => messageFiber.interruptUnsafe();

  const actions = createActions(
    tabs,
    downloads,
    prompts,
    zoom,
    bookmarks,
    win,
    chrome,
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

  /** How the store's Cmds reach this window's code until it moves onto the store. */
  const windowHooks: WindowHooks = {
    tabs: tabViews,
    restoreSession: () => {},
    tabDownloaded: (contents) => tabViews.closeIfUncommitted(contents),
    runCommand: (name, arg) => {
      if (!commands.execute(name, arg)) messages.warn(`unknown command ${name}`);
    },
  };

  const legacy = runtime.runSync(Effect.service(LegacyWindow));

  legacy.current = windowHooks;

  const vim = {
    dispatch: (msg: VimMsg) => mainStore().dispatch(msg),
  };

  const modeFiber = runtime.runFork(
    project(
      (model) => model.vim.mode,
      (mode) => chrome.mode(mode),
    ),
  );

  // The prompt the window shows and the mode the keyboard is in both follow
  // the one queue: a pending question captures normal mode, and answering it
  // hands normal back.
  const promptFiber = runtime.runFork(
    project(
      (model) => promptHead(model.prompts),
      (head) => chrome.prompt(head),
    ),
  );

  const releasePermissions = () => {
    promptFiber.interruptUnsafe();
    downloadsFiber.interruptUnsafe();
    modeFiber.interruptUnsafe();
  };

  // Any key at all ends whatever the echo area is showing, wherever it came
  // from — the page's keys and the chrome's both arrive here.
  const onKey = (input: KeyInput, source: KeySource): boolean => {
    // find.clear swallows Escape in normal mode (Vim#dispatch matches and
    // calls event.preventDefault), which would otherwise be the only chance
    // Chromium's built-in "Escape exits HTML fullscreen" gets — so that has
    // to be reimplemented here, falling out to whatever normal-mode Escape
    // already does, matching every other browser.
    if (input.key === "Escape") {
      mainStore().dispatch(TabsMsg.cases.FullscreenLeaveRequested.make({}));
    }

    // Asked first, on this tick: `before-input-event` must know now whether
    // the key is kept from the page. The update then makes the same step.
    const consumed = resolveKey(mainStore().get().vim, input, source);

    vim.dispatch(VimMsgs.cases.KeyPressed.make({ ...input, source }));

    return consumed;
  };

  // The chrome needs the same treatment as a page: it is a separate
  // webContents, so without this every key pressed while the chrome holds
  // focus is invisible to the mode machine.
  interceptKeys(win.webContents, "chrome", onKey);

  const runCommand = (line: string): void => {
    const [name = "", ...rest] = line.trim().split(/\s+/);

    if (name === "") return;
    const arg = rest.join(" ") || undefined;

    if (!commands.execute(name, arg)) {
      messages.warn(`unknown command :${name}`);
    }
  };

  // Saves before `closed` because `getBounds` on a destroyed window is
  // undefined. `close` fires on every close path (user click, app quit,
  // macOS reopen-by-relaunch) — last-write-wins on the singleton row, so the
  // most recently closed window is what the next launch restores.
  win.on("close", () => {
    if (win.isDestroyed()) return;

    // A window closed mid-prompt, with no answer, is not a decision.
    // The chrome rendered the prompt, the user dismissed the window
    // without clicking restore or discard, and the saved row must
    // survive — the next launch should re-prompt. Cancelling removes
    // the entry without firing its callback, so the queue stops showing
    // a question that nobody answered.
    const promptStillPending = sessionRestorePending(mainStore().get().prompts);

    mainStore().dispatch(PromptsMsg.cases.SessionRestoreAbandoned.make({}));

    const snapshot = sessionTabs(mainStore().get().tabs);

    if (snapshot === null) {
      // No tabs at close time has two meanings now: the user closed
      // every tab they had open, or the prompt was never answered
      // (no tabs were ever created). Distinguish by asking the queue —
      // a still-pending session-restore means the user closed mid-
      // prompt, and the saved row must survive so the next launch can
      // ask again.
      if (!promptStillPending) {
        // The prompt was answered and the user closed what they had —
        // either their only tab (the discard branch's homepage) or
        // every tab of a restored session. Wiping the row makes the
        // next launch look like a fresh first launch, which is what
        // closing everything means.
        sessions.clear();
      }

      return;
    }

    const bounds = win.getBounds();
    sessions.save(
      {
        tabs: snapshot.urls,
        activeIndex: snapshot.activeIndex,
        width: bounds.width,
        height: bounds.height,
        x: bounds.x,
        y: bounds.y,
        orientation: orientationOverride,
      },
      Date.now(),
    );
  });

  win.on("closed", () => {
    windows.delete(applyToWindow);
    tabManagers.delete(tabViews);
    tabsFiber.interruptUnsafe();
    completionFiber.interruptUnsafe();
  });

  win.webContents.once("did-finish-load", () => {
    windows.add(applyToWindow);
    applyToWindow(current);

    // The observer already wired `chrome.prompt` to the queue head on
    // subscribe, and a question asked during page load (none today, but
    // possible) would already have reached the chrome by the time we get
    // here. Nothing else to push.
    if (saved !== null) {
      // Ask before restoring: a relaunch with a saved session used to
      // resurrect tabs the user had no chance to discard, and the prompt
      // would not be dismissed except by answering it. Asking makes
      // "discard" reachable and gives the user a clear exit from the
      // last session. Permission prompts go through the same queue, so the
      // chrome line is one component and y/n/Escape one keybind set.
      const restore = (allow: boolean): void => {
        if (!allow) {
          // Same path as a fresh launch: one homepage tab. The mirror
          // has to follow: the saved flip never reached the chrome in
          // this branch (no restoreSession broadcast), so persisting it
          // onto the new homepage session would survive until the user
          // explicitly re-flipped the orientation.
          orientationOverride = null;
          tabs.create();

          return;
        }

        // The chrome seeds its orientation override from the saved flip
        // before any tabs are created, so the very first paint shows the
        // saved layout, not a horizontal default that flashes before
        // being overridden. Main owns the tab restore — the URL list and
        // bounds never need to leave main.
        chrome.restoreSession({ orientation: saved.orientation });
        // `background: true` keeps the chrome on whatever tab it already
        // shows; the final `activate` is what lands on the saved one.
        let activeId: TabId | null = null;
        let firstCreatedId: TabId | null = null;

        for (let i = 0; i < saved.tabs.length; i++) {
          const url = saved.tabs[i]!;
          const id = mainStore().get().tabs.nextId;

          tabs.create(url, true);

          if (!mainStore().get().tabs.snapshots.has(id)) continue;

          if (firstCreatedId === null) firstCreatedId = id;

          if (i === saved.activeIndex) activeId = id;
        }

        // An external-protocol URL at the saved active index (a
        // hand-edited or partially corrupt row) leaves no activated tab
        // and every view hidden — a window of chrome over nothing. Fall
        // back to the first created tab so something is on screen.
        if (activeId === null) activeId = firstCreatedId;

        if (activeId !== null)
          mainStore().dispatch(TabsMsg.cases.TabActivated.make({ id: activeId }));
      };

      windowHooks.restoreSession = restore;
      mainStore().dispatch(
        PromptsMsg.cases.SessionRestoreAsked.make({ tabCount: saved.tabs.length }),
      );
    } else {
      tabs.create();
    }
  });

  /** The overlay's own surface: a list's worth of API, so a dropdown cannot navigate tabs. */
  function pageOverlay(contents: Electron.WebContents): OverlaySenders {
    const overlay = overlayLink();

    serve(
      runtime,
      contents,
      RpcServer.make(OverlayRpcs).pipe(
        Effect.provide(
          OverlayRpcs.toLayer({
            Subscribe: () => overlay.events.stream,
            Dispatch: (message) =>
              Effect.sync(() =>
                OverlayIntent.match(message, {
                  CompletionMeasured: ({ height }) =>
                    mainStore().dispatch(
                      CompletionMsg.cases.CompletionHeightMeasured.make({ height }),
                    ),
                  CompletionClicked: ({ candidate }) => {
                    chrome.completionAccept(candidate);
                    // The click moved focus into the overlay's webContents.
                    // Without this the keyboard is stranded there.
                    win.webContents.focus();
                  },
                }),
              ),
          }),
        ),
      ),
    );

    return overlay.send;
  }

  const releaseChrome = serve(
    runtime,
    win.webContents,
    RpcServer.make(ChromeRpcs).pipe(
      Effect.provide(
        ChromeRpcs.toLayer({
          Subscribe: () => chromeEvents.stream,
          OmniboxSuggestions: ({ query }) => omniboxSuggestions(query),
          CommandCompletions: ({ line }) => Effect.sync(() => completeCommand(line)),
          Dispatch: (message) =>
            Effect.sync(() =>
              ChromeIntent.match(message, {
                ContentRectMeasured: ({ rect }) =>
                  mainStore().dispatch(TabsMsg.cases.ContentRectMeasured.make({ rect })),
                TabRequested: ({ url }) => tabs.create(url),
                TabCloseRequested: ({ id }) =>
                  mainStore().dispatch(TabsMsg.cases.TabCloseRequested.make({ id })),
                TabActivated: ({ id }) =>
                  mainStore().dispatch(TabsMsg.cases.TabActivated.make({ id })),
                NavigationRequested: ({ url }) => tabs.active?.navigate(url),
                BackRequested: () => tabs.active?.goBack(),
                ForwardRequested: () => tabs.active?.goForward(),
                ReloadRequested: () => tabs.active?.reload(),
                DevToolsToggled: () => tabs.active?.toggleDevTools(),
                FindRequested: ({ query }) => tabs.active?.find(query),
                FindStopped: () => tabs.active?.stopFind(),
                ModeRequested: ({ mode }) =>
                  vim.dispatch(VimMsgs.cases.ModeRequested.make({ mode })),
                DownloadCancelRequested: ({ id }) =>
                  mainStore().dispatch(DownloadsMsg.cases.DownloadCancelRequested.make({ id })),
                PromptAnswered: ({ id, allow }) =>
                  mainStore().dispatch(PromptsMsg.cases.PromptAnswered.make({ id, allow })),
                // The chrome owns the override; main mirrors it so the close
                // handler can save it with the rest of the session.
                OrientationOverridden: ({ orientation }) => {
                  orientationOverride = orientation;
                },
                CommandEntered: ({ line }) => {
                  runCommand(line);
                  // A typed `:foo` ends in normal mode. Button-driven intents
                  // must not take this path, or a click would drop the mode
                  // out from under someone typing.
                  vim.dispatch(VimMsgs.cases.ModeRequested.make({ mode: "normal" }));
                },
                CompletionOverlayChanged: ({ state }) =>
                  mainStore().dispatch(CompletionMsg.cases.CompletionChanged.make({ state })),
              }),
            ),
        }),
      ),
    ),
  );

  // ipcMain is process-global; these belong to this window.
  win.on("closed", () => {
    releaseChrome();

    if (legacy.current === windowHooks) legacy.current = undefined;
    releaseMessages();
    releasePermissions();
    releaseBookmarks();
    completion.release();
  });
}

/**
 * A second launch is a relaunch: the lock keeps two processes from opening
 * kvist.db, since WAL forbids concurrent writers. The lock-false copy
 * quits; the first refocuses its window, so a dock click opens, not
 * another instance.
 */
const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    // The OS already tried to launch a second copy; it now exits and we
    // refocus whatever window the user is likely after.
    const windows = BrowserWindow.getAllWindows();
    const target = windows[0];

    if (target !== undefined) {
      if (target.isMinimized()) target.restore();
      target.focus();
    }
  });

  void app.whenReady().then(async () => {
    // A bad migration or a corrupt database is a real failure: log and quit
    // rather than leave the user staring at a window that never appears.
    const built = await runtime.runPromiseExit(Effect.void);

    if (Exit.isFailure(built)) {
      console.error("kvist: could not start:", built.cause);
      app.quit();

      return;
    }

    useSync(PromptsGate, (gate) => Effect.sync(() => gate.attach(session.defaultSession)));
    useSync(DownloadsGate, (gate) => Effect.sync(() => gate.attach(session.defaultSession)));

    // The first load is the startup config; every later one is a save.
    const configLoaded = Promise.withResolvers<void>();

    const configFiber = runtime.runFork(
      Effect.gen(function* () {
        const { changes } = yield* ConfigFiles;

        yield* Stream.runForEach(changes, (loaded) =>
          Effect.promise(async () => {
            reportProblems(loaded);
            await applyConfig(loaded.config);
            configLoaded.resolve();
          }),
        );
      }),
    );

    await configLoaded.promise;
    registerKvistProtocol();

    // Like the config: the first scan is startup, every later one an edit.
    const stylesLoaded = Promise.withResolvers<void>();

    const styleFiber = runtime.runFork(
      Effect.gen(function* () {
        const { changes } = yield* StyleFiles;

        yield* Stream.runForEach(changes, (sources) =>
          Effect.sync(() => {
            reportStyleProblems(userStyles.setSources([...sources]));

            // An edit must restyle what is already open, not wait for each
            // page's next navigation.
            for (const tabs of tabManagers) {
              tabs.forEachTab((contents, url) => userStyles.applyTo(contents, url));
            }

            stylesLoaded.resolve();
          }),
        );
      }),
    );

    await stylesLoaded.promise;

    // The single prompt queue: permission asks and the session-restore ask
    // share one mechanism, one observer wiring, one keybind set, one IPC
    // channel. App-scoped because the chrome renders one line at a time and
    // a permission prompt outliving its tab is the only cross-window concern
    // — already handled inside `Permissions` via `Prompts.cancel`.
    // `sessions.load()` is forgiving: missing or malformed row collapses to
    // null, which is indistinguishable from a fresh first launch — the right
    // answer when an old build has never written the table or when a corrupt
    // row is left behind by a crash.
    createWindow(zoom, bookmarks, sessions, sessions.load());

    // The config watcher and the zoom store are both acquired once and released
    // on quit. The store additionally holds the quit until its queued write has
    // landed: a Ctrl-wheel nudge inside the debounce window is otherwise lost.
    app.on("will-quit", () => configFiber.interruptUnsafe());
    app.on("will-quit", () => styleFiber.interruptUnsafe());
    // `quit` rather than `will-quit`: `will-quit` is cancellable, and an app
    // that keeps running with a closed database throws out of every later
    // query — `activate` calling `Session.load` is the one that surfaced.
    // `quit` only fires once the app is definitely going.
    app.on("quit", () => {
      disposeNow(runtime);
    });
    runtime.runFork(Effect.logInfo("kvist started"));

    app.on("activate", () => {
      // macOS reopen: a re-launched app with no windows restores the last
      // session, same as cold start. Re-reading from the store is cheap and
      // avoids the alternative of carrying the row across the app's lifetime.
      if (BrowserWindow.getAllWindows().length === 0)
        createWindow(zoom, bookmarks, sessions, sessions.load());
    });
  });
}

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
