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
 * Where the completion overlay's view goes: the anchor says which input the
 * list belongs to, the overlay says how tall it rendered, and this puts the
 * two together.
 *
 * A view's bounds are whole device-independent pixels, but the input it hangs
 * from rarely sits on one — the chrome's padding is measured in `ch`, so the
 * omnibox lands on fractions. Rounding the view to the nearest whole pixel
 * leaves its border up to one device pixel away from the panel's, and the two
 * vertical lines visibly fail to meet.
 *
 * So the view is the smallest whole-pixel rectangle that *contains* the true
 * span, and the list is placed at its exact fractional offset inside it,
 * where CSS can still address sub-pixels. The slack is invisible: the
 * overlay's document is transparent.
 *
 * The list is clamped to the space on the side it grows into rather than
 * flipped to the other one. Each caller has a side that always fits — the
 * omnibox sits at the top of the chrome and the command line at the bottom —
 * so flipping would be a rule that only ever fires in a window too short to
 * use, and it would move the list away from the input it belongs to.
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
