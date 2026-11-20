import { Effect } from "effect";
import type { Interpret } from "../../../shared/tea/store";
import { LiveDownloads } from "../../services/live-downloads";
import { Cmd } from "./downloads.program";

export const interpret: Interpret<never, Cmd, never, LiveDownloads> = (cmd) =>
  Cmd.match(cmd, {
    // Anything that has already stopped is left alone.
    CancelDownload: ({ id }) =>
      Effect.map(Effect.service(LiveDownloads), (live) => live.items.get(id)?.cancel()),
  });
