/**
 * A candidate dropdown for a text input, generic over what it is completing.
 * The caller supplies a source (query -> candidates) and decides what
 * accepting one does to its input; this module only owns the list, the
 * selection, and the keys that drive both.
 *
 * The rows are rendered in an overlay view rather than in this document — a
 * tab's `WebContentsView` paints over the chrome, so a dropdown here would be
 * hidden by the page. A candidate makes the trip through main to get there,
 * which is why its type lives in `shared/ipc.ts`.
 */
import type { CompletionCandidate } from "../../shared/ipc";

export type Candidate = CompletionCandidate;

export type CompletionSource = (query: string) => Candidate[] | Promise<Candidate[]>;

export interface CompletionOptions {
  /**
   * Whether `update()` preselects the first candidate. Tab-completion
   * (the command line) wants this: Tab should have something to cycle from
   * immediately. A URL bar must not: preselecting would let a bare Enter
   * after typing silently navigate to a ranked suggestion instead of what
   * the user typed. Defaults to `true`.
   */
  selectFirst?: boolean;
}

export type Completion = ReturnType<typeof createCompletion>;

export function createCompletion(source: CompletionSource, options: CompletionOptions = {}) {
  const selectFirst = options.selectFirst ?? true;
  const state = $state<{ candidates: Candidate[]; index: number }>({ candidates: [], index: -1 });
  // Bumped on every update and every close, so a slow async source landing
  // after a newer query (or after the list was closed) cannot resurrect it.
  let latest = 0;

  return {
    get candidates(): Candidate[] {
      return state.candidates;
    },
    get index(): number {
      return state.index;
    },
    get open(): boolean {
      return state.candidates.length > 0;
    },
    get active(): Candidate | null {
      // index is only ever >= 0 right after update() sets it to a valid slot
      // (unless selectFirst is false, where it starts at -1 with candidates
      // present until the first next()/prev()), or after next()/prev() wrap
      // it within the current candidates.
      return state.index >= 0 ? state.candidates[state.index] : null;
    },
    async update(query: string): Promise<void> {
      const token = ++latest;
      let candidates: Candidate[];
      try {
        candidates = await source(query);
      } catch {
        // A caller fires this from a keydown handler without awaiting it, so
        // a rejection has nowhere to go but here. Clear the stale list rather
        // than leaving it on screen — but only if nothing newer has already
        // superseded this query.
        if (token === latest) {
          state.candidates = [];
          state.index = -1;
        }
        return;
      }
      if (token !== latest) return;
      state.candidates = candidates;
      state.index = candidates.length > 0 && selectFirst ? 0 : -1;
    },
    next(): void {
      if (state.candidates.length === 0) return;
      state.index = state.index < 0 ? 0 : (state.index + 1) % state.candidates.length;
    },
    prev(): void {
      if (state.candidates.length === 0) return;
      state.index =
        state.index < 0
          ? state.candidates.length - 1
          : (state.index - 1 + state.candidates.length) % state.candidates.length;
    },
    close(): void {
      latest++;
      state.candidates = [];
      state.index = -1;
    },
  };
}

/**
 * Interprets a keydown against an open completion list. Returns whether the
 * key was consumed, so a caller's own handler (which may want Escape for
 * something else, such as closing the whole command line) only acts when
 * this didn't.
 */
export function handleCompletionKey(
  completion: Completion,
  event: Pick<KeyboardEvent, "key" | "shiftKey" | "preventDefault">,
  onAccept: (candidate: Candidate) => void,
): boolean {
  if (!completion.open) return false;

  switch (event.key) {
    case "ArrowDown":
      event.preventDefault();
      completion.next();
      return true;
    case "ArrowUp":
      event.preventDefault();
      completion.prev();
      return true;
    case "Tab":
      event.preventDefault();
      if (event.shiftKey) completion.prev();
      else completion.next();
      return true;
    case "Enter": {
      const candidate = completion.active;
      if (!candidate) return false;
      event.preventDefault();
      completion.close();
      onAccept(candidate);
      return true;
    }
    case "Escape":
      event.preventDefault();
      completion.close();
      return true;
    default:
      return false;
  }
}
