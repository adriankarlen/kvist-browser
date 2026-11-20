import type { DownloadItem } from "electron";
import { Context, Layer } from "effect";

/** Transfers still running, by row id, so a Cmd can cancel one. */
export class LiveDownloads extends Context.Service<
  LiveDownloads,
  { readonly items: Map<number, DownloadItem> }
>()("kvist/LiveDownloads") {
  static layer = Layer.sync(LiveDownloads, () => ({ items: new Map() }));
}
