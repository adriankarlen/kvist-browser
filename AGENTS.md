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
- **IPC is full-snapshot**, not diffs: fire-and-forget `send` one way, plus
  `kvist:state` and `kvist:config` broadcasts back.
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

Nothing may cancel a quit. `will-quit` is cancellable, and Electron drops an
`app.quit()` that lands on the same tick as the `will-quit` that cancelled it
— so the "preventDefault, finish the work, re-arm the quit" shape leaves the
app alive in the dock with its teardown already run. Quit-time work is
synchronous (`ZoomStore.release`), and anything that must not be torn down
early hangs off `quit` rather than `will-quit` (the `Database`).

Anything acquired with a lifetime past the call that acquired it — a
listener, a timer, a filesystem watcher, a reservation, an IPC subscription
— returns or is paired with a `release`, not a fire-and-forget. Pair it at
the point of acquisition: `config.ts`'s `watchConfig` (watcher + debounce
timer), `downloads.ts`'s save-path reservation and its `updated`/`done`
listeners, and `permissions.ts`'s per-waiter `destroyed` listener all follow
this shape (PR #24, KVI-35).

A release reachable from only one exit path is half a fix. `permissions.ts`
first released a waiter's `destroyed` listener only when its tab died, not
when the question was answered normally — every resolved permission left one
dead listener on a long-lived tab. Ask both: how does this get released when
the resource retires normally, and how does it get released if the thing
being watched disappears first?

App/session-scoped acquisitions are the deliberate exception: `Downloads` and
`Permissions` attach their session handlers once, for the app's whole life,
with nothing narrower to release into — there is only one app. Everything
window-scoped follows `observe()` → disposer: `Messages`, `Downloads` and
`Permissions` all hand back an unsubscribe that `createWindow` calls on
`win.on("closed", ...)`, the same shape `watchConfig`'s release takes on
`will-quit`. A new module with a per-window subscription should return the
same shape rather than invent its own teardown.

## Persistence

The storage layer is `node:sqlite` behind Drizzle, with ArkType for runtime
validation of typed boundaries (KVI-24). The driver is Node's built-in
module, the ORM is pinned to the Drizzle 1.0 RC line, and the validator
is ArkType 2.x — the pins are intentional, so the eventual bump to
stable is a version change rather than a rewrite.

- The single `Database` instance is opened in `app.whenReady` and released
  on `quit`, not `will-quit`: `will-quit` is cancellable, and an app that
  keeps running with a closed connection throws out of every later query.
  Consumers take the same instance and call `db.drizzle`
  to query. One process, one connection; WAL mode is on, but readers and
  writers are not a concurrency story Kvist needs.
- Schemas live in `src/main/db/schema.ts` and migrations in
  `src/main/db/migrations/`. The workflow for adding a table: define it,
  re-export it from `schema.ts`, run `pnpm db:generate`, check the
  generated SQL in. The migrator is read-only at runtime; the schema is
  the source of truth.
- Runtime validation of typed boundaries goes through ArkType via
  `parse()` / `parseAll()` in `src/main/db/validation.ts`. The result
  adapts to the existing `Problem` interface from `shared/config.ts`, so
  config-style `reportProblems` flows read validation errors from any
  boundary. For DB rows, `drizzle-arktype`'s `createSelectSchema(table)`
  derives a validator from the Drizzle schema — types and runtime checks
  come from one source.

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
