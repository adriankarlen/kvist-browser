import { expect, test } from "vite-plus/test";
import { matchesUserCss, parseUserCss } from "./user-css";

/** The shape of a real file, as the Stylus docs spell it. */
const STYLE = `/* ==UserStyle==
@name         Example Dark
@namespace    github.com/octocat
@version      1.0.0
@description  Makes it dark
@author       Octocat <cat@example.com>
@license      unlicense
@preprocessor default
==/UserStyle== */

@-moz-document domain("example.com") {
  body { background: #111 }
}`;

test("the metadata block is read, and the body is scoped by its match rule", () => {
  const parsed = parseUserCss(STYLE);

  expect(parsed.metadata).toEqual({
    name: "Example Dark",
    namespace: "github.com/octocat",
    version: "1.0.0",
    description: "Makes it dark",
    author: "Octocat <cat@example.com>",
    license: "unlicense",
  });
  expect(parsed.preprocessor).toBe("default");
  expect(parsed.problems).toEqual([]);
  expect(parsed.blocks).toEqual([
    { matchers: [{ type: "domain", value: "example.com" }], css: "body { background: #111 }" },
  ]);
});

test("a missing @preprocessor is the default one", () => {
  const parsed = parseUserCss(`/* ==UserStyle==
@name Bare
==/UserStyle== */
a {}`);

  expect(parsed.preprocessor).toBe("default");
  expect(parsed.problems).toEqual([]);
});

test("a declared preprocessor is reported rather than run", () => {
  for (const declared of ["less", "stylus", "uso"]) {
    const parsed = parseUserCss(`/* ==UserStyle==
@name Themed
@preprocessor ${declared}
==/UserStyle== */
@-moz-document domain("example.com") { body { color: darken(@base, 10%) } }`);

    expect(parsed.preprocessor).toBe(declared);
    // Parsing still succeeds: skipping it is the caller's call, not ours.
    expect(parsed.problems).toEqual([]);
    expect(parsed.blocks).toHaveLength(1);
  }
});

test("an unknown preprocessor is a problem, and the default stands", () => {
  const parsed = parseUserCss(`/* ==UserStyle==
@preprocessor sass
==/UserStyle== */
a {}`);

  expect(parsed.preprocessor).toBe("default");
  expect(parsed.problems).toEqual([{ reason: 'unknown @preprocessor "sass"' }]);
});

test("@var and friends are skipped without complaint", () => {
  const parsed = parseUserCss(`/* ==UserStyle==
@name Configurable
@updateURL https://example.com/s.user.css
@var color bg "Background" #fff
@advanced text a "A" "b"
==/UserStyle== */
a {}`);

  expect(parsed.metadata).toEqual({ name: "Configurable" });
  expect(parsed.problems).toEqual([]);
});

test("several match rules in one block are alternatives", () => {
  const parsed = parseUserCss(`/* ==UserStyle==
@name Multi
==/UserStyle== */
@-moz-document url("http://a.example/"),
                url-prefix("http://a.example/style/"),
                domain("b.example"),
                regexp("https://c\\\\.example/.*") {
  body { color: red }
}`);

  expect(parsed.blocks[0]!.matchers).toEqual([
    { type: "url", value: "http://a.example/" },
    { type: "url-prefix", value: "http://a.example/style/" },
    { type: "domain", value: "b.example" },
    { type: "regexp", value: "https://c\\\\.example/.*" },
  ]);
});

test("a comma inside a regexp does not split the matcher list", () => {
  const parsed = parseUserCss(`/* ==UserStyle==
@name Ranged
==/UserStyle== */
@-moz-document regexp("https://a\\\\.example/x{2,3}") { a {} }`);

  expect(parsed.blocks[0]!.matchers).toHaveLength(1);
});

test("several blocks each keep their own rules, and nesting is counted", () => {
  const parsed = parseUserCss(`/* ==UserStyle==
@name Two
==/UserStyle== */
@-moz-document domain("a.example") {
  @media (min-width: 100px) { body { color: red } }
}
@-moz-document domain("b.example") {
  body { color: blue }
}`);

  expect(parsed.blocks).toEqual([
    {
      matchers: [{ type: "domain", value: "a.example" }],
      css: "@media (min-width: 100px) { body { color: red } }",
    },
    { matchers: [{ type: "domain", value: "b.example" }], css: "body { color: blue }" },
  ]);
});

test("CSS outside any block applies everywhere, before and after one", () => {
  const parsed = parseUserCss(`/* ==UserStyle==
@name Mixed
==/UserStyle== */
html { font-size: 15px }
@-moz-document domain("a.example") { body { color: red } }
a { color: gray }`);

  expect(parsed.blocks).toEqual([
    { matchers: null, css: "html { font-size: 15px }" },
    { matchers: [{ type: "domain", value: "a.example" }], css: "body { color: red }" },
    { matchers: null, css: "a { color: gray }" },
  ]);
});

