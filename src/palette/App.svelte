<script lang="ts">
  import Palette from "./Palette.svelte";
  import { palette } from "./store.svelte";

  const opening = $derived(palette.model.opening);
</script>

{#if opening}
  <Palette {opening} />
{/if}
