// Intl only accepts IANA names, so "UTC±n" offsets are handled by hand.
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

/**
 * System time, or the [newtab] timezone from config.toml when set. Main
 * validates the configured value, so `timezone` is always safe to format.
 */
export async function initClock() {
  const clockEl = document.getElementById("clock");

  let timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  try {
    const config = await (await fetch("config.json")).json();
    timezone = config.timezone ?? timezone;
  } catch {
    // No config is not worth breaking the clock over.
  }

  const tick = () => {
    clockEl.textContent = formatTime(new Date(), timezone);
  };
  setInterval(tick, 1000);
  tick();
}
