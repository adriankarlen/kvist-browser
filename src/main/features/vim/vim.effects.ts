import { Effect } from "effect";
import type { Interpret } from "../../../shared/tea/store";
import { LegacyWindow } from "../../services/legacy-window";
import { Cmd } from "./vim.program";

export const interpret: Interpret<never, Cmd, never, LegacyWindow> = (cmd) =>
  Cmd.match(cmd, {
    RunCommand: ({ name, arg }) =>
      Effect.map(Effect.service(LegacyWindow), (window) => window.current?.runCommand(name, arg)),
  });
