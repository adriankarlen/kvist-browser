import { initClock } from "./widgets/clock.js";
import { initLinks } from "./widgets/links.js";
import { initScratchpad } from "./widgets/scratchpad.js";

/** Scale the fixed-size dashboard to fit the window. */
function initScaling() {
  const container = document.getElementById("dashboard-container");
  const wrapper = document.getElementById("dashboard-wrapper");

  const handleScaling = () => {
    const scaleX = wrapper.clientWidth / container.offsetWidth;
    const scaleY = wrapper.clientHeight / container.offsetHeight;
    container.style.transform = `scale(${Math.min(scaleX, scaleY, 1)})`;
  };

  new ResizeObserver(handleScaling).observe(container);
  window.addEventListener("resize", handleScaling);
  handleScaling();
}

/** Space+key shortcuts: S = focus scratchpad. */
function initShortcuts(scratchpad) {
  let isSpacePressed = false;

  window.addEventListener("keydown", (e) => {
    const typing = e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA";
    if (e.code === "Space" && !typing) {
      e.preventDefault();
      isSpacePressed = true;
    }
    if (!isSpacePressed || typing) return;
    if (e.code === "KeyS") scratchpad.focus();
  });

  window.addEventListener("keyup", (e) => {
    if (e.code === "Space") isSpacePressed = false;
  });
}

initScaling();
initClock();
initLinks();
initShortcuts(initScratchpad());
