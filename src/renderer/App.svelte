<script lang="ts">
  import "./App.css";
  import { browser, contentRect } from "./lib/browser.svelte";
  import Omnibox from "./lib/Omnibox.svelte";
  import { ui } from "./lib/settings.svelte";
  import TabStrip from "./lib/TabStrip.svelte";
</script>

<div class="kv-shell" class:is-sidebar={ui.tabOrientation === "vertical"}>
  <TabStrip orientation={ui.tabOrientation} />
  <div class="kv-main">
    <Omnibox />
    <div class="kv-panel kv-content" data-label={browser.active?.title ?? "page"} use:contentRect>
    </div>
  </div>
</div>
