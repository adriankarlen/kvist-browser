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

  new ResizeObserver(handleScaling).observe(wrapper);
  handleScaling();
}

initScaling();
void initClock();
void initLinks();
initScratchpad();
