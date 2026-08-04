import { join } from "node:path";
import { app, BrowserWindow, WebContentsView } from "electron";

const CHROME_HEIGHT = 40;
const HOMEPAGE = "https://example.com";

const preload = join(import.meta.dirname, "../preload/index.mjs");
const rendererHtml = join(import.meta.dirname, "../renderer/index.html");

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    frame: false,
    backgroundColor: "#1d1d1d",
    webPreferences: { preload },
  });

  if (process.env.VITE_DEV_SERVER_URL) {
    void win.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else {
    void win.loadFile(rendererHtml);
  }

  const tab = new WebContentsView();
  win.contentView.addChildView(tab);
  void tab.webContents.loadURL(HOMEPAGE);

  // The window's own 'resize' event reports stale content bounds on Wayland;
  // the parent view's post-layout event is the only reliable source.
  const layout = (): void => {
    const { width, height } = win.contentView.getBounds();
    tab.setBounds({
      x: 0,
      y: CHROME_HEIGHT,
      width,
      height: Math.max(0, height - CHROME_HEIGHT),
    });
  };

  layout();
  win.contentView.on("bounds-changed", layout);
}

void app.whenReady().then(() => {
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
