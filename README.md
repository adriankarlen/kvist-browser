# Kvist

A hackable, TUI-styled, vim-modal browser: Electron and Chromium underneath,
Svelte 5 chrome on top, retheme it from a plain-text config file.

Kvist borrows two things from other projects: the [textfox](https://github.com/adriankarlen/textfox)
look (minimal, no chrome chrome, theme from a config file) and a
[Vimium](https://vimium.github.io/)-style interaction model (normal, insert,
and command modes, keyboard-first navigation).

> [!IMPORTANT]
> **Status:** early and incomplete. This is a personal hobby project. Expect
> missing features, rough edges, and breaking changes to config format and
> keybindings.

## Why Electron

I wanted to build a hackable browser with a Chromium core. Electron is a
perfect tool for that: a real, fully compatible rendering engine, and a
chrome (window, tabs, omnibox) that's just TypeScript and Svelte, with Vite's
hot reload making it fast to iterate on.

It also keeps Chromium itself out of my hands. If I'd forked Chromium
directly, I'd be stuck patching and rebuilding it myself just to get a custom
chrome. Electron already does that work and hands me a clean API to build the
UI on instead, which is exactly what I wanted. Building my own version of
Electron would be pointless: I have no reason to believe I'd do a better job
than the people already maintaining it.

## Who this is for

People who want a browser they can reshape: rebind keys, rewrite the theme,
change how tabs behave, all from plain-text config instead of a settings UI.
It's not aimed at being the fastest or leanest browser around, which is also
why it's not a Rust project. Chromium's heavy resource usage is,
unfortunately, a necessary part of a project with this vision.

## Features

- **Vim modal editing** for the browser chrome. Normal mode drives
  navigation and tabs, insert mode hands the keyboard to a text field or the
  omnibox, command mode runs `:` commands. See [Keybindings](#keybindings).
- **Config-file driven, not a settings UI.** `~/.config/kvist/config.toml`
  for behavior, `~/.config/kvist/config.css` for the entire look. See
  [Configuration](#configuration).
- **Unlayered user CSS.** Your `config.css` always outranks what Kvist
  ships, with no specificity fights and no `!important`.
- **Vertical or horizontal tabs**, configurable via `config.toml`.
- **Unpacked Chrome extensions**, listed in `config.toml`. See
  [Extensions](#extensions).
- Single `WebContentsView` per tab, hidden rather than destroyed on switch.

## Roadmap

Roughly what's next, in no particular order and with no promised timeline:

- In-page navigation, the start of in-page vim.
- Ad blocking, by shipping uBlock rather than reimplementing it.
- Password manager integration, Bitwarden first.
- In-page styling, in the spirit of Stylus: user CSS for sites, not just
  the chrome.
- Bookmarks.
- A toggleable UI, so the omnibox, tab bar, and other chrome pieces can be
  hidden on demand.
- A custom sidebar.
- Default new tab page.

## Install & run

Requires Node 24.11 or newer, and pnpm. Node and pnpm are pinned via
`.node-version` and managed with [fnm](https://github.com/Schniz/fnm) rather
than living on the default `PATH`:

```sh
eval "$(fnm env --use-on-cwd)"   # or `fnm use` inside the repo
pnpm install
```

```sh
pnpm dev       # vite dev server + electron, with hot restart/reload
pnpm build     # production build
pnpm package   # build + electron-builder, unpacked app under release/
pnpm check     # format + lint + typecheck in one pass (--fix to autofix)
pnpm test      # vitest, via vp
```

The toolchain is [Vite+](https://npmjs.com/package/vite-plus). `vp` is the
entry point behind every script above.

## Keybindings

Kvist has three modes: **normal** (default, keys are commands), **insert**
(typing goes to a focused field or the omnibox), and **command** (a `:` line
at the bottom that runs a command on submit).

Escape always returns to normal mode and blurs whatever had focus.

### Normal mode

| Key  | Action                              |
| ---- | ----------------------------------- |
| `t`  | New tab                             |
| `x`  | Close active tab                    |
| `gt` | Next tab                            |
| `gT` | Previous tab                        |
| `H`  | Back                                |
| `L`  | Forward                             |
| `r`  | Reload                              |
| `i`  | Insert mode (focus the page)        |
| `o`  | Insert mode, focused on the omnibox |
| `:`  | Command mode                        |

### Commands

| Command                   | Action                                      |
| ------------------------- | ------------------------------------------- |
| `:o <url>`, `:open <url>` | Navigate the active tab                     |
| `:tabnew <url>`           | Open a new tab; homepage if no URL is given |
| `:r`, `:reload`           | Reload the active tab                       |
| `:q`, `:quit`             | Close the active tab                        |
| `:qa`                     | Quit Kvist                                  |

Both keybindings and commands are early and intentionally minimal. See
`src/main/vim.ts` and `runCommand` in `src/main/index.ts` if you want to add
your own.

## Configuration

Kvist reads from `~/.config/kvist/` (or `$XDG_CONFIG_HOME/kvist/`) and never
writes to it; it's yours to hand-edit. Changes are picked up live, no restart
needed.

### `config.toml`

```toml
homepage = "https://example.com"
extensions = ["extensions/ublock"]  # unpacked extension folders

[tabs]
orientation = "horizontal"  # or "vertical"
focus-page = true           # hand keyboard focus to the page after a tab switch
```

Anything missing or invalid falls back to the default. A broken file keeps
the last config that parsed instead of reverting to defaults out from under
you.

### Extensions

Kvist loads unpacked extensions only — no Chrome Web Store, no `.crx`. Point
`extensions` at the folders holding the unpacked builds; paths may be
absolute, start with `~`, or be relative to the config directory. A path that
fails to load is reported on stderr and skipped, so one broken entry does not
stop the rest.

Unlike the rest of the config, `extensions` is read once at startup. Chromium
loads extensions per session and does not persist them, and swapping them
under a live page leaves it half-instrumented, so changes here need a
restart.

### `config.css`

Everything Kvist ships lives inside `@layer kvist.reset | tokens |
components`. Your `config.css` is injected unlayered, and unlayered styles
always beat layered ones in CSS regardless of selector specificity. So any
rule you write there overrides Kvist's own styling, without needing to fight
it on specificity or reach for `!important`. The theme itself is a
three-tier token system:

- **palette**: `--kv-color-*`, what color things are. Swap these to reskin
  the whole browser.
- **metrics**: sizes and spacing (`--kv-space`, `--kv-tabstrip-height`, and
  so on). Swap these to restructure the chrome.
- **parts**: per-component tokens built from the two tiers above
  (`--kv-tab-fg`, `--kv-panel-border`, and so on). Override one to change a
  single element without disturbing anything else.

Ships with [Rosé Pine](https://rosepinetheme.com/) by default. See
`src/renderer/styles/tokens.css` for the full token list.

## Layout

```
src/main/       Electron main: window, tab manager, vim mode machine, config loading, XDG paths
src/preload/    contextBridge only; exposes window.kvist to the chrome
src/renderer/   Svelte chrome (tab strip, omnibox, command line); components in lib/
src/shared/     Types and IPC channel names imported by all three
```

There are two preloads. `index.ts` is the chrome's bridge and exposes
`window.kvist`. `page.ts` runs in every tab and deliberately exposes nothing,
since a web page must never reach that API.

See [`AGENTS.md`](./AGENTS.md) for the deeper architectural notes: process
model, the vim mode machine, IPC conventions, styling rules, and known
gotchas.

## A note on AI

I use AI tools as an assistant while building Kvist, and some of the code in
this repository was generated with their help. This isn't a vibe-coded
project: I review, understand, and take responsibility for everything that
gets merged. AI is a tool in the process, not the author of it.

## License

[MIT](./LICENSE)
