import { expect, test } from "vite-plus/test";
import { urlBarChoices } from "./labels";

test("every supported URL-bar region is offered, with a plain label when none is written", () => {
  expect(urlBarChoices(["top", "floating", "left"])).toEqual([
    { value: "top", label: "Top", hint: "A bar above the page, always there." },
    {
      value: "floating",
      label: "Command palette",
      hint: "Hidden until summoned, then a floating box over the page.",
    },
    { value: "left", label: "Left", hint: "" },
  ]);
});
