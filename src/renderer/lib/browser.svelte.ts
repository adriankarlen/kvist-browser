import type { BrowserState, KvistApi, Rect, TabState } from "../../shared/ipc";

export type Browser = ReturnType<typeof createBrowser>;

/** The tab strip's view of main, which is the whole of it: nothing is mirrored. */
export function createBrowser(bridge: Pick<KvistApi, "onState">) {
  const state = $state<BrowserState>({ tabs: [], activeId: null });

  bridge.onState((next) => {
    state.tabs = next.tabs;
    state.activeId = next.activeId;
  });

  return {
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
}

/**
 * Keeps main in sync with wherever the chrome leaves room for page content.
 * Reports the content box, not the border box: the tab's WebContentsView is a
 * native layer painted over this element, so it would cover any border or
 * padding included in the rectangle.
 */
export function createContentRect(bridge: Pick<KvistApi, "setContentRect">) {
  return (node: HTMLElement): { destroy: () => void } => {
    const report = (): void => {
      const box = node.getBoundingClientRect();
      const style = getComputedStyle(node);
      const padLeft = parseFloat(style.paddingLeft);
      const padTop = parseFloat(style.paddingTop);
      const rect: Rect = {
        x: Math.round(box.x + node.clientLeft + padLeft),
        y: Math.round(box.y + node.clientTop + padTop),
        width: Math.round(node.clientWidth - padLeft - parseFloat(style.paddingRight)),
        height: Math.round(node.clientHeight - padTop - parseFloat(style.paddingBottom)),
      };
      bridge.setContentRect(rect);
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
  };
}
