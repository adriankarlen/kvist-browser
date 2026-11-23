import { Schema } from "effect";

/** One saved bookmark: the database row and the wire row are the same shape. */
export const Bookmark = Schema.Struct({
  id: Schema.Int,
  url: Schema.String,
  title: Schema.String,
  /** Epoch milliseconds. */
  createdAt: Schema.Int,
});

export type Bookmark = typeof Bookmark.Type;
