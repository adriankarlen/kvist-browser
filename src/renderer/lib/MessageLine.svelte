<script lang="ts">
  import "./MessageLine.css";
  import Icon from "../../shared/icons/Icon.svelte";
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
    <span class="kv-line__prompt"
      >{#if message.level === "error"}<Icon role="message-error" glyph="!" />{:else}<Icon
          role="message"
          glyph=">"
        />{/if}</span
    >
    <span class="kv-message__text">{message.text}</span>
  </output>
{/if}
