import { expect, test, vi } from "vite-plus/test";
import type { WebContents } from "electron";
import type { PromptState } from "../shared/ipc";
import { Permissions } from "./permissions";
import { Prompts } from "./prompts";

type PromptHead = { id: number; state: PromptState };

/** A stand-in tab: a real enough store of `destroyed` listeners to test both acquiring one and releasing it. */
function fakeContents() {
  const listeners = new Set<() => void>();
  let destroyed = false;
  // SAFETY: partial stub — Permissions only reaches isDestroyed, once and removeListener.
  const contents = {
    isDestroyed: () => destroyed,
    once: (_event: string, listener: () => void) => {
      listeners.add(listener);
    },
    removeListener: (_event: string, listener: () => void) => {
      listeners.delete(listener);
    },
  } as unknown as WebContents;
  return {
    contents,
    destroy: () => {
      destroyed = true;
      // A real `once` listener removes itself before firing; snapshot and
      // clear first so the fake does not retain what Electron would not.
      const firing = [...listeners];
      listeners.clear();
      for (const listener of firing) listener();
    },
    listenerCount: () => listeners.size,
  };
}

function createPermissions() {
  // Permissions now shares the queue with the rest of the app — the test
  // owns its own Prompts so each test starts with a fresh queue.
  const prompts = new Prompts<PromptState>();
  const permissions = new Permissions(prompts);
  const seen: (PromptHead | null)[] = [];
  permissions.observe((head) => seen.push(head));
  return { permissions, seen, prompts };
}

const at = (url: string) => ({ requestingUrl: url });

/** Pulls the permission-shaped {id, state} out of the prompts queue for assertions. */
function permissionsPending(permissions: Permissions): PromptHead[] {
  const pending = permissions.pending;
  // SAFETY: Permissions#pending is typed as the broad head pair; the
  // test only ever pushes permission-kind states through this instance,
  // so the assertion narrows without runtime risk.
  return pending as PromptHead[];
}

test("an unlisted permission is denied without asking anyone", () => {
  const { permissions } = createPermissions();
  const { contents } = fakeContents();
  const callback = vi.fn();

  permissions.request(contents, "midi", callback, at("https://example.com"));
  permissions.request(contents, "openExternal", callback, at("https://example.com"));

  expect(callback.mock.calls).toEqual([[false], [false]]);
  expect(permissionsPending(permissions)).toEqual([]);
});

test("fullscreen, pointer lock and sanitized writes are granted silently", () => {
  const { permissions } = createPermissions();
  const { contents } = fakeContents();
  const callback = vi.fn();

  permissions.request(contents, "fullscreen", callback, at("https://example.com"));
  permissions.request(contents, "pointerLock", callback, at("https://example.com"));
  permissions.request(contents, "clipboard-sanitized-write", callback, at("https://example.com"));

  expect(callback.mock.calls).toEqual([[true], [true], [true]]);
  expect(permissionsPending(permissions)).toEqual([]);
});

test("an askable permission queues a prompt and waits", () => {
  const { permissions, seen } = createPermissions();
  const { contents } = fakeContents();
  const callback = vi.fn();

  permissions.request(contents, "geolocation", callback, at("https://maps.example.com/there"));

  expect(callback).not.toHaveBeenCalled();
  expect(permissionsPending(permissions)).toEqual([
    {
      id: 1,
      state: {
        kind: "permission",
        origin: "https://maps.example.com",
        permission: "geolocation",
        mediaTypes: undefined,
      },
    },
  ]);
  // Subscribe fires with null immediately, then again on the ask.
  expect(seen).toHaveLength(2);
});

