import { expect, test } from "vite-plus/test";
import { kindBadge, kindBadgeStyle } from "./badge";

test("kindBadge is the kind's first letter, lowercased, or a neutral fallback", () => {
  expect(kindBadge({})).toBe("\u2022");
  expect(kindBadge({ kind: "Bookmark" })).toBe("b");
  expect(kindBadge({ kind: "history" })).toBe("h");
});

test("kindBadgeStyle looks the colour up by kind name and tints the background from it", () => {
  expect(kindBadgeStyle({ kind: "bookmark" })).toBe(
    "color: var(--kv-completion-kind-bookmark-fg, var(--kv-completion-badge-fg)); " +
      "background: color-mix(in srgb, var(--kv-completion-kind-bookmark-fg, var(--kv-completion-badge-fg)) " +
      "var(--kv-completion-badge-tint), var(--kv-completion-bg))",
  );
});

test("kindBadgeStyle falls back to the default badge colour when there is no kind", () => {
  expect(kindBadgeStyle({})).toBe(
    "color: var(--kv-completion-badge-fg); " +
      "background: color-mix(in srgb, var(--kv-completion-badge-fg) " +
      "var(--kv-completion-badge-tint), var(--kv-completion-bg))",
  );
});

test("kindBadgeStyle rejects a kind that isn't a safe CSS token name", () => {
  // `kind` lands in a custom property *name*, where var()'s escaping does
  // nothing — this would otherwise close the declaration and inject CSS.
  expect(kindBadgeStyle({ kind: "x); background: url(http://evil" })).toBe(kindBadgeStyle({}));
});
