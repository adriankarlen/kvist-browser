import { Schema } from "effect";
import { UserConfig } from "../../../shared/schema/config";
import { next, type Next } from "../../../shared/tea/program";
import { type Msg as MessagesMsg, say, warn } from "../messages/messages.program";
import { type Msg as VimMsg, Msg as VimMsgs } from "../vim/vim.program";

const Problem = Schema.Struct({
  field: Schema.String,
  reason: Schema.String,
  file: Schema.optionalKey(Schema.String),
});

const StyleSource = Schema.Struct({ id: Schema.String, source: Schema.String });

/** A style file's problem: the file names itself, and the echo area shows its basename. */
const StyleProblem = Schema.Struct({ id: Schema.String, reason: Schema.String });

/**
 * The config in force. `current` is published only once everything
 * process-wide (the blocker, local pages, downloads) has taken it, so a
 * window opened mid-apply never configures itself from a config the rest
 * of the app has not seen.
 */
export interface Model {
  readonly current: UserConfig | null;
  /** Every recipe `:recipe` may pick, as of the last load. */
  readonly recipes: ReadonlyArray<string>;
  /** A recipe written to config.toml but not applied yet. A later `:recipe` compares against it. */
  readonly pending: string | null;
  /** The latest config read from disk. */
  readonly loaded: UserConfig | null;
  /** A config the setup wizard is showing off. It outranks `loaded` until it ends. */
  readonly preview: Preview | null;
}

export interface Preview {
  readonly config: UserConfig;
  /** Written to disk: it ends with the next load, which says the same, so nothing flickers. */
  readonly saved: boolean;
}

export const init: Model = {
  current: null,
  recipes: [],
  pending: null,
  loaded: null,
  preview: null,
};

export const Msg = Schema.TaggedUnion({
  /** config.toml or config.css was read: at startup, and after every save. */
  ConfigLoaded: {
    config: UserConfig,
    problems: Schema.Array(Problem),
    recipes: Schema.Array(Schema.String),
  },
  ConfigApplied: { config: UserConfig },
  StylesLoaded: { sources: Schema.Array(StyleSource) },
  StylesApplied: { problems: Schema.Array(StyleProblem) },
  /** `:recipe [name]`. No name asks which recipe is in force. */
  RecipeChosen: { name: Schema.UndefinedOr(Schema.String) },
  RecipeNotSaved: { reason: Schema.String },
  /** Applied in place of the files until `PreviewEnded`. Nothing is written. */
  PreviewLoaded: { config: UserConfig },
  /** Back to what the files say: now, or once `saved` files have been read back. */
  PreviewEnded: { saved: Schema.Boolean },
});

export type Msg = typeof Msg.Type;

export const Cmd = Schema.TaggedUnion({
  /** Applied one at a time, in order: blocking can take seconds to fetch its lists. */
  ApplyConfig: { config: UserConfig },
  ApplyStyles: { sources: Schema.Array(StyleSource) },
  LogProblems: { lines: Schema.Array(Schema.String) },
  /** Points config.toml at a recipe. The save then comes back as a `ConfigLoaded`. */
  WriteRecipe: { name: Schema.String },
});

export type Cmd = typeof Cmd.Type;

type Result = Next<Model, MessagesMsg | VimMsg, Cmd>;

/** How a config problem reads: which file, which field, and why. */
export function describeProblem({
  file = "config.toml",
  field,
  reason,
}: typeof Problem.Type): string {
  // A problem with the file itself names the file as its field; saying so twice reads as a bug.
  return field === file ? `${file}: ${reason}` : `${file}: ${field}: ${reason}`;
}

const basename = (path: string): string => path.slice(path.lastIndexOf("/") + 1);

/**
 * The echo area holds one line, so the first problem is shown and the rest
 * counted; the log gets them all.
 */
function report(lines: ReadonlyArray<string>, shown: (first: string) => string): Result {
  const [first, ...rest] = lines;

  if (first === undefined) return next(init);
  const more = rest.length === 0 ? "" : ` (+${rest.length} more)`;

  return next(init, rest.length === 0 ? [] : [Cmd.cases.LogProblems.make({ lines: rest })], [
    warn(`${shown(first)}${more}`),
  ]);
}

/** What `:recipe` does with a name: report, refuse, or write it to config.toml. */
function chooseRecipe(name: string | undefined, model: Model): Result {
  const active = model.pending ?? model.current?.recipe.name;

  if (name === undefined || name === "") {
    return next(
      model,
      [],
      [say(`recipe ${active ?? "?"} (available: ${model.recipes.join(", ")})`)],
    );
  }

  if (!model.recipes.includes(name)) return next(model, [], [warn(`no recipe named ${name}`)]);

  if (name === active) return next(model, [], [say(`recipe ${name} is already in use`)]);

  return next({ ...model, pending: name }, [Cmd.cases.WriteRecipe.make({ name })]);
}

export function update(msg: Msg, model: Model): Result {
  return Msg.match(msg, {
    ConfigLoaded: ({ config, problems, recipes }) => {
      const reported = report(problems.map(describeProblem), (line) => line);
      // A save during a preview is kept for later, so the preview does not flicker away.
      const showing = model.preview !== null && !model.preview.saved;
      const apply = showing ? [] : [Cmd.cases.ApplyConfig.make({ config })];

      return next(
        { ...model, recipes, loaded: config, preview: showing ? model.preview : null },
        [...reported.cmds, ...apply],
        reported.msgs,
      );
    },
    ConfigApplied: ({ config }) => {
      const scheme = config.settings.inputMode;
      const changed = model.current === null || model.current.settings.inputMode !== scheme;

      const pending = model.pending === config.recipe.name ? null : model.pending;

      return next(
        { ...model, current: config, pending },
        [],
        changed ? [VimMsgs.cases.InputModeChanged.make({ scheme })] : [],
      );
    },
    StylesLoaded: ({ sources }) => next(model, [Cmd.cases.ApplyStyles.make({ sources })]),
    StylesApplied: ({ problems }) => {
      const lines = problems.map(({ id, reason }) => `${id}: ${reason}`);
      // The echo area names the file, not the full path: a deep config
      // directory would push the reason itself off the end of the line.
      const reported = report(lines, (line) => basename(line));

      return next(model, reported.cmds, reported.msgs);
    },
    RecipeChosen: ({ name }) => chooseRecipe(name, model),
    RecipeNotSaved: ({ reason }) => next({ ...model, pending: null }, [], [warn(reason)]),
    PreviewLoaded: ({ config }) =>
      next({ ...model, preview: { config, saved: false } }, [
        Cmd.cases.ApplyConfig.make({ config }),
      ]),
    PreviewEnded: ({ saved }) => {
      if (model.preview === null) return next(model);

      if (saved) return next({ ...model, preview: { ...model.preview, saved } });

      const restore =
        model.loaded === null ? [] : [Cmd.cases.ApplyConfig.make({ config: model.loaded })];

      return next({ ...model, preview: null }, restore);
    },
  });
}
