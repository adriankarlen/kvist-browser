<script lang="ts">
  import "./Slot.css";
  import { type ElementId, type Region, tabStripDirection } from "../../../shared/layout";
  import { layout, messages, prompts, vim } from "../../lib/stores.svelte";
  import BookmarksPanel from "../bookmarks/BookmarksPanel.svelte";
  import CommandLine from "../../lib/CommandLine.svelte";
  import DownloadsPanel from "../../lib/DownloadsPanel.svelte";
  import FindLine from "../../lib/FindLine.svelte";
  import MessageLine from "../../lib/MessageLine.svelte";
  import Omnibox from "../../lib/Omnibox.svelte";
  import PromptLine from "../../lib/PromptLine.svelte";
  import TabStrip from "../../lib/TabStrip.svelte";

  let { id, region }: { id: ElementId; region: Region } = $props();
</script>

<!-- The size travels as a custom property, never as width or height, so
     config.css can still override the box itself. -->
<div class={["kv-slot", `kv-slot--${id}`]} style:--kv-layout-size={layout.size(id)}>
  {#if id === "tabs"}
    <TabStrip orientation={tabStripDirection(region)} />
  {:else if id === "omnibox"}
    <Omnibox />
  {:else if id === "bookmarks"}
    <BookmarksPanel />
  {:else if id === "downloads"}
    <DownloadsPanel />
  {:else if id === "status"}
    <!-- A prompt is what main is asking, a message is what it has to say, and
         never both at once. -->
    {#if vim.mode === "command"}
      <CommandLine />
    {:else if prompts.current}
      <PromptLine />
    {:else if messages.current}
      <MessageLine />
    {/if}
  {:else if id === "find"}
    <FindLine />
  {/if}
</div>
