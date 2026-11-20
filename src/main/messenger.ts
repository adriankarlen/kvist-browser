/** What code outside the store uses to put a line in the echo area. */
export interface Messenger {
  /** Something worth saying that nothing went wrong about. */
  say(text: string): void;
  /** Something the user asked for that could not be done. */
  warn(text: string): void;
}
