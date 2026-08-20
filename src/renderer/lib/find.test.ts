import { expect, test, vi } from "vite-plus/test";
import type { FindResult } from "../../shared/ipc";
import { createFind } from "./find.svelte";

function createBridge() {
  let report: (result: FindResult | null) => void = () => {};
  const bridge = {
    onFindResult: (listener: (result: FindResult | null) => void) => {
      report = listener;
      return () => {};
    },
    find: vi.fn<(query: string) => void>(),
    stopFind: vi.fn(),
  };
  return { find: createFind(bridge), send: (result: FindResult | null) => report(result), bridge };
}

test("the matches are main's to report", () => {
  const { find, send } = createBridge();

  expect(find.active).toBe(false);
  expect(find.query).toBe("");

  send({ query: "needle", matches: 3, active: 2 });
  expect(find.active).toBe(true);
  expect(find.query).toBe("needle");
  expect(find.result).toEqual({ query: "needle", matches: 3, active: 2 });
});

test("stopping clears here rather than waiting to be told", () => {
  const { find, send, bridge } = createBridge();

  send({ query: "needle", matches: 3, active: 2 });
  find.stop();

  // Main answers nothing when there was no search to stop, so the chrome
  // cannot wait for an echo.
  expect(find.active).toBe(false);
  expect(bridge.stopFind).toHaveBeenCalled();
});

test("a search is a full query every time, not a keystroke", () => {
  const { find, bridge } = createBridge();
  find.run("nee");
  find.run("need");
  expect(bridge.find.mock.calls).toEqual([["nee"], ["need"]]);
});
