import { ipcMain, type IpcMainEvent, type IpcMainInvokeEvent, type WebContents } from "electron";
import {
  type AnyQueryTable,
  type AnyTable,
  type PayloadOf,
  type RequestOf,
  type ResponseOf,
  wire,
} from "../shared/ipc";

/**
 * One handler per channel, and the compiler insists on all of them: a channel
 * declared and never wired is a build error rather than a message that
 * silently goes nowhere.
 */
export type Handlers<T extends AnyTable> = {
  [K in keyof T]: (payload: PayloadOf<T[K]>, sender: WebContents) => void;
};

/**
 * Registers a whole table at once, behind one sender check — a channel
 * cannot be wired without stating who may use it.
 *
 * `ipcMain` is process-global while these handlers belong to a window, so
 * the return value takes them off again.
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

/** One handler per query channel, the request/response counterpart of `Handlers`. */
export type QueryHandlers<T extends AnyQueryTable> = {
  [K in keyof T]: (
    request: RequestOf<T[K]>,
    sender: WebContents,
  ) => ResponseOf<T[K]> | Promise<ResponseOf<T[K]>>;
};

/**
 * Registers a whole query table at once, behind one sender check — the same
 * shape as `handle`, but over `ipcMain.handle`/`ipcRenderer.invoke` so a
 * caller gets the answer back rather than firing into the void.
 */
export function handleQueries<T extends AnyQueryTable>(
  channels: T,
  handlers: QueryHandlers<T>,
  accept: (sender: WebContents) => boolean,
): () => void {
  const names = Object.keys(channels).map((key) => {
    const name = wire(key);
    ipcMain.handle(name, (event: IpcMainInvokeEvent, request: unknown) => {
      if (!accept(event.sender)) throw new Error(`kvist: rejected query ${name}`);
      // SAFETY: the request arrives over the wire erased; the channel table is the only sender.
      return handlers[key]!(request as never, event.sender);
    });
    return name;
  });

  return () => {
    for (const name of names) ipcMain.removeHandler(name);
  };
}
