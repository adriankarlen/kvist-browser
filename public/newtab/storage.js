/**
 * localStorage persistence for the dashboard. All keys live here so the
 * widgets agree on what exists.
 */

export const CONFIG_KEY = "dash_config";
export const LINKS_KEY = "dash_links";
export const SCRATCHPAD_KEY = "dash_scratchpad";

function debounce(fn, timeout = 500) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), timeout);
  };
}

/** Dashboard settings (timezone) as one JSON object. */
export function loadConfig() {
  try {
    return JSON.parse(localStorage.getItem(CONFIG_KEY) || "{}");
  } catch {
    return {};
  }
}

export const saveConfig = debounce((patch) => {
  localStorage.setItem(CONFIG_KEY, JSON.stringify({ ...loadConfig(), ...patch }));
}, 300);

/** JSON-valued keys (links). */
export function loadJSON(key, fallback) {
  const raw = localStorage.getItem(key);
  return raw ? JSON.parse(raw) : fallback;
}

export const saveJSON = debounce((key, value) => {
  localStorage.setItem(key, JSON.stringify(value));
});

/** Plain-text keys (scratchpad). */
export function loadText(key) {
  return localStorage.getItem(key) || "";
}

export const saveText = debounce((key, text) => {
  localStorage.setItem(key, text);
});
