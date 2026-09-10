import { defineRule } from "@oxlint/plugins";

import { COMMENT_WORD_LIMIT, checkComments } from "../shared/verbose-comments.ts";
import { verboseCommentScriptScope } from "../verbose-comment-baseline.ts";

/** Cap prose comments at the shared word limit; a baselined file must shed its over-limit comments or shed its entry. */
export const noVerboseCommentsRule = defineRule({
	meta: {
		type: "problem",
		docs: {
			description:
				"Disallow prose comments above the shared word limit; consecutive line comments count as one comment.",
		},
		messages: {
			verboseComment:
				"Comment is {{words}} words; the limit is {{limit}}. Shorten the comment, or move detailed reasoning into documentation.",
			staleBaselineEntry:
				"No over-limit comment remains in this file; prune its entry from verbose-comment-baseline.ts so exemptions keep shrinking.",
		},
	},
	createOnce(context) {
		return {
			Program(program) {
				const result = checkComments(context.sourceCode.getAllComments(), {
					baseline: verboseCommentScriptScope,
					filename: context.filename,
					cwd: process.cwd(),
				});
				for (const over of result.overLimit) {
					context.report({
						node: over.comment,
						messageId: "verboseComment",
						data: { words: over.words, limit: COMMENT_WORD_LIMIT },
					});
				}
				if (result.staleBaseline) {
					context.report({ node: program, messageId: "staleBaselineEntry" });
				}
			},
		};
	},
});
