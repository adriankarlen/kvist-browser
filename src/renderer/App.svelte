<script lang="ts">
  import "./App.css";
  import { contentRect } from "./lib/browser.svelte";
  import Omnibox from "./lib/Omnibox.svelte";
  import { ui } from "./lib/settings.svelte";
  import TabStrip from "./lib/TabStrip.svelte";
</script>

<div class="kv-shell" class:is-sidebar={ui.tabOrientation === "vertical"}>
  <TabStrip orientation={ui.tabOrientation} />
  <div class="kv-main">
    <Omnibox />
    <div class="kv-content" use:contentRect></div>
  </div>
</div>
