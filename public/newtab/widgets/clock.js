import { loadConfig, saveConfig } from "../storage.js";

const UTC_RX = /^UTC\s*([+-])\s*(\d+)$/i;

function formatTime(date, timezone) {
  const m = timezone.match(UTC_RX);
  if (m) {
    const offset = (m[1] === "+" ? 1 : -1) * parseInt(m[2]) * 3600000;
    return new Date(date.getTime() + offset).toLocaleTimeString("en-GB", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      timeZone: "UTC",
    });
  }
  return date.toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    timeZone: timezone,
  });
}

function isValidTimezone(value) {
  if (UTC_RX.test(value)) return true;
  try {
    new Intl.DateTimeFormat("en", { timeZone: value }).format(new Date());
    return true;
  } catch {
    return false;
  }
}

export function initClock() {
  const clockEl = document.getElementById("clock");
  const timezoneInput = document.getElementById("timezone-input");
  const tzLabel = document.getElementById("clock-tz-label");

  let timezone = loadConfig().dash_timezone || Intl.DateTimeFormat().resolvedOptions().timeZone;
  if (loadConfig().dash_timezone) {
    timezoneInput.value = timezone;
    tzLabel.textContent = timezone.toUpperCase();
  }

  timezoneInput.addEventListener("input", () => {
    const val = timezoneInput.value.trim();
    if (!isValidTimezone(val)) {
      timezoneInput.style.color = "var(--kv-color-danger)";
      return;
    }
    timezone = val;
    timezoneInput.style.color = "var(--kv-color-text)";
    tzLabel.textContent = val.toUpperCase();
    saveConfig({ dash_timezone: timezone });
  });

  const tick = () => {
    try {
      clockEl.textContent = formatTime(new Date(), timezone);
    } catch {
      clockEl.textContent = new Date().toLocaleTimeString("en-GB");
    }
  };
  setInterval(tick, 1000);
  tick();
}
