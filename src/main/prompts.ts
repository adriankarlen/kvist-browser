/**
 * A FIFO queue of questions, generic over the state shape, coalescing
 * deliberately absent (each asker matches differently).
 *
 * Head-only notification: one `$state` update per real change. The id
 * lives here — the asker's state carries none — and `cancel` removes
 * without firing.
 */
export class Prompts<T> {
  #pending: Entry<T>[] = [];
  #observers = new Set<(head: { id: number; state: T } | null) => void>();
  #nextId = 1;
  /**
   * The head the observer last reported. Reference equality suffices
   * because the queue never mutates an entry's state in place — entries
   * re-queue, and a new head is a new reference. Skipping tail
   * notifications keeps renderer updates to one per real change.
   */
  #lastEntry: Entry<T> | null = null;

  /**
   * Enqueues a new question. The queue stamps a fresh id; the returned id
   * matches what the chrome will see. `answer` runs exactly once when the
   * entry is settled, and never if `cancel` runs first.
   */
  ask(state: T, answer: (allow: boolean) => void): number {
    const id = this.#nextId++;
    this.#pending.push({ id, state, answer });
    this.#notify();
    return id;
  }

  /**
   * Settles the entry with the given id. A stale id (the entry has already
   * been settled or cancelled) is a no-op, so the click that won the race
   * against `cancel` cannot double-fire the callback.
   */
  answer(id: number, allow: boolean): void {
    const index = this.#pending.findIndex((entry) => entry.id === id);
    if (index === -1) return;
    const [entry] = this.#pending.splice(index, 1);
    this.#notify();
    entry.answer(allow);
  }

  /**
   * Settles the head of the queue, whatever id it carries. Used by the
   * prompt-mode `y`/`n`/`Escape` keybinds, which answer whatever is up
   * without first reading the head's id from the renderer.
   */
  answerHead(allow: boolean): void {
    const head = this.#pending[0];
    if (head !== undefined) this.answer(head.id, allow);
  }

  /**
   * Removes the entry without firing its answer callback. The queue is
   * unchanged otherwise — observers see the same head transition as a
   * settle, but the asker is not told a decision was made.
   */
  cancel(id: number): void {
    const index = this.#pending.findIndex((entry) => entry.id === id);
    if (index === -1) return;
    this.#pending.splice(index, 1);
    this.#notify();
  }

  /** The current head state, or null when nothing is queued. */
  get head(): T | null {
    return this.#pending[0]?.state ?? null;
  }

  /**
   * Subscribes to head changes. The observer fires immediately with the
   * current head (so a late subscriber does not miss the first paint),
   * then again on every transition.
   */
  observe(observer: (head: { id: number; state: T } | null) => void): () => void {
    this.#observers.add(observer);
    observer(this.#toWire(this.#pending[0]));
    return () => void this.#observers.delete(observer);
  }

  /** Every entry in queue order, for tests and shutdown sweeps. */
  get pending(): { id: number; state: T }[] {
    return this.#pending.map((entry) => ({ id: entry.id, state: entry.state }));
  }

  #toWire(entry: Entry<T> | undefined): { id: number; state: T } | null {
    return entry === undefined ? null : { id: entry.id, state: entry.state };
  }

  #notify(): void {
    const headEntry = this.#pending[0] ?? null;
    if (headEntry === this.#lastEntry) return;
    this.#lastEntry = headEntry;
    for (const observer of this.#observers)
      observer(this.#toWire(headEntry === null ? undefined : headEntry));
  }
}

interface Entry<T> {
  id: number;
  state: T;
  /**
   * What runs when an entry is settled by an answer. Wired by the asker —
   * the queue neither knows nor cares what it does, only that it runs once
   * on a real answer and never on `cancel`.
   */
  answer: (allow: boolean) => void;
}
