<script lang="ts">
  import { untrack } from "svelte";
  import type { Attachment } from "svelte/attachments";
  import { registerElement } from "../app/store.svelte";
  import "./Omnibox.css";
  import Icon from "../../shared/icons/Icon.svelte";
  import { completionGrow, elementDirection, type Region } from "../../shared/layout";
  import { acceptOmnibox, omniboxCandidate } from "../../shared/omnibox-action";
  import { resolveUrl } from "../../shared/url";
  import {
    browser,
    completionOverlay,
    downloads,
    keys,
    layout,
    ui,
    vim,
    browse,
  } from "./stores.svelte";
  import { createAnchor } from "./anchor.svelte";
  import { createCompletion, handleCompletionKey, type Candidate } from "../../shared/completion/completion.svelte";

  let { region }: { region: Region } = $props();
  let input = $state<HTMLInputElement>();
  let draft = $state("");
  let focused = $state(false);

  // The list lines up with the URL field when the field is drawn as a box of its own.
  const anchor = createAnchor(".kv-omnibox__field");

  const grow = $derived(
    anchor.current === null ? "down" : completionGrow(region, anchor.current, window.innerHeight),
  );

  $effect(() => {
    const url = browser.active?.url ?? "";

    if (!focused) draft = url;
  });

  // Suggestions follow the draft while the omnibox has focus; blurring or an
  // empty draft closes the list rather than leaving a stale query's answer
  // on screen. selectFirst: false — Enter submits the draft through
  // resolveUrl instead of accepting whatever suggestion ranked first.
  const completion = createCompletion(
    async (query) => (await browse.omniboxSuggestions(query)).map(omniboxCandidate),
    { selectFirst: false },
  );

  // The debounce keeps mid-word typing from firing an IPC request per
  // keystroke; the effect's cleanup cancels any timer a newer draft
  // superseded, and blurring or an empty draft closes the list outright.
  $effect(() => {
    if (!focused || draft.trim() === "") {
      completion.close();

      return;
    }

    const query = draft;
    const timer = setTimeout(() => void completion.update(query), 75);

    return () => clearTimeout(timer);
  });

  // A clicked row comes back through main: the overlay is a webContents of
  // its own, so its clicks cannot reach this document directly.
  // Derived, so the effect below reruns only when the setting flips. Read
  // straight from the model, every show would dispatch, replace the model,
  // and rerun the effect without end.
  const completionShown = $derived(layout.completionShown);

  const overlay = completionOverlay.claim((candidate) => {
    completion.close();
    acceptSuggestion(candidate);
  });

  $effect(() => () => overlay.release());

  /**
   * Mirrors the list to main, which paints it in an overlay view above the
   * page — chrome HTML can never overlap a tab's native layer, so the rows
   * cannot render here. Snapshotted: a `$state` proxy is not something IPC
   * can serialise.
   */
  $effect(() => {
    const box = anchor.current;

    if (!focused || box === null || !completion.open || !completionShown) {
      overlay.hide();

      return;
    }

    overlay.show({
      candidates: $state.snapshot(completion.candidates),
      index: completion.index,
      anchor: box,
      grow,
    });
  });

  // Zoom follows the active tab; the omnibox is just a mirror, so this is
  // a derived read of the snapshot. 1.2^level is what Electron's setZoomLevel
  // uses internally, so the rendered percentage is the same one the user sees
  // on the page.
  const zoom = $derived.by(() => {
    const level = browser.active?.zoomLevel ?? 0;

    return Math.round(100 * 1.2 ** level);
  });

  const downloading = $derived(downloads.list.some((entry) => entry.status === "progressing"));

  function submit(event: SubmitEvent): void {
    event.preventDefault();

    if (draft.trim() === "") return;
    browse.navigate(resolveUrl(draft, ui.searchUrl));
    input?.blur();
  }

  // A suggestion is already a concrete destination, not typed search text —
  // accepting one skips resolveUrl.
  function acceptSuggestion(candidate: Candidate): void {
    acceptOmnibox(candidate, { navigate: browse.navigate, activate: browse.activateTab });
    input?.blur();
  }

  function onkeydown(event: KeyboardEvent): void {
    if (handleCompletionKey(completion, event, acceptSuggestion, grow)) return;

    if (event.key !== "Escape") return;
    event.preventDefault();
    input?.blur();
  }

  // Main swallows keys from the chrome while in normal mode, so a mouse click
  // into the omnibox has to announce insert the same way "o" does.
  function onfocus(event: FocusEvent & { currentTarget: HTMLInputElement }): void {
    focused = true;
    event.currentTarget.select();
    browse.setMode("insert");
  }

  function onblur(): void {
    focused = false;
  }

  // Focus moving between the bar's own controls is not leaving it.
  function onfocusout(event: FocusEvent & { currentTarget: HTMLFormElement }): void {
    const to = event.relatedTarget;

    if (to instanceof Node && event.currentTarget.contains(to)) return;
    // Every exit, even the window's: a click on the page would otherwise
    // leave a summoned bar up with nothing to dismiss it.
    layout.omniboxDismissed();

    // The window going to the background also blurs the input. Dropping to
    // normal there would pull focus onto the page behind the user's back, so
    // only treat a blur as leaving the omnibox while the chrome still has it.
    if (document.hasFocus()) vim.toNormal();
  }

  // A button click blurs the input first, which would dismiss a summoned bar
  // before the click lands. macOS never focuses the button, so keep the input's.
  function keepSummoned(event: MouseEvent): void {
    if (layout.omniboxHidden) event.preventDefault();
  }

  // Main asks for focus with a Cmd, which runs before a hidden omnibox has
  // rendered. So a summoned one focuses itself as it appears.
  const focusable: Attachment<HTMLInputElement> = (node) => {
    if (untrack(() => layout.omniboxHidden)) node.focus();

    return registerElement("omnibox", node);
  };
