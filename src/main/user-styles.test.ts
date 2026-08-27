import { expect, test } from "vite-plus/test";
import type { StylesheetTarget } from "./stylesheet";
import { UserStyles } from "./user-styles";

/** A style file with a metadata block, scoped to one domain. */
const scoped = (domain: string, css: string): string => `/* ==UserStyle==
@name ${domain}
==/UserStyle== */
@-moz-document domain("${domain}") { ${css} }`;

function createTarget() {
  const inserted: string[] = [];
  const target: StylesheetTarget = {
    isDestroyed: () => false,
    insertCSS: (css: string) => {
      inserted.push(css);
      return Promise.resolve(`key-${inserted.length}`);
    },
    removeInsertedCSS: () => Promise.resolve(),
  };
  return { target, inserted };
}

const flush = async (): Promise<void> => {
  for (let turn = 0; turn < 10; turn++) await Promise.resolve();
};

test("nothing is styled until sources are given", () => {
  const styles = new UserStyles();
  expect(styles.cssFor("https://a.example/")).toBe("");
});

test("only the blocks matching the URL are applied", () => {
  const styles = new UserStyles();
  styles.setSources([
    { id: "a.css", source: scoped("a.example", "body { color: red }") },
    { id: "b.css", source: scoped("b.example", "body { color: blue }") },
  ]);

  expect(styles.cssFor("https://a.example/")).toBe("body { color: red }");
  expect(styles.cssFor("https://b.example/x")).toBe("body { color: blue }");
  expect(styles.cssFor("https://c.example/")).toBe("");
});

test("several files matching one URL are combined in the order given", () => {
  const styles = new UserStyles();
  styles.setSources([
    { id: "first.css", source: scoped("a.example", "body { color: red }") },
    { id: "second.css", source: "html { font-size: 15px }" },
    { id: "third.css", source: scoped("a.example", "a { color: gray }") },
  ]);

  expect(styles.cssFor("https://a.example/")).toBe(
    "body { color: red }\nhtml { font-size: 15px }\na { color: gray }",
  );
  // The file with no metadata block is global, so it alone styles other sites.
  expect(styles.cssFor("https://z.example/")).toBe("html { font-size: 15px }");
});

test("a file needing a preprocessor is skipped by name, not injected", () => {
  const styles = new UserStyles();
  const problems = styles.setSources([
    {
      id: "rose-pine.user.less",
      source: `/* ==UserStyle==
@name Rose Pine
@preprocessor less
==/UserStyle== */
@-moz-document domain("a.example") { body { color: darken(@base, 10%) } }`,
    },
    { id: "plain.css", source: scoped("a.example", "body { color: red }") },
  ]);

  expect(problems).toEqual([
    { id: "rose-pine.user.less", reason: "skipped: @preprocessor less is not run" },
  ]);
  // The uncompiled LESS never reaches a page; the plain file beside it does.
  expect(styles.cssFor("https://a.example/")).toBe("body { color: red }");
});

test("a preprocessor-skipped file is still found by :style, just not injected", () => {
  const styles = new UserStyles();
  styles.setSources([
    {
      id: "rose-pine.user.less",
      source: `/* ==UserStyle==
@name Rose Pine
@preprocessor less
==/UserStyle== */
@-moz-document domain("a.example") { body { color: darken(@base, 10%) } }`,
    },
  ]);

  // Its CSS never reaches the page…
  expect(styles.cssFor("https://a.example/")).toBe("");
  // …but the file itself is still the one to open for that page: its match
  // rule parsed fine, only the preprocessor stopped the CSS from being used.
  expect(styles.filesFor("https://a.example/")).toEqual(["rose-pine.user.less"]);
  expect(styles.filesFor("https://other.example/")).toEqual([]);
});

test("problems carry the file they were found in", () => {
  const styles = new UserStyles();
  const problems = styles.setSources([
    {
      id: "broken.user.css",
      source: `/* ==UserStyle==
@preprocessor sass
==/UserStyle== */
@-moz-document media-document("video") { a {} }`,
    },
  ]);

  expect(problems).toEqual([
    { id: "broken.user.css", reason: 'unknown @preprocessor "sass"' },
    { id: "broken.user.css", reason: "unsupported matching function media-document()" },
  ]);
});

test("setting sources again replaces what was in force", () => {
  const styles = new UserStyles();
  styles.setSources([{ id: "a.css", source: scoped("a.example", "body { color: red }") }]);
  styles.setSources([{ id: "b.css", source: scoped("a.example", "body { color: blue }") }]);

  expect(styles.cssFor("https://a.example/")).toBe("body { color: blue }");
});

test("applying puts the URL's styles on the page", async () => {
  const styles = new UserStyles();
  styles.setSources([{ id: "a.css", source: scoped("a.example", "body { color: red }") }]);
  const { target, inserted } = createTarget();

  styles.applyTo(target, "https://a.example/");
  await flush();

  expect(inserted).toEqual(["body { color: red }"]);
});

test("a page matching nothing is not left wearing the last page's styles", async () => {
  const styles = new UserStyles();
  styles.setSources([{ id: "a.css", source: scoped("a.example", "body { color: red }") }]);
  const { target, inserted } = createTarget();

  styles.applyTo(target, "https://a.example/");
  await flush();
  styles.applyTo(target, "https://unstyled.example/");
  await flush();

  // The second application removes rather than inserting; the sheet's own
  // tests cover the removal.
  expect(inserted).toEqual(["body { color: red }"]);
});

test("filesFor names every distinct file matching a URL, in the order given", () => {
  const styles = new UserStyles();
  styles.setSources([
    { id: "global.css", source: "html { font-size: 15px }" },
    { id: "a.css", source: scoped("a.example", "body { color: red }") },
    { id: "b.css", source: scoped("b.example", "body { color: blue }") },
  ]);

  expect(styles.filesFor("https://a.example/")).toEqual(["global.css", "a.css"]);
  expect(styles.filesFor("https://b.example/")).toEqual(["global.css", "b.css"]);
  expect(styles.filesFor("https://c.example/")).toEqual(["global.css"]);
});

test("filesFor names a file once even when several of its blocks match", () => {
  const styles = new UserStyles();
  styles.setSources([
    {
      id: "multi.css",
      source: `${scoped("a.example", "body { color: red }")}\n${scoped("a.example", "a { color: gray }")}`,
    },
  ]);

  expect(styles.filesFor("https://a.example/")).toEqual(["multi.css"]);
});

test("filesFor is empty when nothing has been set, or nothing matches", () => {
  const styles = new UserStyles();
  expect(styles.filesFor("https://a.example/")).toEqual([]);

  styles.setSources([{ id: "a.css", source: scoped("a.example", "body { color: red }") }]);
  expect(styles.filesFor("https://z.example/")).toEqual([]);
});

test("a file with a broken block cannot leak into other sites' styles", () => {
  const styles = new UserStyles();
  const problems = styles.setSources([
    {
      id: "broken.user.css",
      source: `/* ==UserStyle==
@name Broken
==/UserStyle== */
@-moz-document domain("a.example") { body { color: red }`,
    },
    { id: "fine.user.css", source: scoped("b.example", "body { color: blue }") },
  ]);

  expect(problems).toEqual([
    { id: "broken.user.css", reason: "an @-moz-document block is never closed" },
  ]);
  // The unterminated at-rule must not be joined ahead of the healthy file: as
  // raw CSS it would swallow everything after it.
  expect(styles.cssFor("https://b.example/")).toBe("body { color: blue }");
  expect(styles.cssFor("https://a.example/")).toBe("");
});
