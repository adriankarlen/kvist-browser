<script lang="ts">
  import { browser } from "./browser.svelte";
  import type { TabOrientation } from "./settings.svelte";

  let { orientation }: { orientation: TabOrientation } = $props();
</script>

<nav
  class="strip"
  class:vertical={orientation === "vertical"}
  class:horizontal={orientation === "horizontal"}
>
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
    overflow: auto;
    scrollbar-width: none;
  }

  .horizontal {
    flex-direction: row;
    align-items: stretch;
    height: var(--kv-tabstrip-height);
    border-bottom: 1px solid var(--kv-border);
  }

  .vertical {
    flex-direction: column;
    width: var(--kv-sidebar-width);
    border-right: 1px solid var(--kv-border);
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
    padding: 0 1ch;
    gap: 1ch;
    color: var(--kv-muted);
  }

  .horizontal .tab {
    flex: 0 1 22ch;
    border-right: 1px solid var(--kv-border);
  }

  .vertical .tab {
    flex: none;
    height: var(--kv-tabstrip-height);
    border-bottom: 1px solid var(--kv-border);
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
    flex: none;
    color: var(--kv-muted);
  }

  .horizontal .new {
    padding: 0 1.5ch;
  }

  .vertical .new {
    height: var(--kv-tabstrip-height);
    padding: 0 2ch;
    text-align: left;
  }

  .drag {
    flex: 1;
    -webkit-app-region: drag;
  }
</style>
