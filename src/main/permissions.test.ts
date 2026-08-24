import { expect, test, vi } from "vite-plus/test";
import type { WebContents } from "electron";
import type { PermissionPromptState } from "../shared/ipc";
import { Permissions } from "./permissions";

/** A stand-in tab: captures the destroyed listener so a test can fire it. */
function fakeContents() {
  let onDestroyed: () => void = () => {};
  // SAFETY: partial stub — Permissions only reaches isDestroyed and once.
  const contents = {
    isDestroyed: () => false,
    once: (_event: string, listener: () => void) => {
      onDestroyed = listener;
    },
  } as unknown as WebContents;
  return { contents, destroy: () => onDestroyed() };
}

function createPermissions() {
  const permissions = new Permissions();
  const seen: PermissionPromptState[][] = [];
  permissions.observe((pending) => seen.push(pending));
  return { permissions, seen };
}

const at = (url: string) => ({ requestingUrl: url });

test("an unlisted permission is denied without asking anyone", () => {
  const { permissions } = createPermissions();
  const { contents } = fakeContents();
  const callback = vi.fn();

  permissions.request(contents, "midi", callback, at("https://example.com"));
  permissions.request(contents, "openExternal", callback, at("https://example.com"));

  expect(callback.mock.calls).toEqual([[false], [false]]);
  expect(permissions.pending).toEqual([]);
});

test("fullscreen, pointer lock and sanitized writes are granted silently", () => {
  const { permissions } = createPermissions();
  const { contents } = fakeContents();
  const callback = vi.fn();

  permissions.request(contents, "fullscreen", callback, at("https://example.com"));
  permissions.request(contents, "pointerLock", callback, at("https://example.com"));
  permissions.request(contents, "clipboard-sanitized-write", callback, at("https://example.com"));

  expect(callback.mock.calls).toEqual([[true], [true], [true]]);
  expect(permissions.pending).toEqual([]);
});

test("an askable permission queues a prompt and waits", () => {
  const { permissions, seen } = createPermissions();
  const { contents } = fakeContents();
  const callback = vi.fn();

  permissions.request(contents, "geolocation", callback, at("https://maps.example.com/there"));

  expect(callback).not.toHaveBeenCalled();
  expect(permissions.pending).toEqual([
    { id: 1, origin: "https://maps.example.com", permission: "geolocation", mediaTypes: undefined },
  ]);
  expect(seen).toHaveLength(1);
});

test("a media request says which of camera and microphone it wants", () => {
  const { permissions } = createPermissions();
  const { contents } = fakeContents();

  permissions.request(contents, "media", () => {}, {
    requestingUrl: "https://meet.example.com",
    mediaTypes: ["video", "audio"],
  });

  expect(permissions.pending[0]).toMatchObject({
    permission: "media",
    mediaTypes: ["video", "audio"],
  });
});

test("an allow is remembered: the next request resolves without a prompt", () => {
  const { permissions } = createPermissions();
  const { contents } = fakeContents();

  permissions.request(contents, "notifications", () => {}, at("https://example.com"));
  permissions.answer(1, true);

  const callback = vi.fn();
  permissions.request(contents, "notifications", callback, at("https://example.com/other/page"));
  expect(callback).toHaveBeenCalledWith(true);
  expect(permissions.pending).toEqual([]);
});

test("a denial is remembered too, or the site would re-ask on every click", () => {
  const { permissions } = createPermissions();
  const { contents } = fakeContents();

  permissions.request(contents, "notifications", () => {}, at("https://example.com"));
  permissions.answer(1, false);

  const callback = vi.fn();
  permissions.request(contents, "notifications", callback, at("https://example.com"));
  expect(callback).toHaveBeenCalledWith(false);
  expect(permissions.pending).toEqual([]);
});

test("decisions are per origin and per permission", () => {
  const { permissions } = createPermissions();
  const { contents } = fakeContents();

  permissions.request(contents, "notifications", () => {}, at("https://example.com"));
  permissions.answer(1, true);

  const callback = vi.fn();
  // Same permission, another origin: asked again.
  permissions.request(contents, "notifications", callback, at("https://other.example.com"));
  // Same origin, another permission: asked again.
  permissions.request(contents, "geolocation", callback, at("https://example.com"));

  expect(callback).not.toHaveBeenCalled();
  expect(permissions.pending).toHaveLength(2);
});

