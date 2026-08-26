/**
 * The UserCSS metadata format, parsed from the published convention rather
 * than from Stylus's source: Stylus is GPLv3, and the format itself — the
 * `==UserStyle==` comment, the `@-moz-document` match rules — is a documented
 * convention, not their code.
 *
 * Nothing here compiles anything. A file that declares a preprocessor is
 * reported as declaring one and left alone; resolving LESS or Stylus-lang down
 * to plain CSS is a separate tool's job, out of this repo entirely. What this
 * module does is decide *which* CSS applies to a URL, and hand it over
 * unmodified.
 */

/**
 * The `@preprocessor` a file declares. Only `default` is injectable; the rest
 * are recognized precisely so they can be skipped by name rather than injected
 * as broken CSS.
 */
export type Preprocessor = "default" | "less" | "stylus" | "uso";

const PREPROCESSORS: readonly Preprocessor[] = ["default", "less", "stylus", "uso"];

/** One `@-moz-document` matching function, as the `@document` spec defines them. */
export type Matcher =
  | { type: "domain"; value: string }
  | { type: "url"; value: string }
  | { type: "url-prefix"; value: string }
  | { type: "regexp"; value: string };

const MATCHER_TYPES: readonly Matcher["type"][] = ["domain", "url", "url-prefix", "regexp"];

/**
 * A run of CSS and what it applies to. `matchers: null` is CSS that was not
 * wrapped in an `@-moz-document` at all, which applies everywhere; an empty
 * list is a block whose matchers were all unusable, which applies nowhere.
 * The difference matters: a block nobody can match must not silently become a
 * block that matches everything.
 */
export interface UserCssBlock {
  matchers: Matcher[] | null;
  css: string;
}

/** The metadata fields worth keeping: enough to name a style in a log line. */
export interface UserCssMetadata {
  name?: string;
  namespace?: string;
  version?: string;
  description?: string;
  author?: string;
  license?: string;
  homepageURL?: string;
}

/** Something in a style file that could not be used, and why. */
export interface UserCssProblem {
  reason: string;
}

export interface ParsedUserCss {
  metadata: UserCssMetadata;
  /** What the file declared; `default` when it declared nothing. */
  preprocessor: Preprocessor;
  blocks: UserCssBlock[];
  problems: UserCssProblem[];
}

const METADATA_START = "==UserStyle==";
const METADATA_END = "==/UserStyle==";

/** The metadata keys kept verbatim; everything else is skipped, `@var` included. */
const METADATA_KEYS = new Set<keyof UserCssMetadata>([
  "name",
  "namespace",
  "version",
  "description",
  "author",
  "license",
  "homepageURL",
]);

/** A file split around its metadata comment: CSS before it, the block, CSS after. */
interface SplitSource {
  /**
   * CSS ahead of the metadata comment. The block is only conventionally at the
   * top of a file, so anything above it is still the user's CSS and is kept
   * rather than silently dropped.
   */
  leading: string;
  meta: string;
  body: string;
}

/**
 * The metadata block and the CSS around it. The block is a comment, so it is
 * found by its markers rather than by parsing CSS: `/* ==UserStyle== ...
 * ==/UserStyle== *​/`.
 *
 * A start marker with no end is a truncated file rather than a style with no
 * metadata — reported as such, and nothing after it is treated as CSS: what
 * follows an unterminated metadata block is more metadata, and guessing
 * otherwise would inject the header into the page.
 */
