import { contextBridge } from "electron";
import { forwardPort } from "./forward-port";

/**
 * Same shape as the chrome's preload. Main serves this port only the
 * palette's group, so the palette can ask for a destination but not drive tabs.
 */
contextBridge.exposeInMainWorld("kvist", forwardPort());
