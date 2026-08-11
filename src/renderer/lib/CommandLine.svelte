<script lang="ts">
  import "./CommandLine.css";
  import { vim } from "./vim.svelte";

  let input = $state<HTMLInputElement>();
  let line = $state("");

  // Opening is driven by main switching mode, so focus follows the mode rather
  // than a click.
  $effect(() => {
    if (vim.mode === "command") {
      line = "";
      input?.focus();
    }
  });

  function onkeydown(event: KeyboardEvent): void {
    if (event.key !== "Escape") return;
    event.preventDefault();
    vim.toNormal();
  }

  function submit(event: SubmitEvent): void {
    event.preventDefault();
    window.kvist.runCommand(line);
  }
</script>

<form class="kv-panel kv-line kv-cmdline" data-label="cmd" onsubmit={submit}>
  <span class="kv-line__prompt">:</span>
  <input
    class="kv-line__input"
    bind:this={input}
    bind:value={line}
    spellcheck="false"
    autocomplete="off"
    {onkeydown}
  />
</form>
