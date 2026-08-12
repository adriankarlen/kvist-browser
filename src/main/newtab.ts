import { readFile } from "node:fs/promises";
import { extname, join, normalize, sep } from "node:path";
import { app, protocol } from "electron";

/**
 * Default kvist token values, mirroring src/renderer/styles/tokens.css but
 * without the @layer wrapper — the newtab page has no layer budget of its own.
 * Appended after the page's own style.css so user config.css overrides win by
 * source order.
 */
const TOKEN_DEFAULTS = `
:root {
  --kv-color-base: #191724;
  --kv-color-surface: #1f1d2e;
  --kv-color-overlay: #26233a;
  --kv-color-muted: #6e6a86;
  --kv-color-subtle: #908caa;
  --kv-color-text: #e0def4;
  --kv-color-accent: #c4a7e7;
  --kv-color-accent-alt: #9ccfd8;
  --kv-color-warning: #f6c177;
  --kv-color-danger: #eb6f92;
  --kv-color-highlight-low: #21202e;
  --kv-color-highlight-med: #403d52;
  --kv-color-highlight-high: #524f67;
  --kv-font-family: "JetBrainsMono Nerd Font", monospace;
  --kv-font-size: 14px;
  --kv-border-color: var(--kv-color-highlight-med);
  --kv-border-width: 2px;
}
`;

const MIME_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
};

let currentCss = "";

/** Must be called before app.whenReady(). */
export function registerNewtabScheme(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: "kvist",
      privileges: { standard: true, secure: true, corsEnabled: true },
    },
  ]);
}

/** Called when config.css changes; picked up on the next newtab page load. */
export function updateNewtabCss(css: string): void {
  currentCss = css;
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

    if (file.endsWith(".css")) {
      body += `\n${TOKEN_DEFAULTS}\n${currentCss}\n`;
    }

    return new Response(body, {
      headers: { "content-type": MIME_TYPES[extname(file)] ?? "text/plain" },
    });
  });
}
