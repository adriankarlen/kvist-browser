import { createBrowser, createContentRect } from "./browser.svelte";
import { createDownloads } from "./downloads.svelte";
import { createFind } from "./find.svelte";
import { createMessages } from "./messages.svelte";
import { createPermissions } from "./permissions.svelte";
import { createUi, injectUserCss } from "./settings.svelte";
import { createVim } from "./vim.svelte";

/**
 * The chrome's state, bound to the preload's bridge. The one place in the
 * renderer that reaches for `window.kvist`: every store takes the slice of it
 * that it uses, so a test hands each one a fake instead.
 */
const bridge = window.kvist;

export const browser = createBrowser(bridge);
export const contentRect = createContentRect(bridge);
export const downloads = createDownloads(bridge);
export const find = createFind(bridge);
export const messages = createMessages(bridge);
export const permissions = createPermissions(bridge);
export const ui = createUi(bridge, injectUserCss);
export const vim = createVim(bridge);
