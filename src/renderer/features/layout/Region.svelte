<script lang="ts">
  import "./Region.css";
  import type { Region } from "../../../shared/layout";
  import { layout } from "../../lib/stores.svelte";
  import Slot from "./Slot.svelte";

  let { name }: { name: Region } = $props();

  // An empty box would still take a gap in the shell, so a region with
  // nothing to show is left out entirely.
  const shown = $derived(layout.elementsIn(name).filter((id) => layout.showing(id)));
</script>

{#if shown.length > 0}
  <div class={["kv-region", `is-${name}`]}>
    {#each shown as id (id)}
      <Slot {id} region={name} />
    {/each}
  </div>
{/if}
