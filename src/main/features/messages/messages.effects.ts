import { Effect } from "effect";
import type { Interpret } from "../../../shared/tea/store";
import { Cmd, type Msg } from "./messages.program";

export const interpret: Interpret<Msg, Cmd, never, never> = (cmd) =>
  Cmd.match(cmd, {
    LogMessage: ({ message }) =>
      message.level === "error" ? Effect.logError(message.text) : Effect.logInfo(message.text),
  });
