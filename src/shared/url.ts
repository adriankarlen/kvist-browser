const HAS_SCHEME = /^[a-z][a-z0-9+.-]*:/i;
const LOOKS_LIKE_HOST = /^[^\s/]+\.[^\s/]+/;

/** Turns omnibox or :open input into something loadURL will accept. */
export function resolveUrl(input: string): string {
  const query = input.trim();
  if (HAS_SCHEME.test(query)) return query;
  if (LOOKS_LIKE_HOST.test(query)) return `https://${query}`;
  return `https://duckduckgo.com/?q=${encodeURIComponent(query)}`;
}
