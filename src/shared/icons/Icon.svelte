<script lang="ts">
  import "./Icon.css";
  import { iconToken, type IconRole } from "./roles";

  /**
   * `glyph` is what a glyph-styled recipe shows; `role` or `image` is the
   * picture an image-styled one shows instead. `image` is any CSS image, for
   * a picture chosen at runtime.
   */
  type Props = { glyph: string } & ({ role: IconRole } | { image: string });

  let props: Props = $props();

  const image = $derived("role" in props ? `var(${iconToken(props.role)})` : props.image);
</script>

<span class="kv-icon" style:--kv-icon-image={image} aria-hidden="true">{props.glyph}</span>
