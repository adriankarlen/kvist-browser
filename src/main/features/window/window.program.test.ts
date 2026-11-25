import { expect, test } from "vite-plus/test";
import { init, Msg, trafficLights, update } from "./window.program";

const slot = { x: 8, y: 8, width: 72, height: 32 };
const measured = update(Msg.cases.WindowControlsMeasured.make({ rect: slot }), init).model;

test("the traffic lights are centred in the slot the chrome keeps for them", () => {
  expect(trafficLights(measured, false)).toEqual({ visible: true, position: { x: 18, y: 18 } });
});

test("no slot, an empty one, or a full screen window hides them", () => {
  const gone = update(Msg.cases.WindowControlsMeasured.make({ rect: null }), measured).model;

  const empty = update(
    Msg.cases.WindowControlsMeasured.make({ rect: { ...slot, width: 0 } }),
    init,
  ).model;

  const hidden = { visible: false, position: null };

  expect(trafficLights(init, false)).toEqual(hidden);
  expect(trafficLights(gone, false)).toEqual(hidden);
  expect(trafficLights(empty, false)).toEqual(hidden);
  expect(trafficLights(measured, true)).toEqual(hidden);
});

test("the window says when it is maximized, for the restore button", () => {
  const maximized = update(Msg.cases.WindowMaximizedChanged.make({ maximized: true }), init);

  expect(maximized.model).toEqual({ maximized: true, controls: null });
});
