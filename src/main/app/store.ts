import { Context, type Duration, Effect, Layer, Stream } from "effect";
import { interpretAll, interpretersFor, make, type Store } from "../../shared/tea/store";
import * as Config from "../features/config/config.program";
import * as ConfigFx from "../features/config/config.effects";
import * as Downloads from "../features/downloads/downloads.program";
import * as DownloadsFx from "../features/downloads/downloads.effects";
import * as Messages from "../features/messages/messages.program";
import * as MessagesFx from "../features/messages/messages.effects";
import * as Prompts from "../features/prompts/prompts.program";
import * as PromptsFx from "../features/prompts/prompts.effects";
import * as Tabs from "../features/tabs/tabs.program";
import * as TabsFx from "../features/tabs/tabs.effects";
import * as Vim from "../features/vim/vim.program";
import * as VimFx from "../features/vim/vim.effects";
import type { ConfigApplier } from "../services/config-applier";
import type { Desktop } from "../services/desktop";
import type { LegacyWindow } from "../services/legacy-window";
import type { LiveDownloads } from "../services/live-downloads";
import type { Requesters } from "../services/requesters";
import { type Cmd, type Model, type Msg, program } from "./program";

const interpreter = interpretersFor<
  Msg,
  Cmd,
  never,
  Requesters | Desktop | LegacyWindow | LiveDownloads | ConfigApplier
>();

const interpret = interpretAll<
  Msg,
  Cmd,
  never,
  Requesters | Desktop | LegacyWindow | LiveDownloads | ConfigApplier
>([
  interpreter(Config.Cmd, ConfigFx.interpret),
  interpreter(Downloads.Cmd, DownloadsFx.interpret),
  interpreter(Messages.Cmd, MessagesFx.interpret),
  interpreter(Prompts.Cmd, PromptsFx.interpret),
  interpreter(Tabs.Cmd, TabsFx.interpret),
  interpreter(Vim.Cmd, VimFx.interpret),
]);

/** Main's one loop, app-scoped: it starts with the runtime and stops with it. */
export class MainStore extends Context.Service<MainStore, Store<Model, Msg>>()("kvist/MainStore") {
  static layer = Layer.effect(MainStore, make(program, interpret));
}

/**
 * A slice of the model, pushed out every time it changes. This is how a
 * view leaves main: the selector is the view, `publish` the transport.
 */
export const project = <A>(
  select: (model: Model) => A,
  publish: (value: A) => void,
): Effect.Effect<void, never, MainStore> =>
  Effect.flatMap(Effect.service(MainStore), (store) =>
    store.changes.pipe(
      Stream.map(select),
      Stream.changes,
      Stream.runForEach((value) => Effect.sync(() => publish(value))),
    ),
  );

/**
 * Like `project`, at most once per `every`, always ending on the latest
 * value: a transfer reports far more often than anyone can read.
 */
export const projectThrottled = <A>(
  select: (model: Model) => A,
  publish: (value: A) => void,
  every: Duration.Input,
): Effect.Effect<void, never, MainStore> =>
  Effect.flatMap(Effect.service(MainStore), (store) =>
    store.changes.pipe(
      Stream.map(select),
      Stream.changes,
      Stream.throttle({ cost: () => 1, units: 1, duration: every }),
      Stream.mapArray((values) => [values[values.length - 1]!] as const),
      Stream.runForEach((value) => Effect.sync(() => publish(value))),
    ),
  );
