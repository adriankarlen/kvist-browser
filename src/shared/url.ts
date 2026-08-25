const HAS_SCHEME = /^[a-z][a-z0-9+.-]*:/i;
const LOOKS_LIKE_HOST = /^[^\s/]+\.[^\s/]+/;

/**
 * The search template used when config.toml does not say otherwise. `{q}` is
 * where the encoded query goes.
 */
export const DEFAULT_SEARCH_URL = "https://duckduckgo.com/?q={q}";

/** Turns omnibox or :open input into something loadURL will accept. */
export function resolveUrl(input: string, searchUrl: string = DEFAULT_SEARCH_URL): string {
  const query = input.trim();
  if (HAS_SCHEME.test(query)) return query;
  if (LOOKS_LIKE_HOST.test(query)) return `https://${query}`;
  return searchUrl.replace("{q}", encodeURIComponent(query));
}
