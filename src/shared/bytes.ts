const UNITS = ["B", "KB", "MB", "GB", "TB"] as const;

/**
 * A byte count at the width a download row can spare: one decimal below
 * 10 units, none above, so "9.4 MB" and "142 MB" both fit. Binary steps with
 * decimal names, which is what every browser's download list shows.
 */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";

  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < UNITS.length - 1) {
    value /= 1024;
    unit++;
  }

  // Bytes are whole things; only the scaled units get a fraction.
  const digits = unit === 0 || value >= 10 ? 0 : 1;
  return `${value.toFixed(digits)} ${UNITS[unit]}`;
}
