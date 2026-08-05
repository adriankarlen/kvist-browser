<script lang="ts">
  import "./TabStrip.css";
  import { browser } from "./browser.svelte";
  import type { TabOrientation } from "../../shared/config";

  let { orientation }: { orientation: TabOrientation } = $props();
</script>

<nav
  class="kv-tabstrip"
  class:is-vertical={orientation === "vertical"}
  class:is-horizontal={orientation === "horizontal"}
>
  {#each browser.tabs as tab (tab.id)}
    <div class="kv-tab" class:is-active={tab.id === browser.activeId}>
      <button class="kv-tab__label" onclick={() => window.kvist.activateTab(tab.id)}>
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
        onclick={() => window.kvist.closeTab(tab.id)}
      >
        x
      </button>
    </div>
  {/each}

  <button class="kv-tabstrip__new" title="New tab" onclick={() => window.kvist.createTab()}>
    +
  </button>
  <div class="kv-tabstrip__drag"></div>
</nav>
