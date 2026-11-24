import { Schema } from "effect";
import { DEFAULT_SETTINGS } from "../../../shared/config";
import { arrange, type ElementId, type Region } from "../../../shared/layout";
import { type Settings, UserConfig } from "../../../shared/schema/config";
import { next, type Next } from "../../../shared/tea/program";
import { themeCss } from "../../../shared/theme-css";
import { Cmd as LinkCmds, type Cmd as LinkCmd } from "../link/link.program";

/** The config as the chrome uses it. */
export interface Model {
  readonly settings: Settings;
}

export const init: Model = { settings: DEFAULT_SETTINGS };

export const Msg = Schema.TaggedUnion({
  ConfigChanged: { config: UserConfig },
});

export type Msg = typeof Msg.Type;

export const regions = (model: Model): Readonly<Record<Region, ReadonlyArray<ElementId>>> =>
  arrange(model.settings.layout);

export function update(msg: Msg, _model: Model): Next<Model, never, LinkCmd> {
  return Msg.match(msg, {
    ConfigChanged: ({ config }) =>
      next({ settings: config.settings }, [
        LinkCmds.cases.InjectCss.make({ css: themeCss(config) }),
      ]),
  });
}
