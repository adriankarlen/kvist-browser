<script lang="ts">
  import "./CommandLine.css";
  import { completionGrow, elementDirection, type Region } from "../../shared/layout";
  import { completionOverlay, layout, vim, browse } from "./stores.svelte";
  import { createAnchor } from "./anchor.svelte";
  import { createCompletion, handleCompletionKey, type Candidate } from "./completion.svelte";

  let input = $state<HTMLInputElement>();
  let line = $state("");
  let { region }: { region: Region } = $props();

  const anchor = createAnchor();

  // selectFirst: false — a bare Enter runs what was typed, not the first match.
  const completion = createCompletion((query) => browse.commandCompletions(query), {
    selectFirst: false,
  });

  const overlay = completionOverlay.claim(accept);

  $effect(() => () => overlay.release());

  // Derived, so only entering command mode reruns the effect. Reading the mode
  // directly reran it on every model change, which stole focus back from the
  // bookmarks filter that `:bookmarks` opens.
  const commanding = $derived(vim.mode === "command");

  // Opening is driven by main switching mode, so focus follows the mode rather
  // than a click.
  $effect(() => {
    if (commanding) {
      line = "";
      input?.focus();
    }
  });

  // Rows are painted in main's overlay view, above the page, since chrome
  // HTML cannot overlap a tab. Snapshotted: a `$state` proxy cannot cross IPC.
  $effect(() => {
    const box = anchor.current;

    if (box === null || !completion.open || !layout.completionShown) {
      overlay.hide();

      return;
    }

    overlay.show({
      candidates: $state.snapshot(completion.candidates),
      index: completion.index,
      anchor: box,
      grow: completionGrow(region, box, window.innerHeight),
    });
  });

  // The trailing space leaves the caret ready for an argument, and ends the
  // command word so the list does not reopen over it.
  function accept(candidate: Candidate): void {
    completion.close();
    line = `${candidate.value} `;
    input?.focus();
  }

  function oninput(): void {
    if (line.trim() === "") completion.close();
    else void completion.update(line);
  }

  function onkeydown(event: KeyboardEvent): void {
    if (handleCompletionKey(completion, event, accept)) return;

    // Tab only ever completes here; moving focus off the line would strand
    // command mode with nothing to type into.
    if (event.key === "Tab") {
      event.preventDefault();

      return;
    }

    if (event.key !== "Escape") return;
    event.preventDefault();
    vim.toNormal();
  }

  function submit(event: SubmitEvent): void {
    event.preventDefault();
    browse.runCommand(line);
  }
</script>

<form
  class={["kv-panel", "kv-line", "kv-cmdline", `is-${elementDirection(region)}`]}
  data-label="cmd"
  onsubmit={submit}
  use:anchor.element
>
  <span class="kv-line__prompt">:</span>
  <input
    class="kv-line__input"
    bind:this={input}
    bind:value={line}
    spellcheck="false"
    autocomplete="off"
    {oninput}
    {onkeydown}
  />
</form>
