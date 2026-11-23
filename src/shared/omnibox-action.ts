import type { TabId } from "./schema/browser";
import type { CompletionCandidate, OmniboxSuggestion } from "./schema/completion";

/**
 * A tab row carries its id as the value and shows its URL as the hint. The
 * overlay hands back the candidate alone, so the id must ride in it.
 */
export function omniboxCandidate(row: OmniboxSuggestion): CompletionCandidate {
  if (row.kind === "tab" && row.tabId !== undefined) {
    return { label: row.label, value: String(row.tabId), kind: "tab", hint: row.value };
  }

  // A history row's label is usually its URL already, so a hint would repeat it.
  if (row.kind === "bookmark") {
    return { label: row.label, value: row.value, kind: row.kind, hint: row.value };
  }

  return { label: row.label, value: row.value, kind: row.kind };
}

export interface OmniboxTarget {
  navigate(url: string): void;
  activate(id: TabId): void;
}

/** A picked row is a concrete destination: an open tab to switch to, or a URL to load as is. */
export function acceptOmnibox(candidate: CompletionCandidate, target: OmniboxTarget): void {
  const id = Number(candidate.value);

  if (candidate.kind === "tab" && Number.isInteger(id)) target.activate(id);
  else target.navigate(candidate.value);
}
