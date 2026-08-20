import { afterEach, expect, test, vi } from "vite-plus/test";
import type { Message } from "../shared/ipc";
import { Messages } from "./messages";

// Every case here stubs the console; a stub left behind would silence the
// next test's log, and a failed assertion must not be able to leave one.
afterEach(() => vi.restoreAllMocks());

function createMessages() {
  const messages = new Messages();
  const seen: (Message | null)[] = [];
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  const release = messages.observe((message) => seen.push(message));
  return { messages, seen, release };
}

test("a message reaches every window that is listening", () => {
  const { messages, seen } = createMessages();
  const other: (Message | null)[] = [];
  messages.observe((message) => other.push(message));

  messages.warn("not a download row: x");

  const expected = { text: "not a download row: x", level: "error" };
  expect(seen).toEqual([expected]);
  expect(other).toEqual([expected]);
});

test("what went wrong and what merely happened read differently", () => {
  const { messages, seen } = createMessages();

  messages.say("cleared 2 downloads");
  messages.warn("unknown command :nope");

  expect(seen).toEqual([
    { text: "cleared 2 downloads", level: "info" },
    { text: "unknown command :nope", level: "error" },
  ]);
});

test("everything said also reaches the log", () => {
  const { messages } = createMessages();

  messages.say("cleared 2 downloads");
  messages.warn("unknown command :nope");

  expect(console.log).toHaveBeenCalledWith("kvist: cleared 2 downloads");
  expect(console.error).toHaveBeenCalledWith("kvist: unknown command :nope");
});

test("what is up outlasts the moment it was said", () => {
  const { messages } = createMessages();
  expect(messages.current).toBeNull();

  messages.warn("config.toml: homepage: not a string");
  // A window that loads after this has to be able to find out.
  expect(messages.current).toEqual({
    text: "config.toml: homepage: not a string",
    level: "error",
  });

  messages.say("cleared 1 download");
  expect(messages.current).toEqual({ text: "cleared 1 download", level: "info" });

  messages.keyPressed();
  expect(messages.current).toBeNull();
});

test("the next keystroke clears what is up, and only once", () => {
  const { messages, seen } = createMessages();

  messages.warn("unknown command :nope");
  messages.keyPressed();
  expect(seen.at(-1)).toBeNull();

  // Nothing is up any more, so further keys are not news.
  messages.keyPressed();
  messages.keyPressed();
  expect(seen).toHaveLength(2);
});

test("a keystroke before anything was said clears nothing", () => {
  const { messages, seen } = createMessages();
  messages.keyPressed();
  expect(seen).toEqual([]);
});

test("a window that has closed is not told", () => {
  const { messages, seen, release } = createMessages();

  messages.warn("first");
  release();
  messages.warn("second");

  expect(seen).toHaveLength(1);
});
