/**
 * Shared budget for prose comments, used by the oxlint rule for script
 * sources and by the document scanner for CSS, HTML, and Svelte templates:
 * what counts as a word, which comments are exempt, and how consecutive
 * line comments merge into one comment.
 */
export const COMMENT_WORD_LIMIT = 40;

export type ProseComment = {
	type: string;
	value: string;
	line: number;
	endLine: number;
};

export type CommentRun<T> = {
	comment: T;
	value: string;
	line: number;
};

const directivePattern =
	/^(?:@ts-(?:expect-error|ignore|check|nocheck)\b|#?@__PURE__\b|(?:oxlint|eslint|biome|deno-lint|dprint|prettier|svelte)[ \t-]*(?:ignore[a-z-]*|disable[a-z-]*|enable\b|env\b)|c8 ignore\b|v8 ignore\b|istanbul ignore\b)/u;

const wordCharacterPattern = /[A-Za-z0-9]/u;

/** Tool directives carry instructions, not prose, and are outside the budget. */
export function isDirectiveText(text: string): boolean {
	return directivePattern.test(text.trim());
}

/** License banners have legally fixed wording; the budget does not rewrite them. */
export function isLicenseText(text: string): boolean {
	return text.trimStart().startsWith("!") || text.includes("@license");
}

export function countWords(value: string): number {
	let words = 0;
	for (const token of bulletStripped(value).split(/\s+/u)) {
		if (wordCharacterPattern.test(token)) words += 1;
	}
	return words;
}

/** Drop the `*` bullet a block comment puts on every continuation line. */
function bulletStripped(value: string): string {
	return value.replace(/^[ \t]*\*+/gmu, "");
}

/**
 * Adjacent line comments state one thought together, so they merge into a
 * single run before counting. A directive or license notice breaks a run
 * instead of joining one.
 */
export function commentRuns<T extends ProseComment>(comments: readonly T[]): CommentRun<T>[] {
	const runs: CommentRun<T>[] = [];
	let open: CommentRun<T> | null = null;
	for (const comment of comments) {
		if (isLicenseText(comment.value)) {
			open = null;
			continue;
		}
		if (comment.type === "Line" && isDirectiveText(comment.value)) {
			open = null;
			continue;
		}
		const continuing =
			open !== null &&
			open.comment.type === "Line" &&
			comment.type === "Line" &&
			comment.line === open.endLine + 1;
		if (open !== null && continuing) {
			open.value += `\n${comment.value}`;
			open.endLine = comment.line;
			continue;
		}
		open = { comment, value: comment.value, line: comment.line, endLine: comment.endLine };
		runs.push(open);
	}
	return runs;
}

export type CommentCheckOptions = {
	baseline: ReadonlySet<string>;
	filename: string;
	cwd: string;
	limit?: number;
};

export type OverLimitComment<T> = {
	comment: T;
	line: number;
	words: number;
};

export type CommentCheckResult<T> = {
	overLimit: OverLimitComment<T>[];
	staleBaseline: boolean;
};

/**
 * Collect every comment over the limit, or mark a baselined file whose
 * comments all fit: its exemption went stale and must be pruned.
 */
export function checkComments<T extends ProseComment>(
	comments: readonly T[],
	options: CommentCheckOptions,
): CommentCheckResult<T> {
	const limit = options.limit ?? COMMENT_WORD_LIMIT;
	const exempt = options.baseline.has(repoRelative(options.filename, options.cwd));
	const overLimit: OverLimitComment<T>[] = [];
	for (const run of commentRuns(comments)) {
		const words = countWords(run.value);
		if (words <= limit) continue;
		if (exempt) return { overLimit: [], staleBaseline: false };
		overLimit.push({ comment: run.comment, line: run.line, words });
	}
	return { overLimit, staleBaseline: exempt && overLimit.length === 0 };
}

/** Baselines key on repo-relative paths; an off-repo absolute path can only miss. */
function repoRelative(filename: string, cwd: string): string {
	const prefix = cwd.endsWith("/") ? cwd : `${cwd}/`;
	return filename.startsWith(prefix) ? filename.slice(prefix.length) : filename;
}
