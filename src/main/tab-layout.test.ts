import { expect, test } from "vite-plus/test";
import type { Rect, TabId } from "../shared/schema/browser";
import { TabLayout, type Placeable } from "./tab-layout";

const CONTENT: Rect = { x: 18, y: 121, width: 982, height: 1138 };

/** A tab view that remembers where it was last put. */
function createTab() {
  const state: { visible: boolean | null; bounds: Rect | null } = { visible: null, bounds: null };

  const tab: Placeable = {
    setVisible: (visible) => void (state.visible = visible),
    setBounds: (rect) => void (state.bounds = rect),
  };

  return { tab, state };
}

function open(layout: TabLayout, tabs: Map<TabId, Placeable>, id: TabId) {
  const created = createTab();

  tabs.set(id, created.tab);
  layout.place(id, created.tab);

  return created.state;
}

test("a tab whose layout arrived before its view is shown when the view is made", () => {
  const layout = new TabLayout();
  const tabs = new Map<TabId, Placeable>();

  layout.reconcile({ visible: 1, bounds: CONTENT }, tabs);
  const first = open(layout, tabs, 1);

  expect(first).toEqual({ visible: true, bounds: CONTENT });
});

test("a tab whose view was made before its layout arrived is shown by the layout", () => {
  const layout = new TabLayout();
  const tabs = new Map<TabId, Placeable>();
  const first = open(layout, tabs, 1);

  expect(first.visible).toBe(false);

  layout.reconcile({ visible: 1, bounds: CONTENT }, tabs);

  expect(first).toEqual({ visible: true, bounds: CONTENT });
});

test("opening a second tab ahead of its view hides the first and shows the second", () => {
  const layout = new TabLayout();
  const tabs = new Map<TabId, Placeable>();
  const first = open(layout, tabs, 1);

  layout.reconcile({ visible: 1, bounds: CONTENT }, tabs);
  layout.reconcile({ visible: 2, bounds: CONTENT }, tabs);
  const second = open(layout, tabs, 2);

  expect(first.visible).toBe(false);
  expect(second).toEqual({ visible: true, bounds: CONTENT });
});

test("a tab opened in the background stays hidden", () => {
  const layout = new TabLayout();
  const tabs = new Map<TabId, Placeable>();

  open(layout, tabs, 1);
  layout.reconcile({ visible: 1, bounds: CONTENT }, tabs);
  const background = open(layout, tabs, 2);

  expect(background).toEqual({ visible: false, bounds: null });
});
