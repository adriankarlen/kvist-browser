import type { Mode, ScrollCommand } from "../shared/ipc";

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
  /** Drops the page's focused element, so leaving insert actually returns the keyboard. */
  blurPage: () => void;
  scrollPage: (command: ScrollCommand) => void;
  showHints: () => void;
  hideHints: () => void;
  /** Feeds one key to the page, which owns hint matching. */
  hintKey: (key: string) => void;
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

  /**
   * A tab reporting that focus moved on or off something typable. Text fields
   * own their keys, so normal mode has to step aside rather than swallow them.
   *
   * This arrives asynchronously, unlike keys — safe only because it is cached
   * state, so handleKey still decides synchronously.
   */
  setEditable(editable: boolean): void {
    // The command line is up and holds the keyboard; the page is a bystander.
    if (this.#mode === "command") return;
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
      if (this.#mode === "hint") return this.#hint(input.key);
      return this.#mode === "normal" ? this.#normal(input.key) : false;
    }

    // The command line lives in the chrome, so a page that still has focus
    // must not steal from it.
    if (this.#mode === "command") return false;

    if (this.#mode === "hint") return this.#hint(input.key);

    if (this.#mode === "insert") {
      if (input.key !== "Escape") return false;
      // Leaving the field focused would keep every following key going to it,
      // which is the confusing half-modal state Escape is meant to end.
      this.#actions.blurPage();
      this.#actions.focusPage();
      this.#set("normal");
      return true;
    }

    return this.#normal(input.key);
  }

  /**
   * Every key belongs to hinting while it is up, so nothing leaks to the page
   * mid-selection. The page decides when a label matched and reports back.
   */
  #hint(key: string): boolean {
    if (key === "Escape") {
      this.#actions.hideHints();
      this.#set("normal");
      return true;
    }
    this.#actions.hintKey(key);
    return true;
  }

  #normal(key: string): boolean {
    if (this.#pending === "g") {
      this.#pending = "";
      if (key === "t") this.#actions.nextTab();
      else if (key === "T") this.#actions.prevTab();
      else if (key === "g") this.#actions.scrollPage("top");
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
      case "j":
        this.#actions.scrollPage("down");
        return true;
      case "k":
        this.#actions.scrollPage("up");
        return true;
      case "d":
        this.#actions.scrollPage("half-down");
        return true;
      case "u":
        this.#actions.scrollPage("half-up");
        return true;
      case "G":
        this.#actions.scrollPage("bottom");
        return true;
      case "f":
        this.#actions.showHints();
        this.#set("hint");
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
