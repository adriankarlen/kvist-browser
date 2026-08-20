import type { Message } from "../../shared/ipc";

const state = $state<{ current: Message | null }>({ current: null });

window.kvist.onMessage((message) => {
  state.current = message;
});

/**
 * The echo area's contents, as main reports them. Nothing is held here: main
 * owns when a message goes away, because main is where the keys arrive.
 */
export const messages = {
  get current(): Message | null {
    return state.current;
  },
};
