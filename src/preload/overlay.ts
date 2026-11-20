import { contextBridge } from "electron";
import { forwardPort } from "./forward-port";

/**
 * Same shape as the chrome's preload, but main serves this port only the
 * overlay's group: a dropdown that could navigate tabs would be a hole.
 */
contextBridge.exposeInMainWorld("kvist", forwardPort());
