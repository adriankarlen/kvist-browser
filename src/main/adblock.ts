import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { ElectronBlocker } from "@ghostery/adblocker-electron";
import { app, session } from "electron";

let blocker: ElectronBlocker | undefined;
let enabled = false;

/**
 * The engine is a few MB of parsed filter lists, so it is cached as a binary
 * blob and only refetched when the library's own versioning says it is stale.
 */
async function engine(): Promise<ElectronBlocker> {
  blocker ??= await ElectronBlocker.fromPrebuiltAdsAndTracking(fetch, {
    path: join(app.getPath("userData"), "adblocker-engine.bin"),
    read: readFile,
    write: writeFile,
  });
  return blocker;
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
