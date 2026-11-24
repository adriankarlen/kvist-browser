import { Schema } from "effect";
import { Rpc, RpcGroup } from "effect/rpc";
import { BrowserState, FindResult, Message, Mode, Rect, TabId } from "../schema/browser";
import {
  CompletionCandidate,
  CompletionOverlayState,
  OmniboxSuggestion,
} from "../schema/completion";
import { Bookmark } from "../schema/bookmarks";
import { UserConfig } from "../schema/config";
import { DownloadState } from "../schema/downloads";
import { PromptWire } from "../schema/prompts";

/** `#rrggbb`: the one colour format both CSS and `setBackgroundColor` read the same way. */
const HexColor = Schema.String.check(
  Schema.makeFilter((color: string) => /^#[0-9a-f]{6}$/.test(color)),
);

/** What main tells the chrome. State-like events are replayed to a new subscriber. */
export const ChromeEvent = Schema.TaggedUnion({
  StateChanged: { state: BrowserState },
  ConfigChanged: { config: UserConfig },
  ModeChanged: { mode: Mode },
  /** The chrome focuses its own omnibox input; main only moves window focus. */
  OmniboxFocusRequested: {},
  FindResultChanged: { result: Schema.NullOr(FindResult) },
  DownloadsChanged: { downloads: Schema.Array(DownloadState) },
  /** `:downloads` pinning the panel open, or letting it go again. */
  DownloadsToggled: {},
  MessageChanged: { message: Schema.NullOr(Message) },
  PromptChanged: { prompt: Schema.NullOr(PromptWire) },
  /** A row clicked in the completion overlay, relayed back to accept. */
  CompletionPicked: { candidate: CompletionCandidate },
  /** `:bookmarks`: open the panel with an empty filter. Main has already focused the chrome. */
  BookmarksOpenRequested: {},
  /** A bookmark was added or removed anywhere; an open panel asks for its rows again. */
  BookmarksChanged: {},
});

export type ChromeEvent = typeof ChromeEvent.Type;

/** What the chrome asks of main. */
export const ChromeIntent = Schema.TaggedUnion({
  ContentRectMeasured: { rect: Rect },
  /** What the chrome painted, so a resize shows the theme's colour before the next frame. */
  ChromeBackgroundMeasured: { color: HexColor },
  /** A typed `:` line; it ends in normal mode. */
  CommandEntered: { line: Schema.String },
  ModeRequested: { mode: Mode },
  TabRequested: { url: Schema.UndefinedOr(Schema.String) },
  TabCloseRequested: { id: TabId },
  TabActivated: { id: TabId },
  NavigationRequested: { url: Schema.String },
  BackRequested: {},
  ForwardRequested: {},
  ReloadRequested: {},
  DevToolsToggled: {},
  /** Restarts the search from the top; an empty query stops it. */
  FindRequested: { query: Schema.String },
  FindStopped: {},
  DownloadCancelRequested: { id: Schema.Int },
  BookmarkRemoveRequested: { id: Schema.Int },
  /** An answer for the prompt with this id; anything else is stale and ignored. */
  PromptAnswered: { id: Schema.Int, allow: Schema.Boolean },
  /** What the completion overlay should show, or null to close it. */
  CompletionOverlayChanged: { state: Schema.NullOr(CompletionOverlayState) },
});

export type ChromeIntent = typeof ChromeIntent.Type;

export class ChromeRpcs extends RpcGroup.make(
  Rpc.make("Subscribe", { success: ChromeEvent, stream: true }),
  Rpc.make("Dispatch", { payload: ChromeIntent }),
  Rpc.make("OmniboxSuggestions", {
    payload: { query: Schema.String },
    success: Schema.Array(OmniboxSuggestion),
  }),
  Rpc.make("CommandCompletions", {
    payload: { line: Schema.String },
    success: Schema.Array(CompletionCandidate),
  }),
  /** The bookmarks panel's rows for a filter; a blank filter lists them all. */
  Rpc.make("BookmarkRows", {
    payload: { query: Schema.String },
    success: Schema.Array(Bookmark),
  }),
) {}
