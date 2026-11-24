<script lang="ts">
  import Setup from "./Setup.svelte";
  import { setup } from "./store.svelte";

  const choices = $derived(setup.model.choices);
  const options = $derived(setup.model.options);
</script>

{#if choices && options}
  <Setup model={setup.model} {choices} {options} />
{/if}
