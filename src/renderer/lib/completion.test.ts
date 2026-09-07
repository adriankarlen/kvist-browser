import { expect, test, vi } from "vite-plus/test";
import {
  type Candidate,
  createCompletion,
  handleCompletionKey,
  kindBadge,
  kindBadgeStyle,
} from "./completion.svelte";

function candidates(...labels: string[]): Candidate[] {
  return labels.map((label) => ({ label, value: label }));
}

function key(key: string, shiftKey = false) {
  return { key, shiftKey, preventDefault: vi.fn() };
}

test("update populates candidates and selects the first one", async () => {
  const completion = createCompletion(() => candidates("a", "b"));

  expect(completion.open).toBe(false);

  await completion.update("q");

  expect(completion.open).toBe(true);
  expect(completion.candidates).toEqual(candidates("a", "b"));
  expect(completion.index).toBe(0);
  expect(completion.active).toEqual({ label: "a", value: "a" });
});

test("an empty result closes the list", async () => {
  const completion = createCompletion(() => candidates("a"));
  await completion.update("q");
  expect(completion.open).toBe(true);

  const empty = createCompletion(() => []);
  await empty.update("q");
  expect(empty.open).toBe(false);
  expect(empty.active).toBe(null);
});

test("next and prev wrap around", async () => {
  const completion = createCompletion(() => candidates("a", "b", "c"));
  await completion.update("q");

  completion.next();
  expect(completion.index).toBe(1);
  completion.next();
  expect(completion.index).toBe(2);
  completion.next();
  expect(completion.index).toBe(0);

  completion.prev();
  expect(completion.index).toBe(2);
});

test("next and prev are no-ops when there are no candidates", () => {
  const completion = createCompletion(() => []);
  completion.next();
  completion.prev();
  expect(completion.index).toBe(-1);
});

test("close clears the list and invalidates any in-flight query", async () => {
  let resolve: (candidates: Candidate[]) => void = () => {};
  const pending = new Promise<Candidate[]>((r) => {
    resolve = r;
  });
  const completion = createCompletion(() => pending);

  const update = completion.update("q");
  completion.close();
  resolve(candidates("a"));
  await update;

  // The stale response landed after close and must not resurrect the list.
  expect(completion.open).toBe(false);
  expect(completion.candidates).toEqual([]);
});

test("a newer update supersedes an older, still in-flight one", async () => {
  let resolveFirst: (candidates: Candidate[]) => void = () => {};
  const first = new Promise<Candidate[]>((r) => {
    resolveFirst = r;
  });
  let call = 0;
  const completion = createCompletion(() => (call++ === 0 ? first : candidates("b")));

  const firstUpdate = completion.update("a");
  const secondUpdate = completion.update("b");
  resolveFirst(candidates("a"));
  await Promise.all([firstUpdate, secondUpdate]);

  expect(completion.candidates).toEqual(candidates("b"));
});

test("handleCompletionKey does nothing when the list is closed", () => {
  const completion = createCompletion(() => []);
  const onAccept = vi.fn();
  const event = key("ArrowDown");

  expect(handleCompletionKey(completion, event, onAccept)).toBe(false);
  expect(event.preventDefault).not.toHaveBeenCalled();
});

test("arrow keys cycle the selection", async () => {
  const completion = createCompletion(() => candidates("a", "b"));
  await completion.update("q");
  const onAccept = vi.fn();

  expect(handleCompletionKey(completion, key("ArrowDown"), onAccept)).toBe(true);
  expect(completion.index).toBe(1);
  expect(handleCompletionKey(completion, key("ArrowUp"), onAccept)).toBe(true);
  expect(completion.index).toBe(0);
});

test("Tab cycles forward, shift+Tab cycles back", async () => {
  const completion = createCompletion(() => candidates("a", "b"));
  await completion.update("q");
  const onAccept = vi.fn();

  handleCompletionKey(completion, key("Tab"), onAccept);
  expect(completion.index).toBe(1);
  handleCompletionKey(completion, key("Tab", true), onAccept);
  expect(completion.index).toBe(0);
});

test("Enter accepts the active candidate and closes the list", async () => {
  const completion = createCompletion(() => candidates("a", "b"));
  await completion.update("q");
  const onAccept = vi.fn();

  expect(handleCompletionKey(completion, key("Enter"), onAccept)).toBe(true);
  expect(onAccept).toHaveBeenCalledWith({ label: "a", value: "a" });
  expect(completion.open).toBe(false);
});

test("Escape closes the list without accepting", async () => {
  const completion = createCompletion(() => candidates("a"));
  await completion.update("q");
  const onAccept = vi.fn();

  expect(handleCompletionKey(completion, key("Escape"), onAccept)).toBe(true);
  expect(onAccept).not.toHaveBeenCalled();
  expect(completion.open).toBe(false);
});

test("an unhandled key is left for the caller", async () => {
  const completion = createCompletion(() => candidates("a"));
  await completion.update("q");
  const onAccept = vi.fn();
  const event = key("a");

  expect(handleCompletionKey(completion, event, onAccept)).toBe(false);
  expect(event.preventDefault).not.toHaveBeenCalled();
});

test("kindBadge is the kind's first letter, lowercased, or a neutral fallback", () => {
  expect(kindBadge({})).toBe("\u2022");
  expect(kindBadge({ kind: "Bookmark" })).toBe("b");
  expect(kindBadge({ kind: "history" })).toBe("h");
});

test("kindBadgeStyle looks the colour up by kind name and tints the background from it", () => {
  expect(kindBadgeStyle({ kind: "bookmark" })).toBe(
    "color: var(--kv-completion-kind-bookmark-fg, var(--kv-completion-badge-fg)); " +
      "background: color-mix(in srgb, var(--kv-completion-kind-bookmark-fg, var(--kv-completion-badge-fg)) " +
      "var(--kv-completion-badge-tint), var(--kv-completion-bg))",
  );
});

test("kindBadgeStyle falls back to the default badge colour when there is no kind", () => {
  expect(kindBadgeStyle({})).toBe(
    "color: var(--kv-completion-badge-fg); " +
      "background: color-mix(in srgb, var(--kv-completion-badge-fg) " +
      "var(--kv-completion-badge-tint), var(--kv-completion-bg))",
  );
});

test("kindBadgeStyle rejects a kind that isn't a safe CSS token name", () => {
  // `kind` lands in a custom property *name*, where var()'s escaping does
  // nothing — this would otherwise close the declaration and inject CSS.
  expect(kindBadgeStyle({ kind: "x); background: url(http://evil" })).toBe(kindBadgeStyle({}));
});
