import { Schema } from "effect";

/** Where a download has got to, as Chromium's `DownloadItem` reports it. */
export const DownloadStatus = Schema.Literals([
  "progressing",
  "paused",
  "completed",
  "cancelled",
  "interrupted",
]);

export type DownloadStatus = typeof DownloadStatus.Type;

export const DownloadState = Schema.Struct({
  /** Ours, not Chromium's — a `DownloadItem` carries no stable identifier. */
  id: Schema.Int,
  /** Basename of the path we chose, which is not always what the server suggested. */
  filename: Schema.String,
  url: Schema.String,
  status: DownloadStatus,
  receivedBytes: Schema.Finite,
  /** 0 when the server sent no length, which is what makes progress unknowable. */
  totalBytes: Schema.Finite,
  /**
   * Smoothed throughput, 0 once a transfer stops. Measured in main, because
   * the chrome only sees throttled snapshots and none while a transfer stalls.
   */
  bytesPerSecond: Schema.Finite,
});

export type DownloadState = typeof DownloadState.Type;
