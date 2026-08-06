import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import { session } from "electron";
import { configDir } from "./paths";

function expand(entry: string): string {
  if (entry === "~") return homedir();
  if (entry.startsWith("~/")) return join(homedir(), entry.slice(2));
  return isAbsolute(entry) ? entry : resolve(configDir, entry);
}

/**
 * Load-as-unpacked only: no store, no CRX parsing. Tabs run in the default
 * session, so that is where extensions have to land.
 *
 * A bad path must not take the browser down with it, so failures are reported
 * and skipped. Must be called after `app.whenReady()`.
 */
export async function loadExtensions(paths: string[]): Promise<void> {
  const { extensions } = session.defaultSession;

  await Promise.all(
    paths.map(async (entry) => {
      const path = expand(entry);
      try {
        const extension = await extensions.loadExtension(path, { allowFileAccess: true });
        console.log(`kvist: loaded extension ${extension.name} ${extension.version}`);
      } catch (error) {
        console.error(`kvist: could not load extension from ${path}:`, error);
      }
    }),
  );
}
