/**
 * Each icon the chrome draws, by the job it does, and the Lucide icon that
 * does it. A role becomes the `--kv-icon-<role>` token, so a recipe or
 * config.css swaps the picture without touching markup.
 */
export const ICON_ROLES = {
  close: { lucide: "x" },
  "new-tab": { lucide: "plus" },
  back: { lucide: "arrow-left" },
  forward: { lucide: "arrow-right" },
  reload: { lucide: "rotate-cw" },
  bookmark: { lucide: "bookmark" },
  bookmarked: { lucide: "bookmark", fill: true },
  devtools: { lucide: "code-xml" },
  downloads: { lucide: "download" },
  bookmarks: { lucide: "library-big" },
  search: { lucide: "search" },
  find: { lucide: "text-search" },
  command: { lucide: "chevron-right" },
  filter: { lucide: "list-filter" },
  page: { lucide: "globe" },
  loading: { lucide: "loader-circle" },
  delete: { lucide: "trash-2" },
  message: { lucide: "info" },
  "message-error": { lucide: "circle-alert" },
  question: { lucide: "circle-question-mark" },
  radio: { lucide: "circle" },
  "radio-checked": { lucide: "circle-dot" },
  "download-progressing": { lucide: "arrow-down" },
  "download-paused": { lucide: "pause" },
  "download-completed": { lucide: "check" },
  "download-cancelled": { lucide: "x" },
  "download-interrupted": { lucide: "circle-alert" },
  "kind-tab": { lucide: "app-window" },
  "kind-bookmark": { lucide: "bookmark" },
  "kind-history": { lucide: "history" },
  "kind-command": { lucide: "square-chevron-right" },
  "kind-alias": { lucide: "corner-down-right" },
  "kind-default": { lucide: "dot" },
  minimize: { lucide: "minus" },
  maximize: { lucide: "square" },
  restore: { lucide: "copy" },
  "window-close": { lucide: "x" },
} as const satisfies Record<string, { readonly lucide: string; readonly fill?: boolean }>;

export type IconRole = keyof typeof ICON_ROLES;

/** The token a role is drawn from. */
export const iconToken = (role: IconRole): string => `--kv-icon-${role}`;
