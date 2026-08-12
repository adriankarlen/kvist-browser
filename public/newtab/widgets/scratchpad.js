const SCRATCHPAD_KEY = "dash_scratchpad";
const DEBOUNCE_MS = 300;

// Older builds stored the text JSON-encoded; read both shapes.
function load() {
  const raw = localStorage.getItem(SCRATCHPAD_KEY);
  if (raw === null) return "";
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

export function initScratchpad() {
  const area = document.getElementById("scratchpad-area");
  area.value = load();

  let timer;
  area.addEventListener("input", () => {
    clearTimeout(timer);
    timer = setTimeout(() => localStorage.setItem(SCRATCHPAD_KEY, area.value), DEBOUNCE_MS);
  });
}
