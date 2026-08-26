/**
 * The failure page, as data: what went wrong and where the user was headed.
 * Kept pure so both sides of the URL — the tab manager writing it and the
 * display mapping reading it back — are unit-testable without a browser.
 *
 * The page itself is static files under `public/error/`, served by the
 * `kvist://` protocol handler. The details travel in the query string, so
 * the page needs no IPC of its own — and it runs with the page preload,
 * which exposes nothing.
 */

/**
 * The one code that is not a failure: Chromium reports ERR_ABORTED when a
 * load is replaced by a newer one, which is ordinary navigation.
 */
export const ERR_ABORTED = -3;

/** Where the failure happened and how Chromium described it. */
export interface ErrorPageInfo {
  /**
   * Chromium's error code (negative), or null when the renderer died rather
   * than the load — a crash has a `render-process-gone` reason, not a code.
   */
  readonly code: number | null;
  /** Chromium's description, or the render-process-gone reason. */
  readonly description: string;
  /** The URL that failed; the retry link points back here. */
  readonly url: string;
}

/** The shape every error-page URL has; only `formatErrorPageUrl` mints one. */
export type ErrorPageUrl = `kvist://error/?${string}`;

const HOST = "error";
const SCHEME = "kvist";

/**
 * Formats an error page URL from failure information. The details are encoded
 * in the query string so the static error page can read and display them
 * without IPC.
 */
export function formatErrorPageUrl(info: ErrorPageInfo): ErrorPageUrl {
  const params = new URLSearchParams();
  if (info.code !== null) params.set("code", String(info.code));
  params.set("desc", info.description);
  params.set("url", info.url);
  // Baked in rather than recomputed in the page: the page is plain static
  // files and cannot import this module.
  params.set("headline", describeError(info.code));
  return `${SCHEME}://${HOST}/?${params.toString()}`;
}

/**
 * Reads back what `formatErrorPageUrl` wrote, or null for any other URL —
 * which is most URLs, since this also guards against looping on a failed
 * error page and against showing a sub-frame's failure as the tab's own.
 */
export function errorPageTarget(raw: string): ErrorPageInfo | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== `${SCHEME}:` || url.hostname !== HOST) return null;

  const target = url.searchParams.get("url");
  if (target === null || target === "") return null;

  // Chromium's codes are negative integers, and formatErrorPageUrl only ever
  // writes one — so anything else in the parameter is a hand-edited URL and
  // the whole page is rejected rather than half-read. parseInt would accept
  // "-105suffix", "-105.5" and padded whitespace; a strict match does not.
  const codeParam = url.searchParams.get("code");
  let code: number | null = null;
  if (codeParam !== null) {
    if (!/^-\d+$/.test(codeParam)) return null;
    code = Number(codeParam);
    if (!Number.isSafeInteger(code)) return null;
  }

  return { code, description: url.searchParams.get("desc") ?? "", url: target };
}

/**
 * A short headline for the codes a user is likely to see. Unknown codes fall
 * back to Chromium's description, which is shown alongside anyway.
 */
const HEADLINES = new Map([
  [-102, "connection refused"],
  [-105, "name not resolved"],
  [-106, "internet disconnected"],
  [-118, "connection timed out"],
  [-21, "network changed"],
  [-7, "timed out"],
  [-137, "name resolution failed"],
  [-324, "empty response"],
]);

/**
 * Returns a short human-readable headline for a Chromium error code. Falls
 * back to a generic description for unknown codes. Null code indicates a
 * renderer crash rather than a network error.
 */
export function describeError(code: number | null): string {
  if (code === null) return "renderer gone";
  return HEADLINES.get(code) ?? `error ${code}`;
}
