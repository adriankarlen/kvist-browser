/**
 * Grandfathered files with over-limit comments. The lists only shrink: when
 * a file holds no overruns, the linter reports it as stale until deleted.
 */

export const verboseCommentScriptScope: ReadonlySet<string> = new Set([]);

export const verboseCommentDocScope: ReadonlySet<string> = new Set([]);
