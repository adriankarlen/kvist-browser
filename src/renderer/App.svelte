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
   * Click anywhere in the chrome outside the prompt line dismisses it as a
   * deny — the same semantics as `Escape`. Restricted to permission
   * prompts because a session-restore deny is destructive: the callback
   * creates a homepage tab and the next close overwrites the saved row
   * with just that homepage. A stray click on a restore prompt would
   * discard the user's saved tabs without warning. The prompt's own
   * container stops propagation so clicks on its buttons (which answer
   * before the stop) and on its text don't trigger this.
   *
   * Page clicks live in a separate webContents and don't bubble into the
   * chrome's DOM, so they don't dismiss — that's a deliberate scope cut.
   */
  function onWindowClick(): void {
    const head = prompts.current;
    if (head?.state.kind === "permission") prompts.answer(false);
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