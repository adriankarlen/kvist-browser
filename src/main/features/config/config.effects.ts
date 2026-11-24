import { Effect } from "effect";
import type { Interpret } from "../../../shared/tea/store";
import { ConfigApplier } from "../../services/config-applier";
import { ConfigFiles } from "../../services/config-files";
import { Cmd, Msg } from "./config.program";

export const interpret: Interpret<Msg, Cmd, never, ConfigApplier | ConfigFiles> = (cmd, dispatch) =>
  Cmd.match(cmd, {
    ApplyConfig: ({ config }) =>
      Effect.flatMap(Effect.service(ConfigApplier), (applier) =>
        Effect.promise(async () => applier.targets?.config(config)).pipe(
          Effect.andThen(Effect.sync(() => dispatch(Msg.cases.ConfigApplied.make({ config })))),
          // A failure must not stop the next save from being applied.
          Effect.catchCause((cause) => Effect.logError("could not apply the config", cause)),
          (effect) => applier.lock.withPermit(effect),
        ),
      ),
    ApplyStyles: ({ sources }) =>
      Effect.flatMap(Effect.service(ConfigApplier), (applier) =>
        Effect.sync(() => {
          const problems = (applier.targets?.styles(sources) ?? []).map(({ id, reason }) => ({
            id,
            reason,
          }));

          dispatch(Msg.cases.StylesApplied.make({ problems }));
        }),
      ),
    LogProblems: ({ lines }) =>
      Effect.forEach(lines, (line) => Effect.logError(line), { discard: true }),
    WriteRecipe: ({ name }) =>
      Effect.flatMap(Effect.service(ConfigFiles), (files) => files.setRecipe(name)).pipe(
        Effect.catchTag("RecipeNotSaved", ({ reason }) =>
          Effect.sync(() => dispatch(Msg.cases.RecipeNotSaved.make({ reason }))),
        ),
      ),
  });