function splitMetadata(source: string, problems: UserCssProblem[]): SplitSource | null {
  const start = source.indexOf(METADATA_START);
  if (start === -1) return null;

  // Back to the comment's own opener: `start` is inside `/* … *​/`, so slicing
  // to it would leave a dangling `/*` that swallows the CSS above it.
  const commentStart = source.lastIndexOf("/*", start);
  const leading = source.slice(0, commentStart === -1 ? start : commentStart);

  const end = source.indexOf(METADATA_END, start + METADATA_START.length);
  if (end === -1) {
    problems.push({ reason: `no ${METADATA_END} closing the metadata block` });
    return { leading, meta: source.slice(start + METADATA_START.length), body: "" };
  }

  const afterEnd = source.indexOf("*/", end);
  return {
    leading,
    meta: source.slice(start + METADATA_START.length, end),
    // Past the comment's own terminator when there is one; a block that lost
    // its `*/` still yields its body rather than nothing.
    body: source.slice(afterEnd === -1 ? end + METADATA_END.length : afterEnd + 2),
  };
}

/** What the metadata block yields: the fields kept, and the preprocessor declared. */
interface ParsedMetadata {
  metadata: UserCssMetadata;
  preprocessor: Preprocessor;
}

/**
 * Reads `@key value` lines. Unknown keys are skipped in silence — `@var`,
 * `@advanced`, `@updateURL` and whatever else a file carries are somebody
 * else's business, and a style is not broken for having them.
 */
function parseMetadata(meta: string, problems: UserCssProblem[]): ParsedMetadata {
  const metadata: UserCssMetadata = {};
  let preprocessor: Preprocessor = "default";

  for (const line of meta.split("\n")) {
    const match = /^\s*@(\S+)\s*(.*)$/.exec(line);
    if (!match) continue;

    const [, key = "", rawValue = ""] = match;
    const value = rawValue.trim();
    if (value === "") continue;

    if (key === "preprocessor") {
      // SAFETY: membership in PREPROCESSORS is the parse — the type is exactly that set.
      const declared = PREPROCESSORS.includes(value as Preprocessor)
        ? (value as Preprocessor)
        : undefined;
      if (declared === undefined) {
        problems.push({ reason: `unknown @preprocessor "${value}"` });
      } else {
        preprocessor = declared;
      }
      continue;
    }

    // SAFETY: membership in METADATA_KEYS is the parse — the key is exactly one of them.
    const field = key as keyof UserCssMetadata;
    if (METADATA_KEYS.has(field)) metadata[field] = value;
  }

  return { metadata, preprocessor };
}

/** Strips one layer of matching quotes; the spec allows either, or neither. */
function unquote(value: string): string {
  const first = value[0];
  if ((first === '"' || first === "'") && value.length >= 2 && value.at(-1) === first) {
    return value.slice(1, -1);
  }
  return value;
}

/**
 * Splits a matcher list on its top-level commas. A `regexp("a{2,3}")` carries
 * commas of its own, so the split has to respect nesting and quoting rather
 * than being a `split(",")`.
 */
function splitMatchers(prelude: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let quote: string | null = null;
  let start = 0;

  for (let index = 0; index < prelude.length; index++) {
    const char = prelude[index]!;
    if (quote !== null) {
      if (char === "\\") index++;
      else if (char === quote) quote = null;
      continue;
    }
    if (char === '"' || char === "'") quote = char;
    else if (char === "(") depth++;
    else if (char === ")") depth--;
    else if (char === "," && depth === 0) {
      parts.push(prelude.slice(start, index));
      start = index + 1;
    }
  }

  parts.push(prelude.slice(start));
  return parts.map((part) => part.trim()).filter((part) => part !== "");
}

/**
 * One matching function, or nothing. `media-document()` is real `@document`
 * syntax we do not implement, and an unknown function is a typo — both are
 * reported, and both leave the block matching on its *other* matchers rather
 * than taking the whole block down.
 */
