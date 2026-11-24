import { describe, expect, test } from "vite-plus/test";
import { DEFAULT_CONFIG, DEFAULT_SETTINGS } from "../../shared/config";
import { ChromeEvent, ChromeIntent } from "../../shared/rpc/chrome";
import type { DownloadState } from "../../shared/schema/downloads";
import { Msg as DownloadsMsg, panelVisible } from "../features/downloads/downloads.program";
import { Cmd as LayoutCmd, PEEK_AFTER_SHIFT } from "../features/layout/layout.program";
import { Cmd as LinkCmd } from "../features/link/link.program";
import { Msg as MainMsg } from "../features/main/main.program";
import { regions } from "../features/ui/ui.program";
import { type Cmd, type Model, type Msg, program } from "./program";

const E = ChromeEvent.cases;

/** Follow-up Msgs run after the Msg that produced them, as the store runs them. */
function run(msgs: ReadonlyArray<Msg>, model: Model = program.init.model) {
  const cmds: Cmd[] = [];
  const pending = [...msgs];

  for (let msg = pending.shift(); msg !== undefined; msg = pending.shift()) {
    const result = program.update(msg, model);

    model = result.model;
    cmds.push(...result.cmds);
    pending.push(...result.msgs);
  }

  return { model, cmds };
}

const row = (id: number, status: DownloadState["status"]): DownloadState => ({
  id,
  filename: `f${id}`,
  url: "https://a/",
  status,
  receivedBytes: 0,
  totalBytes: 0,
  bytesPerSecond: 0,
});

describe("events from main are Msgs", () => {
  test("the strip, the mode and the echo area mirror main", () => {
    const { model } = run([
      E.StateChanged.make({ state: { tabs: [], activeId: null } }),
      E.ModeChanged.make({ mode: "insert" }),
      E.MessageChanged.make({ message: { text: "hi", level: "info" } }),
    ]);

    expect(model.main.mode).toBe("insert");
    expect(model.main.message?.text).toBe("hi");
  });

  test("a config injects its stylesheet and lays the chrome out", () => {
    const layout = {
      ...DEFAULT_SETTINGS.layout,
      tabs: { ...DEFAULT_SETTINGS.layout.tabs, region: "left" as const },
    };

    const config = { ...DEFAULT_CONFIG, css: "a{}", settings: { ...DEFAULT_SETTINGS, layout } };

    const { model, cmds } = run([E.ConfigChanged.make({ config })]);

    expect(regions(model.ui).left).toEqual(["tabs"]);
    expect(regions(model.ui).top).toEqual(["omnibox"]);
    expect(cmds).toContainEqual(
      LinkCmd.cases.InjectCss.make({ css: "@layer kvist.recipe {\n\n}\na{}" }),
    );
  });

  test("main asking for the omnibox focuses it, and summons it in case it is hidden", () => {
    const { model, cmds } = run([E.OmniboxFocusRequested.make({})]);

    expect(cmds).toEqual([LinkCmd.cases.FocusElement.make({ name: "omnibox" })]);
    expect(model.layout.omniboxSummoned).toBe(true);
  });

  test("a tab change peeks the tab strip; the same tabs again do not", () => {
    const tab = (id: number) => ({
      id,
      url: "https://a/",
      title: "a",
      loading: false,
      favicon: null,
      canGoBack: false,
      canGoForward: false,
      zoomLevel: 0,
      bookmarked: false,
    });

    const state = { tabs: [tab(1), tab(2)], activeId: 1 };
    const peek = LayoutCmd.cases.PeekTabStrip.make({ millis: PEEK_AFTER_SHIFT });
    const opened = run([E.StateChanged.make({ state })]);

    expect(opened.cmds).toEqual([peek]);
    expect(opened.model.layout.tabsPeeking).toBe(true);

    const retitled = { ...state, tabs: [{ ...tab(1), title: "b" }, tab(2)] };

    expect(run([E.StateChanged.make({ state: retitled })], opened.model).cmds).toEqual([]);
    expect(
      run([E.StateChanged.make({ state: { ...state, activeId: 2 } })], opened.model).cmds,
    ).toEqual([peek]);
  });
});

describe("the downloads panel", () => {
  test("the first list is history, not a settle; a later settle lingers and is pinned by :downloads", () => {
    const first = run([E.DownloadsChanged.make({ downloads: [row(1, "completed")] })]);

    expect(first.cmds).toEqual([]);
    expect(panelVisible(first.model.downloads, true)).toBe(false);

    const settled = run(
      [
        E.DownloadsChanged.make({ downloads: [row(2, "progressing"), row(1, "completed")] }),
        E.DownloadsChanged.make({ downloads: [row(2, "completed"), row(1, "completed")] }),
      ],
      first.model,
    );

    expect(panelVisible(settled.model.downloads, true)).toBe(true);
    expect(settled.cmds).toHaveLength(1);

    const ended = run([DownloadsMsg.cases.DownloadsLingerEnded.make({})], settled.model).model;

    expect(panelVisible(ended.downloads, true)).toBe(false);
    expect(panelVisible(run([E.DownloadsToggled.make({})], ended).model.downloads, true)).toBe(
      true,
    );
  });

  test("hidden by the layout, it lingers without showing, and :downloads still pins it", () => {
    const settled = run([
      E.DownloadsChanged.make({ downloads: [] }),
      E.DownloadsChanged.make({ downloads: [row(1, "progressing")] }),
      E.DownloadsChanged.make({ downloads: [row(1, "completed")] }),
    ]).model;

    expect(settled.downloads.lingering).toBe(true);
    expect(panelVisible(settled.downloads, false)).toBe(false);
    expect(panelVisible(run([E.DownloadsToggled.make({})], settled).model.downloads, false)).toBe(
      true,
    );
  });
});

describe("prompts", () => {
  test("a button answers the prompt shown, by id; with none up it goes nowhere", () => {
    const shown = run([
      E.PromptChanged.make({ prompt: { id: 7, state: { kind: "session-restore", tabCount: 1 } } }),
    ]).model;

    expect(run([MainMsg.cases.PromptButtonClicked.make({ allow: true })], shown).cmds).toEqual([
      LinkCmd.cases.SendToMain.make({
        intent: ChromeIntent.cases.PromptAnswered.make({ id: 7, allow: true }),
      }),
    ]);
    expect(run([MainMsg.cases.PromptButtonClicked.make({ allow: true })]).cmds).toEqual([]);
  });
});
