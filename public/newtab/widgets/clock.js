// Intl only accepts IANA names, so "UTC±n" offsets are handled by hand.
const UTC_RX = /^UTC\s*([+-])\s*(\d+)$/i;

function formatTime(date, timezone, withSeconds = true) {
  const m = timezone.match(UTC_RX);
  const parts = { hour: "2-digit", minute: "2-digit", ...(withSeconds && { second: "2-digit" }) };

  if (m) {
    const offset = (m[1] === "+" ? 1 : -1) * parseInt(m[2]) * 3600000;

    return new Date(date.getTime() + offset).toLocaleTimeString("en-GB", {
      ...parts,
      timeZone: "UTC",
    });
  }

  return date.toLocaleTimeString("en-GB", { ...parts, timeZone: timezone });
}

function greeting(hour) {
  if (hour < 5) return "Good night";

  if (hour < 12) return "Good morning";

  if (hour < 18) return "Good afternoon";

  return "Good evening";
}

/**
 * System time, or the [newtab] timezone from config.toml when set. Main
 * validates the configured value, so `timezone` is always safe to format.
 */
export async function initClock() {
  const clockEl = document.getElementById("clock");
  const startClockEl = document.getElementById("start-clock");
  const greetingEl = document.getElementById("start-greeting");
  const dateEl = document.getElementById("start-date");

  let timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;

  try {
    const config = await (await fetch("config.json")).json();
    timezone = config.timezone ?? timezone;
  } catch {
    // No config is not worth breaking the clock over.
  }

  const tick = () => {
    const now = new Date();
    const short = formatTime(now, timezone, false);

    clockEl.textContent = formatTime(now, timezone);
    startClockEl.textContent = short;
    greetingEl.textContent = greeting(parseInt(short));
    dateEl.textContent = now.toLocaleDateString([], {
      weekday: "long",
      day: "numeric",
      month: "long",
    });
  };

  setInterval(tick, 1000);
  tick();
}
