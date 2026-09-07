/**
 * A candidate dropdown for a text input, generic over what it is completing.
 * The caller supplies a source (query -> candidates) and decides what
 * accepting one does to its input; this module only owns the list, the
 * selection, and the keys that drive both.
 */
export type Candidate = {
  label: string;
  value: string;
  hint?: string;
  /**
   * A free-form tag such as "bookmark", "history", "search", or "command".
   * This module has no fixed vocabulary for it — a kind becomes a one-letter
   * badge (its first character) coloured by `--kv-completion-kind-<kind>-fg`,
   * a token the caller's feature defines. Nothing here enumerates kinds.
   */
  kind?: string;
};

export type CompletionSource = (query: string) => Candidate[] | Promise<Candidate[]>;

export type Completion = ReturnType<typeof createCompletion>;

export function createCompletion(source: CompletionSource) {
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
      // index is only ever >= 0 right after update() sets it to a valid slot,
      // or after next()/prev() wrap it within the current candidates — so
      // this is a bounds guard against a future change breaking that
      // invariant, not a reachable branch today.
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
      state.index = candidates.length > 0 ? 0 : -1;
    },
    next(): void {
      if (state.candidates.length === 0) return;
      state.index = (state.index + 1) % state.candidates.length;
    },
    prev(): void {
      if (state.candidates.length === 0) return;
      state.index = (state.index - 1 + state.candidates.length) % state.candidates.length;
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

/**
 * The badge letter for a candidate's kind, or a neutral "•" when it has
 * none — every row gets a badge, not just the ones with a kind.
 */
export function kindBadge(candidate: Pick<Candidate, "kind">): string {
  return candidate.kind ? candidate.kind.charAt(0).toLowerCase() : "•";
}

/**
 * Inline style for a candidate's badge: the kind's own colour, and a
 * background tinted towards it by `color-mix`. A kind with no dedicated
 * `--kv-completion-kind-<kind>-fg`, and a candidate with no kind at all,
 * both fall back to the default badge colour — every row gets the same
 * tinted-square look, never a blank space where the colour would be.
 *
 * `kind` is free-form and ends up in a CSS custom property *name*, not a
 * value, so `var()`'s own escaping does nothing for it — a kind containing
 * `)`, `;`, or whitespace could close the declaration early and inject
 * arbitrary CSS. Restricted to the characters a token name can use; anything
 * else is treated the same as no kind at all.
 */
const KIND_TOKEN_PATTERN = /^[a-z0-9-]+$/i;

export function kindBadgeStyle(candidate: Pick<Candidate, "kind">): string {
  const kind =
    candidate.kind && KIND_TOKEN_PATTERN.test(candidate.kind) ? candidate.kind : undefined;
  const fg = kind
    ? `var(--kv-completion-kind-${kind}-fg, var(--kv-completion-badge-fg))`
    : "var(--kv-completion-badge-fg)";
  return `color: ${fg}; background: color-mix(in srgb, ${fg} var(--kv-completion-badge-tint), var(--kv-completion-bg))`;
}
