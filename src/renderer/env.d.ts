import type { KvistApi } from "../shared/ipc";

declare global {
  interface Window {
    kvist: KvistApi;
  }
}

export {};
