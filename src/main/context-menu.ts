import type { ContextMenuParams } from "electron";
import type { ContextMenuItem } from "../shared/ipc";

/**
 * What a right-click gets, decided in main from the `context-menu` params.
 * Kept pure so the whole matrix (link, image, editable, selection, plain
 * page) is unit-testable without a browser.
 */

// Served to the tab alongside the items: the menu renders in a shadow root
// inside the page, where the chrome's stylesheets cannot reach — so the
// tokens, the menu's own styles and the user's overrides travel with it.
import menuCss from "../preload/menu.css?raw";
import tokensCss from "../renderer/styles/tokens.css?raw";

const item = (id: string, label: string, enabled = true): ContextMenuItem => ({
  type: "item",
  id,
  label,
  enabled,
});

const separator = (): ContextMenuItem => ({ type: "separator" });

export function buildContextMenuItems(
  params: ContextMenuParams,
  nav: { canGoBack: boolean; canGoForward: boolean },
): ContextMenuItem[] {
  const sections: ContextMenuItem[][] = [];

  if (params.isEditable) {
    // A text field gets editing actions only; navigation against a half-typed
    // form is a footgun, and browsers made that call long ago.
    const { canCut, canCopy, canPaste, canSelectAll } = params.editFlags;
    sections.push([
      item("edit.cut", "Cut", canCut),
      item("edit.copy", "Copy", canCopy),
      item("edit.paste", "Paste", canPaste),
      item("edit.select-all", "Select All", canSelectAll),
    ]);
  } else {
    const context: ContextMenuItem[] = [];
    if (params.linkURL !== "") {
      context.push(item("link.open-in-new-tab", "Open Link in New Tab"));
      context.push(item("link.copy", "Copy Link Address"));
    }
    if (params.mediaType === "image") {
      context.push(item("image.copy", "Copy Image Address"));
    }
    if (params.selectionText.trim() !== "") {
      context.push(item("selection.copy", "Copy"));
    }
    if (context.length > 0) sections.push(context);

    sections.push([
      item("nav.back", "Back", nav.canGoBack),
      item("nav.forward", "Forward", nav.canGoForward),
      item("nav.reload", "Reload"),
    ]);
  }

  sections.push([item("inspect", "Inspect Element")]);

  return sections
    .filter((section) => section.length > 0)
    .flatMap((section, index) => (index === 0 ? section : [separator(), ...section]));
}

/**
 * The menu lives in a shadow root, where `:root` matches nothing — the
 * shadow host is the root there, so token blocks (ours and the user's) are
 * retargeted at it. User CSS stays unlayered and last, which keeps the
 * chrome's override semantics: unlayered beats every layer.
 */
export function composeContextMenuCss(userCss: string): string {
  const host = (css: string): string => css.replaceAll(":root", ":host");
  return `${host(tokensCss)}\n${menuCss}\n${host(userCss)}`;
}
