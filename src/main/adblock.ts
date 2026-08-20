import { readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { ElectronBlocker } from "@ghostery/adblocker-electron";
import { app, session, type WebContents } from "electron";
import { parse } from "tldts-experimental";
import type { Settings } from "../shared/config";

let blocker: ElectronBlocker | undefined;
let enabled = false;

/** How long a cached engine may be used before the lists are refetched. */
const MAX_ENGINE_AGE = 24 * 60 * 60 * 1000;

/** Ceiling on a single list request, so a hung socket cannot stall startup. */
const FETCH_TIMEOUT = 15 * 1000;

type InjectMessage = Parameters<ElectronBlocker["onInjectCosmeticFilters"]>[2];

/** Key of the URL-scoped sheet per tab, so navigation can replace it. */
/**
 * What cosmetic filtering needs from a page: its own stylesheet surface. A tab
 * reaches this through the `PageHost` seam, which is narrower than a
 * `WebContents`.
 */
type CosmeticTarget = Pick<WebContents, "isDestroyed" | "insertCSS" | "removeInsertedCSS">;

const urlSheets = new WeakMap<CosmeticTarget, string>();

/** Tail of the replacement chain per tab, so overlapping navigations queue. */
const replacements = new WeakMap<CosmeticTarget, Promise<void>>();

/**
 * `$generichide` and friends are matched against the whole URL, path included,
 * so the hiding rules are not fixed for the lifetime of a document. The sheet
 * they produce is tracked and swapped rather than appended, and the swaps are
 * serialized because two navigations in flight at once would otherwise race
 * over which key is current.
 */
function replaceUrlSheet(sender: CosmeticTarget, styles: string): void {
  const swap = async (): Promise<void> => {
    if (sender.isDestroyed()) return;

    const previous = urlSheets.get(sender);
    urlSheets.delete(sender);
    if (previous !== undefined) await sender.removeInsertedCSS(previous);
    if (styles.length === 0 || sender.isDestroyed()) return;

    urlSheets.set(sender, await sender.insertCSS(styles, { cssOrigin: "user" }));
  };

  const queued = (replacements.get(sender) ?? Promise.resolve())
    .then(swap, swap)
    .catch((error: unknown) => console.error("kvist: could not apply hiding rules:", error));
  replacements.set(sender, queued);
}

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

  if (isFirstRun) {
    replaceUrlSheet(sender, active ? styles : "");
  } else if (active && styles.length > 0) {
    // Each update covers selectors the earlier passes had not seen, so these
    // sheets are additive and none of them may be removed.
    void sender
      .insertCSS(styles, { cssOrigin: "user" })
      .catch((error: unknown) => console.error("kvist: could not apply hiding rules:", error));
  }

  if (!active) return;
  for (const script of scripts) runScriptlet(sender, script);
}

/** Reapplies the URL-scoped hiding rules after a history-API navigation. */
export function refreshCosmeticStyles(sender: CosmeticTarget, url: string): void {
  if (!blocker || !enabled || sender.isDestroyed()) return;

  const parsed = parse(url);
  const { active, styles } = blocker.getCosmeticsFilters({
    domain: parsed.domain ?? "",
    hostname: parsed.hostname ?? "",
    url,
    getBaseRules: true,
    getInjectionRules: false,
    getExtendedRules: false,
    getRulesFromHostname: true,
    getRulesFromDOM: false,
  });

  replaceUrlSheet(sender, active ? styles : "");
}

/** Rejects a cached engine past its shelf life, so `fromCached` refetches. */
async function readIfFresh(path: string): Promise<Buffer> {
  const { mtimeMs } = await stat(path);
  if (Date.now() - mtimeMs > MAX_ENGINE_AGE) throw new Error("cached engine is stale");
  return readFile(path);
}

/**
 * The library retries a failed list fetch but never gives up on one that simply
 * hangs, and this runs before the first window opens, so a dead connection
 * would stall the whole app rather than fall through to the cache.
 */
const fetchWithTimeout: typeof fetch = (input, init) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT);
  return fetch(input, { ...init, signal: controller.signal }).finally(() => clearTimeout(timer));
};

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
    ElectronBlocker.fromPrebuiltAdsAndTracking(fetchWithTimeout, { path, read, write: writeFile });

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
export async function applySettings(config: {
  settings: Pick<Settings, "adblock">;
}): Promise<void> {
  const next = config.settings.adblock;
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
