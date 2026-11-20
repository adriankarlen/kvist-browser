# anti-slop provenance

A vendored copy of [dmmulroy/anti-slop](https://github.com/dmmulroy/anti-slop),
from the `install-anti-slop` skill's `assets/anti-slop/` directory.

| | Commit | Where to find the pristine bytes |
|---|---|---|
| Current (incoming) | `13909c9e07590f5a85d93c62712259fe14a883f7` (2026-10-13) | `.agents/skills/install-anti-slop/assets/anti-slop/`, pinned in `skills-lock.json` |
| Previous base | `6d53855` (2026-08-18) | this repo at `b38cf42`, `.agents/skills/install-anti-slop/assets/anti-slop/` |

The next refresh follows `.agents/skills/install-anti-slop/references/update.md`,
using the current commit above as its base.

## Local deviations

Everything else is byte-identical to the incoming assets.

- Every file imports `vite-plus/lint/plugins` instead of `@oxlint/plugins`.
  Vite+ owns the oxlint pair in this repo.
- `rules/no-verbose-comments.ts`, `shared/verbose-comments.ts` and
  `verbose-comment-baseline.ts` are project-owned: the 40-word comment budget
  from `AGENTS.md`. `index.ts` registers `no-verbose-comments` in the generic
  plugin.

## Merge record (6d53855 → 13909c9)

Three-way merge. Base → local held only the two deviations above, so every
upstream change applied cleanly.

Adopted:

- Shared helpers `function-parameters.ts`, `type-alias-resolution.ts`,
  `scope.ts`, `array-method.ts`, and the fixes they bring to existing rules.
- Generic rules `no-array-filter-map`, `no-reduce-accumulator-copy`,
  `require-readable-spacing` (with `vendor/eslint-stylistic/`).
- Effect rules `no-manual-effect-error-tag`, `no-manual-tag-comparison`,
  `no-manual-tagged-construction`, `prefer-effect-match`.

Configuration (`vite.config.ts`): every new rule, the native companion
`oxc/no-accumulating-spread`, and the `anti-slop-effect` plugin with all five
rules, all at `error`. Oxlint comes from Vite+ 1.7.0 (oxlint 1.94.0;
upstream tests against 1.78.0).

Verification:

- All 24 upstream rule test files pass against the merged copy, run with
  `node` from a scratch copy that imports `vite-plus/lint/plugins`.
- A scratch source file with `switch (x._tag)`, a literal `{ _tag: "A" }`,
  `.filter().map()`, a spreading reducer and a 41-word comment is rejected by
  the matching rules.
- `require-readable-spacing --fix` followed by `vp fmt` is stable on a
  second pass.
