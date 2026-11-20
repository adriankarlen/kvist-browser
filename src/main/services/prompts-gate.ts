import type { Session } from "electron";
import { Context, Effect, Layer, Stream } from "effect";
import { httpOrigin } from "../../shared/url";
import { MainStore } from "../app/store";
import { checkPermission, Msg, rulePermission } from "../features/prompts/prompts.program";
import { Requesters, type Watchable } from "./requesters";

/**
 * Where questions enter the loop: Chromium's permission handlers, and a tab
 * asking to hand a URL to the desktop. The handlers answer on the spot when
 * the model already knows; otherwise they leave a requester waiting.
 */
export class PromptsGate extends Context.Service<
  PromptsGate,
  {
    /** Installs the request and check handlers; the session allows one pair, for the app's life. */
    readonly attach: (session: Session) => void;
    readonly requestExternal: (
      url: string,
      scheme: string,
      origin: string | null,
      selfInitiated: boolean,
      contents: Watchable | null,
    ) => void;
  }
>()("kvist/PromptsGate") {
  static layer = Layer.effect(
    PromptsGate,
    Effect.gen(function* () {
      const store = yield* MainStore;
      const requesters = yield* Requesters;

      yield* requesters.gone.pipe(
        Stream.runForEach((requester) =>
          Effect.sync(() => store.dispatch(Msg.cases.RequesterGone.make({ requester }))),
        ),
        Effect.forkScoped,
      );

      return {
        attach: (session) => {
          session.setPermissionRequestHandler((contents, permission, callback, details) => {
            const origin = httpOrigin(details.requestingUrl);
            const mediaTypes = "mediaTypes" in details ? details.mediaTypes : undefined;
            const ruling = rulePermission(store.get().prompts, permission, origin, mediaTypes);

            if (ruling.kind !== "ask" || origin === null) return callback(ruling.kind === "grant");
            const requester = requesters.register(contents, callback);

            store.dispatch(
              Msg.cases.PermissionRequested.make({
                requester,
                origin,
                permission: ruling.permission,
                mediaTypes: ruling.mediaTypes,
              }),
            );
          });
          session.setPermissionCheckHandler((_contents, permission, requestingOrigin, details) =>
            checkPermission(
              store.get().prompts,
              permission,
              httpOrigin(requestingOrigin),
              details.mediaType,
            ),
          );
        },
        requestExternal: (url, scheme, origin, selfInitiated, contents) => {
          const requester = requesters.register(contents);

          store.dispatch(
            Msg.cases.ExternalProtocolRequested.make({
              requester,
              url,
              scheme,
              origin,
              selfInitiated,
              watched: contents !== null,
            }),
          );
        },
      };
    }),
  );
}
