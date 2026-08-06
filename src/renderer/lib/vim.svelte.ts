import type { Mode } from "../../shared/ipc";

const state = $state<{ mode: Mode }>({ mode: "normal" });

window.kvist.onMode((mode) => {
  state.mode = mode;
});

export const vim = {
  get mode(): Mode {
    return state.mode;
  },
  /** Hands control back to the page; main moves focus off the chrome. */
  toNormal(): void {
    window.kvist.setMode("normal");
  },
};
