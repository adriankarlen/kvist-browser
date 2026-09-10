<script lang="ts">
  import "./App.css";
  import { browser, contentRect, downloads, find, messages, prompts, ui, vim } from "./lib/stores.svelte";
  import CommandLine from "./lib/CommandLine.svelte";
  import DownloadsPanel from "./lib/DownloadsPanel.svelte";
  import FindLine from "./lib/FindLine.svelte";
  import MessageLine from "./lib/MessageLine.svelte";
  import Omnibox from "./lib/Omnibox.svelte";
  import PromptLine from "./lib/PromptLine.svelte";
  import TabStrip from "./lib/TabStrip.svelte";

  /**
   * A click outside the prompt line denies the head prompt, like Escape.
   * Only for permission and external-protocol prompts: denying a session
   * restore would overwrite the user's saved tabs. Page clicks live in
   * another webContents and never bubble here.
   */
  function onWindowClick(): void {
    const head = prompts.current;
    if (head?.state.kind === "permission" || head?.state.kind === "external-protocol") {
      prompts.answer(false);
    }
  }
</script>

<svelte:window {onWindowClick} />

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
    <!-- The echo area shares the command line's row: a prompt is what main is
         asking, a message is what it has to say, and never both at once. -->
    {#if vim.mode !== "command"}
      {#if prompts.current}
        <PromptLine />
      {:else if messages.current}
        <MessageLine />
      {/if}
    {/if}
    <!-- Outlives the prompt: matches stay highlighted for n and N, and the
         count is the only thing saying how many there are. -->
    {#if vim.mode === "find" || find.active}
      <FindLine />
    {/if}
  </div>
</div>