test("a repeated request joins the prompt already up rather than stacking", () => {
  const { permissions, seen } = createPermissions();
  const { contents } = fakeContents();
  const first = vi.fn();
  const second = vi.fn();

  permissions.request(contents, "media", first, at("https://meet.example.com"));
  permissions.request(contents, "media", second, at("https://meet.example.com"));

  expect(permissions.pending).toHaveLength(1);
  expect(seen).toHaveLength(1);

  permissions.answer(1, true);
  expect(first).toHaveBeenCalledWith(true);
  expect(second).toHaveBeenCalledWith(true);
});

test("the queue drains one answer at a time, head first", () => {
  const { permissions, seen } = createPermissions();
  const { contents } = fakeContents();

  permissions.request(contents, "geolocation", () => {}, at("https://a.example.com"));
  permissions.request(contents, "notifications", () => {}, at("https://b.example.com"));

  permissions.answerHead(true);
  expect(permissions.pending.map((entry) => entry.origin)).toEqual(["https://b.example.com"]);

  permissions.answerHead(false);
  expect(permissions.pending).toEqual([]);
  // One notification per queue change: two arrivals, two settles.
  expect(seen).toHaveLength(4);
});

test("answering a stale id settles nothing", () => {
  const { permissions } = createPermissions();
  const { contents } = fakeContents();

  permissions.request(contents, "geolocation", () => {}, at("https://a.example.com"));
  permissions.answer(999, true);

  expect(permissions.pending).toHaveLength(1);

  // And the real prompt did not inherit the stale answer.
  const callback = vi.fn();
  permissions.answerHead(false);
  permissions.request(contents, "geolocation", callback, at("https://a.example.com"));
  expect(callback).toHaveBeenCalledWith(false);
});

test("a tab that dies mid-prompt is a denial nobody decided", () => {
  const { permissions, seen } = createPermissions();
  const { contents, destroy } = fakeContents();
  const callback = vi.fn();

  permissions.request(contents, "geolocation", callback, at("https://a.example.com"));
  destroy();

  // The prompt is gone, the callback is resolved...
  expect(permissions.pending).toEqual([]);
  expect(seen.at(-1)).toEqual([]);

  // ...but nothing was remembered, so the next visit asks again.
  const { contents: revived } = fakeContents();
  const again = vi.fn();
  permissions.request(revived, "geolocation", again, at("https://a.example.com"));
  expect(again).not.toHaveBeenCalled();
  expect(permissions.pending).toHaveLength(1);
});

test("only http(s) pages may be asked about", () => {
  const { permissions } = createPermissions();
  const { contents } = fakeContents();
  const callback = vi.fn();

  for (const url of ["kvist://newtab", "file:///home/user/x.html", "about:blank", "not a url"]) {
    permissions.request(contents, "notifications", callback, at(url));
  }

  expect(callback.mock.calls).toEqual([[false], [false], [false], [false]]);
  expect(permissions.pending).toEqual([]);
});

test("the check handler grants only what policy or a remembered answer allows", () => {
  const { permissions } = createPermissions();
  const { contents } = fakeContents();

  expect(permissions.check("fullscreen", "https://example.com")).toBe(true);
  expect(permissions.check("midi", "https://example.com")).toBe(false);
  // Unknown is denied: a probe cannot prompt, so the site must go ask.
  expect(permissions.check("notifications", "https://example.com")).toBe(false);
  expect(permissions.check("notifications", "kvist://newtab")).toBe(false);

  permissions.request(contents, "notifications", () => {}, at("https://example.com"));
  permissions.answerHead(true);

  expect(permissions.check("notifications", "https://example.com")).toBe(true);
  expect(permissions.check("notifications", "https://other.example.com")).toBe(false);
});

test("an observer that leaves is not told", () => {
  const permissions = new Permissions();
  const seen: PermissionPromptState[][] = [];
  const release = permissions.observe((pending) => seen.push(pending));
  const { contents } = fakeContents();

  permissions.request(contents, "geolocation", () => {}, at("https://a.example.com"));
  release();
  permissions.answerHead(true);

  expect(seen).toHaveLength(1);
});
