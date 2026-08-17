import type { DownloadState } from "../../shared/ipc";

/**
 * How long the panel stays up after the last transfer stops. A download off a
 * local network finishes between two frames, so without this the only
 * completion signal is a panel that flickers and is gone — which is the
 * complaint this whole thing exists to answer.
 */
const LINGER_MS = 5000;

const state = $state<{ list: DownloadState[]; pinned: boolean; lingering: boolean }>({
  list: [],
  pinned: false,
  lingering: false,
});

function isFinished(entry: DownloadState): boolean {
  return entry.status !== "progressing" && entry.status !== "paused";
}

let seen = new Map<number, DownloadState["status"]>();
let timer: number | undefined;

window.kvist.onDownloads((list) => {
  // Any row that has just stopped moving restarts the linger, so a burst of
  // downloads leaves the panel up until the last of them has been readable.
  const settled = list.some((entry) => isFinished(entry) && seen.get(entry.id) !== entry.status);
  seen = new Map(list.map((entry) => [entry.id, entry.status]));
  state.list = list;

  if (!settled) return;
  state.lingering = true;
  clearTimeout(timer);
  timer = window.setTimeout(() => {
    state.lingering = false;
  }, LINGER_MS);
});

// `:downloads` pins the panel open. Nothing pins itself: a transfer shows the
// panel on its own, and pinning is only how you get at the ones that finished.
window.kvist.onToggleDownloads(() => {
  state.pinned = !state.pinned;
});

/**
 * The download list, as main reports it. Like the find result, none of it is
 * mirrored — the transfers belong to the session, so main is the only thing
 * that knows where they have got to.
 */
export const downloads = {
  get list(): DownloadState[] {
    return state.list;
  },
  /** Whether anything is still moving, which is what shows the panel unasked. */
  get active(): boolean {
    return state.list.some((entry) => entry.status === "progressing" || entry.status === "paused");
  },
  get visible(): boolean {
    return this.active || state.lingering || state.pinned;
  },
};
