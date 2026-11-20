import { Schema } from "effect";

/** A permission a page may be asked about rather than silently granted or denied. */
export const PromptablePermission = Schema.Literals([
  "media",
  "geolocation",
  "notifications",
  "clipboard-read",
]);

export type PromptablePermission = typeof PromptablePermission.Type;

/**
 * A question the chrome renders as a one-line prompt. The id travels
 * separately, so the queue owns it end to end and the asker never invents one.
 */
export const PromptState = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal("permission"),
    origin: Schema.String,
    permission: PromptablePermission,
    mediaTypes: Schema.optionalKey(Schema.Array(Schema.Literals(["video", "audio"]))),
  }),
  Schema.Struct({
    kind: Schema.Literal("session-restore"),
    tabCount: Schema.Int,
  }),
  Schema.Struct({
    kind: Schema.Literal("external-protocol"),
    /** The page asking, or null for the user's own typed URL, `:tabnew` or a restored tab. */
    origin: Schema.NullOr(Schema.String),
    scheme: Schema.String,
    /** Shown truncated: the scheme alone does not say what is being sent to the OS. */
    url: Schema.String,
  }),
]);

export type PromptState = typeof PromptState.Type;

/** A queued prompt: the state plus the id the queue stamped. */
export const PromptWire = Schema.Struct({ id: Schema.Int, state: PromptState });

export type PromptWire = typeof PromptWire.Type;

export const PromptAnswer = Schema.Struct({ id: Schema.Int, allow: Schema.Boolean });

export type PromptAnswer = typeof PromptAnswer.Type;
