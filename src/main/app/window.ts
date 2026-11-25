import { join } from "node:path";
import { app, BrowserWindow, shell, WebContentsView } from "electron";
import type { UserConfig } from "../../shared/config";
import { refreshCosmeticStyles } from "../adblock";
import {
  type BookmarkAccess,
  createActions,
  type DownloadsAccess,
  type TabsAccess,
} from "../actions";
import { Msg as LibraryMsg } from "../features/library/library.program";
import { systemClipboard } from "../clipboard";
import { omniboxSuggestions } from "../omnibox";
import { bookmarkRows } from "../bookmark-rows";
import { BookmarksRepo } from "../services/bookmarks-repo";
import { SessionRepo, type SessionState } from "../services/session-repo";
import type { TabId, WindowControl } from "../../shared/schema/browser";
import { completeCommand, createCommands, modeAfter } from "../commands";
import { Msg as DownloadsMsg } from "../features/downloads/downloads.program";
import { project, projectThrottled } from "./store";
import { say, warn } from "../features/messages/messages.program";
import type { Messenger } from "../messenger";
import { interceptKeys } from "../keys";
import {
  head as promptHead,
  Msg as PromptsMsg,
  sessionRestorePending,
} from "../features/prompts/prompts.program";
import { PromptsGate } from "../services/prompts-gate";
import { LegacyWindow, type WindowHooks } from "../services/legacy-window";
import { TabViews } from "../tab-views";
import { DEFAULT_CONFIG } from "../../shared/config";
import { themeCss } from "../../shared/theme-css";
import { Msg as CompletionMsg } from "../features/completion/completion.program";
import {
  activeFind,
  layout,
  Msg as TabsMsg,
  sessionTabs,
  strip,
} from "../features/tabs/tabs.program";
import type { PageContents } from "../page-host";
import type { PageSenders } from "../links";
import { CompletionOverlay } from "../completion-overlay";
import { ViewStack } from "../view-stack";
import {
  type KeyInput,
  type KeySource,
  type Msg as VimMsg,
  Msg as VimMsgs,
  resolveKey,
} from "../features/vim/vim.program";
import { UserStyles } from "../user-styles";
import type { ZoomStoreAccess } from "../zoom";
import { Effect, Stream } from "effect";
import type { Fiber } from "effect";
import { RpcServer } from "effect/rpc";
import { ChromeIntent, ChromeRpcs } from "../../shared/rpc/chrome";
import { OverlayIntent, OverlayRpcs } from "../../shared/rpc/overlay";
import { PageIntent, PageRpcs } from "../../shared/rpc/page";
import { chromeLink, overlayLink, type OverlaySenders, pageLink, paletteLink } from "../links";
import { PaletteIntent, PaletteRpcs } from "../../shared/rpc/palette";
import { PaletteOverlay, type PaletteSenders } from "../palette-overlay";
import { Msg as ConfigMsg } from "../features/config/config.program";
import { Msg as PaletteMsg } from "../features/palette/palette.program";
import { Msg as WindowMsg, trafficLights } from "../features/window/window.program";
import { acceptOmnibox } from "../../shared/omnibox-action";
import { resolveUrl } from "../../shared/url";
import { isPalette } from "../../shared/layout";
import { serve } from "../services/surface";
import { mountSetupView } from "./setup-view";

import { mainStore, runtime, useSync } from "./runtime";
import { nextTurn } from "../../shared/tea/store";

export const library = (msg: LibraryMsg): void => mainStore().dispatch(msg);

/** Bookmarks as the commands use them: the toggle decides in the store. */
const bookmarks: BookmarkAccess = {
  toggle: (url, title) => library(LibraryMsg.cases.BookmarkToggled.make({ url, title })),
};

/** Per-origin zoom: read from the model on every navigation, saved by a Cmd. */
const zoom: ZoomStoreAccess = {
  get: (origin) => mainStore().get().library.zoom.get(origin) ?? 0,
  set: (origin, level) => library(LibraryMsg.cases.ZoomChanged.make({ origin, level })),
};

