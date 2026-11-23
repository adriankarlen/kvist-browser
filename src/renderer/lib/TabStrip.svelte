<script lang="ts">
  import "./TabStrip.css";
  import { browser, browse, layout } from "./stores.svelte";
  import { elementDirection, type Region } from "../../shared/layout";

  let { region }: { region: Region } = $props();

  // Only an auto-hidden strip tracks the pointer; a fixed one has nothing to reveal.
  function hovered(): void {
    if (layout.tabsAutohide) layout.tabStripHovered();
  }

  function left(): void {
    if (layout.tabsAutohide) layout.tabStripLeft();
  }
</script>

{#if layout.tabStrip === "shown"}
  <nav
    class={["kv-panel", "kv-tabstrip", `is-${elementDirection(region)}`]}
    data-label="tabs"
    onmouseenter={hovered}
    onmouseleave={left}
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
{:else if layout.tabStrip === "tucked"}
  <div
    class={["kv-tabstrip-edge", `is-${elementDirection(region)}`]}
    role="presentation"
    onmouseenter={hovered}
  ></div>
{/if}