test("quotes are optional, and either kind works", () => {
  const parsed = parseUserCss(`/* ==UserStyle==
@name Quotes
==/UserStyle== */
@-moz-document domain(a.example), domain('b.example') { a {} }`);

  expect(parsed.blocks[0]!.matchers).toEqual([
    { type: "domain", value: "a.example" },
    { type: "domain", value: "b.example" },
  ]);
});

test("the unprefixed @document spelling is understood too", () => {
  const parsed = parseUserCss(`/* ==UserStyle==
@name Unprefixed
==/UserStyle== */
@document domain("a.example") { a {} }`);

  expect(parsed.blocks[0]!.matchers).toEqual([{ type: "domain", value: "a.example" }]);
});

test("a file with no metadata block is global CSS, at-rules and all", () => {
  // Deliberate: a plain .css file dropped in the directory is injected as-is,
  // so a stray @document in it cannot silently scope the whole file away.
  const source = `@-moz-document domain("a.example") { body { color: red } }
a { color: gray }`;
  const parsed = parseUserCss(source);

  expect(parsed.blocks).toEqual([{ matchers: null, css: source }]);
  expect(parsed.problems).toEqual([]);
});

test("an empty file parses to nothing at all", () => {
  expect(parseUserCss("   \n  ").blocks).toEqual([]);
});

test("an apostrophe in a comment does not run the block scanner off the end", () => {
  // `Don't` is prose, not an open quote. Reading it as one used to leave the
  // block "never closed", and the whole rule was then emitted unscoped.
  const parsed = parseUserCss(`/* ==UserStyle==
@name Commented
==/UserStyle== */
@-moz-document domain("example.com") {
  /* Don't override the header */
  body { color: red }
}`);

  expect(parsed.problems).toEqual([]);
  expect(parsed.blocks).toEqual([
    {
      matchers: [{ type: "domain", value: "example.com" }],
      css: "/* Don't override the header */\n  body { color: red }",
    },
  ]);
  // The point of the fix: it is still scoped, not global.
  expect(matchesUserCss(parsed.blocks[0]!.matchers, "https://elsewhere.example/")).toBe(false);
});

test("braces and quotes inside comments are not counted", () => {
  const parsed = parseUserCss(`/* ==UserStyle==
@name Bracey
==/UserStyle== */
@-moz-document /* a { brace " here */ domain("a.example") {
  body { color: red } /* } not the end */
}
a { color: gray }`);

  expect(parsed.blocks.at(-1)).toEqual({ matchers: null, css: "a { color: gray }" });
  expect(parsed.blocks[0]!.css).toBe("body { color: red } /* } not the end */");
});

test("an unterminated comment does not silently take the file with it", () => {
  const parsed = parseUserCss(`/* ==UserStyle==
@name Truncated comment
==/UserStyle== */
@-moz-document domain("a.example") { body { color: red } /* never closed`);

  expect(parsed.problems).toEqual([{ reason: "an @-moz-document block is never closed" }]);
  expect(parsed.blocks).toEqual([]);
});

test("CSS above the metadata block is kept, not dropped", () => {
  const parsed = parseUserCss(`a { color: gray }
/* ==UserStyle==
@name Below
==/UserStyle== */
@-moz-document domain("example.com") { body { color: red } }`);

  expect(parsed.metadata.name).toBe("Below");
  expect(parsed.blocks).toEqual([
    // First in the file, so first here — and unwrapped, so global.
    { matchers: null, css: "a { color: gray }" },
    { matchers: [{ type: "domain", value: "example.com" }], css: "body { color: red }" },
  ]);
});

test("an unclosed block is dropped rather than injected unscoped", () => {
  const parsed = parseUserCss(`/* ==UserStyle==
@name Unclosed
==/UserStyle== */
html { font-size: 15px }
@-moz-document domain("a.example") { body { color: red }`);

  expect(parsed.problems).toEqual([{ reason: "an @-moz-document block is never closed" }]);
  // The valid CSS ahead of it survives; the broken rule does not become a
  // global block carrying raw `@-moz-document` text into every page.
  expect(parsed.blocks).toEqual([{ matchers: null, css: "html { font-size: 15px }" }]);
});

test("a rule with no block at all is dropped the same way", () => {
  const parsed = parseUserCss(`/* ==UserStyle==
@name Blockless
==/UserStyle== */
a { color: gray }
@-moz-document domain("a.example")`);

  expect(parsed.problems).toEqual([{ reason: "an @-moz-document rule has no block" }]);
  expect(parsed.blocks).toEqual([{ matchers: null, css: "a { color: gray }" }]);
});

