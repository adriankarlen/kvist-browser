import { expect, test, vi } from "vite-plus/test";
import type { PermissionPromptState } from "../../shared/ipc";
import { createPermissions, describePrompt, hostOf } from "./permissions.svelte";

function createBridge() {
  let push: (prompt: PermissionPromptState | null) => void = () => {};
  const answerPermission = vi.fn<(answer: { id: number; allow: boolean }) => void>();

  return {
    bridge: {
      onPermission: (listener: (prompt: PermissionPromptState | null) => void) => {
        push = listener;
        return () => {};
      },
      answerPermission,
    },
    push: (prompt: PermissionPromptState | null) => push(prompt),
    answerPermission,
  };
}

const asking = (
  id: number,
  permission: PermissionPromptState["permission"],
  mediaTypes?: ("video" | "audio")[],
): PermissionPromptState => ({
  id,
  origin: "https://meet.example.com",
  permission,
  mediaTypes,
});

test("the question main asks is the one shown", () => {
  const { bridge, push } = createBridge();
  const permissions = createPermissions(bridge);

  expect(permissions.current).toBeNull();

  push(asking(1, "geolocation"));
  expect(permissions.current?.permission).toBe("geolocation");

  push(null);
  expect(permissions.current).toBeNull();
});

test("answering carries the id, so a stale click settles nothing new", () => {
  const { bridge, push, answerPermission } = createBridge();
  const permissions = createPermissions(bridge);

  push(asking(7, "notifications"));
  permissions.answer(true);
  expect(answerPermission).toHaveBeenCalledWith({ id: 7, allow: true });

  permissions.answer(false);
  expect(answerPermission).toHaveBeenCalledWith({ id: 7, allow: false });
});

test("nothing up means an answer goes nowhere", () => {
  const { bridge, answerPermission } = createBridge();
  createPermissions(bridge).answer(true);
  expect(answerPermission).not.toHaveBeenCalled();
});

test("a question is described in the site's own terms", () => {
  expect(describePrompt(asking(1, "media", ["video", "audio"]))).toBe(
    "use your camera and microphone",
  );
  expect(describePrompt(asking(1, "media", ["video"]))).toBe("use your camera");
  expect(describePrompt(asking(1, "media", ["audio"]))).toBe("use your microphone");
  expect(describePrompt(asking(1, "media"))).toBe("use your camera or microphone");
  expect(describePrompt(asking(1, "geolocation"))).toBe("know your location");
  expect(describePrompt(asking(1, "notifications"))).toBe("show notifications");
  expect(describePrompt(asking(1, "clipboard-read"))).toBe("read your clipboard");
});

test("who is asking reads as a host, not a URL", () => {
  expect(hostOf("https://meet.example.com")).toBe("meet.example.com");
  expect(hostOf("http://192.168.1.10:8080")).toBe("192.168.1.10:8080");
  // An origin that will not parse is shown as it arrived rather than lost.
  expect(hostOf("null")).toBe("null");
});
