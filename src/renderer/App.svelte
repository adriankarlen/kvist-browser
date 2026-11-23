<script lang="ts">
  import "./App.css";
  import { browser, contentRect, prompts } from "./lib/stores.svelte";
  import Region from "./features/layout/Region.svelte";

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

<div class="kv-shell">
  <Region name="left" />
  <div class="kv-main">
    <Region name="top" />
    <div class="kv-panel kv-content" data-label={browser.active?.title ?? "page"} use:contentRect>
    </div>
    <Region name="bottom" />
  </div>
  <Region name="right" />
</div>
