import { expect, test } from "vite-plus/test";
import type { Rect, TabId } from "../shared/schema/browser";
import { TabLayout, type Placeable } from "./tab-layout";

const CONTENT: Rect = { x: 18, y: 121, width: 982, height: 1138 };

/** The content rect with square corners, as the TUI recipe frames it. */
const at = (visible: TabId | null, radius = 0) => ({ visible, bounds: CONTENT, radius });

/** A tab view that remembers where it was last put. */
function createTab() {
  const state: { visible: boolean | null; bounds: Rect | null; radii: number[] } = {
    visible: null,
    bounds: null,
    radii: [],
  };

  const tab: Placeable = {
    setVisible: (visible) => void (state.visible = visible),
    setBounds: (rect) => void (state.bounds = rect),
    setBorderRadius: (radius) => void state.radii.push(radius),
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

  layout.reconcile(at(1), tabs);
  const first = open(layout, tabs, 1);

  expect(first).toEqual({ visible: true, bounds: CONTENT, radii: [0] });
});

test("a tab whose view was made before its layout arrived is shown by the layout", () => {
  const layout = new TabLayout();
  const tabs = new Map<TabId, Placeable>();
  const first = open(layout, tabs, 1);

  expect(first.visible).toBe(false);

  layout.reconcile(at(1), tabs);

  expect(first).toEqual({ visible: true, bounds: CONTENT, radii: [0] });
});

test("opening a second tab ahead of its view hides the first and shows the second", () => {
  const layout = new TabLayout();
  const tabs = new Map<TabId, Placeable>();
  const first = open(layout, tabs, 1);

  layout.reconcile(at(1), tabs);
  layout.reconcile(at(2), tabs);
  const second = open(layout, tabs, 2);

  expect(first.visible).toBe(false);
  expect(second).toEqual({ visible: true, bounds: CONTENT, radii: [0] });
});

test("a tab opened in the background stays hidden", () => {
  const layout = new TabLayout();
  const tabs = new Map<TabId, Placeable>();

  open(layout, tabs, 1);
  layout.reconcile(at(1), tabs);
  const background = open(layout, tabs, 2);

  expect(background).toEqual({ visible: false, bounds: null, radii: [] });
});

test("the visible tab is rounded when the radius changes, and only then", () => {
  const layout = new TabLayout();
  const tabs = new Map<TabId, Placeable>();
  const first = open(layout, tabs, 1);

  layout.reconcile(at(1, 11), tabs);
  layout.reconcile(at(1, 11), tabs);
  layout.reconcile(at(1, 0), tabs);

  expect(first.radii).toEqual([11, 0]);
});

test("a tab shown again takes the radius in force, not the one it was hidden with", () => {
  const layout = new TabLayout();
  const tabs = new Map<TabId, Placeable>();
  const first = open(layout, tabs, 1);

  open(layout, tabs, 2);
  layout.reconcile(at(1, 11), tabs);
  layout.reconcile(at(2, 11), tabs);
  layout.reconcile(at(2, 4), tabs);
  layout.reconcile(at(1, 4), tabs);

  expect(first.radii).toEqual([11, 4]);
});
