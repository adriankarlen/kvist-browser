<script lang="ts">
  import "./Region.css";
  import type { Region } from "../../../shared/layout";
  import { layout } from "../../lib/stores.svelte";
  import { isSlotElement } from "./elements";
  import Slot from "./Slot.svelte";

  let { name }: { name: Region } = $props();

  const placed = $derived(layout.elementsIn(name).filter(isSlotElement));
</script>

<div class={["kv-region", `is-${name}`]}>
  {#each placed as id (id)}
    <Slot {id} region={name} />
  {/each}
</div>
