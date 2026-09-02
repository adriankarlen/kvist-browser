<script lang="ts">
  import "./PromptLine.css";
  import { buttonLabels, describePrompt } from "./prompts.svelte";
  import { prompts } from "./stores.svelte";

  const prompt = $derived(prompts.current?.state ?? null);
  const labels = $derived(prompt ? buttonLabels(prompt) : null);

  /**
   * Stop propagation on the container so window-level click-outside
   * dismissal in `App.svelte` does not fire on clicks inside. Button
   * onclick handlers still call `prompts.answer(allow)` and run before
   * the stop, so answering clicks dismiss. The click handler is purely
   * defensive (no user-facing behaviour), so the a11y rule about
   * keyboard handlers does not apply.
   */
  function stopBubble(event: Event): void {
    event.stopPropagation();
  }
</script>

{#if prompt && labels}
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <div
    class="kv-panel kv-line kv-prompt"
    data-label={prompt.kind}
    onclick={stopBubble}
    role="alertdialog"
    tabindex="-1"
  >
    <span class="kv-line__prompt">?</span>
    <span class="kv-prompt__text">{describePrompt(prompt)}</span>
    <span class="kv-prompt__hint">y/n</span>
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