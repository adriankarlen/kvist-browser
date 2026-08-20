import type { KvistApi, Message } from "../../shared/ipc";

export type Messages = ReturnType<typeof createMessages>;

/**
 * The echo area's contents, as main reports them. Nothing is held here: main
 * owns when a message goes away, because main is where the keys arrive.
 */
export function createMessages(bridge: Pick<KvistApi, "onMessage">) {
  const state = $state<{ current: Message | null }>({ current: null });

  bridge.onMessage((message) => {
    state.current = message;
  });

  return {
    get current(): Message | null {
      return state.current;
    },
  };
}
