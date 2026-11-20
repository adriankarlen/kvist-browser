import { type MessagePortMain, MessageChannelMain, type WebContents, ipcMain } from "electron";
import { Effect, type Fiber } from "effect";
import type { ManagedRuntime } from "effect";
import { type RpcMessage, RpcServer } from "effect/rpc";
import { type Port, serverProtocol } from "../../shared/rpc/port";

/** The ask a preload sends once it can receive a port, and the reply that carries it. */
const CONNECT = "kvist:connect";
const PORT = "kvist:port";

function mainPort(
  port: MessagePortMain,
): Port<RpcMessage.FromClientEncoded, RpcMessage.FromServerEncoded> {
  return {
    post: (message) => port.postMessage(message),
    listen: (onMessage, onClose) => {
      const message = (event: Electron.MessageEvent) => onMessage(event.data);

      port.on("message", message);
      port.on("close", onClose);
      port.start();

      return () => {
        port.off("message", message);
        port.off("close", onClose);
      };
    },
    close: () => port.close(),
  };
}

/** What serving needs of a webContents. */
export type ServedContents = Pick<WebContents, "postMessage" | "isDestroyed" | "once" | "off">;

const connectors = new Map<ServedContents, () => void>();
let listening = false;

/** One process-wide listener; each webContents' connector decides what it serves. */
function listenForConnects(): void {
  if (listening) return;
  listening = true;
  ipcMain.on(CONNECT, (event) => connectors.get(event.sender)?.());
}

/**
 * Runs `server` for one webContents, each with a port of its own. Each connect (first load, and every
 * reload) gets a fresh channel and server; the previous one is closed. The
 * webContents' own destruction stops serving for good.
 */
export function serve<R>(
  runtime: ManagedRuntime.ManagedRuntime<R, unknown>,
  contents: ServedContents,
  server: Effect.Effect<never, never, RpcServer.Protocol | R>,
): () => void {
  let running: Fiber.Fiber<unknown, unknown> | undefined;

  const stop = (): void => {
    running?.interruptUnsafe();
    running = undefined;
  };

  const connect = (): void => {
    stop();

    if (contents.isDestroyed()) return;
    const { port1, port2 } = new MessageChannelMain();

    running = runtime.runFork(
      Effect.gen(function* () {
        const protocol = yield* serverProtocol(mainPort(port1));

        return yield* Effect.provideService(server, RpcServer.Protocol, protocol);
      }).pipe(Effect.scoped),
    );
    contents.postMessage(PORT, null, [port2]);
  };

  const release = (): void => {
    connectors.delete(contents);
    stop();
  };

  listenForConnects();
  connectors.set(contents, connect);
  contents.once("destroyed", release);

  return () => {
    contents.off("destroyed", release);
    release();
  };
}
