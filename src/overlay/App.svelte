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
   * Report the unrounded height so main need not model row styles.
   * Main retains the last height when the size stays unchanged.
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
