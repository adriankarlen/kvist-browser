import type { KvistApi, PromptState, PromptWire } from "../../shared/ipc";

export type Prompts = ReturnType<typeof createPrompts>;

/** The two button labels per prompt kind. The wording changes; the shape does not. */
export interface ButtonLabels {
  allow: string;
  deny: string;
}

/**
 * The button labels per prompt kind. The prompt line shape is constant;
 * only wording changes — permission is yes-or-no, session restore
 * keep-or-discard. Splitting the wording off keeps `PromptLine.svelte`
 * markup-only.
 */
export function buttonLabels(prompt: PromptState): ButtonLabels {
  switch (prompt.kind) {
    case "permission":
    case "external-protocol":
      return { allow: "allow", deny: "deny" };
    case "session-restore":
      return { allow: "restore", deny: "discard" };
  }
}

/** The prompt line's words for a question, so the component stays markup. */
export function describePrompt(prompt: PromptState): string {
  switch (prompt.kind) {
    case "permission":
      return `${hostOf(prompt.origin)} wants to ${describePermission(prompt)}`;
    case "session-restore":
      return prompt.tabCount === 1
        ? "Restore 1 tab from your last session?"
        : `Restore ${prompt.tabCount} tabs from your last session?`;
    case "external-protocol": {
      const target = truncate(prompt.url);
      return prompt.origin === null
        ? `Open ${target}?`
        : `${hostOf(prompt.origin)} wants to open ${target}`;
    }
  }
}

/**
 * The scheme alone ("open bankid:") does not say what goes to the OS —
 * the payload is what a user judges trust by. Shown in full up to a point;
 * past it, truncation beats nothing.
 */
const TRUNCATE_AT = 64;

function truncate(url: string): string {
  return url.length > TRUNCATE_AT ? `${url.slice(0, TRUNCATE_AT)}…` : url;
}

/** Who is asking, as shown: the host, with the scheme's noise left out. */
function hostOf(origin: string): string {
  try {
    return new URL(origin).host;
  } catch {
    return origin;
  }
}

/** A permission's "use your camera and microphone"-style phrasing. */
function describePermission(prompt: Extract<PromptState, { kind: "permission" }>): string {
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

/**
 * The prompt main waits on, or null. Nothing is decided here: main owns
 * the queue, and y/n keys bypass this store. App.svelte click-outside
 * dismissal routes through `answer` too, so clearing the prompt means an
 * answer with the current id.
 */
export function createPrompts(bridge: Pick<KvistApi, "onPrompt" | "answerPrompt">) {
  const state = $state<{ current: PromptWire | null }>({ current: null });

  bridge.onPrompt((prompt) => {
    state.current = prompt;
  });

  return {
    get current(): PromptWire | null {
      return state.current;
    },
    /**
     * Clicking a button, or a click outside the prompt. The id goes with it
     * so an answer rendered from a stale snapshot cannot settle a newer
     * question by mistake.
     */
    answer(allow: boolean): void {
      const prompt = state.current;
      if (prompt) bridge.answerPrompt({ id: prompt.id, allow });
    },
  };
}
