import { expect, test } from "vite-plus/test";
import type { ContextMenuParams } from "electron";
import type { ContextMenuItem } from "../shared/ipc";
import { buildContextMenuItems } from "./context-menu";

// Only the fields the builder reads; the rest of the params are Chromium's
// business and a cast keeps the fixture honest about that.
// SAFETY: partial fixture — the builder under test only reads these fields.
const EDIT_FLAGS = {
  canCut: false,
  canCopy: false,
  canPaste: false,
  canSelectAll: true,
} as ContextMenuParams["editFlags"];

/** A plain right-click on unremarkable page content. */
// SAFETY: partial fixture — only the fields the builder reads are set.
const base = {
  x: 0,
  y: 0,
  linkURL: "",
  srcURL: "",
  mediaType: "none",
  isEditable: false,
  selectionText: "",
  editFlags: EDIT_FLAGS,
} as ContextMenuParams;

const ids = (items: ContextMenuItem[]): string[] =>
  items.map((entry) => (entry.type === "separator" ? "separator" : entry.id));

const enabled = (items: ContextMenuItem[], id: string): boolean | undefined => {
  const entry = items.find((candidate) => candidate.type === "item" && candidate.id === id);
  return entry !== undefined && entry.type === "item" ? entry.enabled : undefined;
};

const nav = { canGoBack: true, canGoForward: false };

test("a plain page gets navigation and inspect only", () => {
  const items = buildContextMenuItems(base, nav);
  expect(ids(items)).toEqual(["nav.back", "nav.forward", "nav.reload", "separator", "inspect"]);
});

test("nav items follow history state", () => {
  const items = buildContextMenuItems(base, nav);
  expect(enabled(items, "nav.back")).toBe(true);
  expect(enabled(items, "nav.forward")).toBe(false);
  expect(enabled(items, "nav.reload")).toBe(true);
});

test("a link gets open-in-new-tab and copy-link before navigation", () => {
  const items = buildContextMenuItems({ ...base, linkURL: "https://example.com/a" }, nav);
  expect(ids(items)).toEqual([
    "link.open-in-new-tab",
    "link.copy",
    "separator",
    "nav.back",
    "nav.forward",
    "nav.reload",
    "separator",
    "inspect",
  ]);
});

test("an image gets copy-image-address", () => {
  const items = buildContextMenuItems(
    { ...base, mediaType: "image", srcURL: "https://example.com/a.png" },
    nav,
  );
  expect(ids(items)).toContain("image.copy");
});

test("a linked image gets both link and image items in one section", () => {
  const items = buildContextMenuItems(
    {
      ...base,
      linkURL: "https://example.com/a",
      mediaType: "image",
      srcURL: "https://example.com/a.png",
    },
    nav,
  );
  expect(ids(items).slice(0, 3)).toEqual(["link.open-in-new-tab", "link.copy", "image.copy"]);
});

test("a selection gets a single copy item", () => {
  const items = buildContextMenuItems({ ...base, selectionText: "hello" }, nav);
  expect(ids(items)).toContain("selection.copy");
  expect(ids(items)).not.toContain("link.copy");
});

test("whitespace-only selection is no selection", () => {
  const items = buildContextMenuItems({ ...base, selectionText: "  " }, nav);
  expect(ids(items)).not.toContain("selection.copy");
});

test("an editable field gets editing actions instead of navigation", () => {
  const items = buildContextMenuItems(
    {
      ...base,
      isEditable: true,
      editFlags: { ...EDIT_FLAGS, canCut: true, canCopy: true, canPaste: true },
    },
    nav,
  );
  expect(ids(items)).toEqual([
    "edit.cut",
    "edit.copy",
    "edit.paste",
    "edit.select-all",
    "separator",
    "inspect",
  ]);
});

test("edit items follow the edit flags", () => {
  const items = buildContextMenuItems({ ...base, isEditable: true }, nav);
  expect(enabled(items, "edit.cut")).toBe(false);
  expect(enabled(items, "edit.paste")).toBe(false);
  expect(enabled(items, "edit.select-all")).toBe(true);
});

test("separators only ever sit between sections", () => {
  for (const params of [base, { ...base, isEditable: true }]) {
    const list = ids(buildContextMenuItems(params, nav));
    expect(list[0]).not.toBe("separator");
    expect(list[list.length - 1]).not.toBe("separator");
    for (let index = 1; index < list.length; index += 1) {
      if (list[index] === "separator") expect(list[index - 1]).not.toBe("separator");
    }
  }
});
