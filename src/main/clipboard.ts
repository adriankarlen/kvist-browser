import { clipboard } from "electron";

/**
 * The system clipboard, as Kvist reads and writes it. A tiny wrapper rather
 * than a direct import in `actions.ts`: `commands.test.ts` exercises the
 * actions without ever loading `electron`, and the dependency stays injected
 * the same way `getSearchUrl` is.
 */
export const systemClipboard = {
  read(): string {
    return clipboard.readText();
  },
  write(text: string): void {
    clipboard.writeText(text);
  },
} as const;
