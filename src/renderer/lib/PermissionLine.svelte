<script lang="ts">
  import "./PermissionLine.css";
  import { describePrompt, hostOf } from "./permissions.svelte";
  import { permissions } from "./stores.svelte";

  const prompt = $derived(permissions.current);
</script>

{#if prompt}
  <div class="kv-panel kv-line kv-permission" data-label="permission">
    <span class="kv-line__prompt">?</span>
    <span class="kv-permission__text">
      {hostOf(prompt.origin)} wants to {describePrompt(prompt)}
    </span>
    <span class="kv-permission__hint">y/n</span>
    <button
      class="kv-permission__answer is-allow"
      type="button"
      onclick={() => permissions.answer(true)}>allow</button
    >
    <button
      class="kv-permission__answer is-deny"
      type="button"
      onclick={() => permissions.answer(false)}>deny</button
    >
  </div>
{/if}
