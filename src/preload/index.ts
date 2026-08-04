import { contextBridge } from "electron";

contextBridge.exposeInMainWorld("kvist", {});
