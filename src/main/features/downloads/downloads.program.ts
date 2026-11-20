import { Schema } from "effect";
import { DownloadState, DownloadStatus } from "../../../shared/schema/downloads";
import { next, type Next } from "../../../shared/tea/program";
import { type Msg as MessagesMsg, say } from "../messages/messages.program";
import { type RateState, sampleRate, startRate } from "./download-rate";

/**
 * Every transfer this session, newest first. Session-scoped: a transfer
 * outlives the tab it started in, so the rows belong to the app.
 */
export interface Model {
  readonly items: ReadonlyArray<DownloadState>;
  readonly rates: ReadonlyMap<number, RateState>;
}

export const init: Model = { items: [], rates: new Map() };

const Progress = {
  id: Schema.Int,
  receivedBytes: Schema.Finite,
  totalBytes: Schema.Finite,
  /** When the sample was taken, for the throughput estimate. */
  at: Schema.Finite,
};

export const Msg = Schema.TaggedUnion({
  DownloadStarted: { download: DownloadState, at: Schema.Finite },
  DownloadProgressed: { ...Progress, status: DownloadStatus },
  DownloadFinished: { ...Progress, status: DownloadStatus },
  /** The row's transfer could not be set up; it never really started. */
  DownloadAbandoned: { id: Schema.Int },
  DownloadsCleared: {},
  DownloadCancelRequested: { id: Schema.Int },
  /** `:downloads.cancel [n]`: the n-th row, or the first one still going. */
  DownloadCancelNthRequested: { n: Schema.UndefinedOr(Schema.Int) },
});

export type Msg = typeof Msg.Type;

export const Cmd = Schema.TaggedUnion({
  CancelDownload: { id: Schema.Int },
});

export type Cmd = typeof Cmd.Type;

type Result = Next<Model, MessagesMsg, Cmd>;

export const isFinished = (status: DownloadStatus): boolean =>
  status !== "progressing" && status !== "paused";

function patch(model: Model, id: number, change: Partial<DownloadState>): Model {
  return {
    ...model,
    items: model.items.map((item) => (item.id === id ? { ...item, ...change } : item)),
  };
}

export function update(msg: Msg, model: Model): Result {
  return Msg.match(msg, {
    DownloadStarted: ({ download, at }) =>
      next({
        items: [download, ...model.items],
        rates: new Map(model.rates).set(download.id, startRate(download.receivedBytes, at)),
      }),
    DownloadProgressed: ({ id, status, receivedBytes, totalBytes, at }) => {
      const previous = model.rates.get(id);

      if (previous === undefined) return next(model);
      const rate = sampleRate(previous, receivedBytes, at);
      const bytesPerSecond = status === "paused" ? 0 : rate.rate;
      const patched = patch(model, id, { status, receivedBytes, totalBytes, bytesPerSecond });

      return next({ ...patched, rates: new Map(model.rates).set(id, rate) });
    },
    DownloadFinished: ({ id, status, receivedBytes, totalBytes }) => {
      const rates = new Map(model.rates);

      rates.delete(id);

      return next({
        ...patch(model, id, { status, receivedBytes, totalBytes, bytesPerSecond: 0 }),
        rates,
      });
    },
    DownloadAbandoned: ({ id }) => {
      const rates = new Map(model.rates);

      rates.delete(id);

      return next({ items: model.items.filter((item) => item.id !== id), rates });
    },
    // The panel may not even be up, so clearing is otherwise invisible.
    DownloadsCleared: () => {
      const items = model.items.filter((item) => !isFinished(item.status));
      const cleared = model.items.length - items.length;

      return next(
        { ...model, items },
        [],
        [say(cleared === 1 ? "cleared 1 download" : `cleared ${cleared} downloads`)],
      );
    },
    DownloadCancelRequested: ({ id }) => next(model, [Cmd.cases.CancelDownload.make({ id })]),
    DownloadCancelNthRequested: ({ n }) => {
      const row =
        n === undefined ? model.items.find((item) => !isFinished(item.status)) : model.items[n - 1];

      return next(model, row === undefined ? [] : [Cmd.cases.CancelDownload.make({ id: row.id })]);
    },
  });
}
