import { matchesUserCss, parseUserCss, type UserCssBlock, type UserCssProblem } from "./user-css";
import { ReplaceableStylesheet, type StylesheetTarget } from "./stylesheet";

/** One style file: where it came from, and what it says. */
export interface UserStyleSource {
  /** How the file is named to a user — the absolute path KVI-22's directory read it from. */
  id: string;
  source: string;
}

/** A block that survived parsing, kept beside the file that produced it. */
interface OwnedBlock {
  id: string;
  block: UserCssBlock;
  /**
   * False for a block whose file declared a preprocessor Kvist does not
   * run. Its matchers are real, so `:style` still finds the file; only its
   * CSS is withheld — the user typing `:style` there is who needs the file.
   */
  injectable: boolean;
}

/** A problem, named by the file it was found in. */
export interface UserStyleProblem extends UserCssProblem {
  id: string;
}

/**
 * The styles in force, and their application. Session-scoped, created
 * once: every tab sees the same answer.
 *
 * Injection is `author` origin: user CSS cascades beside the page's
 * sheets, so sites can win. The blocker's hiding rules are the opposite,
 * using `user`.
 */
export class UserStyles {
  #blocks: OwnedBlock[] = [];
  #sheet = new ReplaceableStylesheet("author", "kvist: could not apply user styles:");

  /**
   * Replaces every style in force — a full snapshot like the config path:
   * the directory rescan hands over what it found, and diffing buys
   * nothing.
   *
   * Answers with everything wrong with the input; logging is the caller's
   * call.
   */
  setSources(sources: UserStyleSource[]): UserStyleProblem[] {
    const problems: UserStyleProblem[] = [];
    const blocks: OwnedBlock[] = [];

    for (const { id, source } of sources) {
      const parsed = parseUserCss(source);
      for (const problem of parsed.problems) problems.push({ id, ...problem });

      // No preprocessor lives in the browser: a file that needs compiling is
      // skipped by name, not injected as broken CSS. Converting it to plain
      // CSS is a separate tool's job, outside this repo. Its blocks are kept
      // anyway, marked non-injectable: the matchers parsed fine regardless of
      // the preprocessor, and `:style` still has to be able to find the file.
      const injectable = parsed.preprocessor === "default";
      if (!injectable) {
        problems.push({ id, reason: `skipped: @preprocessor ${parsed.preprocessor} is not run` });
      }

      for (const block of parsed.blocks) blocks.push({ id, block, injectable });
    }

    this.#blocks = blocks;
    return problems;
  }

  /** Every block that applies to a URL, in the order its files were given. */
  cssFor(url: string): string {
    return this.#blocks
      .filter(({ block, injectable }) => injectable && matchesUserCss(block.matchers, url))
      .map(({ block }) => block.css)
      .join("\n");
  }

  /**
   * Every file whose CSS applies to a URL — what `:style` opens. A file
   * may contribute several blocks but is named once: one file to open.
   *
   * Unlike `cssFor`, a skipped file's matchers count here: the `:style`
   * user still needs the file.
   */
  filesFor(url: string): string[] {
    const seen = new Set<string>();
    const files: string[] = [];

    for (const { id, block } of this.#blocks) {
      if (seen.has(id) || !matchesUserCss(block.matchers, url)) continue;
      seen.add(id);
      files.push(id);
    }

    return files;
  }

  /**
   * Puts this URL's styles on the page, replacing the last URL's. Runs on
   * committed and history-API navigations alike: styles key on URL, not
   * document, so a SPA must restyle without reloading. A URL matching
   * nothing clears the sheet.
   */
  applyTo(target: StylesheetTarget, url: string): void {
    this.#sheet.replace(target, this.cssFor(url));
  }
}