function parseMatcher(part: string, problems: UserCssProblem[]): Matcher | null {
  const match = /^([a-z-]+)\s*\(([\s\S]*)\)$/i.exec(part);
  if (!match) {
    problems.push({ reason: `not a matching function: "${part}"` });
    return null;
  }

  const [, name = "", rawValue = ""] = match;
  const type = name.toLowerCase();
  // SAFETY: membership in MATCHER_TYPES is the parse — the type is exactly that set.
  if (!MATCHER_TYPES.includes(type as Matcher["type"])) {
    problems.push({ reason: `unsupported matching function ${type}()` });
    return null;
  }

  const value = unquote(rawValue.trim());
  if (value === "") {
    problems.push({ reason: `empty ${type}() matcher` });
    return null;
  }

  // SAFETY: type was just checked against MATCHER_TYPES above.
  return { type: type as Matcher["type"], value };
}

/**
 * The index just past a `/* … *​/` comment starting at `index`, or -1 when one
 * does not start there. Comments have to be skipped *before* quotes are
 * counted: `/* Don't override *​/` is prose, not a string, and treating that
 * apostrophe as an opening quote runs the scan to the end of the file. An
 * unterminated comment consumes the rest, which is what it does in CSS too.
 */
function skipComment(source: string, index: number): number {
  if (source[index] !== "/" || source[index + 1] !== "*") return -1;
  const end = source.indexOf("*/", index + 2);
  return end === -1 ? source.length : end + 2;
}

/**
 * The `{` that opens a block, skipping any inside a comment or a quoted matcher
 * value — `regexp("x{2,3}")` carries braces of its own, and taking the first
 * one literally would cut the prelude in half and lose the rule.
 */
function findOpenBrace(source: string, from: number): number {
  let quote: string | null = null;

  for (let index = from; index < source.length; index++) {
    const char = source[index]!;
    if (quote !== null) {
      if (char === "\\") index++;
      else if (char === quote) quote = null;
      continue;
    }
    const afterComment = skipComment(source, index);
    if (afterComment !== -1) {
      index = afterComment - 1;
      continue;
    }
    if (char === '"' || char === "'") quote = char;
    else if (char === "{") return index;
  }

  return -1;
}

/**
 * Finds the `}` closing the `{` at `open`, counting nesting and skipping both
 * comments and strings. Still not a CSS parser — the body is passed through
 * untouched, so a full AST would buy nothing — but it has to agree with one
 * about where a block ends, or a valid file is silently dropped.
 */
function findBlockEnd(source: string, open: number): number {
  let depth = 0;
  let quote: string | null = null;

  for (let index = open; index < source.length; index++) {
    const char = source[index]!;
    if (quote !== null) {
      if (char === "\\") index++;
      else if (char === quote) quote = null;
      continue;
    }
    const afterComment = skipComment(source, index);
    if (afterComment !== -1) {
      index = afterComment - 1;
      continue;
    }
    if (char === '"' || char === "'") quote = char;
    else if (char === "{") depth++;
    else if (char === "}") {
      depth--;
      if (depth === 0) return index;
    }
  }

  return -1;
}

const DOCUMENT_RULE = /@(?:-moz-)?document\b/gi;

/**
 * Splits a CSS body into its `@-moz-document` blocks and everything between
 * them. No browser has run `@-moz-document` in page content for years — Chrome
 * never did, and Firefox restricted it to user sheets in 59 — so the rule is
 * ours to interpret; leaving it in the injected CSS would be inert.
 */
