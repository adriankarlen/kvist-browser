import type { Keymap } from "./schema/keymap";

/**
 * `text` with the first key bound to each command, e.g. `zoom (zi / zo)`.
 * `Mod` in a chord reads as `mod`. Commands with no key are left out, and
 * so are the brackets when none has one.
 */
export function keyTitle(
  text: string,
  keymap: Keymap,
  commands: ReadonlyArray<string>,
  mod: string,
): string {
  const labels = commands.flatMap((command) => {
    const bound = keymap.bindings.find((binding) => binding.command === command);

    if (bound === undefined) return [];

    return [bound.table === "chords" ? bound.notation.replaceAll("Mod", mod) : bound.notation];
  });

  return labels.length === 0 ? text : `${text} (${labels.join(" / ")})`;
}
