<script lang="ts">
  import { browser } from "./browser.svelte";

  let input = $state<HTMLInputElement>();
  let draft = $state("");
  let focused = $state(false);

  $effect(() => {
    const url = browser.active?.url ?? "";
    if (!focused) draft = url;
  });

  function resolve(value: string): string {
    const query = value.trim();
    if (/^[a-z][a-z0-9+.-]*:/i.test(query)) return query;
    if (/^[^\s/]+\.[^\s/]+/.test(query)) return `https://${query}`;
    return `https://duckduckgo.com/?q=${encodeURIComponent(query)}`;
  }

  function submit(event: SubmitEvent): void {
    event.preventDefault();
    if (draft.trim() === "") return;
    window.kvist.navigate(resolve(draft));
    input?.blur();
  }
</script>

<form class="omnibox" onsubmit={submit}>
  <button
    type="button"
    title="Back"
    disabled={!browser.active?.canGoBack}
    onclick={() => window.kvist.goBack()}>&lt;</button
  >
  <button
    type="button"
    title="Forward"
    disabled={!browser.active?.canGoForward}
    onclick={() => window.kvist.goForward()}>&gt;</button
  >
  <button type="button" title="Reload" onclick={() => window.kvist.reload()}>r</button>

  <span class="prompt">:</span>
  <input
    bind:this={input}
    bind:value={draft}
    spellcheck="false"
    autocomplete="off"
    placeholder="enter url or search"
    onfocus={() => {
      focused = true;
      input?.select();
    }}
    onblur={() => (focused = false)}
  />

  <button type="button" title="DevTools" onclick={() => window.kvist.toggleDevTools()}>d</button>
</form>

<style>
  .omnibox {
    display: flex;
    align-items: center;
    gap: 1ch;
    height: var(--kv-omnibox-height);
    padding: 0 1ch;
    border-bottom: 1px solid var(--kv-border);
  }

  button {
    background: none;
    border: none;
    color: var(--kv-muted);
    font: inherit;
    cursor: pointer;
    padding: 0 0.5ch;
  }

  button:disabled {
    opacity: 0.3;
    cursor: default;
  }

  button:not(:disabled):hover {
    color: var(--kv-accent);
  }

  .prompt {
    color: var(--kv-accent);
  }

  input {
    flex: 1;
    min-width: 0;
    background: none;
    border: none;
    outline: none;
    color: var(--kv-fg);
    font: inherit;
  }

  input::placeholder {
    color: var(--kv-muted);
  }
</style>
