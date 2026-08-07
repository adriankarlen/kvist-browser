import { readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { ElectronBlocker } from "@ghostery/adblocker-electron";
import { app, session, type WebContents } from "electron";
import { parse } from "tldts-experimental";

let blocker: ElectronBlocker | undefined;
let enabled = false;

/** How long a cached engine may be used before the lists are refetched. */
const MAX_ENGINE_AGE = 24 * 60 * 60 * 1000;

type InjectMessage = Parameters<ElectronBlocker["onInjectCosmeticFilters"]>[2];

/**
 * uBO scriptlets are self-contained bundles that declare their helpers at the
 * top level — several of the YouTube ones declare `class JSONPath`. The library
 * runs each as its own top-level `executeJavaScript`, so they share one global
 * lexical scope and every declaration after the first dies with a redeclaration
 * SyntaxError, taking its whole scriptlet with it. An IIFE gives each one its
 * own scope.
 *
 * The trailing `undefined` keeps a scriptlet's final expression from being
 * serialized back over IPC.
 */
function runScriptlet(sender: WebContents, script: string): void {
  sender
    .executeJavaScript(`(function(){${script}\n})();undefined`, true)
    .catch((error: unknown) => console.error("kvist: scriptlet failed:", error));
}

/**
 * Replaces the library's own cosmetic injection. Kept faithful to it, bar the
 * scriptlet wrapping and a real `catch` — upstream wraps an async call in a
 * synchronous `try`, so its failures escape as unhandled rejections.
 *
 * Nothing here needs redoing on history-API navigation. Same-document
 * navigation cannot cross origins, and with `getExtendedRules` off the styles
 * are a pure function of hostname and domain, so a reinjection is byte for byte
 * what the document already carries. Content the SPA adds afterwards arrives on
 * the DOM-update path below rather than through the URL.
 */
function injectCosmetics(
  sender: WebContents,
  url: string,
  msg?: InjectMessage,
  callerContext?: unknown,
): void {
  if (!blocker || sender.isDestroyed()) return;

  const parsed = parse(url);
  // `msg` is absent on the first call and present for DOM-driven updates.
  const isFirstRun = msg === undefined;
  const { active, styles, scripts } = blocker.getCosmeticsFilters({
    domain: parsed.domain ?? "",
    hostname: parsed.hostname ?? "",
    url,
    classes: msg?.classes,
    hrefs: msg?.hrefs,
    ids: msg?.ids,
    getBaseRules: isFirstRun,
    getInjectionRules: isFirstRun,
    getExtendedRules: false,
    getRulesFromHostname: isFirstRun,
    getRulesFromDOM: !isFirstRun,
    callerContext,
  });

  if (!active) return;
  // Each update covers selectors the previous passes had not seen, so the
  // sheets accumulate by design and none of them may be removed.
  if (styles.length > 0) void sender.insertCSS(styles, { cssOrigin: "user" });
  for (const script of scripts) runScriptlet(sender, script);
}

/** Rejects a cached engine past its shelf life, so `fromCached` refetches. */
async function readIfFresh(path: string): Promise<Buffer> {
  const { mtimeMs } = await stat(path);
  if (Date.now() - mtimeMs > MAX_ENGINE_AGE) throw new Error("cached engine is stale");
  return readFile(path);
}

/**
 * The engine is a few MB of parsed filter lists, cached as a binary blob. The
 * library only invalidates that cache when its own serialization version
 * changes, which would pin a user to whatever lists they first downloaded, so
 * age is enforced here instead.
 */
async function engine(): Promise<ElectronBlocker> {
  if (blocker) return blocker;

  const path = join(app.getPath("userData"), "adblocker-engine.bin");
  const build = (read: (path: string) => Promise<Buffer>): Promise<ElectronBlocker> =>
    ElectronBlocker.fromPrebuiltAdsAndTracking(fetch, { path, read, write: writeFile });

  let instance: ElectronBlocker;
  try {
    instance = await build(readIfFresh);
  } catch {
    // Refetching failed, most likely offline. Stale lists beat none at all.
    instance = await build(readFile);
  }

  // `BlockingContext` dispatches through this property on every injection, so
  // overriding it on the instance is enough to take the handler over.
  instance.onInjectCosmeticFilters = async (event, url, msg) => {
    injectCosmetics(event.sender, url, msg, {
      frameId: event.frameId,
      processId: event.processId,
      lifecycle: msg?.lifecycle,
    });
  };

  blocker = instance;
  return instance;
}

/**
 * Blocking attaches to `session.webRequest`, which allows only one listener per
 * event — so nothing else in main may claim `onBeforeRequest` or
 * `onHeadersReceived`.
 *
 * Failure here is not fatal: the first run needs the network to fetch lists,
 * and a browser that starts without blocking beats one that does not start.
 */
export async function setAdblockEnabled(next: boolean): Promise<void> {
  if (next === enabled) return;

  try {
    const instance = await engine();
    if (next) instance.enableBlockingInSession(session.defaultSession);
    else instance.disableBlockingInSession(session.defaultSession);
    enabled = next;
  } catch (error) {
    console.error("kvist: could not load the ad blocker:", error);
  }
}
