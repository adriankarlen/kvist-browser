<script lang="ts">
  import "./PromptLine.css";
  import Icon from "../../shared/icons/Icon.svelte";
  import { buttonLabels, describePrompt } from "./prompts.svelte";
  import { elementDirection, type Region } from "../../shared/layout";
  import { prompts, vim } from "./stores.svelte";

  let { region }: { region: Region } = $props();

  const prompt = $derived(prompts.current?.state ?? null);
  const labels = $derived(prompt ? buttonLabels(prompt) : null);

  /**
   * Stop propagation on the container so click-outside dismissal in
   * `App.svelte` does not fire on clicks inside; button handlers answer
   * before the stop, so answering clicks still dismiss. The handler is
   * defensive only, so the keyboard a11y rule does not apply.
   */
  function stopBubble(event: Event): void {
    event.stopPropagation();
  }
</script>

{#if prompt && labels}
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <div
    class={["kv-panel", "kv-line", "kv-prompt", `is-${elementDirection(region)}`]}
    data-label={prompt.kind}
    onclick={stopBubble}
    role="alertdialog"
    tabindex="-1"
  >
    <span class="kv-line__prompt"><Icon role="question" glyph="?" /></span>
    <span class="kv-prompt__text">{describePrompt(prompt)}</span>
    {#if vim.enabled}
      <span class="kv-prompt__hint">y/n</span>
    {/if}
    <button
      class="kv-prompt__answer is-allow"
      type="button"
      onclick={() => prompts.answer(true)}>{labels.allow}</button
    >
    <button
      class="kv-prompt__answer is-deny"
      type="button"
      onclick={() => prompts.answer(false)}>{labels.deny}</button
    >
  </div>
{/if}