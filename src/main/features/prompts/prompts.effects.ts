import { Effect } from "effect";
import type { Interpret } from "../../../shared/tea/store";
import { Desktop } from "../../services/desktop";
import { LegacyWindow } from "../../services/legacy-window";
import { Requesters } from "../../services/requesters";
import { type Msg as MessagesMsg, warn } from "../messages/messages.program";
import { Cmd } from "./prompts.program";

export const interpret: Interpret<MessagesMsg, Cmd, never, Requesters | Desktop | LegacyWindow> = (
  cmd,
  dispatch,
) =>
  Cmd.match(cmd, {
    SettleRequesters: ({ requesters, allow }) =>
      Effect.map(Effect.service(Requesters), (service) => service.settle(requesters, allow)),
    OpenExternal: ({ url }) =>
      Effect.flatMap(Effect.service(Desktop), (desktop) =>
        desktop
          .openExternal(url)
          .pipe(
            Effect.catch(() => Effect.sync(() => dispatch(warn(`no application handles ${url}`)))),
          ),
      ),
    SessionRestoreDecided: ({ allow }) =>
      Effect.map(Effect.service(LegacyWindow), (window) => window.current?.restoreSession(allow)),
  });
