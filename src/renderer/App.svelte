<script lang="ts">
  import { contentRect } from "./lib/browser.svelte";
  import Omnibox from "./lib/Omnibox.svelte";
  import { ui } from "./lib/settings.svelte";
  import TabStrip from "./lib/TabStrip.svelte";
</script>

<div class="shell" class:sidebar={ui.tabOrientation === "vertical"}>
  <TabStrip orientation={ui.tabOrientation} />
  <div class="main">
    <Omnibox />
    <div class="content" use:contentRect></div>
  </div>
</div>

<style>
  .shell {
    display: flex;
    flex-direction: column;
    height: 100vh;
  }

  .shell.sidebar {
    flex-direction: row;
  }

  .main {
    display: flex;
    flex-direction: column;
    flex: 1;
    min-width: 0;
    min-height: 0;
  }

  .content {
    flex: 1;
    min-height: 0;
  }
</style>
