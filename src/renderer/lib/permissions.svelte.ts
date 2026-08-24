import type { KvistApi, PermissionPromptState } from "../../shared/ipc";

export type Permissions = ReturnType<typeof createPermissions>;

/** The prompt line's words for a question, so the component stays markup. */
export function describePrompt(prompt: PermissionPromptState): string {
  switch (prompt.permission) {
    case "media": {
      const types = new Set(prompt.mediaTypes ?? []);
      const video = types.has("video");
      const audio = types.has("audio");
      if (video && audio) return "use your camera and microphone";
      if (video) return "use your camera";
      if (audio) return "use your microphone";
      return "use your camera or microphone";
    }
    case "geolocation":
      return "know your location";
    case "notifications":
      return "show notifications";
    case "clipboard-read":
      return "read your clipboard";
  }
}

/** Who is asking, as shown: the host, with the scheme's noise left out. */
export function hostOf(origin: string): string {
  try {
    return new URL(origin).host;
  } catch {
    return origin;
  }
}

/**
 * The permission question main is waiting on, or null. Nothing is decided
 * here: main owns the queue and the remembered answers, and the y/n keys
 * reach it without passing through this store at all.
 */
export function createPermissions(bridge: Pick<KvistApi, "onPermission" | "answerPermission">) {
  const state = $state<{ current: PermissionPromptState | null }>({ current: null });

  bridge.onPermission((prompt) => {
    state.current = prompt;
  });

  return {
    get current(): PermissionPromptState | null {
      return state.current;
    },
    /**
     * Clicking a button. The id goes with it, so a click rendered from a
     * stale snapshot cannot settle a newer question by mistake.
     */
    answer(allow: boolean): void {
      const prompt = state.current;
      if (prompt) bridge.answerPermission({ id: prompt.id, allow });
    },
  };
}
