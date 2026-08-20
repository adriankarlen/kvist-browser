<script lang="ts">
  import "./MessageLine.css";
  import { messages } from "./messages.svelte";

  const message = $derived(messages.current);
</script>

{#if message}
  <output class="kv-panel kv-line kv-message" class:is-error={message.level === "error"} data-label="msg">
    <span class="kv-line__prompt">{message.level === "error" ? "!" : ">"}</span>
    <span class="kv-message__text">{message.text}</span>
  </output>
{/if}
