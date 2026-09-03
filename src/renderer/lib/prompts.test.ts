import { expect, test, vi } from "vite-plus/test";
import type { PromptState, PromptWire } from "../../shared/ipc";
import { buttonLabels, createPrompts, describePrompt } from "./prompts.svelte";

function createBridge() {
  let push: (prompt: PromptWire | null) => void = () => {};
  const answerPrompt = vi.fn<(answer: { id: number; allow: boolean }) => void>();

  return {
    bridge: {
      onPrompt: (listener: (prompt: PromptWire | null) => void) => {
        push = listener;
        return () => {};
      },
      answerPrompt,
    },
    push: (prompt: PromptWire | null) => push(prompt),
    answerPrompt,
  };
}

const permission = (
  id: number,
  kind: "media" | "geolocation" | "notifications" | "clipboard-read",
  mediaTypes?: ("video" | "audio")[],
): PromptWire => {
  // SAFETY: narrowing the state literal to the permission variant keeps
  // the test concise. `kind` is one of the four `PromptablePermission`
  // members and the test never exercises session-restore through this
  // helper, so the cast is sound.
  const state = {
    kind: "permission",
    origin: "https://meet.example.com",
    permission: kind,
    mediaTypes,
  } as Extract<PromptState, { kind: "permission" }>;
  return { id, state };
};

const restore = (id: number, tabCount: number): PromptWire => ({
  id,
  state: { kind: "session-restore", tabCount },
});

const externalProtocol = (
  id: number,
  origin: string | null,
  scheme: string,
  url: string,
): PromptWire => ({
  id,
  state: { kind: "external-protocol", origin, scheme, url },
});

test("the question main asks is the one shown", () => {
  const { bridge, push } = createBridge();
  const prompts = createPrompts(bridge);

  expect(prompts.current).toBeNull();

  push(permission(1, "geolocation"));
  expect(prompts.current?.state.kind).toBe("permission");
  if (prompts.current?.state.kind !== "permission") return;
  expect(prompts.current.state.permission).toBe("geolocation");

  push(null);
  expect(prompts.current).toBeNull();
});

test("answering carries the id, so a stale click settles nothing new", () => {
  const { bridge, push, answerPrompt } = createBridge();
  const prompts = createPrompts(bridge);

  push(permission(7, "notifications"));
  prompts.answer(true);
  expect(answerPrompt).toHaveBeenCalledWith({ id: 7, allow: true });

  prompts.answer(false);
  expect(answerPrompt).toHaveBeenCalledWith({ id: 7, allow: false });
});

test("nothing up means an answer goes nowhere", () => {
  const { bridge, answerPrompt } = createBridge();
  createPrompts(bridge).answer(true);
  expect(answerPrompt).not.toHaveBeenCalled();
});

test("a permission question is described in the site's own terms", () => {
  expect(describePrompt(permission(1, "media", ["video", "audio"]).state)).toBe(
    "meet.example.com wants to use your camera and microphone",
  );
  expect(describePrompt(permission(1, "media", ["video"]).state)).toBe(
    "meet.example.com wants to use your camera",
  );
  expect(describePrompt(permission(1, "media", ["audio"]).state)).toBe(
    "meet.example.com wants to use your microphone",
  );
  expect(describePrompt(permission(1, "media").state)).toBe(
    "meet.example.com wants to use your camera or microphone",
  );
  expect(describePrompt(permission(1, "geolocation").state)).toBe(
    "meet.example.com wants to know your location",
  );
  expect(describePrompt(permission(1, "notifications").state)).toBe(
    "meet.example.com wants to show notifications",
  );
  expect(describePrompt(permission(1, "clipboard-read").state)).toBe(
    "meet.example.com wants to read your clipboard",
  );
});

test("a session-restore question says how many tabs and nothing else", () => {
  expect(describePrompt(restore(1, 1).state)).toBe("Restore 1 tab from your last session?");
  expect(describePrompt(restore(1, 5).state)).toBe("Restore 5 tabs from your last session?");
});

test("an external-protocol question names the site and shows the URL", () => {
  expect(
    describePrompt(
      externalProtocol(1, "https://id.example.com", "bankid", "bankid:///?autostarttoken=abc")
        .state,
    ),
  ).toBe("id.example.com wants to open bankid:///?autostarttoken=abc");
});

test("an external-protocol question with no origin still shows the URL", () => {
  expect(describePrompt(externalProtocol(1, null, "mailto", "mailto:foo@bar.com").state)).toBe(
    "Open mailto:foo@bar.com?",
  );
});

test("a long URL is truncated rather than wrapping the prompt line", () => {
  const url = `bankid:///?autostarttoken=${"a".repeat(80)}`;
  const described = describePrompt(externalProtocol(1, null, "bankid", url).state);
  expect(described.startsWith("Open bankid:///?autostarttoken=")).toBe(true);
  expect(described.includes("\u2026")).toBe(true);
  expect(described.length).toBeLessThan(url.length);
});

test("button labels are per kind: allow/deny for permissions, restore/discard for restores", () => {
  expect(buttonLabels(permission(1, "geolocation").state)).toEqual({
    allow: "allow",
    deny: "deny",
  });
  expect(buttonLabels(restore(1, 3).state)).toEqual({ allow: "restore", deny: "discard" });
  expect(buttonLabels(externalProtocol(1, null, "mailto", "mailto:foo@bar.com").state)).toEqual({
    allow: "allow",
    deny: "deny",
  });
});
