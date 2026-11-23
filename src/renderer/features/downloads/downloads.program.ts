import { Schema } from "effect";
import { ChromeIntent } from "../../../shared/rpc/chrome";
import { DownloadState } from "../../../shared/schema/downloads";
import type { DownloadStatus } from "../../../shared/schema/downloads";
import { next, type Next } from "../../../shared/tea/program";
import { type Cmd as LinkCmd, send } from "../link/link.program";

/** How long the panel stays up after a transfer settles, so the user sees it finish. */
export const LINGER = "5 seconds";

/**
 * The panel shows itself while anything transfers, lingers briefly when one
 * settles, and stays up while `:downloads` pins it.
 */
export interface Model {
  readonly list: ReadonlyArray<DownloadState>;
  readonly pinned: boolean;
  readonly lingering: boolean;
  /** Each row's status as last seen, so a settle is noticed once. Null before the first list. */
  readonly seen: ReadonlyMap<number, DownloadStatus> | null;
}

export const init: Model = { list: [], pinned: false, lingering: false, seen: null };

export const Msg = Schema.TaggedUnion({
  DownloadsChanged: { downloads: Schema.Array(DownloadState) },
  DownloadsToggled: {},
  DownloadsLingerEnded: {},
  DownloadCancelClicked: { id: Schema.Int },
});

export type Msg = typeof Msg.Type;

export const Cmd = Schema.TaggedUnion({
  /** Keyed: a newer settle restarts the wait. */
  LingerDownloads: {},
});

export type Cmd = typeof Cmd.Type;

const finished = (status: DownloadStatus): boolean =>
  status !== "progressing" && status !== "paused";

export function update(msg: Msg, model: Model): Next<Model, never, Cmd | LinkCmd> {
  return Msg.match(msg, {
    DownloadsChanged: ({ downloads }) => {
      const seen = new Map(downloads.map((entry) => [entry.id, entry.status]));

      // The first list is history from before this document, not a settle.
      const settled =
        model.seen !== null &&
        downloads.some(
          (entry) => finished(entry.status) && model.seen?.get(entry.id) !== entry.status,
        );

      const updated = { ...model, list: downloads, seen };

      return settled
        ? next({ ...updated, lingering: true }, [Cmd.cases.LingerDownloads.make({})])
        : next(updated);
    },
    DownloadsToggled: () => next({ ...model, pinned: !model.pinned }),
    DownloadsLingerEnded: () => next({ ...model, lingering: false }),
    DownloadCancelClicked: ({ id }) =>
      next(model, [send(ChromeIntent.cases.DownloadCancelRequested.make({ id }))]),
  });
}

export const transferring = (model: Model): boolean =>
  model.list.some((entry) => !finished(entry.status));

/** A panel the layout hides never pops up by itself; `:downloads` still pins it. */
export const panelVisible = (model: Model, placedVisible: boolean): boolean =>
  model.pinned || (placedVisible && (transferring(model) || model.lingering));
