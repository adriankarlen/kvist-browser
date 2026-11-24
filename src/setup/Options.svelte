<script lang="ts" generics="V extends string">
  import type { Choice } from "./labels";

  let {
    name,
    legend,
    choices,
    value,
    onpick,
  }: {
    name: string;
    legend: string;
    choices: ReadonlyArray<Choice<V>>;
    value: V;
    onpick: (value: V) => void;
  } = $props();
</script>

<fieldset class="kv-setup__options">
  <legend class="kv-setup__legend">{legend}</legend>
  {#each choices as choice (choice.value)}
    <label class={["kv-setup__option", { "is-checked": choice.value === value }]}>
      <input
        class="kv-setup__radio"
        type="radio"
        {name}
        value={choice.value}
        checked={choice.value === value}
        onchange={() => onpick(choice.value)}
      />
      <span class="kv-setup__option-label">{choice.label}</span>
      {#if choice.hint}
        <span class="kv-setup__option-hint">{choice.hint}</span>
      {/if}
    </label>
  {/each}
</fieldset>
