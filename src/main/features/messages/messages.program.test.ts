import { expect, test } from "vite-plus/test";
import { Cmd, init, Msg, say, update, warn } from "./messages.program";

test("a message stands and is logged", () => {
  const shown = update(warn("broken"), init);

  expect(shown.model.current).toEqual({ text: "broken", level: "error" });
  expect(shown.cmds).toEqual([
    Cmd.cases.LogMessage.make({ message: { text: "broken", level: "error" } }),
  ]);
});

test("a newer message replaces the one standing", () => {
  const first = update(say("one"), init).model;

  expect(update(say("two"), first).model.current?.text).toBe("two");
});

test("dismissing clears what is up, and is a no-op when nothing is", () => {
  const shown = update(say("hello"), init).model;

  expect(update(Msg.cases.MessageDismissed.make({}), shown).model.current).toBeNull();
  expect(update(Msg.cases.MessageDismissed.make({}), init).model).toBe(init);
});
