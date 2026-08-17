import { formatBytes } from "./bytes";

/**
 * The numbers a download row shows besides its byte counts: how far along it
 * is, how fast it is going, and how long that leaves. Pure and shared, like
 * `bytes.ts` — the chrome renders them, but nothing here needs a DOM.
 *
 * A server that sent no length leaves nothing to count towards, so every
 * function here has an answer for a total of 0 rather than a caller-side guard.
 */

/**
 * Progress as a percentage, 0–100, rounded to whole points — a download row is
 * not the place for a decimal. Unknown length reads as null, which is what
 * hides the bar rather than showing an empty one.
 */
export function percent(received: number, total: number): number | null {
  if (!Number.isFinite(total) || total <= 0) return null;
  if (!Number.isFinite(received) || received <= 0) return 0;
  return Math.min(100, Math.round((received / total) * 100));
}

/** A transfer rate at the width a row can spare, e.g. "1.2 MB/s". */
export function formatRate(bytesPerSecond: number): string {
  if (!Number.isFinite(bytesPerSecond) || bytesPerSecond <= 0) return "";
  return `${formatBytes(bytesPerSecond)}/s`;
}

/**
 * How long is left at the current rate, as "21s", "4m 10s" or "1h 02m".
 *
 * The empty string is the answer whenever the question cannot be asked — no
 * length, no movement, or already finished — and the row then shows nothing
 * rather than a placeholder that means the same thing but takes up more space.
 */
export function formatEta(received: number, total: number, bytesPerSecond: number): string {
  if (!Number.isFinite(total) || total <= 0) return "";
  if (!Number.isFinite(bytesPerSecond) || bytesPerSecond <= 0) return "";

  const remaining = total - received;
  if (remaining <= 0) return "";

  const seconds = Math.max(1, Math.round(remaining / bytesPerSecond));
  if (seconds < 60) return `${seconds}s`;

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${String(seconds % 60).padStart(2, "0")}s`;

  const hours = Math.floor(minutes / 60);
  return `${hours}h ${String(minutes % 60).padStart(2, "0")}m`;
}
