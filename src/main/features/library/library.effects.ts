import { Effect } from "effect";
import type { Interpret } from "../../../shared/tea/store";
import { BookmarksRepo } from "../../services/bookmarks-repo";
import { HistoryRepo } from "../../services/history-repo";
import { SessionRepo } from "../../services/session-repo";
import { ZoomRepo } from "../../services/zoom-repo";
import { type Msg as MessagesMsg, say, warn } from "../messages/messages.program";
import { Cmd, Msg } from "./library.program";

type Services = HistoryRepo | BookmarksRepo | SessionRepo | ZoomRepo;

const reloadBookmarks = (dispatch: (msg: Msg) => void) =>
  Effect.flatMap(Effect.service(BookmarksRepo), (repo) =>
    Effect.map(repo.urls, (urls) =>
      dispatch(Msg.cases.BookmarksChanged.make({ bookmarked: [...urls] })),
    ),
  );

export const interpret: Interpret<Msg | MessagesMsg, Cmd, never, Services> = (cmd, dispatch) =>
  Cmd.match(cmd, {
    RecordVisit: ({ url, at }) =>
      Effect.flatMap(Effect.service(HistoryRepo), (repo) =>
        Effect.asVoid(repo.record({ url, title: url, visitedAt: at })),
      ),
    AddBookmark: ({ url, title }) =>
      Effect.gen(function* () {
        const added = yield* (yield* BookmarksRepo).add({ url, title });

        dispatch(added ? say(`bookmarked ${title}`) : warn(`cannot bookmark ${url}`));
        yield* reloadBookmarks(dispatch);
      }),
    RemoveBookmarks: ({ url }) =>
      Effect.gen(function* () {
        yield* (yield* BookmarksRepo).removeUrl(url);
        yield* reloadBookmarks(dispatch);
      }),
    RemoveBookmark: ({ id }) =>
      Effect.gen(function* () {
        const repo = yield* BookmarksRepo;
        const row = yield* repo.get(id);

        if (row !== null && (yield* repo.remove(id)))
          dispatch(say(`removed bookmark ${row.title}`));
        yield* reloadBookmarks(dispatch);
      }),
    SaveZoom: ({ origin, level }) =>
      Effect.flatMap(Effect.service(ZoomRepo), (repo) => repo.set(origin, level)),
    SaveSession: ({ state, at }) =>
      Effect.flatMap(Effect.service(SessionRepo), (repo) =>
        Effect.asVoid(repo.save({ ...state, tabs: [...state.tabs] }, at)),
      ),
    ClearSession: () => Effect.flatMap(Effect.service(SessionRepo), (repo) => repo.clear),
  });
