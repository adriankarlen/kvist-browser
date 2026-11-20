import { expect, test } from "vite-plus/test";
import { Cmd, init, type Model, Msg, update } from "./downloads.program";

const M = Msg.cases;

const started = (id: number, at = 0) =>
  M.DownloadStarted.make({
    download: {
      id,
      filename: `f${id}`,
      url: `https://a.example/${id}`,
      status: "progressing",
      receivedBytes: 0,
      totalBytes: 100,
      bytesPerSecond: 0,
    },
    at,
  });

function run(msgs: ReadonlyArray<Msg>, model: Model = init) {
  const cmds: unknown[] = [];
  const follow: unknown[] = [];

  for (const msg of msgs) {
    const result = update(msg, model);

    model = result.model;
    cmds.push(...result.cmds);
    follow.push(...result.msgs);
  }

  return { model, cmds, follow };
}

test("rows are newest first", () => {
  expect(run([started(1), started(2)]).model.items.map((item) => item.id)).toEqual([2, 1]);
});

test("progress updates the row and measures throughput; a pause reads as zero", () => {
  const moving = run([
    started(1, 0),
    M.DownloadProgressed.make({
      id: 1,
      status: "progressing",
      receivedBytes: 50,
      totalBytes: 100,
      at: 1000,
    }),
  ]).model;

  expect(moving.items[0]?.receivedBytes).toBe(50);
  expect(moving.items[0]?.bytesPerSecond).toBeGreaterThan(0);

  const paused = run(
    [
      M.DownloadProgressed.make({
        id: 1,
        status: "paused",
        receivedBytes: 50,
        totalBytes: 100,
        at: 2000,
      }),
    ],
    moving,
  ).model;

  expect(paused.items[0]?.bytesPerSecond).toBe(0);
});

test("a finished transfer stops measuring", () => {
  const { model } = run([
    started(1),
    M.DownloadFinished.make({
      id: 1,
      status: "completed",
      receivedBytes: 100,
      totalBytes: 100,
      at: 5,
    }),
  ]);

  expect(model.items[0]).toMatchObject({ status: "completed", bytesPerSecond: 0 });
  expect(model.rates.has(1)).toBe(false);
});

test("clearing drops finished rows only, and says how many", () => {
  const { model, follow } = run([
    started(1),
    started(2),
    M.DownloadFinished.make({
      id: 1,
      status: "completed",
      receivedBytes: 100,
      totalBytes: 100,
      at: 5,
    }),
    M.DownloadsCleared.make({}),
  ]);

  expect(model.items.map((item) => item.id)).toEqual([2]);
  expect(follow).toHaveLength(1);
});

test("cancel by row number, or the first row still moving", () => {
  const ready = run([
    started(1),
    started(2),
    M.DownloadFinished.make({
      id: 2,
      status: "completed",
      receivedBytes: 100,
      totalBytes: 100,
      at: 5,
    }),
  ]).model;

  expect(run([M.DownloadCancelNthRequested.make({ n: undefined })], ready).cmds).toEqual([
    Cmd.cases.CancelDownload.make({ id: 1 }),
  ]);
  expect(run([M.DownloadCancelNthRequested.make({ n: 1 })], ready).cmds).toEqual([
    Cmd.cases.CancelDownload.make({ id: 2 }),
  ]);
  expect(run([M.DownloadCancelNthRequested.make({ n: 9 })], ready).cmds).toEqual([]);
});

test("a transfer that could not be set up leaves no row", () => {
  expect(run([started(1), M.DownloadAbandoned.make({ id: 1 })]).model.items).toEqual([]);
});