function parseBlocks(body: string, problems: UserCssProblem[]): UserCssBlock[] {
  const blocks: UserCssBlock[] = [];
  let cursor = 0;

  DOCUMENT_RULE.lastIndex = 0;
  let found: RegExpExecArray | null;
  while ((found = DOCUMENT_RULE.exec(body)) !== null) {
    const ruleStart = found.index;
    // Whatever sat between the last block and this one applies everywhere.
    // Taken before the block is read, so valid CSS ahead of a malformed rule
    // survives it.
    const between = body.slice(cursor, ruleStart).trim();
    if (between !== "") blocks.push({ matchers: null, css: between });

    // A rule we cannot read ends the file as far as we are concerned. The
    // remainder is *not* handed back as global CSS: it is an at-rule that was
    // meant to be scoped, and emitting it would inject it into every page and,
    // unterminated, swallow every style joined after it.
    const open = findOpenBrace(body, DOCUMENT_RULE.lastIndex);
    if (open === -1) {
      problems.push({ reason: "an @-moz-document rule has no block" });
      return blocks;
    }

    const close = findBlockEnd(body, open);
    if (close === -1) {
      problems.push({ reason: "an @-moz-document block is never closed" });
      return blocks;
    }

    const prelude = body.slice(DOCUMENT_RULE.lastIndex, open);
    const matchers = splitMatchers(prelude)
      .map((part) => parseMatcher(part, problems))
      .filter((matcher) => matcher !== null);

    blocks.push({ matchers, css: body.slice(open + 1, close).trim() });

    cursor = close + 1;
    DOCUMENT_RULE.lastIndex = cursor;
  }

  const trailing = body.slice(cursor).trim();
  if (trailing !== "") blocks.push({ matchers: null, css: trailing });

  return blocks;
}

/**
 * Parses one style file. Never throws and never logs: a hand-edited,
 * hot-reloaded file being half-wrong must still leave the rest of it usable,
 * and who gets told is the caller's decision.
 *
 * `@-moz-document` is only looked for when a metadata block is present. A file
 * without one is plain CSS the user dropped in, injected everywhere as-is —
 * which is what KVI-22's watched directory promises — and scanning it for at-
 * rules would mean a stray `@document` in a comment could silently scope
 * somebody's whole stylesheet to nothing.
 */
export function parseUserCss(source: string): ParsedUserCss {
  const problems: UserCssProblem[] = [];
  const split = splitMetadata(source, problems);

  if (split === null) {
    const css = source.trim();
    return {
      metadata: {},
      preprocessor: "default",
      blocks: css === "" ? [] : [{ matchers: null, css }],
      problems,
    };
  }

  const { metadata, preprocessor } = parseMetadata(split.meta, problems);
  const blocks = parseBlocks(split.body, problems);
  // CSS above the metadata comment is unwrapped, so it applies everywhere —
  // the same rule as CSS between blocks, and it comes first in the file.
  const leading = split.leading.trim();
  if (leading !== "") blocks.unshift({ matchers: null, css: leading });

  return { metadata, preprocessor, blocks, problems };
}

/**
 * Whether a `regexp()` matcher covers the whole URL. The spec is explicit that
 * the expression must match the entire URL, so an unanchored pattern is
 * anchored here rather than being left to match a substring — `regexp("http")`
 * matching every page on the web is not what anyone wrote it for.
 *
 * An unparseable pattern matches nothing. It cannot be reported from here, so
 * it is silently inert rather than throwing on every navigation.
 */
function matchesRegexp(pattern: string, url: string): boolean {
  try {
    return new RegExp(`^(?:${pattern})$`).test(url);
  } catch {
    return false;
  }
}

/** Whether `host` is `domain` or a subdomain of it, and not merely suffixed by it. */
function matchesDomain(domain: string, host: string): boolean {
  return host === domain || host.endsWith(`.${domain}`);
}

/**
 * Whether a block applies to a URL. `null` matchers are CSS that was never
 * wrapped, which applies everywhere; an empty list applies nowhere. Otherwise
 * any one matcher is enough, as `@document` defines it.
 */
export function matchesUserCss(matchers: Matcher[] | null, url: string): boolean {
  if (matchers === null) return true;

  return matchers.some((matcher) => {
    switch (matcher.type) {
      case "url":
        return url === matcher.value;
      case "url-prefix":
        return url.startsWith(matcher.value);
      case "regexp":
        return matchesRegexp(matcher.value, url);
      case "domain": {
        // A URL with no host — about:blank, data: — has no domain to match.
        try {
          return matchesDomain(matcher.value, new URL(url).hostname);
        } catch {
          return false;
        }
      }
    }
  });
}
