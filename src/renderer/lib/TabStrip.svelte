<script lang="ts">
  import { browser } from "./browser.svelte";
</script>

<nav class="strip">
  {#each browser.tabs as tab (tab.id)}
    <div class="tab" class:active={tab.id === browser.activeId}>
      <button class="label" onclick={() => window.kvist.activateTab(tab.id)}>
        {#if tab.loading || !tab.favicon}
          <span class="marker">{tab.loading ? "*" : ">"}</span>
        {:else}
          <img class="favicon" src={tab.favicon} alt="" />
        {/if}
        <span class="title">{tab.title}</span>
      </button>
      <button class="close" title="Close tab" onclick={() => window.kvist.closeTab(tab.id)}>
        x
      </button>
    </div>
  {/each}

  <button class="new" title="New tab" onclick={() => window.kvist.createTab()}>+</button>
  <div class="drag"></div>
</nav>

<style>
  .strip {
    display: flex;
    align-items: stretch;
    gap: 1px;
    height: var(--kv-tabstrip-height);
    border-bottom: 1px solid var(--kv-border);
    overflow-x: auto;
    scrollbar-width: none;
  }

  button {
    background: none;
    border: none;
    color: inherit;
    font: inherit;
    cursor: pointer;
    padding: 0;
  }

  .tab {
    display: flex;
    align-items: center;
    min-width: 0;
    flex: 0 1 22ch;
    padding: 0 1ch;
    gap: 1ch;
    color: var(--kv-muted);
    border-right: 1px solid var(--kv-border);
  }

  .tab.active {
    color: var(--kv-fg);
    background: var(--kv-bg-alt);
  }

  .label {
    display: flex;
    align-items: center;
    gap: 1ch;
    min-width: 0;
    flex: 1;
  }

  .marker {
    color: var(--kv-accent);
  }

  .favicon {
    width: 1em;
    height: 1em;
    flex: none;
  }

  .drag {
    flex: 1;
    -webkit-app-region: drag;
  }

  .title {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .close:hover,
  .new:hover {
    color: var(--kv-accent);
  }

  .new {
    padding: 0 1.5ch;
    color: var(--kv-muted);
  }
</style>
