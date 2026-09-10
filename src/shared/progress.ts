import { formatBytes } from "./bytes";

/**
 * The numbers a download row shows beside its byte counts: progress, rate,
 * and time left. Pure and shared, like `bytes.ts` — the chrome renders
 * them; nothing here needs a DOM. A missing total reads as 0, so callers
 * need no guard.
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
 * Time left at the current rate: `21s`, `4m 10s`, `1h 02m`.
 *
 * Empty whenever the question cannot be asked — no length, no movement, or
 * done — so the row shows nothing rather than a placeholder meaning the
 * same thing.
 */
export function formatEta(received: number, total: number, bytesPerSecond: number): string {
  if (!Number.isFinite(received)) return "";
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
