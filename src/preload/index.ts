import { contextBridge } from "electron";
import { forwardPort } from "./forward-port";

contextBridge.exposeInMainWorld("kvist", forwardPort());
