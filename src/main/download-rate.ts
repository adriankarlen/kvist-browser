/**
 * How fast a transfer moves, pure so it tests without a `DownloadItem`.
 * The Electron side lives in `downloads.ts`. Computed in main, which alone
 * sees a real sample stream — the chrome gets a snapshot every 100 ms,
 * nothing when stalled.
 */

/** Samples closer together than this are ignored; see `sampleRate`. */
const MIN_SAMPLE_MS = 250;

/**
 * Smoothing for the exponential moving average. Low enough that a burst does
 * not make the ETA jump, high enough that a stall shows up within a second.
 */
const ALPHA = 0.3;

export interface RateState {
  /** Received bytes at the last accepted sample. */
  bytes: number;
  /** When that sample was taken, in ms. */
  at: number;
  /** The smoothed rate in bytes per second. */
  rate: number;
}

/** The state a transfer starts in: a mark to measure from, and no rate yet. */
export function startRate(bytes: number, at: number): RateState {
  return { bytes, at, rate: 0 };
}

/**
 * `updated` fires per chunk, so a naive delta measures scheduling noise:
 * samples sooner than `MIN_SAMPLE_MS` are held, letting the next sample
 * span the gap. A stalled transfer reads as zero — what a stopped one
 * should show.
 */
export function sampleRate(prev: RateState, bytes: number, at: number): RateState {
  const elapsed = at - prev.at;
  if (elapsed < MIN_SAMPLE_MS) return prev;

  // A retried transfer can restart its byte count, and a clock is never quite
  // to be trusted; neither is allowed to produce a negative rate.
  const instant = Math.max(0, (bytes - prev.bytes) / (elapsed / 1000));
  // The first accepted sample has nothing to average against, so it stands as
  // the rate — otherwise every download would open at a third of its speed.
  const rate = prev.rate === 0 ? instant : prev.rate + ALPHA * (instant - prev.rate);
  return { bytes, at, rate };
}
