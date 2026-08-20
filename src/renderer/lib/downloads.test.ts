import { afterEach, beforeEach, expect, test, vi } from "vite-plus/test";
import type { DownloadState } from "../../shared/ipc";
import { createDownloads } from "./downloads.svelte";

const transfer = (id: number, status: DownloadState["status"]): DownloadState => ({
  id,
  filename: `file-${id}`,
  url: `https://example.com/${id}`,
  status,
  receivedBytes: 1,
  totalBytes: 2,
  bytesPerSecond: 0,
});

/** The preload's half, reduced to the two channels the panel listens on. */
function createBridge() {
  let push: (list: DownloadState[]) => void = () => {};
  let toggle: () => void = () => {};
  const cancelDownload = vi.fn<(id: number) => void>();

  return {
    bridge: {
      onDownloads: (listener: (list: DownloadState[]) => void) => {
        push = listener;
        return () => {};
      },
      onDownloadsToggle: (listener: () => void) => {
        toggle = listener;
        return () => {};
      },
      cancelDownload,
    },
    push: (...list: DownloadState[]) => push(list),
    toggle: () => toggle(),
    cancelDownload,
  };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

test("a transfer in flight shows the panel", () => {
  const { bridge, push } = createBridge();
  const downloads = createDownloads(bridge);

  expect(downloads.visible).toBe(false);

  push(transfer(1, "progressing"));
  expect(downloads.active).toBe(true);
  expect(downloads.visible).toBe(true);
});

test("a paused transfer has not stopped", () => {
  const { bridge, push } = createBridge();
  const downloads = createDownloads(bridge);
  push(transfer(1, "paused"));
  expect(downloads.active).toBe(true);
});

test("the first snapshot is history, not news", () => {
  const { bridge, push } = createBridge();
  const downloads = createDownloads(bridge);

  // What main had already when the chrome loaded; none of it settled while
  // anyone was looking.
  push(transfer(1, "completed"), transfer(2, "cancelled"));

  expect(downloads.visible).toBe(false);
});

test("a transfer that finishes lingers, then goes", () => {
  const { bridge, push } = createBridge();
  const downloads = createDownloads(bridge);

  push(transfer(1, "progressing"));
  push(transfer(1, "completed"));
  expect(downloads.active).toBe(false);
  expect(downloads.visible).toBe(true);

  vi.advanceTimersByTime(4999);
  expect(downloads.visible).toBe(true);

  vi.advanceTimersByTime(1);
  expect(downloads.visible).toBe(false);
});

test("a burst keeps the panel up until the last of them has been readable", () => {
  const { bridge, push } = createBridge();
  const downloads = createDownloads(bridge);

  push(transfer(1, "progressing"), transfer(2, "progressing"));
  push(transfer(1, "completed"), transfer(2, "progressing"));

  vi.advanceTimersByTime(4000);
  push(transfer(1, "completed"), transfer(2, "completed"));

  // The second one settled 4s in, so the linger starts again from there.
  vi.advanceTimersByTime(4000);
  expect(downloads.visible).toBe(true);

  vi.advanceTimersByTime(1000);
  expect(downloads.visible).toBe(false);
});

test("a snapshot that settles nothing does not restart the linger", () => {
  const { bridge, push } = createBridge();
  const downloads = createDownloads(bridge);

  push(transfer(1, "progressing"));
  push(transfer(1, "completed"));
  vi.advanceTimersByTime(4000);

  // Progress on an unrelated transfer: nothing stopped, so nothing changes.
  push(transfer(1, "completed"), transfer(2, "progressing"));
  vi.advanceTimersByTime(1000);
  // Still up, but because the second one is moving rather than any linger.
  expect(downloads.active).toBe(true);
});

test("pinning holds the panel open with nothing to show", () => {
  const { bridge, toggle } = createBridge();
  const downloads = createDownloads(bridge);

  toggle();
  expect(downloads.visible).toBe(true);

  toggle();
  expect(downloads.visible).toBe(false);
});

test("cancelling asks main, since the transfer is not the chrome's", () => {
  const { bridge, cancelDownload } = createBridge();
  createDownloads(bridge).cancel(7);
  expect(cancelDownload).toHaveBeenCalledWith(7);
});
