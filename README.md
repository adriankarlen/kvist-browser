# Kvist

A hackable, TUI-styled, vim-modal browser: Electron and Chromium underneath,
Svelte 5 chrome on top, retheme it from a plain-text config file.

<img width="2046" height="1294" alt="image" src="https://github.com/user-attachments/assets/f2fed993-2874-40d9-9e20-c8d24fae2d51" />

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
- **Ad and tracker blocking** built in, using EasyList and uBlock Origin's
  own filter lists. See [Ad blocking](#ad-blocking).
- Single `WebContentsView` per tab, hidden rather than destroyed on switch.

## Roadmap

Roughly what's next, in no particular order and with no promised timeline:

- In-page navigation, the start of in-page vim.
- Per-site blocking toggles, and user filter lists.
- Password manager integration, Bitwarden first.
- In-page styling, in the spirit of Stylus: user CSS for sites, not just
  the chrome.
- Bookmarks.
- A toggleable UI, so the omnibox, tab bar, and other chrome pieces can be
  hidden on demand.
- A custom sidebar.
- Default new tab page.

## Install & run

There are no published releases yet, to use it, build from source.

Node and pnpm. Pinned via `.node-version`.

```sh
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

Kvist has five modes: **normal** (default, keys are commands), **insert**
(typing goes to a focused field or the omnibox), **command** (a `:` line at
the bottom that runs a command on submit), **hint** (labels are shown on the
page and typing one follows it), and **find** (a `/` line that searches the
page as you type).

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
| `j`  | Scroll down                         |
| `k`  | Scroll up                           |
| `d`  | Scroll half a screen down           |
| `u`  | Scroll half a screen up             |
| `gg` | Scroll to the top                   |
| `G`  | Scroll to the bottom                |
| `f`  | Hint mode: label every link         |
| `/`  | Find mode: search the page          |
| `n`  | Next match                          |
| `N`  | Previous match                      |
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
| `:downloads`              | Keep the downloads panel open, or let it go |
| `:downloads.clear`        | Forget the downloads that have finished     |
| `:downloads.cancel [n]`   | Stop row `n`, or the newest live transfer   |
| `:qa`                     | Quit Kvist                                  |

### Hint mode

`f` labels every link, button and field currently on screen. Type a label to
follow it; Escape gives up. Hinting a text field focuses it and drops you
straight into insert mode. Labels are drawn from the home row and are all the
same length, so a hint fires as soon as its last key lands.

Only what is visible gets a label — scroll first, hint second.

### Find mode

`/` opens a search line and jumps as you type; Enter keeps the matches and
closes the line, Escape gives up. `n` and `N` walk the matches afterward,
and Escape in normal mode clears the highlighting. The match count sits at
the end of the line, and the search belongs to the tab, so switching tabs
switches what is highlighted.

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
adblock = true              # ad and tracker blocking

[tabs]
orientation = "horizontal"  # or "vertical"
focus-page = true           # hand keyboard focus to the page after a tab switch

# Where downloads are saved. Without it Kvist follows $XDG_DOWNLOAD_DIR, and
# falls back to ~/Downloads.
[downloads]
# dir = "~/downloads"

# New tab page: quick links, and an optional clock timezone (IANA name or
# "UTC±n"). Without it the clock shows your system timezone.
[newtab]
# timezone = "Europe/Stockholm"

[[newtab.links]]
name = "github"
url = "https://github.com"

[[newtab.links]]
name = "youtube"
url = "https://youtube.com"
```

Anything missing or invalid falls back to the default. A broken file keeps
the last config that parsed instead of reverting to defaults out from under
you.

### Downloads

Downloads save without a dialog, to `$XDG_DOWNLOAD_DIR` or `~/Downloads`
unless `[downloads] dir` says otherwise, and an existing file is never
overwritten — a second copy lands as `name-1.ext`.

A `downloads` panel appears in the chrome while anything is transferring and
lingers a few seconds after the last one stops, so a fast download still
reports where it went. A transfer in flight shows a bar, percentage, received
of total, rate and ETA — a state colour tells them apart at a glance: warning
while moving, accent-alt once done, danger when cancelled or interrupted.
Each live row carries an `x` button that cancels it.

`:downloads` pins the panel open on top of that, to look over the finished and
interrupted ones, and unpins it again — it does not hide a panel that a live
transfer or the linger is holding up. `:downloads.clear` forgets the downloads
that have stopped, leaving anything still transferring in the list.
`:downloads.cancel` stops the newest transfer still moving, and
`:downloads.cancel 2` stops the second row as the panel shows it — the panel
displays no ids, so a row position is the only thing there is to point at.

### Ad blocking

On by default, and toggled live with `adblock` in `config.toml`. Kvist blocks
both network requests and page elements using the prebuilt EasyList and
uBlock Origin lists, via
[`@ghostery/adblocker`](https://github.com/ghostery/adblocker).

The filter engine is downloaded on first run and cached under
`$XDG_DATA_HOME/kvist/`, so later launches are offline and instant. If that
first download fails, Kvist starts without blocking rather than not starting.

This is deliberately not uBlock Origin itself. uBlock cannot run as an
extension on Electron: the classic build needs a `chrome.webRequest`
implementation Electron does not ship, and uBlock Origin Lite's rules load
but are never enforced. Same lists, different engine.

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
