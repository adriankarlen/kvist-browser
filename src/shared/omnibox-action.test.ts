import { expect, test, vi } from "vite-plus/test";
import { acceptOmnibox, omniboxCandidate } from "./omnibox-action";

const target = () => ({ navigate: vi.fn(), activate: vi.fn() });

test("a tab row carries its id as the value and its URL as the hint", () => {
  expect(
    omniboxCandidate({ label: "Docs", value: "https://docs.test/", kind: "tab", tabId: 7 }),
  ).toEqual({ label: "Docs", value: "7", kind: "tab", hint: "https://docs.test/" });
});

test("a bookmark row hints its URL; a history row does not", () => {
  expect(omniboxCandidate({ label: "Saved", value: "https://a.test/", kind: "bookmark" })).toEqual({
    label: "Saved",
    value: "https://a.test/",
    kind: "bookmark",
    hint: "https://a.test/",
  });

  expect(omniboxCandidate({ label: "Seen", value: "https://b.test/", kind: "history" })).toEqual({
    label: "Seen",
    value: "https://b.test/",
    kind: "history",
  });
});

test("accepting a tab row switches to the tab", () => {
  const to = target();

  acceptOmnibox({ label: "Docs", value: "7", kind: "tab", hint: "https://docs.test/" }, to);

  expect(to.activate).toHaveBeenCalledWith(7);
  expect(to.navigate).not.toHaveBeenCalled();
});

test("accepting any other row navigates to its value", () => {
  const to = target();

  acceptOmnibox({ label: "Saved", value: "https://a.test/", kind: "bookmark" }, to);

  expect(to.navigate).toHaveBeenCalledWith("https://a.test/");
  expect(to.activate).not.toHaveBeenCalled();
});
