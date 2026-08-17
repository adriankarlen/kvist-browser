/**
 * How fast a transfer is moving, kept pure so it can be tested without a
 * `DownloadItem` and a stopwatch. The Electron side lives in `downloads.ts`.
 *
 * The rate is computed in main rather than in the chrome because main is the
 * only place with a real stream of samples — the chrome sees a snapshot every
 * 100 ms at best, and nothing at all once a transfer stalls.
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
 * Folds one `updated` report into the running average.
 *
 * `updated` fires per chunk, so a naive delta over a delta measures scheduling
 * noise rather than throughput — anything sooner than `MIN_SAMPLE_MS` after the
 * last accepted sample is therefore held rather than measured, and the previous
 * state is returned unchanged so the next sample spans the whole gap.
 *
 * A stalled transfer keeps reporting the same byte count, which reads as an
 * instant rate of zero and decays the average towards zero — which is what the
 * user should see, rather than the speed it managed before it stopped.
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
