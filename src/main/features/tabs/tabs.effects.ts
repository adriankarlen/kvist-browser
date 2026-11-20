import { Effect } from "effect";
import type { Interpret } from "../../../shared/tea/store";
import { LegacyWindow } from "../../services/legacy-window";
import type { TabViews } from "../../tab-views";
import { Cmd } from "./tabs.program";

const onViews = (act: (views: TabViews) => void) =>
  Effect.map(Effect.service(LegacyWindow), (window) => {
    if (window.current !== undefined) act(window.current.tabs);
  });

export const interpret: Interpret<never, Cmd, never, LegacyWindow> = (cmd) =>
  Cmd.match(cmd, {
    CreateTabView: ({ id, url }) => onViews((views) => views.create(id, url)),
    DestroyTabView: ({ id }) => onViews((views) => views.destroy(id)),
    FocusTab: ({ id }) => onViews((views) => views.focus(id)),
    SyncTabZoom: ({ id }) => onViews((views) => views.syncZoom(id)),
    HideTabContextMenu: ({ id }) => onViews((views) => views.hideContextMenu(id)),
    CancelTabFullscreen: ({ id }) => onViews((views) => views.cancelFullscreen(id)),
    SetWindowFullscreen: ({ fullscreen }) =>
      onViews((views) => views.setWindowFullscreen(fullscreen)),
    CloseWindow: () => onViews((views) => views.closeWindow()),
    RequestExternal: ({ url, scheme, origin, selfInitiated, opener }) =>
      onViews((views) => views.requestExternal(url, scheme, origin, selfInitiated, opener)),
  });
