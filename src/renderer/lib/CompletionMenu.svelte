<script lang="ts">
  import "./CompletionMenu.css";
  import { kindBadge, kindBadgeStyle, type Candidate, type Completion } from "./completion.svelte";

  let { completion, onaccept }: { completion: Completion; onaccept: (candidate: Candidate) => void } = $props();

  let list = $state<HTMLUListElement>();

  // Cycling the selection with the keyboard moves state, not scroll
  // position; the list caps its height and clips, so the active row has to
  // be pulled into view itself.
  $effect(() => {
    const index = completion.index;
    if (index < 0) return;
    list?.querySelector(`[data-index="${index}"]`)?.scrollIntoView({ block: "nearest" });
  });

  function accept(candidate: Candidate): void {
    completion.close();
    onaccept(candidate);
  }

  // Keeps focus (and the caret) on the input the dropdown belongs to; without
  // this the input blurs before the click's own handler runs.
  function keepFocus(event: MouseEvent): void {
    event.preventDefault();
  }
</script>

{#if completion.open}
  <!--
    The option is the interactive element, not a button it wraps: a listbox
    option must stay a leaf for a screen reader to announce it correctly,
    and the keyboard never focuses it anyway — arrow keys and Enter are read
    off the owning input by handleCompletionKey, not by tabbing in here.
  -->
  <ul class="kv-completion" role="listbox" bind:this={list}>
    {#each completion.candidates as candidate, index (candidate.value)}
      <!-- svelte-ignore a11y_click_events_have_key_events -->
      <li
        class="kv-completion__item"
        class:is-active={index === completion.index}
        role="option"
        aria-selected={index === completion.index}
        data-index={index}
        onmousedown={keepFocus}
        onclick={() => accept(candidate)}
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
