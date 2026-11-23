import type { Component } from "svelte";
import type { ElementId, Region } from "../../../shared/layout";
import BookmarksPanel from "../bookmarks/BookmarksPanel.svelte";
import DownloadsPanel from "../../lib/DownloadsPanel.svelte";
import FindLine from "../../lib/FindLine.svelte";
import Omnibox from "../../lib/Omnibox.svelte";
import StatusLine from "../../lib/StatusLine.svelte";
import TabStrip from "../../lib/TabStrip.svelte";

/** Completion is painted in main's overlay view, never in a region of the chrome. */
export type SlotElement = Exclude<ElementId, "completion">;

/** Each element renders nothing while it has nothing to show; CSS hides the empty slot. */
export const ELEMENTS = {
  tabs: TabStrip,
  omnibox: Omnibox,
  bookmarks: BookmarksPanel,
  downloads: DownloadsPanel,
  status: StatusLine,
  find: FindLine,
} satisfies Record<SlotElement, Component<{ region: Region }>>;

export const isSlotElement = (id: ElementId): id is SlotElement => id !== "completion";
