import type { CompletionCandidate, CompletionOverlayState, KvistApi } from "../../shared/ipc";

export interface CompletionOverlayClient {
  show(state: CompletionOverlayState): void;
  /** Hides the overlay only while this input owns it. */
  hide(): void;
  release(): void;
}

/**
 * Shares the one overlay view between the chrome's inputs. Main relays a
 * clicked row to the whole chrome, so this routes it to whichever input
 * showed the list last.
 */
export function createCompletionOverlay(
  bridge: Pick<KvistApi, "completionOverlay" | "onCompletionAccept">,
) {
  const accepts = new Map<symbol, (candidate: CompletionCandidate) => void>();
  // Kept past hide(): a click blurs the input, which hides the list before
  // the pick arrives back from main.
  let owner: symbol | null = null;

  bridge.onCompletionAccept((candidate) => {
    if (owner !== null) accepts.get(owner)?.(candidate);
  });

  return {
    claim(onAccept: (candidate: CompletionCandidate) => void): CompletionOverlayClient {
      const id = Symbol("completion-client");
      accepts.set(id, onAccept);
      const hide = (): void => {
        if (owner === id) bridge.completionOverlay(null);
      };
      return {
        show(state) {
          owner = id;
          bridge.completionOverlay(state);
        },
        hide,
        release() {
          hide();
          accepts.delete(id);
          if (owner === id) owner = null;
        },
      };
    },
  };
}
