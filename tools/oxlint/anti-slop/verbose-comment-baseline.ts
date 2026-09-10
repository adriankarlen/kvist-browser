/**
 * Files that still carried over-limit prose comments when the 40-word cap
 * landed. The lists only shrink: once a file holds no over-limit comment,
 * its linter (the oxlint rule or the document scanner) reports the entry as
 * stale until it is pruned. Prune by deleting the path, not by rewording.
 */

export const verboseCommentScriptScope: ReadonlySet<string> = new Set([]);

export const verboseCommentDocScope: ReadonlySet<string> = new Set([]);
