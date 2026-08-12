import { SCRATCHPAD_KEY, loadText, saveText } from "../storage.js";

export function initScratchpad() {
  const area = document.getElementById("scratchpad-area");
  area.value = loadText(SCRATCHPAD_KEY);
  area.addEventListener("input", () => saveText(SCRATCHPAD_KEY, area.value));

  return {
    focus: () => area.focus(),
  };
}
