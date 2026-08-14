# Kvist — agent notes

A TUI-styled, Chromium-backed browser: Electron + Svelte 5 + TypeScript, carrying
the [textfox](https://github.com/adriankarlen/textfox) aesthetic and a vim-modal
interaction model.

## Environment

Requires Node >= 24.11 (`vite-plus`) and pnpm. Neither is on the default PATH —
fnm manages them, and the repo pins Node via `.node-version`:

```sh
eval "$(fnm env --use-on-cwd)"   # or `fnm use` inside the repo
```

## Commands

The toolchain is [Vite+](https://npmjs.com/package/vite-plus); `vp` is the entry
point for everything.

```sh
pnpm dev       # vite dev server + electron, with hot restart/reload
pnpm build
pnpm check     # format + lint + typecheck in one pass; --fix to autofix
pnpm test      # vitest, via vp
```

Import test helpers from `vite-plus/test`, not `vitest` — Vite+ bundles vitest
rather than exposing it as a resolvable dependency, so a bare `vitest` import
runs but fails typecheck.

Config for `fmt` and `lint` lives in `vite.config.ts`, so `defineConfig` must be
imported from `vite-plus`, not `vite`. oxfmt has no style options — double
quotes and semicolons are not a choice.

## Layout

```
src/main/       Electron main: window, tab manager, config loading, XDG paths
src/preload/    contextBridge only; exposes window.kvist
src/renderer/   Svelte chrome (tab strip, omnibox). Components in lib/
src/shared/     Types and channel names imported by all three
```

There are two preloads. `index.ts` is the chrome's bridge and exposes
`window.kvist`; `page.ts` runs in every tab and deliberately exposes nothing,
since a web page must never reach that API. Each needs its own entry in
`vite.config.ts` — the plugin bundles a preload to a single file, so one build
cannot serve several entries.

Tabs are one `WebContentsView` per tab, owned by `TabManager` and hidden with
`setVisible(false)` rather than being detached.

`window.open` and `target="_blank"` are denied and answered with a tab of our
own, so everything a page opens stays inside the tab model. Two hard limits
make it that shape, both verified against Electron 43:

- **`createWindow` cannot return a `WebContentsView`'s webContents.** It is the
  documented way to keep the opener relationship — `window.opener`, a live
  handle, `window.close()` — but Chromium hangs the whole process adopting one.
  Denying is why `window.open` returns null, and why a `target="_blank"` POST
  loses its `postBody`.
- **Never call back into Chromium from inside its own window creation or
  teardown.** Building the tab in the open handler deadlocks; so does
  unwinding one in `destroyed`. Both defer with `setImmediate`.

**A destroyed view is toxic — even reading `view.webContents` hangs.** A page
can close itself, and the tab is then left holding a dead view, so `#forget`
drops the tab without touching it. `close` is the only path that may touch a
view, because it runs while the view is still alive.

**The renderer owns layout.** Main does not know the chrome's height — the
renderer measures its own content area and pushes the rectangle over IPC, and
main just applies it. Keep it that way; it is what makes tab orientation a pure
CSS concern.

IPC is fire-and-forget `send` one way, plus full-snapshot `kvist:state` and
`kvist:config` broadcasts back. Full snapshots, not diffs.

## Modes

The mode machine (`src/main/vim.ts`) lives in main, because `before-input-event`
must decide synchronously whether to swallow a key and cannot wait for an IPC
round trip.

`before-input-event` is per webContents, so keys must be intercepted on **both**
the page and the chrome — `TabManager.interceptKeys` covers every tab,
`interceptChromeKeys` covers the window. Hooking only the page leaves vim dead
whenever focus sits on the chrome, which on macOS is where it lands whenever the
window is activated.

Chrome keys are gated on mode: normal drives vim, while insert, command and
find pass everything through so the omnibox, command line and find prompt can
type — including their own `Escape`, which they report back via
`kvist:set-mode`. **Any chrome control
that accepts typing must therefore put vim into insert while it holds focus**,
or normal mode will eat every character. `Omnibox.svelte` does this on
focus/blur.

Mode has two entry points — keys and `kvist:set-mode` — but commands only have
keys. A mode indicator that moves is therefore no evidence that key
interception works.

`activate()` hands keyboard focus back to the page, since hiding the previously
focused view drops focus on the chrome. `[tabs] focus-page = false` in
`config.toml` turns that off for anyone who wants focus to stay put.

Pages report focus landing on a text field over `kvist:page-editable`, and vim
enters insert so normal mode stops eating the user's typing — the same courtesy
the omnibox gets. That report is asynchronous, unlike keys; it is safe only
because main caches it, leaving `handleKey` synchronous. Escape blurs the field
as well as leaving insert, otherwise focus stays in the input and the next key
goes straight back into it.

`TabManager` keeps the flag per tab, so mode follows the tab you land on rather
than the one you left, and ignores reports from a webContents that owns no tab
— which doubles as the sender check on that channel.

## In-page vim

Scrolling and hints need the DOM, so they live in `src/preload/page.ts` and
`src/preload/hints.ts` while the mode machine stays in main. Main names the
movement (`ScrollCommand`) rather than sending pixels, and hint matching runs
in the page so a keystroke never costs a round trip.

Hint mode swallows **every** key and forwards it, so nothing leaks to the page
mid-selection. The page decides when a label matched and reports back on
`kvist:hints-done`; `Vim.endHints` only unwinds hint mode, because hinting a
text field focuses it and puts us in insert _before_ that report arrives.
Returning to normal unconditionally would throw that focus away.

**Hint activation must be a real click from main.** Chromium marks history
entries created without user activation as skippable, and a scripted
`element.click()` has none — following a hint left `canGoBack()` false and the
back button dead. The page sends a point on `kvist:hints-click` and
`TabManager.clickActive` injects the click with `sendInputEvent`, which does
carry activation. The scripted click survives only as the fallback for when
the point does not hit the element.

Hint labels are inline-styled rather than classed: the page's own stylesheet is
hostile territory, and a class is one `!important` away from being hidden.

## Find in page

`/` opens a prompt in the chrome, `n` and `N` cycle, and Escape in normal mode
clears the highlighting. Chromium owns the search, so main only drives
`findInPage` and forwards `found-in-page` counts to the chrome on
`kvist:find-result`; the chrome keeps no query of its own, since the matches
live on the tab and switching tabs has to change what is on screen.

Find is a mode, not a widget. Like `command`, it swallows nothing and lets the
chrome type — `Vim.#prompting` is the pair of them — and the bar outlives the
mode, because `n` needs somewhere to report to once the prompt is gone.

Two Electron 43 traps, both found the hard way:

- **`findInPage(text, { findNext: false })` never emits `found-in-page`**, even
  though `false` is the documented default. Passing `{ forward: true }` and
  leaving `findNext` out searches identically and does report. A new search is
  therefore spelled as the _absence_ of the option.
- **A find session survives navigation.** Chromium re-runs it against the new
  document and reports matches for a page the user never searched, so
  `did-navigate` has to call `stopFindInPage` rather than merely forgetting the
  query.

Testing this needs the window frontmost — find is one of the things Chromium
does not run while the window is occluded, so the whole feature reads as broken
from a background window.

## Context menu

Rendered in the page, not in the chrome and not native. A tab's
`WebContentsView` is a native layer painted over the chrome, so chrome HTML
can never overlap page content — the same reason hints live in the preload.
A native `Menu` was considered and rejected: it cannot be themed, and
themeability is the product.

Main builds the item list from the `context-menu` params (`context-menu.ts`
is pure and unit-tested), stashes the params for pick time, and ships the
styling with the payload: tokens.css + `src/preload/menu.css` + the user's
config.css, with `:root` rewritten to `:host` because the menu renders in a
shadow root where `:root` matches nothing. User CSS stays unlayered and
last, so a `--kv-menu-*` override in config.css wins exactly as it does in
the chrome.

Two traps the shadow root does not solve on its own:

- **Mousedown inside the menu is preventDefaulted.** Otherwise clicking Cut
  or Paste blurs the field before main runs the editing command, and
  clicking Copy collapses the selection it was meant to copy.
- **Dismissal needs both sides.** The preload hides on an outside mousedown
  (checked with `composedPath`, because shadow retargeting makes the
  listener see the host), and on scroll and resize, which would leave the
  menu pointing at the wrong thing. Main hides it on tab switch and forgets
  the stash on navigation and close — no hide is sent on navigation, because
  the menu died with its document.

Picks arrive on `kvist:context-menu-pick` with the same `ownsTab` sender
check as the hint channels; only the visible tab can be right-clicked, so
the stashed menu always belongs to the active tab.

## Extensions

There is no extension support, deliberately. It was built and then removed in
`767b55b`..`HEAD` — the loader worked, but Electron 43 implements too little
of the extension API for the two extensions worth having. uBlock Origin and
Bitwarden both die on a missing `chrome.webRequest` implementation, and
Bitwarden also needs `webNavigation`, `contextMenus`, `notifications` and
`sidePanel`, none of which exist. Details are on KVI-19 and KVI-20.

Go back to `git show 767b55b` before rebuilding this; the loader itself was
fine, and only ever needed `session.extensions.loadExtension` against
`session.defaultSession`.

## Ad blocking

`@ghostery/adblocker-electron`, wired up in `src/main/adblock.ts` against
`session.defaultSession`. Not uBlock: the classic build needs a
`chrome.webRequest` implementation Electron does not ship, and uBlock Origin
Lite's rulesets register but are never enforced. Same filter lists, different
engine.

**`session.webRequest` allows exactly one listener per event.** The blocker
claims `onBeforeRequest` and `onHeadersReceived`, so anything else in main
that wants them will silently displace it, or be displaced. Disabling works by
removing the listeners outright, for the same reason.

**The package must stay external in the main build.** It resolves its own
cosmetic-filtering preload with `require.resolve` at runtime; bundling moves
that call to `dist/main`, where pnpm's non-hoisted layout cannot see the
transitive dependency, and the app dies on boot. Marked external in
`vite.config.ts`. This will need revisiting for packaging, since
electron-builder currently ships `dist/**/*` only.

The engine is fetched on first run and cached under `userData`, which
`paths.ts` has already pointed at `XDG_DATA_HOME`. A failed fetch is logged
and skipped rather than thrown — a browser that starts without blocking beats
one that does not start.

Generic cosmetic filters are keyed on real domains, so a page served from a
bare IP gets none of them. Test cosmetic filtering against an actual site;
localhost will read as a false negative.

## Styling rules

These are load-bearing for the product, not preferences. Hackability is the
point: users retheme the chrome from `~/.config/kvist/config.css`.

- **Never use a Svelte `<style>` block.** Scoped styles compile to hashed
  selectors users cannot predict or outrank.
- **No Tailwind or utility classes.** Atomic classes leave nothing semantic to
  override.
- Plain `.css` files colocated with their component, imported from the
  component. Reset and tokens live in `src/renderer/styles/`.
- Everything Kvist ships goes inside `@layer kvist.reset | tokens | components`.
  User CSS is injected unlayered, which beats every layer regardless of
  specificity — so never rely on specificity to win, and never use
  `!important`.
- Classnames are `kv-` prefixed block/element (`.kv-tab__title`) with `is-`
  state classes (`.is-active`).
- Tokens are two-tier: a `--kv-color-*` palette, and component tokens
  (`--kv-tab-active-bg`) built from it. Add a component token when a value is
  something a user might plausibly want to change.

`src/renderer/styles/index.css` must stay the first import in `main.ts`; layer
order depends on it being emitted first.

## Testing UI changes

There is a real display. Launch detached, then drive the chrome over CDP —
asserting on the running app beats asserting on internals, and it survives the
terminal dying:

```sh
setsid ./node_modules/.bin/electron . --remote-debugging-port=9222 \
  > /tmp/kvist.log 2>&1 < /dev/null &
```

Then `http://127.0.0.1:9222/json/list` to find the chrome target (title
`Kvist`), connect to its `webSocketDebuggerUrl`, and use `Runtime.evaluate` to
click and read computed styles. `grim /tmp/shot.png` screenshots Wayland.

**CDP cannot test key bindings, but the main-process inspector can.**
`Input.dispatchKeyEvent` injects below the level `before-input-event` hooks
into, so main never sees those keys. Launch with `--inspect=9229` as well, and
drive `webContents.sendInputEvent` from the main process instead — that does
fire `before-input-event`, so the whole chain from keystroke to DOM is
testable:

```js
page.sendInputEvent({ type: "keyDown", keyCode: "j" });
page.sendInputEvent({ type: "char", keyCode: "j" });
page.sendInputEvent({ type: "keyUp", keyCode: "j" });
```

Two traps. `require` comes from the inspector's command-line API and is gone
after an `await`, so grab the webContents synchronously and only then start an
async loop. And each inspector session must send all its keys in **one**
`Runtime.evaluate`; keys split across separate evaluates silently fail to
arrive. Capitals need `modifiers: ["shift"]`, or `G` arrives as `g` and leaves
a pending `g` prefix that eats the next key.

**Nothing driven by the rendering lifecycle fires while the display is
blanked or the window is occluded.** `requestAnimationFrame` stops, and with it
`scroll` events — in the page's own world, not just the preload's. Check
`framesIn1s` with rAF before concluding that a scroll-driven handler is broken.
This is the same trap as the focus one below, one layer down.

**Focus tests need the window frontmost.** Chromium fires no `focusin` or
`focusout` while the window is in the background, so anything focus-driven
reads as "nothing happened" if you have since switched apps. Raise the window
first, and blur between assertions — focusing an element that already has
focus fires nothing either, which reads as a pass against stale state.

Outbound network is often blocked; serve a local test site instead of relying on
public URLs. Beware `pkill -f` with a pattern matching the repo path — it
matches its own shell command line.

## Gotchas

- **Preload must be emitted as `.cjs`.** `vite-plugin-electron` names it `.mjs`
  under `"type": "module"` but still emits CommonJS; Electron then parses it as
  ESM and the preload fails _silently_ — `window.kvist` is simply undefined with
  nothing in any log. Overridden in `vite.config.ts`.
- **`BrowserWindow`'s `resize` event reports stale bounds** on Wayland, and
  carries no bounds payload. Use `win.contentView.on("bounds-changed")`.
- **`~/.config/kvist` is the user's**, for hand-edited config only. Electron
  defaults `userData` there on Linux; `src/main/paths.ts` redirects profile
  state to `XDG_DATA_HOME`. Never write to the config dir.
- Config watching watches the _directory_, not the files — editors rename over
  files, which swaps the inode and kills a file watch.
- **`.kv-panel` must keep `overflow: visible`.** Its label is a pseudo-element
  positioned outside the box to straddle the top border, so any other overflow
  value clips the label away. A panel that needs to scroll has to scroll an
  inner element instead of itself.
- oxlint's `no-unassigned-vars` does not understand Svelte's `bind:this`; use
  `$state<T>()` rather than adding a lint override.
- Keep `@types/node` pinned to 24.x. Electron and electron-builder pull in
  different majors, and ambiguous resolution breaks `fs` typings.

## Tracking

Work is tracked in Linear: team `KVI`, project "Kvist Browser", with the plan's
phases modelled as **project milestones**. Close issues as work lands, and leave
a comment when something non-obvious came up — those comments are the main
record of why things are the way they are.

Phases are not strictly sequential. Agreed order: 0 → 1 → 2 → 3 (chrome-level
vim only) → 4 (uBlock only) → 3 (in-page vim) → 3.5 → 5 → 6 → 7, with 4
(Bitwarden) parked until Electron's extension API surface grows.

Out of scope unless revisited: history/bookmark sync, extension-store
integration, any GUI settings panel.
