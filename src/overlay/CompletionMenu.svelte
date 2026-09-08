<script lang="ts">
  import type { Attachment } from "svelte/attachments";
  import "./CompletionMenu.css";
  import { kindBadge, kindBadgeStyle } from "./badge";
  import type { CompletionCandidate } from "../shared/ipc";

  let {
    candidates,
    index,
    onaccept,
  }: {
    candidates: CompletionCandidate[];
    index: number;
    onaccept: (candidate: CompletionCandidate) => void;
  } = $props();

  // Cycling the selection with the keyboard moves state, not scroll
  // position; the list caps its height and clips, so the active row has to
  // be pulled into view itself. Reading `index` here is what re-runs this
  // whenever the selection moves.
  const revealActive = (row: number): Attachment<HTMLElement> => {
    return (node) => {
      if (row < 0) return;
      node.querySelector(`[data-index="${row}"]`)?.scrollIntoView({ block: "nearest" });
    };
  };
</script>

{#if candidates.length > 0}
  <!--
    The option is the interactive element, not a button it wraps: a listbox
    option must stay a leaf for a screen reader to announce it correctly,
    and the keyboard never focuses it anyway — arrow keys and Enter are read
    off the owning input by handleCompletionKey, which runs in the chrome.
  -->
  <ul class="kv-completion" role="listbox" {@attach revealActive(index)}>
    {#each candidates as candidate, row (row)}
      <!-- svelte-ignore a11y_click_events_have_key_events -->
      <li
        class="kv-completion__item"
        class:is-active={row === index}
        role="option"
        aria-selected={row === index}
        data-index={row}
        onclick={() => onaccept(candidate)}
      >
        <span class="kv-completion__badge" style={kindBadgeStyle(candidate)}>{kindBadge(candidate)}</span>
        <span class="kv-completion__label">{candidate.label}</span>
        {#if candidate.hint}
          <span class="kv-completion__hint">{candidate.hint}</span>
        {/if}
      </li>
    {/each}
  </ul>
{/if}
