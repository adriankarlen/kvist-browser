import { homedir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vite-plus/test";
import { resolveDownloadDir, uniqueSavePath } from "./downloads-path";

const sources = { fallback: "/c", home: "/home/x" };

test("config wins over the environment, which wins over the fallback", () => {
  expect(resolveDownloadDir({ ...sources, configured: "/a", env: "/b" })).toBe("/a");
  expect(resolveDownloadDir({ ...sources, configured: undefined, env: "/b" })).toBe("/b");
  expect(resolveDownloadDir({ ...sources, configured: undefined, env: undefined })).toBe("/c");
});

test("an empty or blank setting is no setting at all", () => {
  expect(resolveDownloadDir({ ...sources, configured: "", env: "/b" })).toBe("/b");
  expect(resolveDownloadDir({ ...sources, configured: "  ", env: "" })).toBe("/c");
});

test("a fallback of the home directory itself becomes ~/Downloads", () => {
  expect(
    resolveDownloadDir({
      configured: undefined,
      env: undefined,
      fallback: "/home/x",
      home: "/home/x",
    }),
  ).toBe("/home/x/Downloads");
  // Only the fallback is corrected; an explicit answer of $HOME is the user's.
  expect(resolveDownloadDir({ ...sources, configured: "/home/x", env: undefined })).toBe("/home/x");
});

test("a leading ~ is expanded, since only a shell would have done it", () => {
  expect(resolveDownloadDir({ ...sources, configured: "~/dl", env: undefined })).toBe(
    join(homedir(), "dl"),
  );
  expect(resolveDownloadDir({ ...sources, configured: "~", env: undefined })).toBe(homedir());
  // Not a home reference — "~files" is a perfectly good directory name.
  expect(resolveDownloadDir({ ...sources, configured: "/a/~files", env: undefined })).toBe(
    "/a/~files",
  );
});

test("a free name is used as it is", () => {
  expect(uniqueSavePath("/dl", "notes.pdf", () => false)).toBe("/dl/notes.pdf");
});

test("a taken name counts up until one is free", () => {
  const taken = new Set(["/dl/notes.pdf", "/dl/notes-1.pdf"]);
  expect(uniqueSavePath("/dl", "notes.pdf", (path) => taken.has(path))).toBe("/dl/notes-2.pdf");
});

test("the suffix goes before the extension, and dotfiles keep theirs", () => {
  const taken = new Set(["/dl/archive.tar.gz", "/dl/.bashrc", "/dl/no-extension"]);
  const exists = (path: string): boolean => taken.has(path);
  expect(uniqueSavePath("/dl", "archive.tar.gz", exists)).toBe("/dl/archive.tar-1.gz");
  expect(uniqueSavePath("/dl", ".bashrc", exists)).toBe("/dl/.bashrc-1");
  expect(uniqueSavePath("/dl", "no-extension", exists)).toBe("/dl/no-extension-1");
});
