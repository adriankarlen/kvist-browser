import { contextBridge } from "electron";
import { forwardPort } from "./forward-port";

/** Same shape as the palette's. Main serves this port only the wizard's group. */
contextBridge.exposeInMainWorld("kvist", forwardPort());
