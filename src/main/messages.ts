import type { Message } from "../shared/ipc";

/**
 * The echo area's source, Neovim-style: main says one thing at a time, and it
 * stands until the user does something else.
 *
 * Everything here also reaches the log. A packaged browser's stderr is nobody's
 * idea of a user interface, which is the whole reason this exists — but the
 * log is still where a bug report comes from.
 */
export class Messages {
  #observers = new Set<(message: Message | null) => void>();
  /** Whether anything is up, so a keystroke knows if it has work to do. */
  #showing = false;

  /**
   * A window subscribing. Answers with the way to stop, because the messages
   * outlive any one window.
   */
  observe(observer: (message: Message | null) => void): () => void {
    this.#observers.add(observer);
    return () => void this.#observers.delete(observer);
  }

  /** Something worth saying that nothing went wrong about. */
  say(text: string): void {
    console.log(`kvist: ${text}`);
    this.#show({ text, level: "info" });
  }

  /** Something the user asked for that could not be done. */
  warn(text: string): void {
    console.error(`kvist: ${text}`);
    this.#show({ text, level: "error" });
  }

  /**
   * The next keystroke clears whatever is up. Not a timer: a message that
   * disappears on its own can disappear before it has been read, and the one
   * thing worth saying is usually the thing the user is waiting for.
   */
  keyPressed(): void {
    if (!this.#showing) return;
    this.#showing = false;
    this.#emit(null);
  }

  #show(message: Message): void {
    this.#showing = true;
    this.#emit(message);
  }

  #emit(message: Message | null): void {
    for (const observer of this.#observers) observer(message);
  }
}
