import { expect, test, vi } from "vite-plus/test";
import type { Rect } from "../shared/schema/browser";
import { type PaletteLease, PaletteOverlay, type PaletteView } from "./palette-overlay";

const bounds: Rect = { x: 0, y: 40, width: 1000, height: 700 };

const view = (changes: Partial<PaletteView> = {}): PaletteView => ({
  open: true,
  text: "https://example.com/",
  seq: 1,
  bounds,
  size: undefined,
  ...changes,
});

/** One fake palette view that logs, in order, everything done to it. */
function createLease() {
  const listeners = new Map<string, (() => void)[]>();
  const log: string[] = [];

  const emit = (event: string) => {
    for (const listener of listeners.get(event)?.splice(0) ?? []) listener();
  };

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
      // SAFETY: a trimmed stand-in; the palette only touches the members above.
      webContents: webContents as unknown as PaletteLease["host"]["webContents"],
      setVisible: (visible: boolean) => void log.push(`visible ${visible}`),
      setBounds: (rect: Rect) => void log.push(`bounds ${rect.width}x${rect.height}`),
    },
    link: {
      opened: (text: string, seq: number, size: string | undefined) =>
        void log.push(`opened ${text} ${seq}${size === undefined ? "" : ` ${size}`}`),
      css: (css: string) => void log.push(`css ${css}`),
    },
    release: vi.fn(() => void log.push("release")),
  };

  return { lease, log, crash: () => emit("render-process-gone") };
}

function setup() {
  const leases: ReturnType<typeof createLease>[] = [];

  const open = vi.fn(() => {
    const created = createLease();
    leases.push(created);

    return created.lease;
  });

  let css = "a{}";
  const palette = new PaletteOverlay(open, () => css);

  return { palette, open, leases, setCss: (next: string) => (css = next) };
}

test("a closed palette never builds a view", () => {
  const { palette, open } = setup();

  palette.render(view({ open: false }));

  expect(open).not.toHaveBeenCalled();
});

test("opening sizes and shows the view before sending the text, then focuses it", () => {
  const { palette, leases } = setup();

  palette.render(view());

  expect(leases[0]!.log).toEqual([
    "css a{}",
    "bounds 1000x700",
    "visible true",
    "opened https://example.com/ 1",
    "focus",
  ]);
});

test("a resize while open moves the view without reopening it", () => {
  const { palette, leases } = setup();

  palette.render(view());
  leases[0]!.log.length = 0;
  palette.render(view({ bounds: { ...bounds, width: 800 } }));

  expect(leases[0]!.log).toEqual(["bounds 800x700", "visible true"]);
});

test("closing conceals the view and zero-sizes it, and the next opening reuses it", () => {
  const { palette, open, leases } = setup();

  palette.render(view());
  leases[0]!.log.length = 0;
  palette.render(view({ open: false }));

  expect(leases[0]!.log).toEqual(["visible false", "bounds 0x0"]);

  palette.render(view({ text: ":", seq: 2 }));

  expect(open).toHaveBeenCalledTimes(1);
  expect(leases[0]!.log).toContain("opened : 2");
});

test("a crashed view is released and replaced at the next opening", () => {
  const { palette, open, leases } = setup();

  palette.render(view());
  leases[0]!.crash();

  expect(leases[0]!.lease.release).toHaveBeenCalled();

  palette.render(view());

  expect(open).toHaveBeenCalledTimes(2);
  expect(leases[1]!.log).toContain("opened https://example.com/ 1");
});

test("a config change restyles a built view", () => {
  const { palette, leases, setCss } = setup();

  palette.applyCss();
  palette.render(view());
  setCss("b{}");
  palette.applyCss();

  expect(leases[0]!.log.at(-1)).toBe("css b{}");
});
