import { expect, test, vi } from "vite-plus/test";
import type { Rect } from "../shared/schema/browser";
import type { SetupOptions } from "../shared/setup";
import { type SetupLease, SetupOverlay, type SetupView } from "./setup-overlay";

const bounds: Rect = { x: 0, y: 40, width: 1000, height: 700 };

const options: SetupOptions = {
  recipes: [
    { id: "tui", name: "tui", description: "", inputMode: "vim", omnibox: "top", tabs: "top" },
  ],
  recipe: "tui",
  omniboxRegions: ["top", "floating"],
  tabsRegions: ["top"],
  densityAvailable: true,
  searchUrl: "https://duckduckgo.com/?q={q}",
};

const view = (changes: Partial<SetupView> = {}): SetupView => ({
  open: true,
  seq: 1,
  options,
  saving: false,
  error: undefined,
  bounds,
  ...changes,
});

/** One fake wizard view that logs, in order, everything done to it. */
function createLease() {
  const listeners = new Map<string, (() => void)[]>();
  const log: string[] = [];

  const webContents = {
    once: (event: string, listener: () => void) => {
      listeners.set(event, [...(listeners.get(event) ?? []), listener]);

      return webContents;
    },
    isDestroyed: () => false,
    focus: () => void log.push("focus"),
  };

  const lease = {
    host: {
      // SAFETY: a trimmed stand-in; the overlay only touches the members above.
      webContents: webContents as unknown as SetupLease["host"]["webContents"],
      setVisible: (visible: boolean) => void log.push(`visible ${visible}`),
      setBounds: (rect: Rect) => void log.push(`bounds ${rect.width}x${rect.height}`),
    },
    link: {
      opened: (seq: number) => void log.push(`opened ${seq}`),
      status: (saving: boolean, error: string | undefined) =>
        void log.push(`status ${saving} ${error ?? "-"}`),
      css: (css: string) => void log.push(`css ${css}`),
    },
    release: vi.fn(() => void log.push("release")),
  };

  const crash = () => {
    for (const listener of listeners.get("render-process-gone")?.splice(0) ?? []) listener();
  };

  return { lease, log, crash };
}

function setup() {
  const leases: ReturnType<typeof createLease>[] = [];

  const open = vi.fn(() => {
    const created = createLease();
    leases.push(created);

    return created.lease;
  });

  const overlay = new SetupOverlay(open, () => "a{}");

  return { overlay, open, leases };
}

test("a closed wizard never builds a view", () => {
  const { overlay, open } = setup();

  overlay.render(view({ open: false }));

  expect(open).not.toHaveBeenCalled();
});

test("opening shows the view before sending anything, then focuses it", () => {
  const { overlay, leases } = setup();

  overlay.render(view());

  expect(leases[0]!.log).toEqual([
    "css a{}",
    "bounds 1000x700",
    "visible true",
    "status false -",
    "opened 1",
    "focus",
  ]);
});

test("the view waits for the options before it opens", () => {
  const { overlay, leases } = setup();

  overlay.render(view({ options: null }));

  expect(leases[0]!.log).not.toContain("opened 1");

  overlay.render(view());

  expect(leases[0]!.log).toContain("opened 1");
});

test("a moved tab strip moves the view without reopening it, and status is sent on change", () => {
  const { overlay, leases } = setup();

  overlay.render(view());
  leases[0]!.log.length = 0;
  overlay.render(view({ bounds: { ...bounds, width: 800 } }));

  expect(leases[0]!.log).toEqual(["bounds 800x700", "visible true"]);

  overlay.render(view({ bounds: { ...bounds, width: 800 }, saving: true }));

  expect(leases[0]!.log.at(-1)).toBe("status true -");
});

test("closing releases the view for good", () => {
  const { overlay, leases } = setup();

  overlay.render(view());
  overlay.render(view({ open: false }));

  expect(leases[0]!.lease.release).toHaveBeenCalledTimes(1);
});

test("a crashed view is replaced and told to open again", () => {
  const { overlay, open, leases } = setup();

  overlay.render(view());
  leases[0]!.crash();

  expect(leases[0]!.lease.release).toHaveBeenCalled();

  overlay.render(view());

  expect(open).toHaveBeenCalledTimes(2);
  expect(leases[1]!.log).toContain("opened 1");
});
