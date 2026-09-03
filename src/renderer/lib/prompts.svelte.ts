import type { KvistApi, PromptState, PromptWire } from "../../shared/ipc";

export type Prompts = ReturnType<typeof createPrompts>;

/** The two button labels per prompt kind. The wording changes; the shape does not. */
export interface ButtonLabels {
  allow: string;
  deny: string;
}

/**
 * The button labels per prompt kind. The two-line shape of the prompt line
 * (text + buttons) is the same; only the wording changes — a permission is
 * a yes-or-no, a session restore is a keep-or-discard. Splitting the
 * wording off the component keeps `PromptLine.svelte` markup-only.
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
 * The scheme alone ("open bankid:") does not say what is actually being
 * sent to the OS — the payload is the one thing that lets a user judge
 * whether to trust it. Shown in full up to a point; past it, a truncated
 * URL is still more informative than nothing, and the full one is not
 * worth wrapping the prompt line for.
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
 * The prompt main is waiting on, or null. Nothing is decided here: main
 * owns the queue and the answers, and the y/n keys reach it without
 * passing through this store at all.
 *
 * Click-outside dismissal in `App.svelte` also routes through `answer`,
 * so the only way to clear the prompt from the renderer is to send an
 * answer with the current id — the same path the buttons and y/n keys
 * already use.
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
