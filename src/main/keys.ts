import type { PageContents } from "./page-host";
import type { KeyInput, KeySource } from "./features/vim/vim.program";

/**
 * Routes a webContents' keys to the mode machine before its document sees
 * them. Both a page and the chrome need this — `before-input-event` is
 * per-webContents — and neither should have to remember the keyDown filter or
 * the preventDefault.
 */
export function interceptKeys(
  contents: PageContents,
  source: KeySource,
  onKey: (input: KeyInput, source: KeySource) => boolean,
): void {
  contents.on("before-input-event", (event, input) => {
    if (input.type !== "keyDown") return;

    const consumed = onKey(
      {
        key: input.key,
        code: input.code,
        control: input.control,
        alt: input.alt,
        meta: input.meta,
        shift: input.shift,
      },
      source,
    );

    if (consumed) event.preventDefault();
  });
}
