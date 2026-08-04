import type { BrowserState, Rect, TabState } from "../../shared/ipc";

const state = $state<BrowserState>({ tabs: [], activeId: null });

window.kvist.onState((next) => {
  state.tabs = next.tabs;
  state.activeId = next.activeId;
});

export const browser = {
  get tabs(): TabState[] {
    return state.tabs;
  },
  get activeId(): number | null {
    return state.activeId;
  },
  get active(): TabState | undefined {
    return state.tabs.find((tab) => tab.id === state.activeId);
  },
};

/** Keeps the main process in sync with wherever the chrome leaves room for page content. */
export function contentRect(node: HTMLElement): { destroy: () => void } {
  const report = (): void => {
    const { x, y, width, height } = node.getBoundingClientRect();
    const rect: Rect = {
      x: Math.round(x),
      y: Math.round(y),
      width: Math.round(width),
      height: Math.round(height),
    };
    window.kvist.setContentRect(rect);
  };

  const observer = new ResizeObserver(report);
  observer.observe(node);
  window.addEventListener("resize", report);
  report();

  return {
    destroy() {
      observer.disconnect();
      window.removeEventListener("resize", report);
    },
  };
}