</script>

{#if layout.omniboxShown}
  <form
    class={["kv-panel", "kv-omnibox", `is-${elementDirection(region)}`]}
    data-label="url"
    onsubmit={submit}
    {onfocusout}
    use:anchor.element
  >
    {#if vim.enabled}
      <span class="kv-mode is-{vim.mode}">{vim.mode}</span>
    {/if}
    <button
      class="kv-omnibox__button"
      type="button"
      onmousedown={keepSummoned}
      title={keys.title("Back", "nav.back")}
      disabled={!browser.active?.canGoBack}
      onclick={() => browse.goBack()}><Icon role="back" glyph="<" /></button
    >
    <button
      class="kv-omnibox__button"
      type="button"
      onmousedown={keepSummoned}
      title={keys.title("Forward", "nav.forward")}
      disabled={!browser.active?.canGoForward}
      onclick={() => browse.goForward()}><Icon role="forward" glyph=">" /></button
    >
    <button
      class="kv-omnibox__button"
      type="button"
      onmousedown={keepSummoned}
      title={keys.title("Reload", "nav.reload")}
      onclick={() => browse.reload()}><Icon role="reload" glyph="r" /></button
    >

    <div class="kv-omnibox__field">
      <span class="kv-omnibox__prompt"><Icon role="search" glyph=":" /></span>
      <input
        class="kv-omnibox__input"
        bind:this={input}
        {@attach focusable}
        bind:value={draft}
        spellcheck="false"
        autocomplete="off"
        placeholder="enter url or search"
        {onfocus}
        {onblur}
        {onkeydown}
      />
      <button
        class="kv-omnibox__bookmark"
        class:is-bookmarked={browser.active?.bookmarked}
        type="button"
        onmousedown={keepSummoned}
        title={keys.title(browser.active?.bookmarked ? "Remove bookmark" : "Bookmark this page", "bookmark.toggle")}
        aria-label="Bookmark this page"
        aria-pressed={browser.active?.bookmarked ?? false}
        onclick={() => browse.runCommand("bookmark.toggle")}
        >{#if browser.active?.bookmarked}<Icon role="bookmarked" glyph="*" />{:else}<Icon
            role="bookmark"
            glyph="*"
          />{/if}</button
      >
      <span class="kv-omnibox__zoom" class:is-default={zoom === 100} title={keys.title("zoom", "zoom.in", "zoom.out", "zoom.reset")}>{zoom}%</span>
    </div>

    <div class="kv-omnibox__actions">
      <button
        class="kv-omnibox__button"
        class:is-busy={downloading}
        type="button"
        onmousedown={keepSummoned}
        title={keys.title("Downloads", "downloads.toggle")}
        onclick={() => browse.runCommand("downloads.toggle")}><Icon role="downloads" glyph="v" /></button
      >
      <button
        class="kv-omnibox__button"
        type="button"
        onmousedown={keepSummoned}
        title={keys.title("Bookmarks", "bookmarks.open")}
        onclick={() => browse.runCommand("bookmarks.open")}><Icon role="bookmarks" glyph="b" /></button
      >
    </div>

    <button
      class="kv-omnibox__button kv-omnibox__devtools"
      type="button"
      onmousedown={keepSummoned}
      title={keys.title("DevTools", "app.devtools")}
      onclick={() => browse.toggleDevTools()}><Icon role="devtools" glyph="d" /></button
    >
  </form>
{/if}
