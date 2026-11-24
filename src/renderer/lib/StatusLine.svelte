<script lang="ts">
  import type { Region } from "../../shared/layout";
  import CommandLine from "./CommandLine.svelte";
  import LocationLine from "./LocationLine.svelte";
  import MessageLine from "./MessageLine.svelte";
  import PromptLine from "./PromptLine.svelte";
  import { layout } from "./stores.svelte";

  let { region }: { region: Region } = $props();
</script>

{#if layout.statusLine === "command"}
  <CommandLine {region} />
{:else if layout.statusLine === "prompt"}
  <PromptLine {region} />
{:else if layout.statusLine === "message"}
  <MessageLine {region} />
{:else if layout.statusLine === "location"}
  <LocationLine {region} />
{/if}
