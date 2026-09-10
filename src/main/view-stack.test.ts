import type { View } from "electron";
import { expect, test } from "vite-plus/test";
import { type StackRoot, ViewStack } from "./view-stack";

/**
 * A fake `contentView`, modelling the one behaviour the stack leans on:
 * Electron re-orders a child to the top when it is added a second time.
 */
function createRoot() {
  const children: View[] = [];
  const root: StackRoot = {
    addChildView(view) {
      const existing = children.indexOf(view);
      if (existing >= 0) children.splice(existing, 1);
      children.push(view);
    },
    removeChildView(view) {
      const index = children.indexOf(view);
      if (index >= 0) children.splice(index, 1);
    },
  };
  return { root, children };
}

/** Stand-ins for views: the stack only ever compares them by identity. */
function views(count: number): View[] {
  // SAFETY: the stack passes these straight to the root and never calls into them.
  return Array.from({ length: count }, (_, index) => `view-${index}` as unknown as View);
}

test("an overlay stays on top of a page mounted after it", () => {
  const { root, children } = createRoot();
  const stack = new ViewStack(root);
  const [overlay, page] = views(2);

  stack.addOverlay(overlay!);
  stack.addPage(page!);

  expect(children).toEqual([page, overlay]);
});

test("every later page goes under the overlay too", () => {
  const { root, children } = createRoot();
  const stack = new ViewStack(root);
  const [overlay, first, second, third] = views(4);

  stack.addOverlay(overlay!);
  stack.addPage(first!);
  stack.addPage(second!);
  stack.addPage(third!);

  expect(children.at(-1)).toBe(overlay);
});

test("an overlay added late lands on top of the pages already there", () => {
  const { root, children } = createRoot();
  const stack = new ViewStack(root);
  const [overlay, page] = views(2);

  stack.addPage(page!);
  stack.addOverlay(overlay!);

  expect(children).toEqual([page, overlay]);
});

test("overlays keep their own order as pages mount beneath them", () => {
  const { root, children } = createRoot();
  const stack = new ViewStack(root);
  const [lower, upper, page] = views(3);

  stack.addOverlay(lower!);
  stack.addOverlay(upper!);
  stack.addPage(page!);

  expect(children).toEqual([page, lower, upper]);
});

test("registering an overlay twice does not change the overlay order", () => {
  const { root, children } = createRoot();
  const stack = new ViewStack(root);
  const [lower, upper, page] = views(3);

  stack.addOverlay(lower!);
  stack.addOverlay(upper!);
  stack.addOverlay(lower!);
  stack.addPage(page!);

  expect(children).toEqual([page, lower, upper]);
});

test("a removed overlay stops being raised over later pages", () => {
  const { root, children } = createRoot();
  const stack = new ViewStack(root);
  const [overlay, page] = views(2);

  stack.addOverlay(overlay!);
  stack.remove(overlay!);
  stack.addPage(page!);

  expect(children).toEqual([page]);
});

test("removing a page leaves the overlay alone", () => {
  const { root, children } = createRoot();
  const stack = new ViewStack(root);
  const [overlay, page] = views(2);

  stack.addOverlay(overlay!);
  stack.addPage(page!);
  stack.remove(page!);

  expect(children).toEqual([overlay]);
});
