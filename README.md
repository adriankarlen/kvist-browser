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

## Preview

<img width="2196" height="1375" alt="image" src="https://github.com/user-attachments/assets/8601e646-eb04-44da-ade2-13107d29e912" />

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
- **Per-site user styles**, in the spirit of Stylus: drop UserCSS-format
  `.css` files into `~/.config/kvist/styles/`, live-reloaded on save, and
  open every file that applies to the current page with `:style`. See
  [User styles](#user-styles).
- Single `WebContentsView` per tab, hidden rather than destroyed on switch.

## Roadmap

Roughly what's next, in no particular order and with no promised timeline:

- In-page navigation, the start of in-page vim.
- Per-site blocking toggles, and user filter lists.
- Bookmarks.
- A toggleable UI, so the omnibox, tab bar, and other chrome pieces can be
  hidden on demand.
- A custom sidebar.
- Default new tab page.

Extensions (a real distribution model, Bitwarden and other extension
integrations) are deliberately not on this list. They need dedicated design
thought this project isn't giving them yet, so that work is parked rather
than queued.

## Install & run

There are no published releases yet, to use it, build from source.

Node and pnpm. Pinned via `.node-version`.

```sh
pnpm install
```

```sh
pnpm dev       # vite dev server + electron, with hot restart/reload
pnpm build     # production build
pnpm package   # build + electron-builder, platform installers under release/
pnpm check     # format + lint + typecheck in one pass (--fix to autofix)
pnpm test      # vitest, via vp
```

The toolchain is [Vite+](https://npmjs.com/package/vite-plus). `vp` is the
entry point behind every script above.

## Keybindings

Kvist has two key sets. Vim mode is the default and is described first.
Set `[input] mode = "standard"` for the shortcuts every other browser uses;
see [Standard mode](#standard-mode).

Kvist has six modes: **normal** (default, keys are commands), **insert**
(typing goes to a focused field or the omnibox), **command** (a `:` line at
the bottom that runs a command on submit), **hint** (labels are shown on the
page and typing one follows it), **find** (a `/` line that searches the
page as you type), and **prompt** (a permission question is waiting for an
answer).

Escape always returns to normal mode and blurs whatever had focus, except in
prompt mode, where it denies the permission question instead.

### Normal mode

| Key  | Action                              |
| ---- | ----------------------------------- |
| `t`  | New tab                             |
| `x`  | Close active tab                    |
| `X`  | Reopen the last closed tab          |
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
| `B`  | Bookmark the page, or remove it     |
| `gb` | Open the bookmarks panel            |
| `:`  | Command mode                        |

### Commands

| Command                   | Action                                       |
| ------------------------- | -------------------------------------------- |
| `:o <url>`, `:open <url>` | Navigate the active tab                      |
| `:tabnew <url>`           | Open a new tab; homepage if no URL is given  |
| `:r`, `:reload`           | Reload the active tab                        |
| `:q`, `:quit`             | Close the active tab                         |
| `:undo`                   | Reopen the last closed tab                   |
| `:tab.select <n\|last>`   | Go to tab `n`, or the last tab               |
| `:downloads`              | Keep the downloads panel open, or let it go  |
| `:bookmark`               | Bookmark the page, or remove its bookmarks   |
| `:bookmarks`              | Open the bookmarks panel                     |
| `:downloads.clear`        | Forget the downloads that have finished      |
| `:downloads.cancel [n]`   | Stop row `n`, or the newest live transfer    |
| `:recipe [name]`          | Switch recipe; no name shows the current one |
| `:qa`                     | Quit Kvist                                   |

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

### Prompt mode

When a page asks for the camera, the microphone, your location,
notifications or clipboard access, a question line appears and normal mode
becomes prompt mode: `y` allows, `n` and Escape deny, and nothing else
reaches the page until the question is answered. The answer is remembered
for the origin until the browser restarts — a denial included, so a refused
site cannot re-ask on every click. The camera and the microphone are
remembered separately, even though a page asking for both at once gets a
single allow-or-deny answer covering that request.

A question that arrives while you are typing waits: insert, command and find
keep their keys, and the prompt takes over on the way back through normal.
Everything not listed above is denied without asking, and fullscreen,
pointer lock and sanitized clipboard writes are granted without asking, as
in any other browser.

### Standard mode

With `[input] mode = "standard"`, there are no modes to learn. Every plain
key goes to the page, hints are off, and the mode badge is gone. A
permission question shows Allow and Deny buttons and does not take the
keyboard. Shortcuts work wherever focus is, even while typing in the
omnibox.

`Mod` is Cmd on macOS and Ctrl elsewhere.

| Keys                          | Action                           |
| ----------------------------- | -------------------------------- |
| `Mod+L`                       | Focus the omnibox                |
| `Mod+T`                       | New tab                          |
| `Mod+W`                       | Close active tab                 |
| `Mod+Shift+T`                 | Reopen the last closed tab       |
| `Ctrl+Tab` / `Ctrl+Shift+Tab` | Next / previous tab              |
| `Mod+1` … `Mod+8`             | Go to tab 1 … 8                  |
| `Mod+9`                       | Go to the last tab               |
| `Mod+[` / `Mod+]`             | Back / forward                   |
| `Alt+Left` / `Alt+Right`      | Back / forward (not on macOS)    |
| `Mod+R`, `F5`                 | Reload                           |
| `Mod+F`                       | Find in page                     |
| `Mod+G` / `Mod+Shift+G`       | Next / previous match            |
| `Mod+=` / `Mod+-` / `Mod+0`   | Zoom in / out / reset            |
| `Mod+D`                       | Bookmark the page, or remove it  |
| `Mod+Shift+O`                 | Open the bookmarks panel         |
| `Mod+J`                       | Show or hide the downloads panel |
| `Mod+Shift+P`                 | Command line                     |
| `Mod+Alt+I`, `F12`            | DevTools                         |
| `Mod+Q`                       | Quit Kvist                       |

Copy, paste, undo and select all work as in any other app.

Both key sets and commands are early and intentionally minimal. See
`src/main/features/vim/keybinds.ts` and `src/main/commands.ts` if you want
to add your own.

## Configuration

Kvist reads from `~/.config/kvist/` (or `$XDG_CONFIG_HOME/kvist/`); it's
yours to hand-edit. Kvist writes one thing there: `:recipe` sets the `recipe`
line in `config.toml` and leaves the rest of the file as it was. Changes are
picked up live, no restart needed.

### `config.toml`

```toml
recipe = "tui" # the look and defaults to start from. See "Recipes" below.
homepage = "https://example.com"
adblock = true # ad and tracker blocking

# Where an omnibox input that is not a URL goes. {q} is replaced with the
# encoded query; without it Kvist searches DuckDuckGo.
# search = "https://duckduckgo.com/?q={q}"

[tabs]
focus-page = true # hand keyboard focus to the page after a tab switch

# "vim" (the default) or "standard" for the usual browser shortcuts.
[input]
mode = "vim"

# Where each part of the chrome sits. See "Layout" below.
[layout.tabs]
region = "left" # vertical tabs; "top" is the default

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

### Layout

Each part of the chrome has a `[layout.<element>]` table:

```toml
[layout.tabs]
region = "left" # top, bottom, left or right
order = 0 # sorts the elements inside one region
size = "30ch" # width at the left or right, height at the top or bottom
visible = true
autohide = false # tabs only: tuck into a thin edge until needed
```

Left and right run the full height of the window. Top and bottom sit above
and below the page, between them. Leave a field out to keep its default.
An element you move keeps its default order, so you rarely need `order`.
Changes apply as soon as you save the file.

| Element      | Default | Can go        | `visible = false` means                           |
| ------------ | ------- | ------------- | ------------------------------------------------- |
| `tabs`       | top     | any edge      | no tab strip                                      |
| `omnibox`    | top     | top, floating | shown only while you use it (`o`)                 |
| `bookmarks`  | bottom  | any edge      | no change: it only shows while open (`gb`)        |
| `downloads`  | bottom  | any edge      | no popup while downloading; `:downloads` shows it |
| `status`     | bottom  | any edge      | command line, prompts and errors only             |
| `find`       | bottom  | any edge      | shown while you type; `n` and `N` still work      |
| `completion` | overlay | overlay       | no completion lists                               |

`status` is the row that the command line, prompts and messages share.
Hidden, it drops info messages but still shows errors. The tab strip, and
every panel and line, runs vertically at the left or right and horizontally
at the top or bottom. `tabs.orientation` is gone: use `[layout.tabs] region`
instead.

#### Command palette

```toml
[layout.omnibox]
region = "floating"
size = "100ch" # optional: the palette's width
```

A floating omnibox is a command palette, like Arc's. There is no bar. `o`
opens a box over the page with the current URL selected. Type a URL, a
search, or part of an open tab's title, bookmark or history entry, then press
Enter. `:` opens the same box with a colon, and a leading colon turns it into
the command line, with command completion. Escape, or a click anywhere
outside the box, closes it.

While the palette is closed, an idle status line shows the mode and the URL.
Style the palette with the `--kv-palette-*` tokens. `[layout.completion]
visible = false` does not hide the palette's rows, because the rows are the
palette.

With `autohide = true`, the tab strip shrinks to a thin edge. Hover over the
edge to bring it back. It also shows for a moment when you open, close or
switch tabs. The page resizes to make room. `--kv-tabstrip-edge-size` and
`--kv-tabstrip-edge-bg` style the edge.

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

### Bookmarks

`B` bookmarks the page, and pressing it again removes every bookmark the page
has. `gb` or `:bookmarks` opens a `bookmarks` panel, newest first, with the
keyboard in its filter. Typing narrows the list by title or URL.

| Key                   | Action                         |
| --------------------- | ------------------------------ |
| Down, Tab, Ctrl-n     | Next row                       |
| Up, Shift-Tab, Ctrl-p | Previous row                   |
| Enter                 | Open the row in the active tab |
| Shift-Delete          | Delete the row                 |
| Escape                | Close the panel                |

A click opens a row too, and each row's `x` button deletes it. Opening a
bookmark closes the panel and hands the keyboard back to the page.

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

Everything Kvist ships lives inside `@layer kvist.reset | tokens | recipe |
components`. Your `config.css` is injected unlayered, and unlayered styles
always beat layered ones in CSS regardless of selector specificity. So any
rule you write there overrides Kvist's own styling, without needing to fight
it on specificity or reach for `!important`. Kvist never writes to
`config.css`: it is yours. A recipe's CSS goes in the `recipe` layer, under
your file (see [Recipes](#recipes)).

#### Theme tokens

The theme is a three-tier token system:

- **palette**: `--kv-color-*`, what colour things are. Swap these to reskin
  the whole browser.
- **metrics**: font, density, spacing, borders, radii, shadows and focus
  (`--kv-border-width`, `--kv-radius`, `--kv-shadow-raised`, and so on).
  Swap these to change the style: flat, bordered, hard shadows or soft ones.
- **parts**: per-component tokens built from the two tiers above
  (`--kv-tab-active-bg`, `--kv-panel-border`, and so on). Override one to
  change a single element without disturbing anything else.

Ships with [Rosé Pine](https://rosepinetheme.com/) in dark and Rosé Pine Dawn
in light. See [`src/shared/styles/tokens.css`](src/shared/styles/tokens.css)
for the full token list.

```css
:root {
  color-scheme: light; /* "dark" (the default), "light", or "light dark" to follow the OS */
  --kv-density: 0.85; /* scales control heights and panel padding */
  --kv-radius: 6px; /* panels and menus; --kv-radius-control for tabs and rows */
  --kv-border-width: 3px;
  --kv-shadow-raised: 4px 4px 0 var(--kv-color-shadow);
  --kv-color-accent: light-dark(#aa5500, #ff8800); /* light value, dark value */
}
```

`color-scheme` picks the light or dark value of every palette colour. It
changes Kvist's own UI only: websites keep following your OS setting. A plain
value applies in both schemes; use `light-dark(light, dark)` to set one per
scheme.

| Metric family   | Tokens                                                                                  |
| --------------- | --------------------------------------------------------------------------------------- |
| Font            | `--kv-font-family`, `--kv-font-size`, `--kv-font-weight`, `--kv-font-weight-strong`     |
| Density         | `--kv-density`, and `--kv-control-height` built from it                                 |
| Space           | `--kv-space`, `--kv-space-sm`, `--kv-gap`, `--kv-chrome-inset`                          |
| Border          | `--kv-border-width`, `--kv-border-style`, `--kv-border-color`, `--kv-separator-width`   |
| Radius          | `--kv-radius` (panels, menus), `--kv-radius-control` (tabs, rows, badges, bars)         |
| Shadow          | `--kv-shadow-raised`, `--kv-shadow-pressed`, `--kv-shadow-inset`, `--kv-shadow-overlay` |
| Focus and state | `--kv-focus-outline`, `--kv-disabled-opacity`                                           |

Shadows next to the page only show inside `--kv-chrome-inset`, because the
page is drawn above the chrome. The completion list does not show a shadow
yet.

#### Renamed tokens

The palette now names roles instead of Rosé Pine colours. The old names are
gone, so update a `config.css` that sets them:

| Old                                                     | New                                                         |
| ------------------------------------------------------- | ----------------------------------------------------------- |
| `--kv-color-base`                                       | `--kv-color-bg` (text on an accent: `--kv-color-on-accent`) |
| `--kv-color-surface`                                    | `--kv-color-bg-raised`                                      |
| `--kv-color-overlay`                                    | `--kv-color-bg-selected` (borders: `--kv-color-border`)     |
| `--kv-color-highlight-med`                              | `--kv-color-bg-track`                                       |
| `--kv-color-highlight-low`, `--kv-color-highlight-high` | removed                                                     |
| `--kv-color-text`                                       | `--kv-color-fg`                                             |
| `--kv-color-subtle`                                     | `--kv-color-fg-dim`                                         |
| `--kv-color-muted`                                      | `--kv-color-fg-faint`                                       |
| `--kv-permission-*`                                     | `--kv-prompt-*`                                             |

`--kv-panel-border`, `--kv-menu-border` and `--kv-completion-border` are now
whole borders (`2px solid …`). Set the colour alone with
`--kv-panel-border-color`, `--kv-menu-border-color` or
`--kv-completion-border-color`.

### Recipes

A recipe is a starting point: a look, plus defaults for input and layout.
Pick one with `recipe = "<name>"` in `config.toml`, or switch live with
`:recipe <name>`. `tui` is built in and is the default.

A recipe is a pair of files in `~/.config/kvist/recipes/`. A user recipe
with the same name as a built-in one replaces it.

- `<name>.css`, required. It goes in `@layer kvist.recipe` and should only set
  tokens (see [Theme tokens](#theme-tokens)).
- `<name>.toml`, optional. It sets defaults for `[input]` and `[layout]`:

```toml
format = 1 # required
name = "Modern"
description = "Familiar shortcuts, tabs on top."

[input]
mode = "standard"

[layout.tabs]
region = "top"
```

Names use lowercase letters, digits and `-`. Your `config.toml` and
`config.css` sit on top of the recipe, so switching recipes never loses what
you set yourself. Editing the recipe in use restyles live.

### User styles

`config.css` themes the chrome; `~/.config/kvist/styles/` themes pages
themselves, Stylus-style. Drop any `*.css` file into that directory and it is
picked up live — no restart, same as `config.toml`.

A file may start with a UserCSS metadata comment to scope itself to specific
sites:

```css
/* ==UserStyle==
@name My GitHub tweaks
==/UserStyle== */
@-moz-document domain("github.com") {
  body {
    font-family: monospace;
  }
}
```

`domain()`, `url()`, `url-prefix()` and `regexp()` are all supported, each
`@-moz-document` block only applies where it matches, and a file with no
metadata block at all (or CSS outside any block) applies everywhere. Multiple
files, and multiple blocks within one file, all combine.

Only plain CSS is injected — there is no LESS/Stylus-lang preprocessing, on
purpose, the same reasoning as unlayered `config.css`: it works _because_
it's just CSS, with no build step between file and effect. A file that
declares `@preprocessor less`/`stylus`/`uso` is skipped with a log message
rather than injected uncompiled. Theme repos that ship `.user.less` (like
[rose-pine/userstyles](https://github.com/rose-pine/userstyles)) need
converting to plain CSS first; there is currently no bundled tool for that.

`:style` opens, for editing, every file in that directory whose rules apply
to the page you're currently on — handed to whatever your OS opens `.css`
files with.

## Layout

```
src/main/       Electron main: window, tab manager, vim mode machine, config loading, XDG paths
src/preload/    contextBridge only; exposes window.kvist to the chrome
src/renderer/   Svelte chrome (tab strip, omnibox, command line); components in lib/
src/overlay/    the completion list's own view, above the page
src/palette/    the command palette's own view, above the page
src/shared/     Types and IPC channel names imported by all of them
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
