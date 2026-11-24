import { Schema } from "effect";
import { UserConfig } from "../../../shared/schema/config";
import { SetupChoices, SetupOptions } from "../../../shared/schema/setup";
import { DEFAULT_SETTINGS } from "../../../shared/config";
import { initialChoices } from "../../../shared/setup";
import { next, type Next } from "../../../shared/tea/program";
import { type Msg as ConfigMsg, Msg as ConfigMsgs } from "../config/config.program";
import { type Msg as MessagesMsg, warn } from "../messages/messages.program";
import { type Msg as VimMsg, Msg as VimMsgs } from "../vim/vim.program";
import { choicesProblem, isSearchUrl, renderSetup, type SetupFiles } from "../../setup-files";

/**
 * Whether the first-run wizard is up. Its steps and choices live in the
 * wizard's own document; main previews and writes what it is sent.
 */
export interface Model {
  readonly open: boolean;
  /** Bumped on every opening, so the document starts over. */
  readonly seq: number;
  readonly options: SetupOptions | null;
  /** The latest preview asked for. An older one that lands late is dropped. */
  readonly revision: number;
  readonly saving: boolean;
  /** Why the last Finish wrote nothing. */
  readonly error: string | null;
}

export const init: Model = {
  open: false,
  seq: 0,
  options: null,
  revision: 0,
  saving: false,
  error: null,
};

const Files = Schema.Struct({ toml: Schema.String, css: Schema.UndefinedOr(Schema.String) });

export const Msg = Schema.TaggedUnion({
  SetupOpened: {},
  SetupOptionsLoaded: { options: SetupOptions },
  SetupChoicesChanged: { choices: SetupChoices },
  SetupPreviewLoaded: { config: UserConfig, revision: Schema.Int },
  SetupFinished: { choices: SetupChoices },
  SetupSkipped: {},
  SetupWritten: {},
  SetupNotSaved: { reason: Schema.String },
  /** A config.toml appeared while the wizard was up. It is the user's, so the wizard gives way. */
  SetupSuperseded: { reason: Schema.String },
});

export type Msg = typeof Msg.Type;

export const Cmd = Schema.TaggedUnion({
  LoadSetupOptions: {},
  PreviewSetup: { files: Files, revision: Schema.Int },
  WriteSetup: { files: Files },
});

export type Cmd = typeof Cmd.Type;

type Result = Next<Model, ConfigMsg | MessagesMsg | VimMsg | Msg, Cmd>;

/** Choices as files, or undefined for a recipe the options do not know. */
function render(choices: SetupChoices, options: SetupOptions): SetupFiles | undefined {
  const recipe = options.recipes.find((option) => option.id === choices.recipe);

  return recipe && renderSetup(choices, recipe, !options.densityAvailable);
}

function preview(model: Model, choices: SetupChoices): Result {
  if (!model.open || model.saving || model.options === null) return next(model);

  // A half-typed search URL changes nothing on screen, so it must not hold the rest back.
  const shown = isSearchUrl(choices.searchUrl)
    ? choices
    : { ...choices, searchUrl: DEFAULT_SETTINGS.searchUrl };

  const files = render(shown, model.options);

  if (files === undefined) return next(model);
  const revision = model.revision + 1;

  return next({ ...model, revision }, [Cmd.cases.PreviewSetup.make({ files, revision })]);
}

function save(model: Model, choices: SetupChoices): Result {
  if (!model.open || model.saving || model.options === null) return next(model);
  const problem = choicesProblem(choices, model.options);
  const files = problem === undefined ? render(choices, model.options) : undefined;

  if (files === undefined) {
    const error = problem ?? `no recipe named ${choices.recipe}`;

    return next({ ...model, error }, [], [warn(error)]);
  }

  return next({ ...model, saving: true, error: null }, [Cmd.cases.WriteSetup.make({ files })]);
}

/** Skipping writes the first-run recipe as it comes, and drops the preview at once. */
function skip(model: Model): Result {
  if (!model.open || model.saving || model.options === null) return next(model);
  const choices = initialChoices(model.options);
  const recipe = model.options.recipes.find((option) => option.id === choices?.recipe);

  if (choices === undefined || recipe === undefined) return next(model);
  const files = renderSetup(choices, recipe, true);

  return next(
    { ...model, saving: true, error: null },
    [Cmd.cases.WriteSetup.make({ files })],
    [ConfigMsgs.cases.PreviewEnded.make({ saved: false })],
  );
}

const close = (model: Model): Model => ({ ...model, open: false, saving: false, error: null });

const toPage = VimMsgs.cases.ModeRequested.make({ mode: "normal" });

export function update(msg: Msg, model: Model): Result {
  return Msg.match(msg, {
    SetupOpened: () =>
      next({ ...init, open: true, seq: model.seq + 1, revision: model.revision }, [
        Cmd.cases.LoadSetupOptions.make({}),
      ]),
    SetupOptionsLoaded: ({ options }) => {
      const loaded = { ...model, options };
      const choices = initialChoices(options);

      return choices === undefined ? next(loaded) : preview(loaded, choices);
    },
    SetupChoicesChanged: ({ choices }) => preview(model, choices),
    SetupPreviewLoaded: ({ config, revision }) =>
      model.open && !model.saving && revision === model.revision
        ? next(model, [], [ConfigMsgs.cases.PreviewLoaded.make({ config })])
        : next(model),
    SetupFinished: ({ choices }) => save(model, choices),
    SetupSkipped: () => skip(model),
    SetupWritten: () =>
      next(close(model), [], [ConfigMsgs.cases.PreviewEnded.make({ saved: true }), toPage]),
    SetupNotSaved: ({ reason }) =>
      next({ ...model, saving: false, error: reason }, [], [warn(reason)]),
    SetupSuperseded: ({ reason }) =>
      next(
        close(model),
        [],
        [ConfigMsgs.cases.PreviewEnded.make({ saved: false }), toPage, warn(reason)],
      ),
  });
}
