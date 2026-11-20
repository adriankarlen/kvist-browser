import { shell } from "electron";
import { Context, Effect, Layer, Schema } from "effect";

export class DesktopOpenFailed extends Schema.TaggedError<DesktopOpenFailed>()(
  "DesktopOpenFailed",
  {
    url: Schema.String,
  },
) {}

/** What Kvist hands to the operating system. */
export class Desktop extends Context.Service<
  Desktop,
  { readonly openExternal: (url: string) => Effect.Effect<void, DesktopOpenFailed> }
>()("kvist/Desktop") {
  static layer = Layer.succeed(Desktop, {
    openExternal: (url) =>
      Effect.tryPromise({
        try: () => shell.openExternal(url),
        catch: () => new DesktopOpenFailed({ url }),
      }),
  });
}
