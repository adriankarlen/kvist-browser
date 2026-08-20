<script lang="ts">
  import "./FindLine.css";
  import { find, vim } from "./stores.svelte";

  let input = $state<HTMLInputElement>();
  // Bound rather than read from the store: the store's query is already ""
  // when the prompt reopens, so nothing would tell the input to clear itself.
  let query = $state("");

  // Opening is driven by main switching mode, so focus follows the mode rather
  // than a click, as it does for the command line.
  $effect(() => {
    if (vim.mode !== "find") return;
    query = "";
    find.stop();
    input?.focus();
  });

  const count = $derived.by(() => {
    const result = find.result;
    if (result === null) return "";
    return result.matches === 0
      ? "no matches"
      : `${result.active}/${result.matches}`;
  });

  function oninput(): void {
    find.run(query);
  }

  function onkeydown(event: KeyboardEvent): void {
    if (event.key !== "Escape") return;
    event.preventDefault();
    find.stop();
    vim.toNormal();
  }

  function onblur(): void {
    vim.toNormal();
  }

  // Enter closes the prompt but keeps the matches, so n and N can carry on.
  function submit(event: SubmitEvent): void {
    event.preventDefault();
    vim.toNormal();
  }
</script>

<form class="kv-panel kv-line kv-find" data-label="find" onsubmit={submit}>
  <span class="kv-line__prompt">/</span>
  {#if vim.mode === "find"}
    <input
      class="kv-line__input"
      bind:this={input}
      bind:value={query}
      spellcheck="false"
      autocomplete="off"
      {oninput}
      {onkeydown}
      {onblur}
    />
  {:else}
    <span class="kv-find__query">{find.query}</span>
  {/if}
  <span class="kv-find__count">{count}</span>
</form>
