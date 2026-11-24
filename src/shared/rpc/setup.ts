import { Schema } from "effect";
import { Rpc, RpcGroup } from "effect/rpc";
import { SetupChoices, SetupOptions } from "../schema/setup";

/** What main tells the wizard. All of it is state, so a late document starts current. */
export const SetupEvent = Schema.TaggedUnion({
  /** Start over with these options. `seq` tells two openings apart. */
  Opened: { seq: Schema.Int, options: SetupOptions },
  /** Whether a write is in flight, and why the last one failed. */
  Status: { saving: Schema.Boolean, error: Schema.UndefinedOr(Schema.String) },
  /** `themeCss`: the wizard wears the look it is previewing. */
  CssChanged: { css: Schema.String },
});

export type SetupEvent = typeof SetupEvent.Type;

export const SetupIntent = Schema.TaggedUnion({
  /** Any change at all: main previews it on the real chrome. */
  ChoicesChanged: { choices: SetupChoices },
  Finished: { choices: SetupChoices },
  Skipped: {},
});

export type SetupIntent = typeof SetupIntent.Type;

export class SetupRpcs extends RpcGroup.make(
  Rpc.make("Subscribe", { success: SetupEvent, stream: true }),
  Rpc.make("Dispatch", { payload: SetupIntent }),
) {}
