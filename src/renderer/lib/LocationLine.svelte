<script lang="ts">
  import "./LocationLine.css";
  import { elementDirection, type Region } from "../../shared/layout";
  import { browser, vim } from "./stores.svelte";

  let { region }: { region: Region } = $props();

  const url = $derived(browser.active?.url ?? "");
</script>

<output class={["kv-panel", "kv-line", "kv-location", `is-${elementDirection(region)}`]} data-label="url">
  <span class="kv-mode is-{vim.mode}">{vim.mode}</span>
  <span class="kv-location__url" title={url}>{url}</span>
</output>
