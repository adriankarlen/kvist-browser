/**
 * Schemes a page may hand to the desktop, and no others. An allowlist, not
 * a denylist: `shell.openExternal` runs page-controlled input through
 * xdg-open, where `file:` on Windows launches executables and several
 * desktop environments take unusual paths on the schemes nobody explicitly
 * allowlisted. Every scheme not listed here fails the navigation as it
 * always has — the error page is the only feedback for an unknown one.
 */
const EXTERNAL_PROTOCOLS = new Set(["ftp", "geo", "magnet", "mailto", "sms", "tel", "webcal"]);

/**
 * The scheme of a URL the desktop should open instead of the tab, or null
 * for everything else: http(s) pages, kvist: pages, and every scheme a
 * browser should not hand out.
 */
export function externalProtocolTarget(raw: string): string | null {
  let protocol: string;
  try {
    protocol = new URL(raw).protocol;
  } catch {
    return null;
  }
  const scheme = protocol.slice(0, -1);
  return EXTERNAL_PROTOCOLS.has(scheme) ? scheme : null;
}
