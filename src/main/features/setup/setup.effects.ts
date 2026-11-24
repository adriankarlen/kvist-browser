import { Effect } from "effect";
import type { Interpret } from "../../../shared/tea/store";
import { ConfigFiles } from "../../services/config-files";
import { setupOptions } from "../../setup-files";
import { Cmd, Msg } from "./setup.program";

export const interpret: Interpret<Msg, Cmd, never, ConfigFiles> = (cmd, dispatch) =>
  Cmd.match(cmd, {
    LoadSetupOptions: () =>
      Effect.flatMap(Effect.service(ConfigFiles), (files) =>
        Effect.all({ recipes: files.recipeOptions, cssExists: files.cssExists }),
      ).pipe(
        Effect.map(({ recipes, cssExists }) =>
          dispatch(
            Msg.cases.SetupOptionsLoaded.make({ options: setupOptions(recipes, cssExists) }),
          ),
        ),
      ),
    PreviewSetup: ({ files, revision }) =>
      Effect.flatMap(Effect.service(ConfigFiles), ({ preview }) => preview(files)).pipe(
        Effect.map(({ config }) =>
          dispatch(Msg.cases.SetupPreviewLoaded.make({ config, revision })),
        ),
      ),
    WriteSetup: ({ files }) =>
      Effect.flatMap(Effect.service(ConfigFiles), (config) => config.writeFirstRun(files)).pipe(
        Effect.andThen(Effect.sync(() => dispatch(Msg.cases.SetupWritten.make({})))),
        Effect.catchTag("SetupNotSaved", ({ reason, exists }) =>
          Effect.sync(() =>
            dispatch(
              exists
                ? Msg.cases.SetupSuperseded.make({ reason })
                : Msg.cases.SetupNotSaved.make({ reason }),
            ),
          ),
        ),
      ),
  });
