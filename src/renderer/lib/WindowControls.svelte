<script lang="ts">
  import "./WindowControls.css";
  import Icon from "../../shared/icons/Icon.svelte";
  import { windowControls } from "./stores.svelte";
</script>

<!-- macOS draws its own buttons over an empty slot. Full screen has no title
     bar for them, so the slot goes too. -->
{#if windowControls.native}
  {#if !windowControls.fullscreen}
    <div class={["kv-window-controls", "is-native"]} use:windowControls.slot></div>
  {/if}
{:else if windowControls.known}
  <div class="kv-window-controls">
    <button
      class="kv-window-controls__button"
      type="button"
      title="Minimize"
      aria-label="Minimize"
      onclick={() => windowControls.press("minimize")}><Icon role="minimize" glyph="-" /></button
    >
    <button
      class="kv-window-controls__button"
      type="button"
      title={windowControls.maximized ? "Restore" : "Maximize"}
      aria-label={windowControls.maximized ? "Restore" : "Maximize"}
      onclick={() => windowControls.press("maximize")}
      >{#if windowControls.maximized}<Icon role="restore" glyph="=" />{:else}<Icon
          role="maximize"
          glyph="o"
        />{/if}</button
    >
    <button
      class={["kv-window-controls__button", "is-close"]}
      type="button"
      title="Close window"
      aria-label="Close window"
      onclick={() => windowControls.press("close")}><Icon role="window-close" glyph="x" /></button
    >
  </div>
{/if}
