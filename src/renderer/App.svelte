<script lang="ts">
  import "./App.css";
  import { browser, contentRect } from "./lib/browser.svelte";
  import CommandLine from "./lib/CommandLine.svelte";
  import Omnibox from "./lib/Omnibox.svelte";
  import { ui } from "./lib/settings.svelte";
  import TabStrip from "./lib/TabStrip.svelte";
  import { vim } from "./lib/vim.svelte";
</script>

<div class="kv-shell" class:is-sidebar={ui.tabOrientation === "vertical"}>
  <TabStrip orientation={ui.tabOrientation} />
  <div class="kv-main">
    <Omnibox />
    <div class="kv-panel kv-content" data-label={browser.active?.title ?? "page"} use:contentRect>
    </div>
    {#if vim.mode === "command"}
      <CommandLine />
    {/if}
  </div>
</div>
