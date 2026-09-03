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

/** Schemes whose origin makes sense to remember per-site — http(s), the local pages, file://. */
const PERSISTABLE = new Set(["http:", "https:", "kvist:", "file:"]);

/**
 * The origin a page may be asked about, or null. Narrower than `originOf`:
 * a permission or an external-protocol ask ties a remembered decision to a
 * site, and `kvist:`, `file:`, devtools and anything opaque all parse to
 * the origin "null" — a prompt that cannot say who is asking is no prompt,
 * so only http(s) origins qualify.
 */
export function httpOrigin(url: string): string | null {
  let origin: string;
  try {
    origin = new URL(url).origin;
  } catch {
    return null;
  }
  return origin.startsWith("http://") || origin.startsWith("https://") ? origin : null;
}

/**
 * The origin a per-site preference (zoom level, etc.) is keyed under. Returns
 * null for opaque origins (`about:blank`, `data:`) and for schemes we do not
 * care to remember, so callers can skip persistence without an extra check.
 *
 * `URL#origin` returns the string `"null"` for non-special schemes like
 * `kvist:`, so `kvist://newtab` is assembled by hand from protocol + host.
 */
export function originOf(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (!PERSISTABLE.has(parsed.protocol)) return null;
  // Non-special schemes have no `URL#origin`; fall back to scheme + host.
  if (parsed.origin === "null") return `${parsed.protocol}//${parsed.host}`;
  return parsed.origin;
}
