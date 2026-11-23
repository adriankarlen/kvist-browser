<script lang="ts">
  import "./Slot.css";
  import type { Region } from "../../../shared/layout";
  import { layout } from "../../lib/stores.svelte";
  import { ELEMENTS, type SlotElement } from "./elements";

  let { id, region }: { id: SlotElement; region: Region } = $props();

  const Element = $derived(ELEMENTS[id]);
</script>

<!-- The size travels as a custom property, never as width or height, so
     config.css can still override the box itself. -->
<div class={["kv-slot", `kv-slot--${id}`]} style:--kv-layout-size={layout.size(id)}>
  <Element {region} />
</div>
