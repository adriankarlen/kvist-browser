<script lang="ts">
  import { contentRect } from "./lib/browser.svelte";
  import Omnibox from "./lib/Omnibox.svelte";
  import TabStrip from "./lib/TabStrip.svelte";
</script>

<div class="shell">
  <TabStrip />
  <Omnibox />
  <div class="content" use:contentRect></div>
</div>

<style>
  .shell {
    display: flex;
    flex-direction: column;
    height: 100vh;
  }

  .content {
    flex: 1;
    min-height: 0;
  }
</style>
