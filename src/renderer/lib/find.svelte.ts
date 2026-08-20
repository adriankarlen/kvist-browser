import type { FindResult, KvistApi } from "../../shared/ipc";

export type Find = ReturnType<typeof createFind>;

/**
 * The active tab's search, as main reports it. Nothing is mirrored here: the
 * matches live on the tab, so switching tabs has to change what the chrome
 * shows, and only main knows that.
 */
export function createFind(bridge: Pick<KvistApi, "onFindResult" | "find" | "stopFind">) {
  const state = $state<{ result: FindResult | null }>({ result: null });

  bridge.onFindResult((result) => {
    state.result = result;
  });

  return {
    get result(): FindResult | null {
      return state.result;
    },
    get query(): string {
      return state.result?.query ?? "";
    },
    /** Whether a search is still highlighted, which is what `n` acts on. */
    get active(): boolean {
      return state.result !== null;
    },
    run(query: string): void {
      bridge.find(query);
    },
    stop(): void {
      // Cleared here rather than waiting for main to echo back: main answers
      // nothing when there was no search to stop.
      state.result = null;
      bridge.stopFind();
    },
  };
}
