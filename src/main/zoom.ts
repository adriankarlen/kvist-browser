/**
 * Electron counts zoom in levels: 0 is the original size, and each step of
 * 1 is about 20%. Chromium accepts roughly 25% to 500%, which is this range.
 */
export const STEP = 1;

const FLOOR = -2.8;
const CEILING = 5.7;

export function clamp(level: number): number {
  if (level < FLOOR) return FLOOR;

  if (level > CEILING) return CEILING;

  return level;
}

/** Per-origin zoom, as the tab and action layers read and write it. */
export interface ZoomStoreAccess {
  get(origin: string): number;
  set(origin: string, level: number): void;
}
