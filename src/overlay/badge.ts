import type { CompletionCandidate } from "../shared/ipc";

/**
 * The badge letter for a candidate's kind, or a neutral "•" when it has
 * none — every row gets a badge, not just the ones with a kind.
 */
export function kindBadge(candidate: Pick<CompletionCandidate, "kind">): string {
  return candidate.kind ? candidate.kind.charAt(0).toLowerCase() : "•";
}

/**
 * `kind` ends up in a CSS custom property *name*, not a value, so a kind
 * containing `)`, `;`, or whitespace could close the declaration and inject
 * CSS. Restricted to token-name characters; anything else is no kind.
 */
const KIND_TOKEN_PATTERN = /^[a-z0-9-]+$/i;

/**
 * Inline style for a candidate's badge: the kind's colour, and a background
 * tinted towards it via `color-mix`. Without a dedicated
 * `--kv-completion-kind-<kind>-fg`, or without a kind at all, the default
 * badge colour applies — every row keeps its tinted square.
 */
export function kindBadgeStyle(candidate: Pick<CompletionCandidate, "kind">): string {
  const kind =
    candidate.kind && KIND_TOKEN_PATTERN.test(candidate.kind) ? candidate.kind : undefined;
  const fg = kind
    ? `var(--kv-completion-kind-${kind}-fg, var(--kv-completion-badge-fg))`
    : "var(--kv-completion-badge-fg)";
  return `color: ${fg}; background: color-mix(in srgb, ${fg} var(--kv-completion-badge-tint), var(--kv-completion-bg))`;
}
