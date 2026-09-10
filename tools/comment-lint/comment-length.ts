import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import {
  COMMENT_WORD_LIMIT,
  countWords,
  isDirectiveText,
  isLicenseText,
} from "../oxlint/anti-slop/shared/verbose-comments.ts";

/**
 * The document scope covers what the oxlint rule's parser cannot see: CSS
 * block comments, HTML comments, and the `<style>` and template parts of a
 * Svelte component. Svelte `<script>` blocks stay with the oxlint rule.
 */
export const documentExtensions: ReadonlySet<string> = new Set([".svelte", ".css", ".html"]);

export type SourceComment = {
  line: number;
  text: string;
};

export type DocumentViolation = {
  path: string;
  line: number;
  text: string;
  words: number;
};

export type DocumentScanReport = {
  violations: DocumentViolation[];
  staleBaseline: string[];
};

/**
 * CSS block comments, with quoted strings skipped so a `/*` inside a string
 * value cannot pose as a comment opener.
 */
export function cssComments(source: string): SourceComment[] {
  const found: SourceComment[] = [];
  const cursor = { index: 0, line: 1 };
  while (cursor.index < source.length) {
    const character = source[cursor.index];
    if (character === "\n") {
      cursor.line += 1;
      cursor.index += 1;
      continue;
    }
    if (character === '"' || character === "'") {
      advance(cursor, source, skipQuoted(source, cursor.index));
      continue;
    }
    if (character === "/" && source[cursor.index + 1] === "*") {
      const end = source.indexOf("*/", cursor.index + 2);
      const stop = end === -1 ? source.length : end + 2;
      pushComment(found, cursor, source.slice(cursor.index + 2, stop - 2));
      advance(cursor, source, stop);
      continue;
    }
    cursor.index += 1;
  }
  return found;
}

/**
 * HTML comments in template text, plus quoted attribute values skipped. The
 * scan first blanks inline elements whose content is not template text, so
 * both plain HTML documents and Svelte files reuse one scanner.
 */
export function templateComments(source: string): SourceComment[] {
  const found: SourceComment[] = [];
  const cursor = { index: 0, line: 1 };
  let insideTag = false;
  while (cursor.index < source.length) {
    const character = source[cursor.index];
    if (character === "\n") {
      cursor.line += 1;
      cursor.index += 1;
      continue;
    }
    if (insideTag) {
      if (character === ">") {
        insideTag = false;
      } else if (character === '"' || character === "'") {
        advance(cursor, source, skipQuoted(source, cursor.index));
        continue;
      }
      cursor.index += 1;
      continue;
    }
    if (character === "<" && source.startsWith("<!--", cursor.index)) {
      const end = source.indexOf("-->", cursor.index + 4);
      const stop = end === -1 ? source.length : end + 3;
      const text =
        end === -1
          ? source.slice(cursor.index + 4).trim()
          : source.slice(cursor.index + 4, end).trim();
      pushComment(found, cursor, text);
      advance(cursor, source, stop);
      continue;
    }
    if (character === "<" && /^[!a-zA-Z/]/u.test(source[cursor.index + 1] ?? "")) {
      insideTag = true;
    }
    cursor.index += 1;
  }
  return found;
}

/** Svelte files: template comments plus `<style>` CSS, never `<script>`. */
export function svelteComments(source: string): SourceComment[] {
  const scripts = spannedRegions(source, "script");
  const styles = spannedRegions(source, "style");
  const regions = [...scripts, ...styles].sort((a, b) => b.start - a.start);
  let blanked = source;
  for (const region of regions) {
    blanked =
      blanked.slice(0, region.start) + "\n".repeat(region.newlines) + blanked.slice(region.end);
  }
  const found = templateComments(blanked);
  for (const style of styles) {
    const contents = source.slice(style.contentStart, style.contentEnd);
    const baseLine = countNewlines(source.slice(0, style.contentStart)) + 1;
    for (const comment of cssComments(contents)) {
      found.push({ line: comment.line + baseLine - 1, text: comment.text });
    }
  }
  return found;
}

export function commentsForSource(path: string, source: string): SourceComment[] {
  if (path.endsWith(".css")) return cssComments(source);
  if (path.endsWith(".html")) return templateComments(source);
  return svelteComments(source);
}

export function walkDocumentSources(root: string, skipDirectories: readonly string[]): string[] {
  const skip = new Set(skipDirectories);
  return walkDirectory(root, skip);
}

/**
 * Scan the whole document scope against the baseline. A non-baselined file
 * with an over-limit comment is a violation; a baselined file whose comments
 * all fit is a stale entry that must be pruned.
 */
export function scanDocumentScope(
  root: string,
  cwd: string,
  baseline: ReadonlySet<string>,
  limit = COMMENT_WORD_LIMIT,
): DocumentScanReport {
  const violations: DocumentViolation[] = [];
  const flagged = new Set<string>();
  for (const absolute of walkDocumentSources(root, [
    "node_modules",
    "dist",
    "release",
    "images",
    ".git",
  ])) {
    const path = absolute.slice(cwd.length + 1).replaceAll("\\", "/");
    const baselined = baseline.has(path);
    const source = readFileSync(absolute, "utf8");
    for (const comment of commentsForSource(path, source)) {
      if (isDirectiveText(comment.text) || isLicenseText(comment.text)) continue;
      const words = countWords(comment.text);
      if (words <= limit) continue;
      if (baselined) {
        flagged.add(path);
        continue;
      }
      violations.push({ path, line: comment.line, text: comment.text.slice(0, 60), words });
    }
  }
  const staleBaseline = [...baseline].filter((path) => !flagged.has(path));
  return { violations, staleBaseline };
}

type Cursor = {
  index: number;
  line: number;
};

type InlineElement = {
  start: number;
  end: number;
  newlines: number;
  contentStart: number;
  contentEnd: number;
};

function advance(cursor: Cursor, source: string, target: number): void {
  cursor.line += countNewlines(source.slice(cursor.index, target));
  cursor.index = target;
}

function pushComment(into: SourceComment[], cursor: Cursor, text: string): void {
  into.push({ line: cursor.line, text });
}

function skipQuoted(source: string, open: number): number {
  const quote = source[open];
  let index = open + 1;
  while (index < source.length) {
    if (source[index] === "\\") {
      index += 2;
      continue;
    }
    if (source[index] === quote) return index + 1;
    index += 1;
  }
  return source.length;
}

function countNewlines(text: string): number {
  let newlines = 0;
  for (const character of text) {
    if (character === "\n") newlines += 1;
  }
  return newlines;
}

function spannedRegions(source: string, tagName: string): InlineElement[] {
  const regions: InlineElement[] = [];
  const region = new RegExp(`<${tagName}\\b[^>]*>([\\s\\S]*?)</${tagName}>`, "gu");
  for (const match of source.matchAll(region)) {
    const start = match.index;
    const openTagEnd = start + match[0].indexOf(">") + 1;
    const contentEnd = openTagEnd + match[1].length;
    regions.push({
      start,
      end: openTagEnd + match[1].length + `</${tagName}>`.length,
      newlines: countNewlines(match[0]),
      contentStart: openTagEnd,
      contentEnd,
    });
  }
  return regions;
}

function walkDirectory(directory: string, skip: ReadonlySet<string>): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (skip.has(entry.name)) continue;
    const path = join(directory, entry.name);
    if (statSync(path).isDirectory()) {
      files.push(...walkDirectory(path, skip));
      continue;
    }
    if (documentExtensions.has(entry.name.slice(entry.name.lastIndexOf(".")))) {
      files.push(path);
    }
  }
  return files;
}
