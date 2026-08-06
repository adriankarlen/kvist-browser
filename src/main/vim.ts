import type { Mode } from "../shared/ipc";

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

export interface VimActions {
  newTab: () => void;
  closeTab: () => void;
  nextTab: () => void;
  prevTab: () => void;
  back: () => void;
  forward: () => void;
  reload: () => void;
  focusPage: () => void;
  focusChrome: () => void;
  focusOmnibox: () => void;
}

export class Vim {
  #mode: Mode = "normal";
  #pending = "";
  #actions: VimActions;
  #onMode: (mode: Mode) => void;

  constructor(actions: VimActions, onMode: (mode: Mode) => void) {
    this.#actions = actions;
    this.#onMode = onMode;
  }

  get mode(): Mode {
    return this.#mode;
  }

  /** Mode changes requested by the chrome, e.g. escaping out of the command line. */
  requestMode(mode: Mode): void {
    if (mode === "normal") this.#actions.focusPage();
    this.#set(mode);
  }

  /** True when the key was consumed and must not reach its webContents. */
  handleKey(input: KeyInput, source: KeySource): boolean {
    if (input.control || input.alt || input.meta) return false;

    // Chrome inputs own every key they can type, and own their own Escape —
    // the omnibox and command line report the mode change back over IPC.
    if (source === "chrome") {
      return this.#mode === "normal" ? this.#normal(input.key) : false;
    }

    // The command line lives in the chrome, so a page that still has focus
    // must not steal from it.
    if (this.#mode === "command") return false;

    if (this.#mode === "insert") {
      if (input.key !== "Escape") return false;
      this.#actions.focusPage();
      this.#set("normal");
      return true;
    }

    return this.#normal(input.key);
  }

  #normal(key: string): boolean {
    if (this.#pending === "g") {
      this.#pending = "";
      if (key === "t") this.#actions.nextTab();
      else if (key === "T") this.#actions.prevTab();
      // Swallow the rest of an unknown g-sequence rather than leaking it.
      return true;
    }

    switch (key) {
      case "Escape":
        this.#pending = "";
        return true;
      case "g":
        this.#pending = "g";
        return true;
      case "t":
        this.#actions.newTab();
        return true;
      case "x":
        this.#actions.closeTab();
        return true;
      case "r":
        this.#actions.reload();
        return true;
      case "H":
        this.#actions.back();
        return true;
      case "L":
        this.#actions.forward();
        return true;
      case "i":
        this.#set("insert");
        return true;
      case "o":
        this.#actions.focusOmnibox();
        this.#set("insert");
        return true;
      case ":":
        this.#actions.focusChrome();
        this.#set("command");
        return true;
      default:
        return false;
    }
  }

  #set(mode: Mode): void {
    if (mode === this.#mode) return;
    this.#mode = mode;
    this.#pending = "";
    this.#onMode(mode);
  }
}
