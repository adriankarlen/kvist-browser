import type { KvistApi, Mode } from "../../shared/ipc";

export type Vim = ReturnType<typeof createVim>;

/** The mode, as main reports it. Main owns it; this only asks. */
export function createVim(bridge: Pick<KvistApi, "onMode" | "setMode">) {
  const state = $state<{ mode: Mode }>({ mode: "normal" });

  bridge.onMode((mode) => {
    state.mode = mode;
  });

  return {
    get mode(): Mode {
      return state.mode;
    },
    /** Hands control back to the page; main moves focus off the chrome. */
    toNormal(): void {
      bridge.setMode("normal");
    },
  };
}
