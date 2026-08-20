import { expect, test, vi } from "vite-plus/test";
import { type Channel, fromPage, listeners, senders, toChrome, toMain, toPage, wire } from "./ipc";

test("a wire name is the channel name, kebabed and namespaced", () => {
  expect(wire("state")).toBe("kvist:state");
  expect(wire("cancelDownload")).toBe("kvist:cancel-download");
  expect(wire("setContentRect")).toBe("kvist:set-content-rect");
});

test("no two channels claim the same wire name", () => {
  const names = [toMain, toChrome, fromPage, toPage].flatMap((table) =>
    Object.keys(table).map(wire),
  );
  expect(new Set(names).size).toBe(names.length);
});

test("a sender sends its own channel and the payload it was given", () => {
  const send = vi.fn<(channel: string, payload?: unknown) => void>();
  const api = senders(toMain, send);

  api.navigate("https://example.com");
  api.cancelDownload(7);
  api.goBack();

  expect(send.mock.calls).toEqual([
    ["kvist:navigate", "https://example.com"],
    ["kvist:cancel-download", 7],
    ["kvist:go-back", undefined],
  ]);
});

test("a table's sending half is exactly its channels", () => {
  const api = senders(toPage, () => {});
  expect(Object.keys(api).sort()).toEqual(Object.keys(toPage).sort());
});

test("listeners are named on-the-channel and pass the payload through", () => {
  const subscriptions = new Map<string, (payload: unknown) => void>();
  const unsubscribe = vi.fn();
  const api = listeners(toChrome, (channel, listener) => {
    subscriptions.set(channel, listener);
    return unsubscribe;
  });

  const seen: unknown[] = [];
  const off = api.onFindResult((result) => seen.push(result));
  api.onDownloadsToggle(() => seen.push("toggled"));

  subscriptions.get("kvist:find-result")?.({ query: "a", matches: 2, active: 1 });
  subscriptions.get("kvist:downloads-toggle")?.(undefined);

  expect(seen).toEqual([{ query: "a", matches: 2, active: 1 }, "toggled"]);

  off();
  expect(unsubscribe).toHaveBeenCalledTimes(1);
});

test("the payload type is phantom: a channel carries nothing of its own", () => {
  const table: Record<string, Channel<unknown>> = toMain;
  expect(Object.values(table).every((entry) => Object.keys(entry).length === 0)).toBe(true);
});
