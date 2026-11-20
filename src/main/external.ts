/**
 * Schemes Chromium loads inside a tab itself — genuinely (`http`,
 * `https`, `kvist`, `file`) or by failing the navigation (`about`,
 * `chrome`, `devtools`, ...). None is a candidate for the desktop:
 * `file:` already works or already fails, in a tab.
 */
const NATIVE_SCHEMES = new Set([
  "http",
  "https",
  "kvist",
  "file",
  "data",
  "blob",
  "filesystem",
  "javascript",
  "about",
  "chrome",
  "chrome-extension",
  "devtools",
  "view-source",
]);

/**
 * The scheme a URL hands to the desktop instead of the tab, or null for a
 * scheme the browser loads itself. Every other scheme is a candidate,
 * since native-app schemes cannot be enumerated; `ExternalProtocols`
 * decides whether a candidate opens.
 */
export function externalProtocolTarget(raw: string): string | null {
  let protocol: string;

  try {
    protocol = new URL(raw).protocol;
  } catch {
    return null;
  }

  const scheme = protocol.slice(0, -1);

  return NATIVE_SCHEMES.has(scheme) ? null : scheme;
}

/**
 * True for a typed `host:port` that is not a scheme: a non-special
 * scheme's URL has no `hostname`, so `tel:123` looks alike; only a dotted
 * or `localhost` word before the colon counts. Typed input only — page
 * links are unambiguous.
 */
export function looksLikeHostPort(raw: string): boolean {
  let parsed: URL;

  try {
    parsed = new URL(raw);
  } catch {
    return false;
  }

  if (parsed.hostname !== "" || !/^\d+(\/.*)?$/.test(parsed.pathname)) return false;
  const word = parsed.protocol.slice(0, -1);

  return word === "localhost" || word.includes(".");
}
