import { expect, test, vi } from "vite-plus/test";
import type { CompletionCandidate, CompletionOverlayState } from "../../shared/ipc";
import { createCompletionOverlay } from "./completion-overlay";

function createBridge() {
  let deliver: (candidate: CompletionCandidate) => void = () => {};
  const bridge = {
    completionOverlay: vi.fn<(state: CompletionOverlayState | null) => void>(),
    onCompletionAccept: (listener: (candidate: CompletionCandidate) => void) => {
      deliver = listener;
      return () => {};
    },
  };
  return { bridge, pick: (candidate: CompletionCandidate) => deliver(candidate) };
}

function state(label: string): CompletionOverlayState {
  return {
    candidates: [{ label, value: label }],
    index: -1,
    anchor: { x: 0, y: 0, width: 100, height: 20 },
    grow: "down",
  };
}

const row = { label: "zoom.set", value: "zoom.set" };

test("a pick goes to the input that showed the list, not every input", () => {
  const { bridge, pick } = createBridge();
  const overlay = createCompletionOverlay(bridge);
  const omnibox = vi.fn();
  const cmdline = vi.fn();
  overlay.claim(omnibox);
  const line = overlay.claim(cmdline);

  line.show(state("zoom.set"));
  pick(row);

  expect(cmdline).toHaveBeenCalledWith(row);
  expect(omnibox).not.toHaveBeenCalled();
});

test("a pick still arrives after its input hid the list on blur", () => {
  const { bridge, pick } = createBridge();
  const overlay = createCompletionOverlay(bridge);
  const accept = vi.fn();
  const client = overlay.claim(accept);

  client.show(state("a"));
  client.hide();
  pick(row);

  expect(accept).toHaveBeenCalledWith(row);
});

test("an input that does not own the overlay cannot hide it", () => {
  const { bridge } = createBridge();
  const overlay = createCompletionOverlay(bridge);
  const omnibox = overlay.claim(vi.fn());
  const line = overlay.claim(vi.fn());

  line.show(state("a"));
  omnibox.hide();

  expect(bridge.completionOverlay).toHaveBeenCalledTimes(1);

  line.hide();
  expect(bridge.completionOverlay).toHaveBeenLastCalledWith(null);
});

test("releasing the owner hides the overlay and drops later picks", () => {
  const { bridge, pick } = createBridge();
  const overlay = createCompletionOverlay(bridge);
  const accept = vi.fn();
  const client = overlay.claim(accept);

  client.show(state("a"));
  client.release();
  pick(row);

  expect(bridge.completionOverlay).toHaveBeenLastCalledWith(null);
  expect(accept).not.toHaveBeenCalled();
});

test("releasing an input that never showed leaves the overlay alone", () => {
  const { bridge } = createBridge();
  const overlay = createCompletionOverlay(bridge);
  const owner = overlay.claim(vi.fn());
  const bystander = overlay.claim(vi.fn());

  owner.show(state("a"));
  bystander.release();

  expect(bridge.completionOverlay).toHaveBeenCalledTimes(1);
});
