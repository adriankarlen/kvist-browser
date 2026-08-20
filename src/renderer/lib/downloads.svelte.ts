import type { DownloadState, KvistApi } from "../../shared/ipc";

export type Downloads = ReturnType<typeof createDownloads>;

/**
 * How long the panel stays up after the last transfer stops. A download off a
 * local network finishes between two frames, so without this the only
 * completion signal is a panel that flickers and is gone — which is the
 * complaint this whole thing exists to answer.
 */
const LINGER_MS = 5000;

function isFinished(entry: DownloadState): boolean {
  return entry.status !== "progressing" && entry.status !== "paused";
}

export function createDownloads(
  bridge: Pick<KvistApi, "onDownloads" | "onDownloadsToggle" | "cancelDownload">,
) {
  const state = $state<{ list: DownloadState[]; pinned: boolean; lingering: boolean }>({
    list: [],
    pinned: false,
    lingering: false,
  });

  let seen = new Map<number, DownloadState["status"]>();
  let first = true;
  let timer: ReturnType<typeof setTimeout> | undefined;

  bridge.onDownloads((list) => {
    // Any row that has just stopped moving restarts the linger, so a burst of
    // downloads leaves the panel up until the last of them has been readable.
    // The first snapshot is history, not news — main sends what is already in
    // the list when the chrome loads, and none of it settled while anyone was
    // looking.
    const settled =
      !first && list.some((entry) => isFinished(entry) && seen.get(entry.id) !== entry.status);
    first = false;
    seen = new Map(list.map((entry) => [entry.id, entry.status]));
    state.list = list;

    if (!settled) return;
    state.lingering = true;
    clearTimeout(timer);
    timer = setTimeout(() => {
      state.lingering = false;
    }, LINGER_MS);
  });

  // `:downloads` pins the panel open. Nothing pins itself: a transfer shows the
  // panel on its own, and pinning is only how you get at the ones that finished.
  bridge.onDownloadsToggle(() => {
    state.pinned = !state.pinned;
  });

  return {
    get list(): DownloadState[] {
      return state.list;
    },
    /** Whether anything is still moving, which is what shows the panel unasked. */
    get active(): boolean {
      return state.list.some(
        (entry) => entry.status === "progressing" || entry.status === "paused",
      );
    },
    get visible(): boolean {
      return this.active || state.lingering || state.pinned;
    },
    /** Stops one transfer; anything that has already stopped is left alone. */
    cancel(id: number): void {
      bridge.cancelDownload(id);
    },
  };
}
