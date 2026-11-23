<script lang="ts">
  import type { Attachment } from "svelte/attachments";
  import "./Palette.css";
  import CompletionMenu from "../shared/completion/CompletionMenu.svelte";
  import {
    createCompletion,
    handleCompletionKey,
    type Candidate,
  } from "../shared/completion/completion.svelte";
  import { omniboxCandidate } from "../shared/omnibox-action";
  import { commandOf, Msg, type Opening } from "./palette.program";
  import { palette } from "./store.svelte";

  let { opening }: { opening: Opening } = $props();
  let input = $state<HTMLInputElement>();
  let draft = $state("");
  let pending: ReturnType<typeof setTimeout> | undefined;

  const command = $derived(commandOf(draft));

  // selectFirst: false, as in the omnibox: a bare Enter submits what was typed.
  const completion = createCompletion(
    async (query) => {
      const line = commandOf(query);

      if (line !== null) return palette.commandCompletions(line);

      return (await palette.suggestions(query)).map(omniboxCandidate);
    },
    { selectFirst: false },
  );

  function startOver(text: string, field: HTMLInputElement): void {
    clearTimeout(pending);
    completion.close();
    draft = text;
    field.value = text;
    field.focus();

    // A URL is selected so typing replaces it; a bare colon waits for a command.
    if (commandOf(text) === null) field.select();
    else field.setSelectionRange(text.length, text.length);
  }

  // Main bumps `seq` on every summon, so each opening is a new object and
  // the attachment runs again.
  const startsFrom =
    (start: Opening): Attachment<HTMLInputElement> =>
    (field) =>
      startOver(start.text, field);

  // Commands are listed locally and answer at once; history is a database
  // query, so it waits for a pause in the typing.
  function oninput(): void {
    clearTimeout(pending);
    const query = draft;

    if (query.trim() === "") {
      completion.close();

      return;
    }

    if (commandOf(query) !== null) {
      void completion.update(query);

      return;
    }

    pending = setTimeout(() => void completion.update(query), 75);
  }

  function dismiss(): void {
    clearTimeout(pending);
    completion.close();
    palette.dispatch(Msg.cases.DismissRequested.make({}));
  }

  // A command completes into the line and leaves the caret for an argument.
  function accept(candidate: Candidate): void {
    completion.close();

    if (command !== null) {
      draft = `:${candidate.value} `;
      input?.focus();

      return;
    }

    palette.dispatch(Msg.cases.RowAccepted.make({ candidate }));
  }

  function submit(event: SubmitEvent): void {
    event.preventDefault();
    clearTimeout(pending);
    completion.close();
    palette.dispatch(Msg.cases.DraftSubmitted.make({ draft }));
  }

  function onkeydown(event: KeyboardEvent): void {
    // Escape leaves at once, list or no list.
    if (event.key === "Escape") {
      event.preventDefault();
      dismiss();

      return;
    }

    if (handleCompletionKey(completion, event, accept)) return;

    // Tab only ever completes; there is nothing else here to move focus to.
    if (event.key === "Tab") event.preventDefault();
  }

  function onBackdrop(event: MouseEvent): void {
    if (event.target === event.currentTarget) dismiss();
  }
</script>

<div class="kv-palette" role="presentation" onmousedown={onBackdrop}>
  <form
    class={["kv-panel", "kv-palette__panel", { "is-command": command !== null }]}
    data-label={command === null ? "open" : "cmd"}
    style:--kv-layout-size={opening.size}
    onsubmit={submit}
  >
    <input
      class="kv-palette__input"
      bind:this={input}
      {@attach startsFrom(opening)}
      bind:value={draft}
      spellcheck="false"
      autocomplete="off"
      placeholder="url, search, tab, or :command"
      {oninput}
      {onkeydown}
    />
    <CompletionMenu candidates={completion.candidates} index={completion.index} onaccept={accept} />
  </form>
</div>
