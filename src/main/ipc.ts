import { ipcMain, type IpcMainEvent, type WebContents } from "electron";
import { type AnyTable, type PayloadOf, wire } from "../shared/ipc";

/**
 * One handler per channel, and the compiler insists on all of them: a channel
 * declared and never wired is a build error rather than a message that
 * silently goes nowhere.
 */
export type Handlers<T extends AnyTable> = {
  [K in keyof T]: (payload: PayloadOf<T[K]>, sender: WebContents) => void;
};

/**
 * Registers a whole table at once, behind one sender check — a channel cannot
 * be wired without stating who may use it.
 *
 * `ipcMain` is process-global while these handlers belong to a window, so this
 * answers with the way to take them off again.
 */
export function handle<T extends AnyTable>(
  channels: T,
  handlers: Handlers<T>,
  accept: (sender: WebContents) => boolean,
): () => void {
  const registered = Object.keys(channels).map((key) => {
    const name = wire(key);
    const listener = (event: IpcMainEvent, payload: unknown): void => {
      if (!accept(event.sender)) return;
      // SAFETY: the payload arrives over the wire erased; the channel table is the only sender.
      handlers[key]!(payload as never, event.sender);
    };
    ipcMain.on(name, listener);
    return () => void ipcMain.off(name, listener);
  });

  return () => {
    for (const off of registered) off();
  };
}
