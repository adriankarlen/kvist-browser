import type { CompletionCandidate } from "../shared/ipc";

/**
 * The badge letter for a candidate's kind, or a neutral "•" when it has
 * none — every row gets a badge, not just the ones with a kind.
 */
export function kindBadge(candidate: Pick<CompletionCandidate, "kind">): string {
  return candidate.kind ? candidate.kind.charAt(0).toLowerCase() : "•";
}

/**
 * `kind` is free-form and ends up in a CSS custom property *name*, not a
 * value, so `var()`'s own escaping does nothing for it — a kind containing
 * `)`, `;`, or whitespace could close the declaration early and inject
 * arbitrary CSS. Restricted to the characters a token name can use; anything
 * else is treated the same as no kind at all.
 */
const KIND_TOKEN_PATTERN = /^[a-z0-9-]+$/i;

/**
 * Inline style for a candidate's badge: the kind's own colour, and a
 * background tinted towards it by `color-mix`. A kind with no dedicated
 * `--kv-completion-kind-<kind>-fg`, and a candidate with no kind at all,
 * both fall back to the default badge colour — every row gets the same
 * tinted-square look, never a blank space where the colour would be.
 */
export function kindBadgeStyle(candidate: Pick<CompletionCandidate, "kind">): string {
  const kind =
    candidate.kind && KIND_TOKEN_PATTERN.test(candidate.kind) ? candidate.kind : undefined;
  const fg = kind
    ? `var(--kv-completion-kind-${kind}-fg, var(--kv-completion-badge-fg))`
    : "var(--kv-completion-badge-fg)";
  return `color: ${fg}; background: color-mix(in srgb, ${fg} var(--kv-completion-badge-tint), var(--kv-completion-bg))`;
}
