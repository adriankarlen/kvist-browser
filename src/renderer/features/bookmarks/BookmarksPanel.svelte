<script lang="ts">
  import type { Attachment } from "svelte/attachments";
  import "./BookmarksPanel.css";
  import { elementDirection, type Region } from "../../../shared/layout";
  import { bookmarks } from "../../lib/stores.svelte";

  let { region }: { region: Region } = $props();

  // Derived, so only a new opening reruns the attachment, not every model change.
  const opened = $derived(bookmarks.opened);

  // Uncontrolled: the model lags a keystroke behind, and writing it back
  // would eat whatever was typed in between. Every opening starts afresh,
  // including one while the panel is already up.
  const fresh: Attachment<HTMLInputElement> = (node) => {
    void opened;
    node.value = "";
    node.focus();
  };

  const pad = (n: number): string => String(n).padStart(2, "0");

  function day(at: number): string {
    const date = new Date(at);

    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  }

  const reveal =
    (selected: boolean): Attachment<HTMLElement> =>
    (node) => {
      if (selected) node.scrollIntoView({ block: "nearest" });
    };

  // Clicks must not take focus from the filter: its blur closes the panel.
  function keepFocus(event: MouseEvent): void {
    event.preventDefault();
  }

  function oninput(event: Event & { currentTarget: HTMLInputElement }): void {
    bookmarks.filter(event.currentTarget.value);
  }

  function onkeydown(event: KeyboardEvent): void {
    // An IME uses these keys, Enter above all, to commit what it composed.
    if (event.isComposing) return;
    const { key, ctrlKey, shiftKey } = event;

    if (key === "ArrowDown" || (key === "Tab" && !shiftKey) || (ctrlKey && key === "n")) {
      bookmarks.move(1);
    } else if (key === "ArrowUp" || (key === "Tab" && shiftKey) || (ctrlKey && key === "p")) {
      bookmarks.move(-1);
    } else if (key === "Enter") {
      bookmarks.pick();
    } else if (key === "Escape") {
      bookmarks.dismiss();
    } else if (key === "Delete" && shiftKey) {
      bookmarks.remove();
    } else {
      return;
    }

    event.preventDefault();
  }

  function typable(target: EventTarget | null): boolean {
    return (
      target instanceof HTMLInputElement ||
      target instanceof HTMLTextAreaElement ||
      (target instanceof HTMLElement && target.isContentEditable)
    );
  }

  // Focus moving to another chrome input keeps the keyboard in the chrome.
  // Handing it to the page there would pull focus from under that input.
  function onblur(event: FocusEvent): void {
    bookmarks.blurred(document.hasFocus() && !typable(event.relatedTarget));
  }
</script>

<!-- Scrolls an inner element rather than itself: .kv-panel's label sits outside
     its box, and any overflow but visible would clip it away. -->
{#if bookmarks.open}
  <section
    class={["kv-panel", "kv-bookmarks", `is-${elementDirection(region)}`]}
    data-label="bookmarks"
  >
    <div class="kv-line kv-bookmarks__filter">
      <span class="kv-line__prompt">&gt;</span>
      <input
        class="kv-line__input"
        {@attach fresh}
        spellcheck="false"
        autocomplete="off"
        placeholder="filter bookmarks"
        aria-label="Filter bookmarks"
        {oninput}
        {onkeydown}
        {onblur}
      />
    </div>
    <ul class="kv-bookmarks__list">
      {#each bookmarks.rows as row, index (row.id)}
        <li
          class={["kv-bookmarks__item", { "is-selected": index === bookmarks.selected }]}
          {@attach reveal(index === bookmarks.selected)}
        >
          <button
            class="kv-bookmarks__open"
            type="button"
            title={row.url}
            onmousedown={keepFocus}
            onclick={() => bookmarks.pick(row.id)}
          >
            <span class="kv-bookmarks__title">{row.title}</span>
            <span class="kv-bookmarks__url">{row.url}</span>
            <span class="kv-bookmarks__date">{day(row.createdAt)}</span>
          </button>
          <button
            class="kv-bookmarks__delete"
            type="button"
            title="Delete bookmark (Shift+Delete)"
            aria-label="Delete bookmark {row.title}"
            onmousedown={keepFocus}
            onclick={() => bookmarks.remove(row.id)}
          >
            x
          </button>
        </li>
      {:else}
        <li class="kv-bookmarks__empty">{bookmarks.query === "" ? "no bookmarks" : "no matches"}</li>
      {/each}
    </ul>
  </section>
{/if}
