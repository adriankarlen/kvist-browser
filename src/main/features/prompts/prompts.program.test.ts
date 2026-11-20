import { describe, expect, test } from "vite-plus/test";
import {
  checkPermission,
  Cmd,
  head,
  init,
  type Model,
  Msg,
  rulePermission,
  sessionRestorePending,
  update,
} from "./prompts.program";

const M = Msg.cases;
const C = Cmd.cases;

/** Runs Msgs in order, collecting every Cmd and follow-up Msg. */
function run(msgs: ReadonlyArray<Msg>, model: Model = init) {
  const cmds: unknown[] = [];
  const follow: unknown[] = [];

  for (const msg of msgs) {
    const result = update(msg, model);

    model = result.model;
    cmds.push(...result.cmds);
    follow.push(...result.msgs);
  }

  return { model, cmds, follow };
}

const camera = (requester: number, origin = "https://a.example") =>
  M.PermissionRequested.make({
    requester,
    origin,
    permission: "geolocation",
    mediaTypes: undefined,
  });

const external = (requester: number, watched = true, origin: string | null = "https://a.example") =>
  M.ExternalProtocolRequested.make({
    requester,
    url: `bankid:///?r=${requester}`,
    scheme: "bankid",
    origin,
    selfInitiated: false,
    watched,
  });

describe("the queue", () => {
  test("questions wait in order, and the head is what the chrome shows", () => {
    const { model } = run([camera(1), M.SessionRestoreAsked.make({ tabCount: 2 })]);

    expect(head(model)).toEqual({
      id: 1,
      state: { kind: "permission", origin: "https://a.example", permission: "geolocation" },
    });
    expect(model.queue).toHaveLength(2);
  });

  test("a stale answer settles nothing", () => {
    const { model } = run([camera(1)]);

    expect(update(M.PromptAnswered.make({ id: 99, allow: true }), model).model).toBe(model);
  });

  test("answering the head goes to whatever is up", () => {
    const { model, cmds } = run([camera(1), M.HeadAnswered.make({ allow: false })]);

    expect(head(model)).toBeNull();
    expect(cmds).toEqual([C.SettleRequesters.make({ requesters: [1], allow: false })]);
  });
});

describe("permissions", () => {
  test("unlisted permissions are denied and the safe ones granted, without asking", () => {
    expect(rulePermission(init, "midi", "https://a.example", undefined)).toEqual({ kind: "deny" });
    expect(rulePermission(init, "fullscreen", null, undefined)).toEqual({ kind: "grant" });
    expect(rulePermission(init, "geolocation", null, undefined)).toEqual({ kind: "deny" });
  });

  test("a repeated ask from the same origin joins the question already up", () => {
    const { model } = run([camera(1), camera(2)]);

    expect(model.queue).toHaveLength(1);
  });

  test("an answer settles every waiter and is remembered for the origin", () => {
    const { model, cmds } = run([
      camera(1),
      camera(2),
      M.PromptAnswered.make({ id: 1, allow: true }),
    ]);

    expect(cmds).toEqual([C.SettleRequesters.make({ requesters: [1, 2], allow: true })]);
    expect(rulePermission(model, "geolocation", "https://a.example", undefined)).toEqual({
      kind: "grant",
    });
    expect(checkPermission(model, "geolocation", "https://a.example", undefined)).toBe(true);
    expect(checkPermission(model, "geolocation", "https://b.example", undefined)).toBe(false);
  });

  test("media is remembered per type, and only unresolved types are asked about", () => {
    const asked = M.PermissionRequested.make({
      requester: 1,
      origin: "https://a.example",
      permission: "media",
      mediaTypes: ["video"],
    });

    const { model } = run([asked, M.PromptAnswered.make({ id: 1, allow: true })]);

    expect(rulePermission(model, "media", "https://a.example", ["video", "audio"])).toEqual({
      kind: "ask",
      permission: "media",
      mediaTypes: ["audio"],
    });
    expect(checkPermission(model, "media", "https://a.example", "video")).toBe(true);
    expect(checkPermission(model, "media", "https://a.example", "unknown")).toBe(false);
  });

  test("a tab dying mid-prompt is not a decision: with nobody left, the prompt goes", () => {
    const one = run([camera(1), camera(2), M.RequesterGone.make({ requester: 1 })]);

    expect(one.model.queue).toHaveLength(1);

    const both = run([M.RequesterGone.make({ requester: 2 })], one.model);

    expect(both.model.queue).toEqual([]);
    expect(rulePermission(both.model, "geolocation", "https://a.example", undefined).kind).toBe(
      "ask",
    );
  });
});

describe("external protocols", () => {
  test("allowing opens every URL that asked, and is remembered", () => {
    const { model, cmds } = run([
      external(1),
      external(2),
      M.PromptAnswered.make({ id: 1, allow: true }),
    ]);

    expect(cmds).toEqual([
      C.SettleRequesters.make({ requesters: [1, 2], allow: true }),
      C.OpenExternal.make({ url: "bankid:///?r=1" }),
      C.OpenExternal.make({ url: "bankid:///?r=2" }),
    ]);
    expect(run([external(3)], model).cmds).toEqual([
      C.OpenExternal.make({ url: "bankid:///?r=3" }),
    ]);
  });

  test("a remembered deny warns instead of doing nothing silently", () => {
    const { model } = run([external(1), M.PromptAnswered.make({ id: 1, allow: false })]);
    const again = run([external(2)], model);

    expect(again.cmds).toEqual([]);
    expect(again.follow).toHaveLength(1);
  });

  test("decisions are per origin, and the user's own typing has a bucket of its own", () => {
    const { model } = run([external(1), M.PromptAnswered.make({ id: 1, allow: true })]);

    expect(run([external(2, true, "https://b.example")], model).model.queue).toHaveLength(1);
    expect(run([external(2, false, null)], model).model.queue).toHaveLength(1);
  });

  test("an unwatched request survives every watched tab dying", () => {
    const { model } = run([
      external(1),
      external(2, false),
      M.RequesterGone.make({ requester: 1 }),
    ]);

    expect(model.queue).toHaveLength(1);
  });
});

describe("session restore", () => {
  test("the answer is handed to the window", () => {
    const { cmds } = run([
      M.SessionRestoreAsked.make({ tabCount: 3 }),
      M.PromptAnswered.make({ id: 1, allow: true }),
    ]);

    expect(cmds).toEqual([C.SessionRestoreDecided.make({ allow: true })]);
  });

  test("a window closed mid-prompt abandons the question without deciding", () => {
    const asked = run([M.SessionRestoreAsked.make({ tabCount: 3 })]).model;

    expect(sessionRestorePending(asked)).toBe(true);

    const { model, cmds } = run([M.SessionRestoreAbandoned.make({})], asked);

    expect(sessionRestorePending(model)).toBe(false);
    expect(cmds).toEqual([]);
  });
});