test("an unterminated metadata block injects nothing", () => {
  const parsed = parseUserCss(`/* ==UserStyle==
@name Truncated
a { color: red }`);

  expect(parsed.problems).toEqual([{ reason: "no ==/UserStyle== closing the metadata block" }]);
  expect(parsed.metadata.name).toBe("Truncated");
  // What follows an unterminated header is more header, not CSS.
  expect(parsed.blocks).toEqual([]);
});

test("an unclosed block is reported rather than swallowing the file", () => {
  const parsed = parseUserCss(`/* ==UserStyle==
@name Unclosed
==/UserStyle== */
@-moz-document domain("a.example") { body { color: red }`);

  expect(parsed.problems).toEqual([{ reason: "an @-moz-document block is never closed" }]);
  expect(parsed.blocks).toEqual([]);
});

test("an unusable matcher leaves the block's other matchers standing", () => {
  const parsed = parseUserCss(`/* ==UserStyle==
@name Partly
==/UserStyle== */
@-moz-document media-document("video"), domain("a.example") { a {} }`);

  expect(parsed.problems).toEqual([{ reason: "unsupported matching function media-document()" }]);
  expect(parsed.blocks[0]!.matchers).toEqual([{ type: "domain", value: "a.example" }]);
});

test("a block whose matchers are all unusable matches nothing, not everything", () => {
  const parsed = parseUserCss(`/* ==UserStyle==
@name Doomed
==/UserStyle== */
@-moz-document media-document("video") { body { display: none } }`);

  // [] rather than null: nobody can match it, which is not the same as
  // everybody matching it.
  expect(parsed.blocks[0]!.matchers).toEqual([]);
  expect(matchesUserCss(parsed.blocks[0]!.matchers, "https://a.example/")).toBe(false);
});

test("domain() matches the domain and its subdomains only", () => {
  const matchers = [{ type: "domain", value: "example.com" } as const];

  expect(matchesUserCss(matchers, "https://example.com/page")).toBe(true);
  expect(matchesUserCss(matchers, "https://www.example.com/")).toBe(true);
  expect(matchesUserCss(matchers, "https://deep.sub.example.com/")).toBe(true);
  // Suffixed, not a subdomain — the classic phishing shape.
  expect(matchesUserCss(matchers, "https://notexample.com/")).toBe(false);
  expect(matchesUserCss(matchers, "https://example.com.evil.test/")).toBe(false);
});

test("domain() against a URL with no host matches nothing", () => {
  const matchers = [{ type: "domain", value: "example.com" } as const];
  expect(matchesUserCss(matchers, "about:blank")).toBe(false);
  expect(matchesUserCss(matchers, "not a url")).toBe(false);
});

test("url() is exact and url-prefix() is a prefix", () => {
  expect(
    matchesUserCss([{ type: "url", value: "https://a.example/x" }], "https://a.example/x"),
  ).toBe(true);
  expect(
    matchesUserCss([{ type: "url", value: "https://a.example/x" }], "https://a.example/x?q=1"),
  ).toBe(false);
  expect(
    matchesUserCss(
      [{ type: "url-prefix", value: "https://a.example/x" }],
      "https://a.example/x?q=1",
    ),
  ).toBe(true);
  expect(
    matchesUserCss([{ type: "url-prefix", value: "https://a.example/x" }], "https://a.example/y"),
  ).toBe(false);
});

test("regexp() must match the whole URL, not a substring of it", () => {
  // Unanchored, and would match every https page if tested loosely.
  const matchers = [{ type: "regexp", value: "https://a\\.example/.*" } as const];

  expect(matchesUserCss(matchers, "https://a.example/anything")).toBe(true);
  expect(matchesUserCss(matchers, "https://b.example/?to=https://a.example/x")).toBe(false);
});

test("an alternation in a regexp is anchored as a whole", () => {
  // Anchoring by concatenation rather than grouping would make this "^a" or
  // "b$", which matches far more than it should.
  const matchers = [
    { type: "regexp", value: "https://a\\.example/|https://b\\.example/" } as const,
  ];

  expect(matchesUserCss(matchers, "https://a.example/")).toBe(true);
  expect(matchesUserCss(matchers, "https://b.example/")).toBe(true);
  expect(matchesUserCss(matchers, "https://a.example/deeper")).toBe(false);
});

test("an unparseable regexp matches nothing rather than throwing", () => {
  expect(matchesUserCss([{ type: "regexp", value: "a(" }], "https://a.example/")).toBe(false);
});

test("unwrapped CSS matches every URL", () => {
  expect(matchesUserCss(null, "https://anything.example/")).toBe(true);
  expect(matchesUserCss(null, "about:blank")).toBe(true);
});

test("any one matcher is enough", () => {
  const matchers = [
    { type: "domain", value: "a.example" } as const,
    { type: "domain", value: "b.example" } as const,
  ];

  expect(matchesUserCss(matchers, "https://b.example/")).toBe(true);
  expect(matchesUserCss(matchers, "https://c.example/")).toBe(false);
});
