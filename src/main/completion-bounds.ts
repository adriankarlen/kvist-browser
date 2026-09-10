import type { CompletionGrow, CompletionInset, Rect } from "../shared/ipc";

/** The window's client area: the frame every rectangle here is measured in. */
export interface ContentSize {
  width: number;
  height: number;
}

/** Where the overlay's view goes, and where the list goes inside it. */
export interface Placement {
  bounds: Rect;
  inset: CompletionInset;
}

function clamp(value: number, max: number): number {
  if (value < 0) return 0;
  return value > max ? max : value;
}

/**
 * Round view bounds outward and retain a fractional inset to keep borders aligned.
 * Clamp to the requested side rather than flipping.
 */
export function placeCompletion(
  anchor: Rect,
  height: number,
  grow: CompletionGrow,
  content: ContentSize,
): Placement {
  const width = Math.min(anchor.width, content.width);
  const left = clamp(anchor.x, content.width - width);
  const x = Math.floor(left);

  const room = grow === "down" ? content.height - (anchor.y + anchor.height) : anchor.y;
  const fitted = clamp(height, Math.max(room, 0));
  const top = grow === "down" ? anchor.y + anchor.height : anchor.y - fitted;
  const y = Math.floor(clamp(top, content.height));

  return {
    bounds: {
      x,
      y,
      width: Math.min(Math.ceil(left + width) - x, content.width - x),
      height: Math.min(Math.ceil(top + fitted) - y, content.height - y),
    },
    inset: { left: left - x, top: top - y, width },
  };
}
