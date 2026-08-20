import { readFile } from "node:fs/promises";
import { extname, join, normalize, sep } from "node:path";
import { app, protocol } from "electron";
import { DEFAULT_SETTINGS, type NewtabLink, type Settings } from "../shared/config";

/** Config-driven data for the newtab page, served as config.json. */
export interface NewtabConfig {
  links: readonly NewtabLink[];
  /** IANA name or "UTC±n"; undefined follows the system timezone. */
  timezone: string | undefined;
}
// Served to the local pages ahead of the user's config.css, so the pages
// share the chrome's reset and tokens rather than duplicating them. The
// @layer wrapper is fine there: user CSS is appended unlayered, and
// unlayered beats layered regardless of source order.
import resetCss from "../shared/styles/reset.css?raw";
import tokensCss from "../shared/styles/tokens.css?raw";

const MIME_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
};

/**
 * The local pages the `kvist://` scheme serves: kvist://newtab/ is the
 * homepage, kvist://error/ the failure page. Each is a directory of static
 * files under public/, and each gets the shared reset and tokens plus the
 * user's config.css appended to its style.css, so it is reset and themed
 * like the chrome.
 */
const PAGES = ["newtab", "error"] as const;
type LocalPage = (typeof PAGES)[number];

let currentCss = "";
let currentConfig: NewtabConfig = {
  links: DEFAULT_SETTINGS.newtabLinks,
  timezone: undefined,
};

/** Must be called before app.whenReady(). */
export function registerKvistScheme(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: "kvist",
      privileges: { standard: true, secure: true, corsEnabled: true, supportFetchAPI: true },
    },
  ]);
}

/**
 * What the local pages take from the config: the user's stylesheet, and the
 * clock and links the new tab page shows. Picked up on the next page load.
 */
export function applySettings(config: {
  css: string;
  settings: Pick<Settings, "newtabLinks" | "newtabTimezone">;
}): void {
  currentCss = config.css;
  currentConfig = {
    links: config.settings.newtabLinks,
    timezone: config.settings.newtabTimezone,
  };
}

function pageDir(page: LocalPage): string {
  // In dev the renderer build hasn't run, so read straight from source.
  // In prod Vite copies public/ → dist/renderer/.
  return process.env.VITE_DEV_SERVER_URL
    ? join(app.getAppPath(), "public", page)
    : join(import.meta.dirname, "../renderer", page);
}

function isLocalPage(hostname: string): hostname is LocalPage {
  return (PAGES as readonly string[]).includes(hostname);
}

/** Must be called after app.whenReady(). */
export function registerKvistProtocol(): void {
  protocol.handle("kvist", async (request) => {
    const url = new URL(request.url);
    if (!isLocalPage(url.hostname)) {
      return new Response("Not found", { status: 404 });
    }

    const pathname = url.pathname === "/" ? "/index.html" : url.pathname;

    // Config-driven data, served rather than read from disk.
    if (url.hostname === "newtab" && pathname === "/config.json") {
      return new Response(JSON.stringify(currentConfig), {
        headers: { "content-type": "application/json; charset=utf-8" },
      });
    }

    const root = pageDir(url.hostname);
    const file = normalize(join(root, pathname));
    if (!file.startsWith(root + sep)) {
      return new Response("Not found", { status: 404 });
    }

    let body: string;
    try {
      body = await readFile(file, "utf8");
    } catch {
      return new Response("Not found", { status: 404 });
    }

    if (pathname === "/style.css") {
      body += `\n${resetCss}\n${tokensCss}\n${currentCss}\n`;
    }

    return new Response(body, {
      headers: { "content-type": MIME_TYPES[extname(file)] ?? "text/plain" },
    });
  });
}
