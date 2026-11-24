<script lang="ts">
  import type { Attachment } from "svelte/attachments";
  import CompletionMenu from "../shared/completion/CompletionMenu.svelte";
  import type { CompletionCandidate } from "../shared/schema/completion";
  import { Msg } from "./overlay.program";
  import { overlay } from "./store.svelte";

  /**
   * Report the unrounded height so main need not model row styles.
   * Main retains the last height when the size stays unchanged.
   */
  const reportHeight: Attachment<HTMLElement> = (node) => {
    const report = (): void =>
      overlay.dispatch(Msg.cases.ListMeasured.make({ height: node.getBoundingClientRect().height }));

    const observer = new ResizeObserver(report);
    observer.observe(node);
    report();

    return () => observer.disconnect();
  };

  function accept(candidate: CompletionCandidate): void {
    overlay.dispatch(Msg.cases.RowClicked.make({ candidate }));
  }

  const state = $derived(overlay.model.state);
  const inset = $derived(overlay.model.inset);
</script>

<div
  class="kv-completion-slot"
  {@attach reportHeight}
  style:left="{inset?.left ?? 0}px"
  style:top={inset?.edge === "bottom" ? null : `${inset?.offset ?? 0}px`}
  style:bottom={inset?.edge === "bottom" ? `${inset.offset}px` : null}
  style:width={inset === null ? null : `${inset.width}px`}
>
  {#if state}
    <CompletionMenu candidates={state.candidates} index={state.index} onaccept={accept} />
  {/if}
</div>
