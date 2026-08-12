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
  const flush = () => {
    clearTimeout(timer);
    localStorage.setItem(SCRATCHPAD_KEY, area.value);
  };
  area.addEventListener("input", () => {
    clearTimeout(timer);
    timer = setTimeout(flush, DEBOUNCE_MS);
  });
  // The debounce would otherwise lose the last few keystrokes on teardown.
  window.addEventListener("pagehide", flush);
}
