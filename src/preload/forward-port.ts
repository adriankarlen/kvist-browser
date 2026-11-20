import { ipcRenderer } from "electron";

/**
 * Hands main's port to the document, and nothing else. A port cannot cross
 * `contextBridge`, so it goes by `window.postMessage`; the document asks
 * once it is listening, through the one function exposed.
 */
export function forwardPort(): { readonly connect: () => void } {
  ipcRenderer.on("kvist:port", (event) => window.postMessage("kvist:port", "*", [...event.ports]));

  return { connect: () => ipcRenderer.send("kvist:connect") };
}
