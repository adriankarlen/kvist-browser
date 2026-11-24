import { Schema } from "effect";
import { SetupIntent } from "../shared/rpc/setup";
import { InputMode } from "../shared/schema/config";
import { Region } from "../shared/schema/layout";
import { Density, SetupOptions } from "../shared/schema/setup";
import { choicesFor, initialChoices, SEARCH_ENGINES, type SetupChoices } from "../shared/setup";
import { next, type Next, type Program } from "../shared/tea/program";

export const STEPS = ["recipe", "input", "urlbar", "tabs", "search", "done"] as const;

export type Step = (typeof STEPS)[number];

/** The choices a recipe brings. Picking one by hand keeps it through a later recipe change. */
type RecipeField = "inputMode" | "omnibox" | "tabs";

export interface Model {
  /** The opening this document is showing; a new one starts over. */
  readonly seq: number | null;
  readonly options: SetupOptions | null;
  readonly step: number;
  readonly choices: SetupChoices | null;
  readonly touched: ReadonlyArray<RecipeField>;
  /** The custom search field is showing, rather than a listed engine. */
  readonly customSearch: boolean;
  readonly saving: boolean;
  readonly error: string | undefined;
}

export const init: Model = {
  seq: null,
  options: null,
  step: 0,
  choices: null,
  touched: [],
  customSearch: false,
  saving: false,
  error: undefined,
};

export const Msg = Schema.TaggedUnion({
  Opened: { seq: Schema.Int, options: SetupOptions },
  Status: { saving: Schema.Boolean, error: Schema.UndefinedOr(Schema.String) },
  CssChanged: { css: Schema.String },
  RecipePicked: { id: Schema.String },
  InputModePicked: { mode: InputMode },
  OmniboxPicked: { region: Region },
  TabsPicked: { region: Region },
  DensityPicked: { density: Density },
  EnginePicked: { url: Schema.String },
  CustomSearchChosen: {},
  SearchTyped: { url: Schema.String },
  /** Enter, or the Next button. On the last step it finishes. */
  NextRequested: {},
  /** Escape, or the Back button. */
  BackRequested: {},
  SkipRequested: {},
});

export type Msg = typeof Msg.Type;

export const Cmd = Schema.TaggedUnion({
  InjectCss: { css: Schema.String },
  SendToMain: { intent: SetupIntent },
});

export type Cmd = typeof Cmd.Type;

type Result = Next<Model, never, Cmd>;

const I = SetupIntent.cases;
const send = (intent: SetupIntent): Cmd => Cmd.cases.SendToMain.make({ intent });

export const stepOf = (model: Model): Step => STEPS[model.step] ?? "recipe";

/** Kept in step with main's own check, so Next can say why before main has to. */
export const hasQuery = (url: string): boolean => url.includes("{q}");

const isEngine = (url: string): boolean => SEARCH_ENGINES.some((engine) => engine.url === url);

function change(model: Model, choices: SetupChoices, touched = model.touched): Result {
  return next({ ...model, choices, touched, error: undefined }, [
    send(I.ChoicesChanged.make({ choices })),
  ]);
}

/** Sets a recipe field by hand. It stays put when the recipe changes later. */
function pick<K extends RecipeField>(model: Model, field: K, value: SetupChoices[K]): Result {
  if (model.choices === null) return next(model);
  const touched = model.touched.includes(field) ? model.touched : [...model.touched, field];

  return change(model, { ...model.choices, [field]: value }, touched);
}

/** A new recipe brings its own settings, except the ones picked by hand. */
function pickRecipe(model: Model, id: string): Result {
  const recipe = model.options?.recipes.find((option) => option.id === id);

  if (recipe === undefined || model.choices === null) return next(model);
  const fresh = choicesFor(recipe, model.choices);
  const kept = Object.fromEntries(model.touched.map((field) => [field, model.choices![field]]));

  return change(model, { ...fresh, ...kept });
}

function forward(model: Model): Result {
  if (model.choices === null || model.saving) return next(model);

  if (stepOf(model) === "search" && !hasQuery(model.choices.searchUrl))
    return next({ ...model, error: 'The search URL needs a "{q}" where the query goes.' });

  if (model.step < STEPS.length - 1)
    return next({ ...model, step: model.step + 1, error: undefined });

  return next({ ...model, error: undefined }, [send(I.Finished.make({ choices: model.choices }))]);
}

function opened(model: Model, seq: number, options: SetupOptions): Result {
  if (seq === model.seq) return next({ ...model, options });
  const choices = initialChoices(options) ?? null;

  return next({
    ...init,
    seq,
    options,
    choices,
    customSearch: choices !== null && !isEngine(choices.searchUrl),
  });
}

function update(msg: Msg, model: Model): Result {
  return Msg.match(msg, {
    Opened: ({ seq, options }) => opened(model, seq, options),
    Status: ({ saving, error }) =>
      next({ ...model, saving, error: error ?? (saving ? undefined : model.error) }),
    CssChanged: ({ css }) => next(model, [Cmd.cases.InjectCss.make({ css })]),
    RecipePicked: ({ id }) => pickRecipe(model, id),
    InputModePicked: ({ mode }) => pick(model, "inputMode", mode),
    OmniboxPicked: ({ region }) => pick(model, "omnibox", region),
    TabsPicked: ({ region }) => pick(model, "tabs", region),
    DensityPicked: ({ density }) =>
      model.choices === null ? next(model) : change(model, { ...model.choices, density }),
    EnginePicked: ({ url }) =>
      model.choices === null
        ? next(model)
        : change({ ...model, customSearch: false }, { ...model.choices, searchUrl: url }),
    CustomSearchChosen: () => next({ ...model, customSearch: true }),
    SearchTyped: ({ url }) =>
      model.choices === null ? next(model) : change(model, { ...model.choices, searchUrl: url }),
    NextRequested: () => forward(model),
    BackRequested: () =>
      next(model.step === 0 ? model : { ...model, step: model.step - 1, error: undefined }),
    SkipRequested: () => (model.saving ? next(model) : next(model, [send(I.Skipped.make({}))])),
  });
}

export const program: Program<Model, Msg, Cmd> = { init: next(init), update };
