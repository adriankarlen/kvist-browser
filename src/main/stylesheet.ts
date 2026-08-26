import type { WebContents } from "electron";

/**
 * What replacing a stylesheet needs from a page, and nothing more: a tab
 * reaches this through the narrow `PageContents` seam rather than a whole
 * `WebContents`, and a test can satisfy it with three functions.
 */
export type StylesheetTarget = Pick<WebContents, "isDestroyed" | "insertCSS" | "removeInsertedCSS">;

/**
 * A rejection reason is `unknown` by nature, and all one of these failures
 * needs is a log line.
 */
const logFailure =
  (what: string) =>
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- rejection reasons are unknown; they are only logged
  (error: unknown): void =>
    console.error(what, error);

/**
 * One swappable sheet per page: inserting the next removes the last, rather
 * than stacking another on top. Both users of this — the ad blocker's
 * URL-scoped hiding rules and the user's own styles — key their CSS on the
 * whole URL rather than the document, so the sheet has to be replaced on every
 * navigation for the lifetime of a tab.
 *
 * The swaps are serialized per target because `insertCSS` answers with the key
 * needed to remove it later: two navigations in flight at once would otherwise
 * race over which key is current, and the loser's sheet would never come off.
 *
 * The origin is fixed per instance rather than passed per call — it is a
 * property of what the CSS *is*, not of one insertion. `user` outranks a
 * page's own `!important` (what hiding rules need); `author` cascades
 * alongside the page's own sheets (what a user stylesheet wants, so a site
 * can still win on specificity the way UserCSS authors already expect).
 */
export class ReplaceableStylesheet {
  #origin: "user" | "author";
  #what: string;
  /** Key of the sheet currently inserted per target, so it can be removed. */
  #keys = new WeakMap<StylesheetTarget, string>();
  /** Tail of the replacement chain per target, so overlapping swaps queue. */
  #chains = new WeakMap<StylesheetTarget, Promise<void>>();

  /** `what` names this sheet in the one place it can fail: a log line. */
  constructor(origin: "user" | "author", what: string) {
    this.#origin = origin;
    this.#what = what;
  }

  /**
   * Puts `css` on the page in place of whatever this sheet last put there.
   * Empty CSS removes without inserting, which is how a page that matches
   * nothing is cleaned up rather than left wearing the last page's styles.
   */
  replace(target: StylesheetTarget, css: string): void {
    const swap = async (): Promise<void> => {
      if (target.isDestroyed()) return;

      const previous = this.#keys.get(target);
      // Forgotten before the await, not after: a failure to remove must not
      // leave a key that a later swap would try to remove a second time.
      this.#keys.delete(target);
      if (previous !== undefined) await target.removeInsertedCSS(previous);
      if (css.length === 0 || target.isDestroyed()) return;

      this.#keys.set(target, await target.insertCSS(css, { cssOrigin: this.#origin }));
    };

    // `.then(swap, swap)` rather than `.finally`: the next swap has to run
    // whether the previous one succeeded or not, or one failure would wedge
    // the chain for the rest of the tab's life.
    const queued = (this.#chains.get(target) ?? Promise.resolve())
      .then(swap, swap)
      .catch(logFailure(this.#what));
    this.#chains.set(target, queued);
  }
}
