import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { app, protocol } from "electron";

/**
 * Default kvist token values, mirroring src/renderer/styles/tokens.css but
 * without the @layer wrapper — the newtab page has no layer budget of its own.
 * User config.css is injected after these so any --kv-* override wins.
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
}
`;

let htmlTemplate = "";
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

function newtabHtmlPath(): string {
  // In dev the renderer build hasn't run, so read straight from source.
  // In prod Vite copies public/ → dist/renderer/.
  return process.env.VITE_DEV_SERVER_URL
    ? join(app.getAppPath(), "public", "newtab.html")
    : join(import.meta.dirname, "../renderer/newtab.html");
}

/** Must be called after app.whenReady(). */
export async function registerNewtabProtocol(): Promise<void> {
  htmlTemplate = await readFile(newtabHtmlPath(), "utf8");

  protocol.handle("kvist", (request) => {
    const { hostname } = new URL(request.url);

    if (hostname !== "newtab") {
      return new Response("Not found", { status: 404 });
    }

    const injected = htmlTemplate.replace(
      "</head>",
      `<style>\n${TOKEN_DEFAULTS}\n${currentCss}\n</style>\n</head>`,
    );

    return new Response(injected, {
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  });
}
