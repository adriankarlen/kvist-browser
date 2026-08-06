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

Tabs are one `WebContentsView` per tab, owned by `TabManager` and hidden with
`setVisible(false)` rather than being detached.

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

Chrome keys are gated on mode: normal drives vim, insert and command pass
everything through so the omnibox and command line can type — including their
own `Escape`, which they report back via `kvist:set-mode`. **Any chrome control
that accepts typing must therefore put vim into insert while it holds focus**,
or normal mode will eat every character. `Omnibox.svelte` does this on
focus/blur.

Mode has two entry points — keys and `kvist:set-mode` — but commands only have
keys. A mode indicator that moves is therefore no evidence that key
interception works.

`activate()` hands keyboard focus back to the page, since hiding the previously
focused view drops focus on the chrome. `[tabs] focus-page = false` in
`config.toml` turns that off for anyone who wants focus to stay put.

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

**CDP cannot test key bindings.** `Input.dispatchKeyEvent` injects below the
level `before-input-event` hooks into, so main never sees those keys. Cover the
modal logic with unit tests against `Vim` instead, drive the chrome-side paths
by calling `window.kvist.*` directly, and leave real keystrokes to manual
checks.

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
vim only) → 4 (uBlock only) → 3 (in-page vim) → 5 → 4 (Bitwarden) → 6 → 7.

Out of scope unless revisited: history/bookmark sync, extension-store
integration, any GUI settings panel.
