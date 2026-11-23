<script lang="ts">
  import "./TabStrip.css";
  import { browser, browse } from "./stores.svelte";
  import type { TabStripDirection } from "../../shared/layout";

  let { orientation }: { orientation: TabStripDirection } = $props();
</script>

<nav
  class="kv-panel kv-tabstrip"
  data-label="tabs"
  class:is-vertical={orientation === "vertical"}
  class:is-horizontal={orientation === "horizontal"}
>
  {#each browser.tabs as tab (tab.id)}
    <div class="kv-tab" class:is-active={tab.id === browser.activeId}>
      <button class="kv-tab__label" onclick={() => browse.activateTab(tab.id)}>
        {#if tab.loading || !tab.favicon}
          <span class="kv-tab__marker">{tab.loading ? "*" : ">"}</span>
        {:else}
          <img class="kv-tab__favicon" src={tab.favicon} alt="" />
        {/if}
        <span class="kv-tab__title">{tab.title}</span>
      </button>
      <button
        class="kv-tab__close"
        title="Close tab"
        onclick={() => browse.closeTab(tab.id)}
      >
        x
      </button>
    </div>
  {/each}

  <button class="kv-tabstrip__new" title="New tab" onclick={() => browse.createTab()}>
    +
  </button>
  <div class="kv-tabstrip__drag"></div>
</nav>