const preload = join(import.meta.dirname, "../preload/index.cjs");
const pagePreload = join(import.meta.dirname, "../preload/page.cjs");
const overlayPreload = join(import.meta.dirname, "../preload/overlay.cjs");
const rendererHtml = join(import.meta.dirname, "../renderer/index.html");
const overlayHtml = join(import.meta.dirname, "../renderer/overlay.html");
const palettePreload = join(import.meta.dirname, "../preload/palette.cjs");
const paletteHtml = join(import.meta.dirname, "../renderer/palette.html");
const iconPath = join(app.getAppPath(), "images/kvist-logo.png");

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
export const userStyles = new UserStyles();

/**
 * Every open window's tabs, so a styles-directory change reaches pages
 * already open, not just their next navigation. Separate from `windows`:
 * that feeds the chrome and each tab's next navigation; this restyles what
 * is on screen now.
 */
export const tabManagers = new Set<TabViews>();

/** The saved session, or null for a first launch: missing and malformed rows read the same. */
export const loadSession = (): SessionState | null => useSync(SessionRepo, (repo) => repo.load);

/** The config in force; startup has applied one before any window opens. */
const currentConfig = (): UserConfig => mainStore().get().config.current ?? DEFAULT_CONFIG;

export function createWindow(saved: SessionState | null): void {
  const win = new BrowserWindow({
    width: saved?.width ?? 1280,
    height: saved?.height ?? 800,
    x: saved?.x ?? undefined,
    y: saved?.y ?? undefined,
    // macOS keeps its frame for the native traffic lights, hidden until the
    // chrome makes room for them. Elsewhere the chrome draws its own buttons.
    ...(process.platform === "darwin" ? { titleBarStyle: "hidden" as const } : { frame: false }),
    // The default theme's --kv-color-bg, shown until the chrome reports what it painted.
    backgroundColor: "#191724",
    icon: iconPath,
    webPreferences: { preload },
  });

  const { events: chromeEvents, send: chrome } = chromeLink();

  if (process.platform === "darwin") win.setWindowButtonVisibility(false);

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
    isBookmarked: (url) => mainStore().get().library.bookmarked.has(url),
    connectPage,
    // Both halves of "the URL changed". Styles key on the URL, not the
    // document, so a SPA changing routes is restyled with nothing reloading.
    navigated: (contents, url) => {
      userStyles.applyTo(contents, url);
      // The title at commit time is still the previous page's; the URL is
      // the truthful answer until the real title lands.
      library(LibraryMsg.cases.VisitCommitted.make({ url, at: Date.now() }));
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
    reopen: () => mainStore().dispatch(TabsMsg.cases.TabReopenRequested.make({})),
    step: (offset) => mainStore().dispatch(TabsMsg.cases.TabStepped.make({ offset })),
    select: (position) => mainStore().dispatch(TabsMsg.cases.TabSelected.make({ position })),
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
        project(
          (model) => ({
            platform: process.platform,
            maximized: model.window.maximized,
            fullscreen: model.tabs.windowFullscreen,
          }),
          (state) => chrome.windowState(state),
        ),
        ...(process.platform === "darwin"
          ? [
              project(
                (model) => trafficLights(model.window, model.tabs.windowFullscreen),
                (lights) => {
                  if (win.isDestroyed()) return;
                  win.setWindowButtonVisibility(lights.visible);

                  if (lights.position !== null) win.setWindowButtonPosition(lights.position);
                },
              ),
            ]
          : []),
      ],
      { concurrency: "unbounded", discard: true },
    ),
  );

  // The strip's star follows the bookmark set.
  const bookmarksFiber = runtime.runFork(
    project(
      (model) => model.library.bookmarked,
      () => tabViews.refresh(),
    ),
  );

  // Every write, not the URL set: deleting one of two rows for a URL leaves
  // the set as it was, but an open panel still has a row to drop.
  const bookmarkRowsFiber = runtime.runFork(
    Effect.flatMap(Effect.service(BookmarksRepo), (repo) =>
      Stream.runForEach(repo.changes, () => Effect.sync(() => chrome.bookmarksChanged())),
    ),
  );

  const releaseBookmarks = () => {
    bookmarksFiber.interruptUnsafe();
    bookmarkRowsFiber.interruptUnsafe();
  };

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
    () => themeCss(currentConfig()),
    () => {
      runtime.runFork(
        nextTurn.pipe(
          Effect.andThen(
            Effect.sync(() => {
              if (!win.isDestroyed()) win.webContents.focus();
            }),
          ),
        ),
      );
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
    tabViews.applyCss(themeCss(config));
    mainStore().dispatch(
      TabsMsg.cases.TabsConfigured.make({
        homepage: config.settings.homepage,
        focusPage: config.settings.tabFocusPage,
      }),
    );
  };

  configureTabs(currentConfig());

  const applyToWindow = (next: UserConfig): void => {
    configureTabs(next);
    chrome.config(next);
    completion.applyCss();
    palette.applyCss();
    setupView.applyCss();
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
    () => currentConfig().settings.searchUrl,
    {
      isOn: () => isPalette(currentConfig().settings.layout),
      summon: (text) => mainStore().dispatch(PaletteMsg.cases.PaletteSummoned.make({ text })),
    },
    {
      choose: (name) => mainStore().dispatch(ConfigMsg.cases.RecipeChosen.make({ name })),
    },
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

  const dismissPalette = (handBack: boolean): void =>
    mainStore().dispatch(PaletteMsg.cases.PaletteDismissed.make({ handBack }));

  const palette = new PaletteOverlay(
    () => {
      const view = new WebContentsView({ webPreferences: { preload: palettePreload } });
      const contents = view.webContents;
      view.setBackgroundColor("#00000000");
      views.addOverlay(view);

      const loaded = process.env.VITE_DEV_SERVER_URL
        ? contents.loadURL(new URL("palette.html", process.env.VITE_DEV_SERVER_URL).href)
        : contents.loadFile(paletteHtml);

      void loaded.catch(() => {
        if (!contents.isDestroyed()) contents.close();
      });

      // The palette types like the chrome does, so the mode machine sees its keys the same way.
      interceptKeys(contents, "chrome", onKey);
      // A click on the page or the chrome leaves the palette. Losing the whole
      // window is not a reason to pull focus onto the page.
      contents.on("blur", () => dismissPalette(win.isFocused()));

      return {
        host: view,
        link: servePalette(contents),
        release: () => {
          views.remove(view);

          if (!contents.isDestroyed()) contents.close();
        },
      };
    },
    () => themeCss(currentConfig()),
  );

  const paletteFiber = runtime.runFork(
    project(
      (model) => ({
        ...model.palette,
        bounds: layout(model.tabs).bounds,
        size: model.config.current?.settings.layout.omnibox.size,
      }),
      (view) => palette.render(view),
    ),
  );

  const setupView = mountSetupView({ views, onKey, css: () => themeCss(currentConfig()) });

  /** The palette's own surface: it can ask for a destination, never drive tabs directly. */
  function servePalette(contents: Electron.WebContents): PaletteSenders {
    const link = paletteLink();

    serve(
      runtime,
      contents,
      RpcServer.make(PaletteRpcs).pipe(
        Effect.provide(
          PaletteRpcs.toLayer({
            Subscribe: () => link.events.stream,
            Suggestions: ({ query }) => omniboxSuggestions(query, strip(mainStore().get().tabs)),
            CommandCompletions: ({ line }) => Effect.sync(() => completeCommand(line)),
            Dispatch: (message) =>
              Effect.sync(() =>
                PaletteIntent.match(message, {
                  Submitted: ({ text }) => {
                    dismissPalette(true);

                    if (text.trim() === "") return;
                    tabs.active?.navigate(resolveUrl(text, currentConfig().settings.searchUrl));
                  },
                  SuggestionPicked: ({ candidate }) => {
                    dismissPalette(true);
                    acceptOmnibox(candidate, {
                      navigate: (url) => tabs.active?.navigate(url),
                      activate: (id) =>
                        mainStore().dispatch(TabsMsg.cases.TabActivated.make({ id })),
                    });
                  },
                  // Closed first, so a command that opens something else gets the focus.
                  CommandEntered: ({ line }) => {
                    dismissPalette(false);
                    runCommand(line);
                    vim.dispatch(VimMsgs.cases.ModeRequested.make({ mode: modeAfter(line) }));
                  },
                  Dismissed: () => dismissPalette(true),
                }),
              ),
          }),
        ),
      ),
    );

    return link.send;
  }

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
        library(LibraryMsg.cases.SessionEmptied.make({}));
      }

      return;
    }

    const bounds = win.getBounds();
    library(
      LibraryMsg.cases.SessionClosed.make({
        state: {
          tabs: snapshot.urls,
          activeIndex: snapshot.activeIndex,
          width: bounds.width,
          height: bounds.height,
          x: bounds.x,
          y: bounds.y,
        },
        at: Date.now(),
      }),
    );
  });

  const maximizedChanged = (maximized: boolean) => () =>
    mainStore().dispatch(WindowMsg.cases.WindowMaximizedChanged.make({ maximized }));

  win.on("maximize", maximizedChanged(true));
  win.on("unmaximize", maximizedChanged(false));

  function pressWindowControl(control: WindowControl): void {
    if (control === "minimize") win.minimize();
    else if (control === "close") win.close();
    else if (win.isMaximized()) win.unmaximize();
    else win.maximize();
  }

  win.on("closed", () => {
    configFiber?.interruptUnsafe();
    tabManagers.delete(tabViews);
    tabsFiber.interruptUnsafe();
    completionFiber.interruptUnsafe();
    paletteFiber.interruptUnsafe();
  });

  // The window follows the config in force: now, and after every save.
  let configFiber: Fiber.Fiber<void, unknown> | undefined;

  win.webContents.once("did-finish-load", () => {
    configFiber = runtime.runFork(
      project(
        (model) => model.config.current,
        (config) => {
          if (config !== null) applyToWindow(config);
        },
      ),
    );

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
          // Same path as a fresh launch: one homepage tab.
          tabs.create();

          return;
        }

        // Main owns the tab restore: the URL list and bounds never need to
        // leave main.
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
          OmniboxSuggestions: ({ query }) =>
            omniboxSuggestions(query, strip(mainStore().get().tabs)),
          CommandCompletions: ({ line }) => Effect.sync(() => completeCommand(line)),
          BookmarkRows: ({ query }) => bookmarkRows(query),
          Dispatch: (message) =>
            Effect.sync(() =>
              ChromeIntent.match(message, {
                ContentRectMeasured: ({ rect, radius }) =>
                  mainStore().dispatch(TabsMsg.cases.ContentRectMeasured.make({ rect, radius })),
                ChromeBackgroundMeasured: ({ color }) => win.setBackgroundColor(color),
                WindowControlsMeasured: ({ rect }) =>
                  mainStore().dispatch(WindowMsg.cases.WindowControlsMeasured.make({ rect })),
                WindowControlPressed: ({ control }) => pressWindowControl(control),
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
                BookmarkRemoveRequested: ({ id }) =>
                  library(LibraryMsg.cases.BookmarkRemoveRequested.make({ id })),
                PromptAnswered: ({ id, allow }) =>
                  mainStore().dispatch(PromptsMsg.cases.PromptAnswered.make({ id, allow })),
                CommandEntered: ({ line }) => {
                  runCommand(line);
                  // A typed `:foo` ends in normal mode, or in the mode its
                  // command declares. Button-driven intents must not take
                  // this path, or a click would drop the mode out from under
                  // someone typing.
                  vim.dispatch(VimMsgs.cases.ModeRequested.make({ mode: modeAfter(line) }));
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
    palette.release();
    setupView.release();
  });
}
