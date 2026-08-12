const SCRATCHPAD_KEY = "dash_scratchpad";
const DEBOUNCE_MS = 300;

// Storage is always a JSON string; older builds stored the text bare, so a
// parse that yields anything but a string is legacy data, returned as-is.
function load() {
  const raw = localStorage.getItem(SCRATCHPAD_KEY);
  if (raw === null) return "";
  try {
    const parsed = JSON.parse(raw);
    return typeof parsed === "string" ? parsed : raw;
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
    localStorage.setItem(SCRATCHPAD_KEY, JSON.stringify(area.value));
  };
  area.addEventListener("input", () => {
    clearTimeout(timer);
    timer = setTimeout(flush, DEBOUNCE_MS);
  });
  // The debounce would otherwise lose the last few keystrokes on teardown.
  window.addEventListener("pagehide", flush);
}
