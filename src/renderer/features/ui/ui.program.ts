import { Schema } from "effect";
import { DEFAULT_SETTINGS } from "../../../shared/config";
import { ChromeIntent } from "../../../shared/rpc/chrome";
import { RestoreSessionState } from "../../../shared/schema/browser";
import { type Settings, type TabOrientation, UserConfig } from "../../../shared/schema/config";
import { next, type Next } from "../../../shared/tea/program";
import { Cmd as LinkCmds, type Cmd as LinkCmd, send } from "../link/link.program";

/**
 * The config as the chrome uses it, plus the runtime orientation flip.
 * Main mirrors the flip so it can save it with the session.
 */
export interface Model {
  readonly settings: Settings;
  readonly orientation: TabOrientation | null;
}

export const init: Model = { settings: DEFAULT_SETTINGS, orientation: null };

export const Msg = Schema.TaggedUnion({
  ConfigChanged: { config: UserConfig },
  SessionRestored: { session: RestoreSessionState },
  OrientationToggled: {},
});

export type Msg = typeof Msg.Type;

const override = (orientation: TabOrientation | null): LinkCmd =>
  send(ChromeIntent.cases.OrientationOverridden.make({ orientation }));

export const tabOrientation = (model: Model): TabOrientation =>
  model.orientation ?? model.settings.tabOrientation;

export function update(msg: Msg, model: Model): Next<Model, never, LinkCmd> {
  return Msg.match(msg, {
    ConfigChanged: ({ config }) => {
      const css = LinkCmds.cases.InjectCss.make({ css: config.css });

      // A new orientation in the file wins over a flip made under the old one.
      if (config.settings.tabOrientation !== model.settings.tabOrientation) {
        const reset: Model = { settings: config.settings, orientation: null };

        return next(reset, [css, override(null)]);
      }

      return next({ ...model, settings: config.settings }, [css]);
    },
    SessionRestored: ({ session }) =>
      next({ ...model, orientation: session.orientation }, [override(session.orientation)]),
    OrientationToggled: () => {
      const orientation: TabOrientation =
        tabOrientation(model) === "horizontal" ? "vertical" : "horizontal";

      return next({ ...model, orientation }, [override(orientation)]);
    },
  });
}
