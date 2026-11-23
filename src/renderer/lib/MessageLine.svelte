<script lang="ts">
  import "./MessageLine.css";
  import { elementDirection, type Region } from "../../shared/layout";
  import { messages } from "./stores.svelte";

  let { region }: { region: Region } = $props();

  const message = $derived(messages.current);
</script>

{#if message}
  <output
    class={[
      "kv-panel",
      "kv-line",
      "kv-message",
      `is-${elementDirection(region)}`,
      { "is-error": message.level === "error" },
    ]}
    data-label="msg"
  >
    <span class="kv-line__prompt">{message.level === "error" ? "!" : ">"}</span>
    <span class="kv-message__text">{message.text}</span>
  </output>
{/if}
