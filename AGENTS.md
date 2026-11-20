# Kvist — agent notes

A TUI-styled, Chromium-backed browser: Electron + Svelte 5 + TypeScript, carrying
the [textfox](https://github.com/adriankarlen/textfox) aesthetic and a vim-modal
interaction model.

## Environment

Node version is pinned in `.node-version`; `pnpm` is the package manager.

## Commands

The toolchain is [Vite+](https://npmjs.com/package/vite-plus); `vp` is the entry
point for everything. The `pnpm` scripts in `package.json` map directly to `vp`
subcommands. Two footguns:

- Import test helpers from `vite-plus/test`, not `vitest` — Vite+ bundles
  vitest rather than exposing it as a resolvable dependency.
- `defineConfig` must be imported from `vite-plus`, not `vite`, because the
  `fmt` and `lint` config lives there.

## Architecture

**Read [`docs/architecture.md`](docs/architecture.md) first.** It is the
rulebook: Effect services and layers, an Elm-style loop (Model, Msg, pure
`update`, Cmds, view) in every process, scopes for lifetimes, and Schema at
every boundary. The move onto it is tracked in
[`plans/effect-migration.md`](plans/effect-migration.md); code not yet
migrated still has the older shape described below.

The shape of the project, with the _why_ living next to the code it
constrains.

- **Three preloads.** `src/preload/index.ts` exposes `window.kvist`;
  `src/preload/page.ts` runs in every tab and exposes nothing;
  `src/preload/overlay.ts` exposes `window.kvistOverlay`, a list renderer's
  worth of API and no more — the chrome's bridge would let a dropdown
  navigate tabs. Each needs its own entry in `vite.config.ts` — the plugin
  bundles a preload to one file.
- **Tabs are `WebContentsView`s** owned by `TabManager` and hidden with
  `setVisible(false)` rather than detached. `TabManager.ownsTab` is the
  sender check for every tab→main channel (hints, context menu, page-editable).
- **`ViewStack` owns z-order.** Tab views and chrome overlays are siblings
  composited in the order they were added, so a tab opened while a dropdown
  is up would paint straight over it. Electron re-orders a child to the top
  when it is added again, which is what every `addPage` ends with. Raising
  the overlay from each site that mounts a tab would be one forgotten call
  away from the bug it fixes, so the invariant lives in one place.
- **Renderer owns layout.** The renderer measures its own content area with a
  `ResizeObserver` and pushes a `Rect` over `kvist:content-rect`; main just
  applies it via `view.setBounds`. Tab orientation is a pure CSS concern.
- **IPC is Effect RPC over a `MessagePort` per surface**, full snapshots
  main → renderer and `dispatch(intent)` back. The port is the capability:
  see [IPC](docs/architecture.md#ipc).
- **Mode machine lives in main.** `before-input-event` is synchronous and
  per-webContents, so keys are intercepted on both the page and the chrome.
  Mode changes have two entry points — keys (intercepted) and `kvist:set-mode`
  (called by the chrome). Any chrome control that accepts typing must call
  `setMode("insert")` on focus, or normal mode eats every character.
- **Downloads are session-scoped.** A transfer outlives the tab it started
  in, so `Downloads` is owned by the app and `TabManager` only subscribes
  through `observe` / `observeTabDownload`.
- **Permissions are session-scoped too.** `Permissions` owns the handler
  pair on `session.defaultSession` (request _and_ check — they answer
  different APIs and default inconsistently). Deny by default, prompt in the
  chrome for camera/mic, geolocation, notifications, clipboard-read; answers
  are remembered per origin in memory until Phase 6 storage. A pending
  question captures normal mode as `prompt` mode (`y`/`n`), which is why
  `Vim.setPromptPending` exists.

## Resource lifetimes

See [Lifetimes](docs/architecture.md#lifetimes). Everything with a lifetime
past its call is acquired in a `Scope`, and scopes nest app → window → tab.

Nothing may cancel a quit. `will-quit` is cancellable, and Electron drops an
`app.quit()` that lands on the same tick as the `will-quit` that cancelled it
— so the "preventDefault, finish the work, re-arm the quit" shape leaves the
app alive in the dock with its teardown already run. The app scope closes on
`quit`, synchronously, and every quit-time finalizer is synchronous.

Ask two questions of every acquisition: how is it released when the resource
retires normally, and how is it released if the thing being watched
disappears first? `permissions.ts` once answered only the second, and every
resolved permission left a dead listener on a long-lived tab. A scope makes
both answers the same path.

## Persistence

SQLite through `effect/sql` and `@effect/sql-sqlite-node` (Node's built-in
`node:sqlite` driver; no native rebuilds). Rows and JSON columns are decoded
with `effect/Schema`.

- One `SqliteClient` for the app, closed with the app scope on `quit`, not
  `will-quit`: an app that keeps running with a closed connection throws
  out of every later query.
- Migrations are TypeScript modules in `src/main/db/migrations/`, run by
  the Effect `Migrator` at startup. To add a table, add the next numbered
  migration; never edit one that has shipped.
- Each table has a repository service (`HistoryRepo`, `BookmarksRepo`,
  `SessionRepo`, `ZoomRepo`) built from `SqlSchema` + a Schema row.
- `src/main/db/validation.ts` adapts a Schema failure to the `Problem`
  shape from `shared/config.ts`, so config-style `reportProblems` flows read
  validation errors from any boundary.

## Completion overlay

The omnibox dropdown is painted in a `WebContentsView` of its own
(`src/main/completion-overlay.ts`, rendered by `src/overlay/`). Rendering it
in the page — the context menu's answer to the same problem — does not work
here: the page rect starts _below_ the omnibox, so a list anchored to that
input could never touch it.

The chrome keeps the state. `createCompletion` and `handleCompletionKey` stay
in the renderer; the overlay renders rows and reports which one was clicked.
That split is what lets the command line reuse it (KVI-41) without either
caller's rules leaking into the other.

Sizing runs the opposite way to the content rect: the chrome reports the
anchor, the overlay reports how tall it rendered, and main puts the two
together in `completion-bounds.ts`. Main never learns row heights, so a
retheme that changes them needs no main-side change.

Both measurements travel unrounded, and that is load-bearing. A view's
bounds are whole device-independent pixels, but the omnibox is not — the
chrome measures its padding in `ch`, so the panel lands on fractions like
x=234.396. Rounding the view to the nearest whole pixel leaves its border up
to one device pixel from the panel's, and the two vertical lines visibly
fail to meet on one side only (whichever edge lost the coin flip). So the
view is the smallest whole-pixel rectangle _containing_ the true span, and
the list is placed at its exact fractional offset inside it, where CSS can
still address sub-pixels. `CompletionInset` carries that offset. The slack
is invisible because the overlay's document is transparent.

The slot is positioned absolutely rather than with margins: a margin would
collapse through the mount element, making an exact placement depend on
nothing above it ever gaining a border.

Two things that look like bugs and are not:

- **A hidden view never reports.** `setVisible(false)` stalls the rendering
  lifecycle, so no layout happens and no `ResizeObserver` fires — and a
  zero-width viewport measures wrong even when layout is forced. Revealing
  only after measuring therefore deadlocks. An unmeasured list is shown at
  every pixel it could use and shrinks once the real height arrives; the
  document is transparent, so the oversized rectangle shows nothing.
- **Rows are sent after the view is sized**, not before, for the same reason.

A clicked row travels as the candidate itself, never as an index into the
chrome's list. The click moves focus off the chrome, which blurs the omnibox,
which clears the list before the pick lands — an index would point into an
empty array. Main refocuses the chrome afterwards, or the keyboard is
stranded in the overlay.

There is one overlay and two inputs, and main relays a pick to the whole
chrome. `completion-overlay.ts` in the renderer routes it to whichever input
showed the list last. That owner survives `hide()`, because the blur that
hides the list lands before the pick does. An input that does not own the
overlay cannot hide it.

## In-page vim

Hints live in the preload, mode stays in main. Hint labels are inline-styled
rather than classed: the page's own stylesheet is hostile territory, and a
class is one `!important` away from being hidden.

## Context menu

Rendered in the page, not native. A native `Menu` was considered and rejected
because it cannot be themed, and themeability is the product.

## Ad blocking

`@ghostery/adblocker-electron` against `session.defaultSession`, not uBlock —
Electron 43's `chrome.webRequest` is incomplete, so the classic build dies
and uBlock Origin Lite's rulesets register but are never enforced.

Generic cosmetic filters are keyed on real domains, so a page served from a
bare IP gets none of them. Test cosmetic filtering against an actual site;
localhost will read as a false negative.

## Svelte tooling

The Svelte MCP server exposes official Svelte 5 / SvelteKit docs and a
code-aware autofixer; the `svelte-code-writer` and `svelte-core-bestpractices`
skills cover the same ground. Use them whenever a `.svelte` file or
`.svelte.ts`/`.svelte.js` module is being created, edited, or analyzed.

- `list-sections` first to find what applies, then `get-documentation` for
  those sections — don't fetch a kitchen-sink dump.
- `svelte-autofixer` after writing Svelte code. Keep iterating until it
  returns nothing.
- `playground-link` only after the user asks for one, and never for code
  already on disk.

This file's styling rules override anything the docs or autofixer suggest.
The `@layer` system, no-`<style>`-block, and no-`!important` rules are
load-bearing — see "Styling rules" below.

## Styling rules

These are load-bearing for the product, not preferences. Hackability is the
point: users retheme the chrome from `~/.config/kvist/config.css`.

- **Never use a Svelte `<style>` block.** Scoped styles compile to hashed
  selectors users cannot predict or outrank.
- **No Tailwind or utility classes.** Atomic classes leave nothing semantic to
  override.
- Plain `.css` files colocated with their component, imported from the
  component. Reset and tokens live in `src/shared/styles/` — the local pages
  and the context menu are themed from them too, so they are shared, not
  renderer-owned.
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

Three traps. `require` comes from the inspector's command-line API, which
only exists when the evaluate passes `includeCommandLineAPI: true`, and is
gone after an `await` even then — so grab the webContents synchronously and
only then start an async loop. And each inspector session must send all its
keys in **one** `Runtime.evaluate`; keys split across separate evaluates
silently fail to arrive. Capitals need `modifiers: ["shift"]`, or `G` arrives as `g` and leaves
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

## Extensions

No extension support for now: Electron implements too little of the
`chrome.*` API for extensions to be broadly viable (KVI-19's uBlock findings
are the evidence). The rest of that scope — KVI-18 (unpacked-extension
loading) and KVI-20 (Bitwarden) — is closed out rather than pursued, on
purpose: extensions deserve dedicated thought this project isn't giving them
right now, not a resumed backlog item. Revisit as a fresh initiative later.

## Gotchas

- oxlint's `no-unassigned-vars` does not understand Svelte's `bind:this`; use
  `$state<T>()` rather than adding a lint override.
- **A `$state` proxy cannot cross IPC.** Structured clone rejects it with
  "An object could not be cloned", thrown inside the effect that sends it —
  which kills that effect for the rest of the page's life, so the symptom is
  a feature that silently never runs again. Use `$state.raw` for anything
  replaced wholesale (`anchor.svelte.ts`, the overlay's own state) and
  `$state.snapshot` for anything read out of a deep one.
- **`contextBridge` properties are not writable.** Patching `window.kvist.foo`
  from a devtools console to trace calls fails silently and reads as "the
  code never ran". Instrument the receiving end instead.

## Comments

A comment is a liability: the code changes and the comment does not, so it
rots into something false next to something true. Before writing one, look
for a way to make the code state its own intent — a renamed variable, an
extracted function with a name that carries the reasoning, a type that makes
an invalid state unrepresentable. Reach for a comment only once that search
comes up empty.

When a comment is the right call, it earns its place by saying something the
code cannot: why this exists, why the obvious alternative was rejected, what
breaks if it is removed, what invariant a caller must not violate. It never
narrates what the code already says — that's the copy that goes stale first.
Write it to ISO 24495-1:2023 plain language: short sentences, common words,
active voice, one idea per sentence.

This is not a one-time filter. Re-examine every comment a change touches —
if the code around it moved, the comment's reason to exist may have moved
with it, or vanished.

The budget is enforced, not just advised: a prose comment carries at most 40
words, and consecutive `//` lines count as one. Directives, license notices,
and generated files are excluded — nothing else is, so JSDoc and SAFETY
justifications obey the same cap. When reasoning truly earns its length, it
moves to documentation beside the code it explains — not to discard it, but
so the length lives where it can still be checked against reality. Files
that already carried overruns are grandfathered in
`tools/oxlint/anti-slop/verbose-comment-baseline.ts`; that list only
shrinks — a file with no overruns left fails the lint until its entry is
pruned.

## Tracking

Work is tracked in Linear: team `KVI`, project "Kvist Browser", with the
plan's phases modelled as project milestones. Close issues as work lands, and
leave a comment when something non-obvious came up — those comments are the
main record of why things are the way they are.

Phases are not strictly sequential. Agreed order: 0 → 1 → 2 → 3 (chrome-level
vim only) → 4 (uBlock only) → 3 (in-page vim) → 3.5 → 5 → 6 → 7. Extensions
(unpacked-extension loading, Bitwarden) are parked, not just reordered: they
were the rest of what used to be phase 4, and got closed out rather than left
blocking, because extensions need dedicated thought this project isn't giving
them yet. Revisit as a fresh initiative later, not by resuming KVI-18/KVI-20
as-is; "the extension phase" is deliberately not part of the count anymore.

Out of scope unless revisited: history/bookmark sync, extension-store
integration, any GUI settings panel, and extensions generally (unpacked
loading, Bitwarden) per the parked milestone above.