test("a media request says which of camera and microphone it wants", () => {
  const { permissions } = createPermissions();
  const { contents } = fakeContents();

  permissions.request(contents, "media", () => {}, {
    requestingUrl: "https://meet.example.com",
    mediaTypes: ["video", "audio"],
  });

  expect(permissionsPending(permissions)[0]).toMatchObject({
    state: { kind: "permission", permission: "media", mediaTypes: ["video", "audio"] },
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
  expect(permissionsPending(permissions)).toEqual([]);
});

test("a denial is remembered too, or the site would re-ask on every click", () => {
  const { permissions } = createPermissions();
  const { contents } = fakeContents();

  permissions.request(contents, "notifications", () => {}, at("https://example.com"));
  permissions.answer(1, false);

  const callback = vi.fn();
  permissions.request(contents, "notifications", callback, at("https://example.com"));
  expect(callback).toHaveBeenCalledWith(false);
  expect(permissionsPending(permissions)).toEqual([]);
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
  expect(permissionsPending(permissions)).toHaveLength(2);
});

test("a repeated request joins the prompt already up rather than stacking", () => {
  const { permissions, seen } = createPermissions();
  const { contents } = fakeContents();
  const first = vi.fn();
  const second = vi.fn();

  permissions.request(contents, "media", first, at("https://meet.example.com"));
  permissions.request(contents, "media", second, at("https://meet.example.com"));

  expect(permissionsPending(permissions)).toHaveLength(1);
  // Subscribe with null, then the first ask. The second ask joined an
  // existing prompt without changing the head — no observer fire.
  expect(seen).toHaveLength(2);

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
  expect(
    permissionsPending(permissions).map((entry) =>
      entry.state.kind === "permission" ? entry.state.origin : null,
    ),
  ).toEqual(["https://b.example.com"]);

  permissions.answerHead(false);
  expect(permissionsPending(permissions)).toEqual([]);
  // One notification per queue change: subscribe (null), first ask
  // (geolocation), answer (notifications promotes to head), answer (null).
  expect(seen).toHaveLength(4);
});

test("answering a stale id settles nothing", () => {
  const { permissions } = createPermissions();
  const { contents } = fakeContents();

  permissions.request(contents, "geolocation", () => {}, at("https://a.example.com"));
  permissions.answer(999, true);

  expect(permissionsPending(permissions)).toHaveLength(1);

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
  expect(permissionsPending(permissions)).toEqual([]);
  expect(seen.at(-1)).toBeNull();

  // ...but nothing was remembered, so the next visit asks again.
  const { contents: revived } = fakeContents();
  const again = vi.fn();
  permissions.request(revived, "geolocation", again, at("https://a.example.com"));
  expect(again).not.toHaveBeenCalled();
  expect(permissionsPending(permissions)).toHaveLength(1);
});

test("only http(s) pages may be asked about", () => {
  const { permissions } = createPermissions();
  const { contents } = fakeContents();
  const callback = vi.fn();

  for (const url of ["kvist://newtab", "file:///home/user/x.html", "about:blank", "not a url"]) {
    permissions.request(contents, "notifications", callback, at(url));
  }

  expect(callback.mock.calls).toEqual([[false], [false], [false], [false]]);
  expect(permissionsPending(permissions)).toEqual([]);
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
  const prompts = new Prompts<PromptState>();
  const permissions = new Permissions(prompts);
  const seen: (PromptHead | null)[] = [];
  const release = permissions.observe((head) => seen.push(head));
  const { contents } = fakeContents();

  permissions.request(contents, "geolocation", () => {}, at("https://a.example.com"));
  release();
  permissions.answerHead(true);

  // Subscribe fires immediately with null, then the ask fires with the head.
  // After release the answer does not fire.
  expect(seen).toHaveLength(2);
});

test("answering releases the destroyed listener it no longer needs", () => {
  const { permissions } = createPermissions();
  const { contents, listenerCount } = fakeContents();

  permissions.request(contents, "geolocation", () => {}, at("https://a.example.com"));
  expect(listenerCount()).toBe(1);

  permissions.answerHead(true);
  // A long session asking for several permissions from one tab must not
  // leave one dead listener behind per question it already answered.
  expect(listenerCount()).toBe(0);
});

test("coalesced waiters each release their own listener on answer", () => {
  const { permissions } = createPermissions();
  const { contents, listenerCount } = fakeContents();

  permissions.request(contents, "geolocation", () => {}, at("https://a.example.com"));
  permissions.request(contents, "geolocation", () => {}, at("https://a.example.com"));
  expect(listenerCount()).toBe(2);

  permissions.answerHead(true);
  expect(listenerCount()).toBe(0);
});

test("a camera grant does not silently cover the microphone too", () => {
  const { permissions } = createPermissions();
  const { contents } = fakeContents();

  permissions.request(contents, "media", () => {}, {
    requestingUrl: "https://meet.example.com",
    mediaTypes: ["video"],
  });
  permissions.answerHead(true);

  // The microphone was never asked about, so it is still unknown.
  const callback = vi.fn();
  permissions.request(contents, "media", callback, {
    requestingUrl: "https://meet.example.com",
    mediaTypes: ["audio"],
  });

  expect(callback).not.toHaveBeenCalled();
  expect(permissionsPending(permissions)[0]).toMatchObject({
    state: { kind: "permission", mediaTypes: ["audio"] },
  });
});

test("the check handler remembers the camera and the microphone separately", () => {
  const { permissions } = createPermissions();
  const { contents } = fakeContents();

  permissions.request(contents, "media", () => {}, {
    requestingUrl: "https://meet.example.com",
    mediaTypes: ["video"],
  });
  permissions.answerHead(true);

  expect(permissions.check("media", "https://meet.example.com", "video")).toBe(true);
  expect(permissions.check("media", "https://meet.example.com", "audio")).toBe(false);
  // No device kind named at all: cannot say which memory answers it.
  expect(permissions.check("media", "https://meet.example.com", "unknown")).toBe(false);
});

test("one tab dying does not strand another tab's coalesced question", () => {
  const { permissions } = createPermissions();
  const first = fakeContents();
  const second = fakeContents();
  const firstCallback = vi.fn();
  const secondCallback = vi.fn();

  permissions.request(first.contents, "geolocation", firstCallback, at("https://a.example.com"));
  permissions.request(second.contents, "geolocation", secondCallback, at("https://a.example.com"));
  expect(permissionsPending(permissions)).toHaveLength(1);

  // The tab that asked first closes; the second tab is still waiting.
  first.destroy();
  expect(permissionsPending(permissions)).toHaveLength(1);

  permissions.answerHead(true);
  expect(secondCallback).toHaveBeenCalledWith(true);
  expect(firstCallback).not.toHaveBeenCalled();
});

test("a combined ask and a camera-only ask do not merge into one question", () => {
  const { permissions } = createPermissions();
  const { contents } = fakeContents();

  permissions.request(contents, "media", () => {}, {
    requestingUrl: "https://a.example.com",
    mediaTypes: ["video", "audio"],
  });
  permissions.request(contents, "media", () => {}, {
    requestingUrl: "https://a.example.com",
    mediaTypes: ["video"],
  });

  expect(permissionsPending(permissions)).toHaveLength(2);
});

test("denying a combined ask does not revoke an already-granted kind", () => {
  const { permissions } = createPermissions();
  const { contents } = fakeContents();

  // The camera is granted on its own first.
  permissions.request(contents, "media", () => {}, {
    requestingUrl: "https://meet.example.com",
    mediaTypes: ["video"],
  });
  permissions.answerHead(true);

  // A later combined ask has only the microphone left to decide, and the
  // prompt reflects that rather than re-asking about the camera too.
  const combined = vi.fn();
  permissions.request(contents, "media", combined, {
    requestingUrl: "https://meet.example.com",
    mediaTypes: ["video", "audio"],
  });
  expect(permissionsPending(permissions)[0]).toMatchObject({
    state: { kind: "permission", mediaTypes: ["audio"] },
  });

  // Denying it settles the microphone only; the camera grant survives.
  permissions.answerHead(false);
  expect(combined).toHaveBeenCalledWith(false);

  const video = vi.fn();
  permissions.request(contents, "media", video, {
    requestingUrl: "https://meet.example.com",
    mediaTypes: ["video"],
  });
  expect(video).toHaveBeenCalledWith(true);
});

test("permission asks reach observers on the shared Prompts, not just Permissions' wrapper", () => {
  // The bug this guards against: Permissions used to construct its own
  // Prompts internally, so observers wired to the app-wide queue never
  // saw permission asks — the chrome's prompt line was blind to
  // permissions entirely. Now the queue is shared, and an external
  // observer sees the same prompt the Permissions-wrapped observer does.
  const prompts = new Prompts<PromptState>();
  const permissions = new Permissions(prompts);
  const externalSeen: (PromptHead | null)[] = [];
  prompts.observe((head) => externalSeen.push(head));
  const { contents } = fakeContents();

  permissions.request(contents, "geolocation", () => {}, at("https://a.example.com"));

  // Subscribe with null, then the permission ask — the external observer
  // saw the same prompt the chrome would render.
  expect(externalSeen).toHaveLength(2);
  expect(externalSeen.at(-1)).toMatchObject({
    state: { kind: "permission", origin: "https://a.example.com" },
  });
});
