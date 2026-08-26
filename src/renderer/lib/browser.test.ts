import { expect, test } from "vite-plus/test";
import type { BrowserState, TabState } from "../../shared/ipc";
import { createBrowser } from "./browser.svelte";

const tab = (id: number): TabState => ({
  id,
  title: `tab ${id}`,
  url: `https://example.com/${id}`,
  favicon: null,
  loading: false,
  canGoBack: false,
  canGoForward: false,
  zoomLevel: 0,
});

function createBridge() {
  let publish: (state: BrowserState) => void = () => {};
  const browser = createBrowser({
    onState: (listener: (state: BrowserState) => void) => {
      publish = listener;
      return () => {};
    },
  });
  return { browser, send: (state: BrowserState) => publish(state) };
}

test("the active tab is looked up, not mirrored", () => {
  const { browser, send } = createBridge();

  expect(browser.active).toBeUndefined();

  send({ tabs: [tab(1), tab(2)], activeId: 2 });
  expect(browser.active?.id).toBe(2);

  // A snapshot where the active tab is gone answers with nothing rather than
  // with a tab that no longer exists.
  send({ tabs: [tab(1)], activeId: 2 });
  expect(browser.active).toBeUndefined();
});
