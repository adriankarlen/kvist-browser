import { readFile } from "node:fs/promises";
import { extname, join, normalize, sep } from "node:path";
import { app, protocol } from "electron";
import { DEFAULT_SETTINGS, type NewtabLink } from "../shared/config";

/** Config-driven data for the newtab page, served as config.json. */
export interface NewtabConfig {
  links: readonly NewtabLink[];
  /** IANA name or "UTC±n"; undefined follows the system timezone. */
  timezone: string | undefined;
}
// Served to the newtab page ahead of the user's config.css. The @layer
// wrapper is fine there: user CSS is appended unlayered, and unlayered beats
// layered regardless of source order.
import tokensCss from "../renderer/styles/tokens.css?raw";

const MIME_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
};

let currentCss = "";
let currentConfig: NewtabConfig = {
  links: DEFAULT_SETTINGS.newtabLinks,
  timezone: undefined,
};

/** Must be called before app.whenReady(). */
export function registerNewtabScheme(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: "kvist",
      privileges: { standard: true, secure: true, corsEnabled: true, supportFetchAPI: true },
    },
  ]);
}

/** Called when config.css changes; picked up on the next newtab page load. */
export function updateNewtabCss(css: string): void {
  currentCss = css;
}

/** Called when the [newtab] settings change; picked up on the next newtab page load. */
export function updateNewtabConfig(config: NewtabConfig): void {
  currentConfig = config;
}

function newtabDir(): string {
  // In dev the renderer build hasn't run, so read straight from source.
  // In prod Vite copies public/ → dist/renderer/.
  return process.env.VITE_DEV_SERVER_URL
    ? join(app.getAppPath(), "public", "newtab")
    : join(import.meta.dirname, "../renderer/newtab");
}

/** Must be called after app.whenReady(). */
export function registerNewtabProtocol(): void {
  const root = newtabDir();

  protocol.handle("kvist", async (request) => {
    const url = new URL(request.url);
    if (url.hostname !== "newtab") {
      return new Response("Not found", { status: 404 });
    }

    const pathname = url.pathname === "/" ? "/index.html" : url.pathname;

    // Config-driven data, served rather than read from disk.
    if (pathname === "/config.json") {
      return new Response(JSON.stringify(currentConfig), {
        headers: { "content-type": "application/json; charset=utf-8" },
      });
    }

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
      body += `\n${tokensCss}\n${currentCss}\n`;
    }

    return new Response(body, {
      headers: { "content-type": MIME_TYPES[extname(file)] ?? "text/plain" },
    });
  });
}
