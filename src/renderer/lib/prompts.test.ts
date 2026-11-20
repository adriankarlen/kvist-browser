import { expect, test } from "vite-plus/test";
import type { PromptWire } from "../../shared/schema/prompts";
import { buttonLabels, describePrompt } from "./prompts.svelte";

const permission = (
  id: number,
  kind: "media" | "geolocation" | "notifications" | "clipboard-read",
  mediaTypes?: ("video" | "audio")[],
): PromptWire => ({
  id,
  state:
    mediaTypes === undefined
      ? { kind: "permission", origin: "https://meet.example.com", permission: kind }
      : { kind: "permission", origin: "https://meet.example.com", permission: kind, mediaTypes },
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

const restore = (id: number, tabCount: number): PromptWire => ({
  id,
  state: { kind: "session-restore", tabCount },
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
