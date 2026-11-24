import { Schema } from "effect";
import { UserConfig } from "../../../shared/schema/config";
import { next, type Next } from "../../../shared/tea/program";
import { type Msg as MessagesMsg, warn } from "../messages/messages.program";
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
  /** Every recipe that can be picked, as of the last load. */
  readonly recipes: ReadonlyArray<string>;
}

export const init: Model = { current: null, recipes: [] };

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
});

export type Msg = typeof Msg.Type;

export const Cmd = Schema.TaggedUnion({
  /** Applied one at a time, in order: blocking can take seconds to fetch its lists. */
  ApplyConfig: { config: UserConfig },
  ApplyStyles: { sources: Schema.Array(StyleSource) },
  LogProblems: { lines: Schema.Array(Schema.String) },
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

export function update(msg: Msg, model: Model): Result {
  return Msg.match(msg, {
    ConfigLoaded: ({ config, problems, recipes }) => {
      const reported = report(problems.map(describeProblem), (line) => line);

      return next(
        { ...model, recipes },
        [...reported.cmds, Cmd.cases.ApplyConfig.make({ config })],
        reported.msgs,
      );
    },
    ConfigApplied: ({ config }) => {
      const scheme = config.settings.inputMode;
      const changed = model.current === null || model.current.settings.inputMode !== scheme;

      return next(
        { ...model, current: config },
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
  });
}
