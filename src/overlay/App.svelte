<script lang="ts">
  import type { Attachment } from "svelte/attachments";
  import CompletionMenu from "./CompletionMenu.svelte";
  import { injectUserCss } from "../shared/inject-css";
  import type {
    CompletionCandidate,
    CompletionInset,
    CompletionOverlayState,
  } from "../shared/ipc";

  // Raw, not deep: the list is replaced wholesale on every push, and a
  // `$state` proxy cannot cross IPC — structured clone rejects it, so a
  // clicked row would never reach the chrome.
  let state = $state.raw<CompletionOverlayState | null>(null);
  /**
   * Where main wants the list drawn inside the view it sized. The view's
   * bounds are whole pixels and the omnibox is not, so the last fraction of
   * the alignment is done here, where CSS can still address it.
   */
  let inset = $state.raw<CompletionInset | null>(null);

  window.kvistOverlay.onCompletionState((next) => {
    state = next;
  });
  window.kvistOverlay.onCompletionInset((next) => {
    inset = next;
  });
  window.kvistOverlay.onCompletionCss((css) => injectUserCss(css));

  /**
   * Reports how tall the list rendered. Main sizes this view from the answer,
   * because the height follows the row count and the styling — neither of
   * which main should have to model. Unrounded, for the same reason the
   * anchor is: a rounded height puts the bottom border a pixel out.
   *
   * Nothing is reported when a new list happens to be exactly as tall as the
   * one it replaced. That is correct rather than a gap: main keeps the last
   * height it was told, and an unchanged height needs no correction.
   */
  const reportHeight: Attachment<HTMLElement> = (node) => {
    const report = (): void =>
      window.kvistOverlay.completionHeight(node.getBoundingClientRect().height);
    const observer = new ResizeObserver(report);
    observer.observe(node);
    report();
    return () => observer.disconnect();
  };

  function accept(candidate: CompletionCandidate): void {
    window.kvistOverlay.completionPick(candidate);
  }
</script>

<div
  class="kv-completion-slot"
  {@attach reportHeight}
  style:left="{inset?.left ?? 0}px"
  style:top="{inset?.top ?? 0}px"
  style:width={inset === null ? null : `${inset.width}px`}
>
  {#if state}
    <CompletionMenu candidates={state.candidates} index={state.index} onaccept={accept} />
  {/if}
</div>
