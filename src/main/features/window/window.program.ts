import { Schema } from "effect";
import { Rect } from "../../../shared/schema/browser";
import { next, type Next } from "../../../shared/tea/program";

/**
 * The window's own buttons. The chrome decides where they go, and whether
 * they show at all, and reports that slot here. On macOS the native traffic
 * lights are moved into it.
 */
export interface Model {
  readonly maximized: boolean;
  /** The slot the chrome keeps for the buttons, in window coordinates; null when there is none. */
  readonly controls: Rect | null;
}

export const init: Model = { maximized: false, controls: null };

export const Msg = Schema.TaggedUnion({
  WindowControlsMeasured: { rect: Schema.NullOr(Rect) },
  WindowMaximizedChanged: { maximized: Schema.Boolean },
});

export type Msg = typeof Msg.Type;

export function update(msg: Msg, model: Model): Next<Model, never, never> {
  return Msg.match(msg, {
    WindowControlsMeasured: ({ rect }) => next({ ...model, controls: rect }),
    WindowMaximizedChanged: ({ maximized }) => next({ ...model, maximized }),
  });
}

/** The three macOS buttons as one block: 12px circles, 8px apart. */
const CLUSTER = { width: 52, height: 12 };

export interface TrafficLights {
  readonly visible: boolean;
  /** The first button's top-left corner; null leaves macOS's own place. */
  readonly position: { readonly x: number; readonly y: number } | null;
}

/**
 * Where macOS should draw its traffic lights: centred in the slot. A full
 * screen window has no title bar for them, and no slot means the chrome
 * left them out.
 */
export function trafficLights(model: Model, fullscreen: boolean): TrafficLights {
  const slot = model.controls;

  if (slot === null || fullscreen || slot.width <= 0 || slot.height <= 0)
    return { visible: false, position: null };

  return {
    visible: true,
    position: {
      x: Math.round(slot.x + (slot.width - CLUSTER.width) / 2),
      y: Math.round(slot.y + (slot.height - CLUSTER.height) / 2),
    },
  };
}
