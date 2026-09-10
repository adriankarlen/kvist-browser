import { existsSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vite-plus/test";

import type { ProseComment } from "../oxlint/anti-slop/shared/verbose-comments.ts";
import {
  COMMENT_WORD_LIMIT,
  checkComments,
  commentRuns,
  countWords,
  isDirectiveText,
} from "../oxlint/anti-slop/shared/verbose-comments.ts";
import { verboseCommentDocScope } from "../oxlint/anti-slop/verbose-comment-baseline.ts";
import {
  cssComments,
  scanDocumentScope,
  svelteComments,
  templateComments,
} from "./comment-length.ts";

const BASE_DIR = "/repo";

function words(count: number): string {
  return Array.from({ length: count }, (_, index) => `w${index}`).join(" ");
}

function lineComment(text: string, line: number): ProseComment {
  return { type: "Line", value: text, line, endLine: line };
}

function blockComment(text: string, startLine: number, endLine: number): ProseComment {
  return { type: "Block", value: text, line: startLine, endLine };
}

function checked(comments: ProseComment[], baseline: ReadonlySet<string> = new Set()) {
  return checkComments(comments, { baseline, filename: "src/example.ts", cwd: BASE_DIR });
}

describe("word budget", () => {
  it("accepts a comment at the limit", () => {
    expect(countWords(words(COMMENT_WORD_LIMIT))).toBe(40);
    expect(checked([lineComment(` ${words(40)} `, 1)]).overLimit).toHaveLength(0);
  });

  it("rejects a comment one word past the limit", () => {
    const result = checked([lineComment(words(41), 1)]);
    expect(result.overLimit).toHaveLength(1);
    expect(result.overLimit[0]?.words).toBe(41);
    expect(result.overLimit[0]?.line).toBe(1);
  });

  it("counts only tokens that carry characters", () => {
    expect(countWords("* one * two `---` / -- ")).toBe(2);
  });
});

describe("consecutive line comments", () => {
  it("merges adjacent line comments into one budget", () => {
    const result = checked([lineComment(words(21), 3), lineComment(words(20), 4)]);
    expect(result.overLimit).toHaveLength(1);
    expect(result.overLimit[0]?.words).toBe(41);
  });

  it("keeps runs whole while a comment grows line by line", () => {
    const runs = commentRuns([
      lineComment("alpha", 5),
      lineComment("beta", 6),
      lineComment("gamma", 7),
    ]);
    expect(runs).toHaveLength(1);
    expect(runs[0]?.value).toBe("alpha\nbeta\ngamma");
    expect(runs[0]?.line).toBe(5);
  });

  it("breaks the run on a blank line", () => {
    expect(checked([lineComment(words(25), 1), lineComment(words(25), 3)]).overLimit).toHaveLength(
      0,
    );
  });

  it("breaks the run on a tool directive", () => {
    const result = checked([
      lineComment(" oxlint-disable-next-line foo ", 1),
      lineComment(words(35), 2),
      lineComment(words(35), 5),
    ]);
    expect(result.overLimit).toHaveLength(0);
  });
});

describe("comment shapes", () => {
  it("reports a long block comment and a long JSDoc alike", () => {
    const result = checked([
      blockComment(` long text\n * ${words(42)}\n `, 2, 4),
      blockComment(`\n * @param alpha ${words(40)}\n `, 10, 12),
    ]);
    expect(result.overLimit).toHaveLength(2);
  });

  it("does not merge line comments into a block comment", () => {
    expect(
      checked([lineComment(words(30), 1), blockComment(words(30), 2, 2)]).overLimit,
    ).toHaveLength(0);
  });
});

describe("exemptions", () => {
  it("skips license banners and @license text", () => {
    expect(countWords(`/*! ${words(80)} */`)).toBe(80);
    expect(checked([blockComment(`! ${words(80)}`, 1, 3)]).overLimit).toHaveLength(0);
    expect(checked([blockComment(` @license ${words(80)} `, 1, 3)]).overLimit).toHaveLength(0);
  });

  it("skips every recognized directive as line or block comment", () => {
    for (const directive of [
      " @ts-expect-error reason ",
      " @ts-ignore reason ",
      " oxlint-disable-next-line rule ",
      " eslint-disable rule ",
      " biome-ignore rule reason ",
      " prettier-ignore ",
      " dprint-ignore ",
      " deno-lint-ignore rule ",
      " svelte-ignore a11y_click ",
    ]) {
      expect(checked([lineComment(directive, 1)]).overLimit).toHaveLength(0);
      expect(checked([blockComment(directive, 1, 1)]).overLimit).toHaveLength(0);
    }
  });

  it("does not treat lookalike prose as a directive", () => {
    expect(
      checked([lineComment(" svelte needs no ignore here " + words(41), 1)]).overLimit,
    ).toHaveLength(1);
  });
});

describe("baseline", () => {
  it("suppresses every comment in a baselined file", () => {
    const baseline = new Set(["src/example.ts"]);
    const result = checked([lineComment(words(90), 1), lineComment(words(90), 3)], baseline);
    expect(result.overLimit).toHaveLength(0);
    expect(result.staleBaseline).toBe(false);
  });

  it("flags a baselined file whose comments all fit, so its entry gets pruned", () => {
    const baseline = new Set(["src/example.ts"]);
    const result = checked([lineComment(words(10), 1)], baseline);
    expect(result.overLimit).toHaveLength(0);
    expect(result.staleBaseline).toBe(true);
    expect(
      checkComments([], { baseline: new Set(["gone.ts"]), filename: "gone.ts", cwd: BASE_DIR })
        .staleBaseline,
    ).toBe(true);
  });
});

describe("css comments", () => {
  it("reports a long block comment with its line", () => {
    const source = `body { color: red; }\n/* ${words(45)} */\nfooter { clear: both; }`;
    expect(cssComments(source)).toEqual([{ line: 2, text: ` ${words(45)} ` }]);
  });

  it("ignores a comment lookalike inside a string value", () => {
    const lookalike = `div { content: "${words(50)} — totally not a comment"; } /* real ${words(5)} */`;
    expect(cssComments(`div { content: "/* ${words(45)} */"; }`)).toEqual([]);
    expect(cssComments(lookalike)).toHaveLength(1);
  });

  it("tracks multiline strings without losing the line", () => {
    const source = `a { content: "one\ntwo" }\n/* ${words(45)} */`;
    expect(cssComments(source)[0]?.line).toBe(3);
  });
});

describe("html comments", () => {
  it("reports a long template comment", () => {
    const source = `<p>one</p>\n<section>\n<!-- ${words(45)} -->\n</section>`;
    expect(templateComments(source)[0]?.line).toBe(3);
  });

  it("ignores a comment lookalike in an attribute value", () => {
    const source = `<p title="<!-- ${words(45)} -->">t</p>\n<!-- ${words(41)} -->`;
    const found = templateComments(source);
    expect(found).toHaveLength(1);
    expect(found[0]?.line).toBe(2);
  });

  it("keeps quoting sane when attribute values hold brackets", () => {
    const source = `<p title="ends with > and a quote" data-note='<!-- ${words(45)} -->'>t</p>`;
    expect(templateComments(source)).toEqual([]);
  });
});

describe("svelte documents", () => {
  it("scans template and style blocks but not the script", () => {
    const source = [
      '<script lang="ts">',
      `\t// ${words(90)} inside script, the oxlint rule's business`,
      "\tconst value = 0;",
      "</script>",
      "",
      `<!-- ${words(45)} -->`,
      "",
      "<style>",
      `/* style comment with ${words(45)} */`,
      "</style>",
    ].join("\n");
    const found = svelteComments(source);
    expect(found).toHaveLength(2);
    expect(found.map((comment) => comment.line)).toEqual([6, 9]);
  });

  it("excludes comments from both module and instance script blocks", () => {
    const source = [
      '<script context="module" lang="ts">',
      `\t// module script comment with ${words(50)}`,
      "\texport const moduleItem = true;",
      "</script>",
      "",
      '<script lang="ts">',
      `\t// instance script comment with ${words(50)}`,
      "\texport let item = false;",
      "</script>",
      "",
      `<!-- template comment with ${words(45)} -->`,
    ].join("\n");
    const found = svelteComments(source);
    expect(found).toHaveLength(1);
    expect(found[0]?.line).toBe(11);
    expect(found[0]?.text).toContain("template comment");
  });

  it("reports directive comments but the scan filters them out", () => {
    const source = `<main>\n<!-- svelte-ignore a11y_click_events_have_key_events -->\n</main>`;
    expect(svelteComments(source)).toEqual([
      { line: 2, text: "svelte-ignore a11y_click_events_have_key_events" },
    ]);
    expect(isDirectiveText("svelte-ignore a11y_click_events_have_key_events")).toBe(true);
  });
});

describe("document-scope repo scan", () => {
  it("leaves the repository clean relative to its baseline", () => {
    const report = scanDocumentScope(process.cwd(), process.cwd(), verboseCommentDocScope);
    expect(report.violations).toEqual([]);
    expect(report.staleBaseline).toEqual([]);
  });

  it("keeps every baselined doc-scope file present on disk", () => {
    for (const path of verboseCommentDocScope) {
      expect(existsSync(join(process.cwd(), path)), path).toBe(true);
    }
  });
});
