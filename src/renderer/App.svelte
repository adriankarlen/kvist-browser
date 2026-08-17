<script lang="ts">
  import "./App.css";
  import { browser, contentRect } from "./lib/browser.svelte";
  import CommandLine from "./lib/CommandLine.svelte";
  import { downloads } from "./lib/downloads.svelte";
  import DownloadsPanel from "./lib/DownloadsPanel.svelte";
  import { find } from "./lib/find.svelte";
  import FindLine from "./lib/FindLine.svelte";
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
    <!-- Shows itself while something is transferring, and stays up while
         `:downloads` keeps it pinned. -->
    {#if downloads.visible}
      <DownloadsPanel />
    {/if}
    {#if vim.mode === "command"}
      <CommandLine />
    {/if}
    <!-- Outlives the prompt: matches stay highlighted for n and N, and the
         count is the only thing saying how many there are. -->
    {#if vim.mode === "find" || find.active}
      <FindLine />
    {/if}
  </div>
</div>
