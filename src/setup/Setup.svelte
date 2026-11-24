<script lang="ts">
  import type { Attachment } from "svelte/attachments";
  import "./Setup.css";
  import { SEARCH_ENGINES, type SetupChoices, type SetupOptions } from "../shared/setup";
  import Options from "./Options.svelte";
  import {
    DENSITY_CHOICES,
    INPUT_MODES,
    regionLabel,
    STEP_TITLES,
    tabChoices,
    urlBarChoices,
    type Choice,
  } from "./labels";
  import { Msg, type Model, STEPS, stepOf } from "./setup.program";
  import { setup } from "./store.svelte";

  let {
    model,
    choices,
    options,
  }: { model: Model; choices: SetupChoices; options: SetupOptions } = $props();

  const CUSTOM = "custom";

  const step = $derived(stepOf(model));
  const last = $derived(model.step === STEPS.length - 1);

  const recipes = $derived<ReadonlyArray<Choice<string>>>(
    options.recipes.map((recipe) => ({
      value: recipe.id,
      label: recipe.name,
      hint: recipe.description,
    })),
  );

  const engines: ReadonlyArray<Choice<string>> = [
    ...SEARCH_ENGINES.map((engine) => ({ value: engine.url, label: engine.name, hint: "" })),
    { value: CUSTOM, label: "Custom", hint: 'Any URL with "{q}" where the query goes.' },
  ];

  const recipeName = $derived(
    options.recipes.find((recipe) => recipe.id === choices.recipe)?.name ?? choices.recipe,
  );

  const engineName = $derived(
    SEARCH_ENGINES.find((engine) => engine.url === choices.searchUrl)?.name ?? choices.searchUrl,
  );

  const densityName = $derived(
    DENSITY_CHOICES.find((choice) => choice.value === choices.density)?.label ?? choices.density,
  );

  const send = setup.dispatch;

  function pickEngine(value: string): void {
    send(
      value === CUSTOM
        ? Msg.cases.CustomSearchChosen.make({})
        : Msg.cases.EnginePicked.make({ url: value }),
    );
  }

  // The step's body is rebuilt on every step change, so this runs once per step.
  const focusFirst: Attachment<HTMLElement> = (body) => {
    const target =
      body.querySelector<HTMLElement>("input:checked") ??
      body.querySelector<HTMLElement>("input, button");

    target?.focus();
  };

  function onsubmit(event: SubmitEvent): void {
    event.preventDefault();
    send(Msg.cases.NextRequested.make({}));
  }

  // The document is only the wizard. Enter moves on from anywhere but a button, which it presses.
  function onkeydown(event: KeyboardEvent): void {
    // Enter and Escape belong to an input method while it is composing.
    if (event.isComposing) return;

    if (event.key === "Escape") {
      event.preventDefault();
      send(Msg.cases.BackRequested.make({}));

      return;
    }

    if (event.key === "Enter" && !(event.target instanceof HTMLButtonElement)) {
      event.preventDefault();
      send(Msg.cases.NextRequested.make({}));
    }
  }
</script>

<svelte:window {onkeydown} />

<div class="kv-setup">
  <form
    class="kv-panel kv-setup__panel"
    data-label="setup {model.step + 1}/{STEPS.length}"
    aria-labelledby="kv-setup-title"
    {onsubmit}
  >
    <h1 id="kv-setup-title" class="kv-setup__title" aria-live="polite">
      {STEP_TITLES[step]}
    </h1>

    {#key model.step}
      <div class="kv-setup__body" {@attach focusFirst}>
        {#if step === "recipe"}
          <p class="kv-setup__intro">
            A recipe sets the whole look. Everything after this starts from it, and the chrome
            around this box shows each choice as you make it.
          </p>
          <Options
            name="recipe"
            legend="Recipe"
            choices={recipes}
            disabled={model.saving}
            value={choices.recipe}
            onpick={(id) => send(Msg.cases.RecipePicked.make({ id }))}
          />
        {:else if step === "input"}
          <Options
            name="input"
            legend="Keys"
            choices={INPUT_MODES}
            disabled={model.saving}
            value={choices.inputMode}
            onpick={(mode) => send(Msg.cases.InputModePicked.make({ mode }))}
          />
        {:else if step === "urlbar"}
          <Options
            name="urlbar"
            legend="URL bar"
            choices={urlBarChoices(options.omniboxRegions)}
            disabled={model.saving}
            value={choices.omnibox}
            onpick={(region) => send(Msg.cases.OmniboxPicked.make({ region }))}
          />
        {:else if step === "tabs"}
          <Options
            name="tabs"
            legend="Tabs"
            choices={tabChoices(options.tabsRegions)}
            disabled={model.saving}
            value={choices.tabs}
            onpick={(region) => send(Msg.cases.TabsPicked.make({ region }))}
          />
          {#if options.densityAvailable}
            <Options
              name="density"
              legend="Density"
              choices={DENSITY_CHOICES}
              disabled={model.saving}
              value={choices.density}
              onpick={(density) => send(Msg.cases.DensityPicked.make({ density }))}
            />
          {:else}
            <p class="kv-setup__note">
              Density is set with <code>--kv-density</code> in your config.css.
            </p>
          {/if}
        {:else if step === "search"}
          <Options
            name="search"
            legend="Search with"
            choices={engines}
            disabled={model.saving}
            value={model.customSearch ? CUSTOM : choices.searchUrl}
            onpick={pickEngine}
          />
          {#if model.customSearch}
            <label class="kv-setup__field">
              <span class="kv-setup__field-label">Search URL</span>
              <input
                class="kv-setup__input"
                type="url"
                disabled={model.saving}
                value={choices.searchUrl}
                spellcheck="false"
                autocomplete="off"
                placeholder="https://example.com/search?q={'{q}'}"
                oninput={(event) =>
                  send(Msg.cases.SearchTyped.make({ url: event.currentTarget.value }))}
              />
            </label>
          {/if}
        {:else}
          <dl class="kv-setup__summary">
            <dt>Recipe</dt>
            <dd>{recipeName}</dd>
            <dt>Keys</dt>
            <dd>{choices.inputMode === "vim" ? "Vim" : "Standard"}</dd>
            <dt>URL bar</dt>
            <dd>{regionLabel(choices.omnibox)}</dd>
            <dt>Tabs</dt>
            <dd>{regionLabel(choices.tabs)}</dd>
            {#if options.densityAvailable}
              <dt>Density</dt>
              <dd>{densityName}</dd>
            {/if}
            <dt>Search</dt>
            <dd>{engineName}</dd>
          </dl>
          <p class="kv-setup__intro">
            Finish writes these to config.toml in your config directory. It is plain text: edit it
            any time, and Kvist reloads it on save.
          </p>
        {/if}
      </div>
    {/key}

    {#if model.error}
      <p class="kv-setup__error" role="alert">{model.error}</p>
    {/if}

    <div class="kv-setup__actions">
      <button
        class="kv-setup__button kv-setup__skip"
        type="button"
        disabled={model.saving}
        onclick={() => send(Msg.cases.SkipRequested.make({}))}
      >
        Skip
      </button>
      <span class="kv-setup__keys">Enter next · Esc back</span>
      <button
        class="kv-setup__button"
        type="button"
        disabled={model.step === 0 || model.saving}
        onclick={() => send(Msg.cases.BackRequested.make({}))}
      >
        Back
      </button>
      <button class="kv-setup__button is-primary" type="submit" disabled={model.saving}>
        {last ? "Finish" : "Next"}
      </button>
    </div>
  </form>
</div>
