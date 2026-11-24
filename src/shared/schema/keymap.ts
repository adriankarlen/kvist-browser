import { Schema } from "effect";
import { Mode } from "./browser";

/**
 * One key, as either notation reads it. A letter is stored lower-case with
 * `shift` saying which case; a printable non-letter carries Shift in `key`
 * itself, so its `shift` is always false.
 */
export const KeyToken = Schema.Struct({
  key: Schema.String,
  control: Schema.Boolean,
  alt: Schema.Boolean,
  meta: Schema.Boolean,
  shift: Schema.Boolean,
});

export type KeyToken = typeof KeyToken.Type;

/** The modes a key sequence can be bound in. The typing modes leave their keys to the input. */
export const MODAL_TABLES = ["normal", "insert", "hint", "prompt"] as const;

export const KeyTable = Schema.Literals([...MODAL_TABLES, "chords"] as const);

export type KeyTable = typeof KeyTable.Type;

export const Binding = Schema.Struct({
  table: KeyTable,
  keys: Schema.Array(KeyToken),
  /** As written, for showing the key back to the user. */
  notation: Schema.String,
  command: Schema.String,
  arg: Schema.optionalKey(Schema.String),
  /** The mode the command leaves behind, taken from the command. */
  enter: Schema.optionalKey(Mode),
});

export type Binding = typeof Binding.Type;

export const Keymap = Schema.Struct({
  /** The preset `[input] mode` named, once resolved. */
  name: Schema.String,
  bindings: Schema.Array(Binding),
});

export type Keymap = typeof Keymap.Type;
