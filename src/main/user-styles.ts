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
}

/** A problem, named by the file it was found in. */
export interface UserStyleProblem extends UserCssProblem {
  id: string;
}

/**
 * The styles in force, and their application to pages. Session-scoped and
 * created once: a style belongs to no window, and every tab in every window
 * gets the same answer for the same URL.
 *
 * Injection is `author` origin — a user stylesheet cascades alongside the
 * page's own sheets rather than outranking them wholesale, so a site can still
 * win on specificity and a UserCSS author reaches for `!important` exactly
 * when the format's own docs say to. The ad blocker's hiding rules are the
 * other case, and use `user` for the opposite reason.
 */
export class UserStyles {
  #blocks: OwnedBlock[] = [];
  #sheet = new ReplaceableStylesheet("author", "kvist: could not apply user styles:");

  /**
   * Replaces every style in force. A full snapshot rather than a diff, like
   * the rest of the config path: the watched directory (KVI-22) rescans and
   * hands over what it found, and working out what changed would buy nothing.
   *
   * Answers with everything wrong with what it was given. Nothing is logged
   * from here — who gets told, and how loudly, is the caller's decision.
   */
  setSources(sources: UserStyleSource[]): UserStyleProblem[] {
    const problems: UserStyleProblem[] = [];
    const blocks: OwnedBlock[] = [];

    for (const { id, source } of sources) {
      const parsed = parseUserCss(source);
      for (const problem of parsed.problems) problems.push({ id, ...problem });

      // No preprocessor lives in the browser: a file that needs compiling is
      // skipped by name, not injected as broken CSS. Converting it to plain
      // CSS is a separate tool's job, outside this repo.
      if (parsed.preprocessor !== "default") {
        problems.push({ id, reason: `skipped: @preprocessor ${parsed.preprocessor} is not run` });
        continue;
      }

      for (const block of parsed.blocks) blocks.push({ id, block });
    }

    this.#blocks = blocks;
    return problems;
  }

  /** Every block that applies to a URL, in the order its files were given. */
  cssFor(url: string): string {
    return this.#blocks
      .filter(({ block }) => matchesUserCss(block.matchers, url))
      .map(({ block }) => block.css)
      .join("\n");
  }

  /**
   * Every distinct file whose CSS currently applies to a URL, in the order
   * its file was first given — what `:style` (KVI-23) jumps to. A file can
   * contribute more than one matching block (a global rule plus a
   * domain-scoped one, say); it is named once regardless, since there is only
   * one file to open for it.
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
   * Puts this URL's styles on a page in place of the last URL's. Called on
   * every committed navigation *and* on history-API ones: the styles are keyed
   * to the URL, not the document, so a SPA moving between routes has to be
   * restyled without anything reloading.
   *
   * A URL that matches nothing clears the sheet rather than leaving the
   * previous page's styles behind.
   */
  applyTo(target: StylesheetTarget, url: string): void {
    this.#sheet.replace(target, this.cssFor(url));
  }
}
