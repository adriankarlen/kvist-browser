import { Schema } from "effect";
import { ChromeIntent } from "../../../shared/rpc/chrome";
import { BrowserState, FindResult, Message, Mode } from "../../../shared/schema/browser";
import type { TabState } from "../../../shared/schema/browser";
import { PromptWire } from "../../../shared/schema/prompts";
import { next, type Next } from "../../../shared/tea/program";
import { type Cmd as LinkCmd, send } from "../link/link.program";

/** What main last said: nothing here is decided by the chrome. */
export interface Model {
  readonly browser: BrowserState;
  readonly mode: Mode;
  readonly message: Message | null;
  readonly prompt: PromptWire | null;
  readonly findResult: FindResult | null;
}

export const init: Model = {
  browser: { tabs: [], activeId: null },
  mode: "normal",
  message: null,
  prompt: null,
  findResult: null,
};

export const Msg = Schema.TaggedUnion({
  StateChanged: { state: BrowserState },
  ModeChanged: { mode: Mode },
  MessageChanged: { message: Schema.NullOr(Message) },
  PromptChanged: { prompt: Schema.NullOr(PromptWire) },
  FindResultChanged: { result: Schema.NullOr(FindResult) },
  /** The find line closed: stop now rather than wait for main to say so. */
  FindStopped: {},
  /** Clicking a prompt button, or outside the prompt. The id goes with it so a stale answer settles nothing. */
  PromptButtonClicked: { allow: Schema.Boolean },
});

export type Msg = typeof Msg.Type;

const I = ChromeIntent.cases;

export function update(msg: Msg, model: Model): Next<Model, never, LinkCmd> {
  return Msg.match(msg, {
    StateChanged: ({ state }) => next({ ...model, browser: state }),
    ModeChanged: ({ mode }) => next({ ...model, mode }),
    MessageChanged: ({ message }) => next({ ...model, message }),
    PromptChanged: ({ prompt }) => next({ ...model, prompt }),
    FindResultChanged: ({ result }) => next({ ...model, findResult: result }),
    FindStopped: () => next({ ...model, findResult: null }, [send(I.FindStopped.make({}))]),
    PromptButtonClicked: ({ allow }) =>
      model.prompt === null
        ? next(model)
        : next(model, [send(I.PromptAnswered.make({ id: model.prompt.id, allow }))]),
  });
}

export const activeTab = (model: Model): TabState | undefined =>
  model.browser.tabs.find((tab) => tab.id === model.browser.activeId);
