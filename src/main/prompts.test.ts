import { afterEach, beforeEach, expect, test, vi } from "vite-plus/test";
import { Prompts } from "./prompts";

type TestState = { label: string };

let prompts: Prompts<TestState>;
let observer: ReturnType<typeof vi.fn<(head: { id: number; state: TestState } | null) => void>>;
let release: () => void;

beforeEach(() => {
  prompts = new Prompts<TestState>();
  observer = vi.fn<(head: { id: number; state: TestState } | null) => void>();
  release = prompts.observe(observer);
});

afterEach(() => {
  release();
});

const label = (label: string): TestState => ({ label });

test("a fresh queue has no head and no pending entries", () => {
  expect(prompts.head).toBeNull();
  expect(prompts.pending).toEqual([]);
});

test("ask enqueues, returns a fresh id, and exposes the pair on head/pending", () => {
  const answer = vi.fn<(allow: boolean) => void>();
  const id = prompts.ask(label("first"), answer);

  expect(id).toBe(1);
  expect(prompts.head).toEqual({ label: "first" });
  expect(prompts.pending).toEqual([{ id: 1, state: { label: "first" } }]);
});

test("the observer fires immediately with the current head on subscribe", () => {
  const local = new Prompts<TestState>();
  const seen: ({ id: number; state: TestState } | null)[] = [];
  local.observe((head) => seen.push(head));
  expect(seen).toEqual([null]);

  const localObserver = vi.fn<(head: { id: number; state: TestState } | null) => void>();
  local.observe(localObserver);
  expect(localObserver).toHaveBeenCalledWith(null);
});

test("the observer fires on every head transition", () => {
  prompts.ask(label("first"), () => {});
  prompts.ask(label("second"), () => {});
  // First ask moved the head from null → first; second did not move it.
  expect(observer.mock.calls.map((call) => call[0])).toEqual([
    null,
    { id: 1, state: { label: "first" } },
  ]);
});

test("answering the head fires the asker's callback and notifies the observer", () => {
  const answer = vi.fn<(allow: boolean) => void>();
  const id = prompts.ask(label("first"), answer);
  observer.mockClear();

  prompts.answer(id, true);

  expect(answer).toHaveBeenCalledWith(true);
  expect(answer).toHaveBeenCalledTimes(1);
  // The head went from "first" to null, so the observer fires once with null.
  expect(observer.mock.calls).toEqual([[null]]);
  expect(prompts.head).toBeNull();
});

test("answering one of two entries promotes the tail to the head", () => {
  const first = vi.fn<(allow: boolean) => void>();
  const second = vi.fn<(allow: boolean) => void>();
  const firstId = prompts.ask(label("first"), first);
  prompts.ask(label("second"), second);
  observer.mockClear();

  prompts.answer(firstId, false);

  expect(first).toHaveBeenCalledWith(false);
  expect(second).not.toHaveBeenCalled();
  expect(prompts.head).toEqual({ label: "second" });
  expect(observer.mock.calls).toEqual([[{ id: 2, state: { label: "second" } }]]);
});

test("answerHead settles whatever the current head is", () => {
  const answer = vi.fn<(allow: boolean) => void>();
  prompts.ask(label("first"), answer);

  prompts.answerHead(true);

  expect(answer).toHaveBeenCalledWith(true);
  expect(prompts.head).toBeNull();
});

test("answerHead is a no-op when the queue is empty", () => {
  // The prompt-mode keybinds call this without first checking the head;
  // an empty queue must not throw.
  expect(() => prompts.answerHead(false)).not.toThrow();
});

test("a stale id is a no-op — the callback does not fire twice", () => {
  const answer = vi.fn<(allow: boolean) => void>();
  const id = prompts.ask(label("first"), answer);

  prompts.answer(id, true);
  prompts.answer(id, false); // stale
  prompts.answer(999, false); // never existed

  expect(answer).toHaveBeenCalledTimes(1);
  expect(answer).toHaveBeenCalledWith(true);
});

test("cancel removes the entry without firing its callback", () => {
  const answer = vi.fn<(allow: boolean) => void>();
  const id = prompts.ask(label("first"), answer);
  observer.mockClear();

  prompts.cancel(id);

  expect(answer).not.toHaveBeenCalled();
  expect(prompts.head).toBeNull();
  // The observer still sees the head transition — same as a settle, just
  // without the asker being told a decision was made.
  expect(observer.mock.calls).toEqual([[null]]);
});

test("cancel on a stale id is a no-op", () => {
  const answer = vi.fn<(allow: boolean) => void>();
  prompts.ask(label("first"), answer);

  expect(() => prompts.cancel(999)).not.toThrow();
  expect(answer).not.toHaveBeenCalled();
  expect(prompts.head).not.toBeNull();
});

test("cancel on the head promotes the tail", () => {
  const first = vi.fn<(allow: boolean) => void>();
  const second = vi.fn<(allow: boolean) => void>();
  const firstId = prompts.ask(label("first"), first);
  prompts.ask(label("second"), second);
  observer.mockClear();

  prompts.cancel(firstId);

  expect(first).not.toHaveBeenCalled();
  expect(second).not.toHaveBeenCalled();
  expect(prompts.head).toEqual({ label: "second" });
});

test("the observer stops firing after the release is called", () => {
  const answer = vi.fn<(allow: boolean) => void>();
  release();

  const id = prompts.ask(label("first"), answer);
  prompts.answer(id, true);

  // The observer was unsubscribed before any of this happened — nothing
  // since the subscribe-with-null should have fired.
  expect(observer.mock.calls).toEqual([[null]]);
});

test("ids are unique across asks", () => {
  const ids = new Set<number>();
  for (let i = 0; i < 5; i++) {
    ids.add(prompts.ask(label(`q${i}`), () => {}));
  }
  expect(ids.size).toBe(5);
});
