import type { Mode } from "../shared/ipc";
import type { CommandName } from "./commands";
import type { Keybind } from "./keybinds";

export interface KeyInput {
  key: string;
  control: boolean;
  alt: boolean;
  meta: boolean;
}

/**
 * Which webContents a key arrived from. Keys reach main through
 * before-input-event, which is per webContents, so the page and the chrome are
 * two separate sources that need different rules.
 */
export type KeySource = "page" | "chrome";

export class Vim {
  #mode: Mode = "normal";
  #pending = "";
  /** A permission question waiting for an answer owns normal mode while it lasts. */
  #promptPending = false;
  #keybinds: readonly Keybind[];
  #execute: (name: CommandName, arg?: string) => void;
  #onMode: (mode: Mode) => void;

  constructor(
    keybinds: readonly Keybind[],
    execute: (name: CommandName, arg?: string) => void,
    onMode: (mode: Mode) => void,
  ) {
    this.#keybinds = keybinds;
    this.#execute = execute;
    this.#onMode = onMode;
  }

  get mode(): Mode {
    return this.#mode;
  }

  /** Modes where a chrome text input is open and owns every key it can type. */
  get #prompting(): boolean {
    return this.#mode === "command" || this.#mode === "find";
  }

  /**
   * A permission request appearing or being answered. A pending question
   * captures normal mode — the only mode whose keys are safe to borrow — so
   * the prompt's y/n work whenever it shows; a user mid-typing in insert or
   * command is never yanked, and lands in the prompt on the way back through
   * normal instead.
   */
  setPromptPending(pending: boolean): void {
    this.#promptPending = pending;
    if (pending && this.#mode === "normal") this.#set("prompt");
    else if (!pending && this.#mode === "prompt") this.#set("normal");
  }

  /** Mode changes requested by the chrome, e.g. escaping out of the command line. */
  requestMode(mode: Mode): void {
    if (mode === "normal") this.#execute("focus.page");
    this.#set(mode);
  }

  /**
   * A tab reporting that focus moved on or off something typable. Text fields
   * own their keys, so normal mode has to step aside rather than swallow them.
   *
   * This arrives asynchronously, unlike keys — safe only because it is cached
   * state, so handleKey still decides synchronously.
   */
  setEditable(editable: boolean): void {
    // A chrome prompt is up and holds the keyboard; the page is a bystander.
    if (this.#prompting) return;
    // A permission question owns the keyboard until it is answered.
    if (this.#mode === "prompt") return;
    if (editable) this.#set("insert");
    else if (this.#mode === "insert") this.#set("normal");
  }

  /**
   * The page reporting that hinting finished. Selecting a text field focuses
   * it, which puts us in insert before this arrives — so only hint mode is
   * unwound here, or that focus would be thrown away again.
   */
  endHints(): void {
    if (this.#mode === "hint") this.#set("normal");
  }

  /** True when the key was consumed and must not reach its webContents. */
  handleKey(input: KeyInput, source: KeySource): boolean {
    if (input.control || input.alt || input.meta) return false;

    // Chrome inputs own every key they can type, and own their own Escape —
    // the omnibox and command line report the mode change back over IPC.
    if (source === "chrome") {
      if (this.#mode !== "normal" && this.#mode !== "hint" && this.#mode !== "prompt") {
        return false;
      }
    } else {
      // The prompts live in the chrome, so a page that still has focus must not
      // steal from them.
      if (this.#prompting) return false;
    }

    // Try keybind dispatch.
    const dispatched = this.#dispatch(input.key);
    if (dispatched) return true;

    // Every key belongs to hinting while it is up, so nothing leaks to the
    // page mid-selection. The page decides when a label matched and reports
    // back.
    if (this.#mode === "hint") {
      this.#execute("hints.key", input.key);
      return true;
    }

    // A permission question owns every other key until it is answered.
    if (this.#mode === "prompt") return true;

    return false;
  }

  /**
   * Looks up the key (appended to any pending prefix) against the keybind
   * table for the current mode.
   *
   * Returns true when the key was consumed — either by matching a binding,
   * extending a prefix, or swallowing the tail of an unknown sequence.
   */
  #dispatch(key: string): boolean {
    const sequence = this.#pending + key;

    // Exact match — execute the command and apply the mode transition.
    const match = this.#keybinds.find((kb) => kb.mode === this.#mode && kb.keys === sequence);

    if (match) {
      this.#pending = "";
      if (match.command) this.#execute(match.command);
      if (match.enter !== undefined) this.#set(match.enter);
      return true;
    }

    // Prefix of a longer binding — wait for the next key.
    const isPrefix = this.#keybinds.some(
      (kb) =>
        kb.mode === this.#mode && kb.keys.startsWith(sequence) && kb.keys.length > sequence.length,
    );

    if (isPrefix) {
      this.#pending = sequence;
      return true;
    }

    // An unknown sequence following a prefix is swallowed rather than leaked.
    if (this.#pending !== "") {
      this.#pending = "";
      return true;
    }

    return false;
  }

  #set(mode: Mode): void {
    // A pending question turns normal into prompt, wherever the transition
    // came from — an answered prompt with another queued behind it keeps the
    // mode, because the queue only empties by being answered.
    const target = mode === "normal" && this.#promptPending ? "prompt" : mode;
    if (target === this.#mode) return;
    this.#mode = target;
    this.#pending = "";
    this.#onMode(target);
  }
}
