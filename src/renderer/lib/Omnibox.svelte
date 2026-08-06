<script lang="ts">
  import "./Omnibox.css";
  import { resolveUrl } from "../../shared/url";
  import { browser } from "./browser.svelte";
  import { ui } from "./settings.svelte";
  import { vim } from "./vim.svelte";

  let input = $state<HTMLInputElement>();
  let draft = $state("");
  let focused = $state(false);

  $effect(() => {
    const url = browser.active?.url ?? "";
    if (!focused) draft = url;
  });

  function submit(event: SubmitEvent): void {
    event.preventDefault();
    if (draft.trim() === "") return;
    window.kvist.navigate(resolveUrl(draft));
    input?.blur();
  }

  function onkeydown(event: KeyboardEvent): void {
    if (event.key !== "Escape") return;
    event.preventDefault();
    input?.blur();
  }

  // Main swallows keys from the chrome while in normal mode, so a mouse click
  // into the omnibox has to announce insert the same way "o" does.
  function onfocus(): void {
    focused = true;
    input?.select();
    window.kvist.setMode("insert");
  }

  function onblur(): void {
    focused = false;
    // The window going to the background also blurs the input. Dropping to
    // normal there would pull focus onto the page behind the user's back, so
    // only treat a blur as leaving the omnibox while the chrome still has it.
    if (document.hasFocus()) vim.toNormal();
  }

  window.kvist.onFocusOmnibox(() => input?.focus());
</script>

<form class="kv-panel kv-omnibox" data-label="url" onsubmit={submit}>
  <span class="kv-mode is-{vim.mode}">{vim.mode}</span>
  <button
    class="kv-omnibox__button"
    type="button"
    title="Back"
    disabled={!browser.active?.canGoBack}
    onclick={() => window.kvist.goBack()}>&lt;</button
  >
  <button
    class="kv-omnibox__button"
    type="button"
    title="Forward"
    disabled={!browser.active?.canGoForward}
    onclick={() => window.kvist.goForward()}>&gt;</button
  >
  <button
    class="kv-omnibox__button"
    type="button"
    title="Reload"
    onclick={() => window.kvist.reload()}>r</button
  >

  <span class="kv-omnibox__prompt">:</span>
  <input
    class="kv-omnibox__input"
    bind:this={input}
    bind:value={draft}
    spellcheck="false"
    autocomplete="off"
    placeholder="enter url or search"
    {onfocus}
    {onblur}
    {onkeydown}
  />

  <button
    class="kv-omnibox__button"
    type="button"
    title="Toggle tab orientation"
    onclick={() => ui.toggleTabOrientation()}>{ui.tabOrientation === "vertical" ? "—" : "|"}</button
  >
  <button
    class="kv-omnibox__button"
    type="button"
    title="DevTools"
    onclick={() => window.kvist.toggleDevTools()}>d</button
  >
</form>
