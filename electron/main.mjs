import { app, BrowserWindow, dialog, shell } from "electron";
import path from "node:path";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const appRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const port = 8787;
const appUrl = `http://127.0.0.1:${port}`;

if (!app.requestSingleInstanceLock()) {
  app.quit();
}

let mainWindow;

function resourceRoot() {
  return app.isPackaged ? process.resourcesPath : appRoot;
}

async function waitForServer(timeoutMs = 15000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const response = await fetch(`${appUrl}/api/health`);
      if (response.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error("The local MarketOS service did not start in time.");
}

async function startServer() {
  const resources = resourceRoot();
  process.env.PORT = String(port);
  process.env.MARKETOS_DATA_DIR = path.join(app.getPath("userData"), "data");
  process.env.MARKETOS_RESOURCE_DIR = resources;
  process.env.MARKETOS_CONFIG_DIR = existsSync(path.join(app.getPath("userData"), "config", "ai.json"))
    ? path.join(app.getPath("userData"), "config")
    : path.join(resources, "config");
  await import("../server.mjs");
  await waitForServer();
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1050,
    minHeight: 700,
    backgroundColor: "#f8fafc",
    title: "MarketOS",
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: path.join(appRoot, "electron", "preload.mjs"),
    },
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith(appUrl)) return { action: "allow" };
    shell.openExternal(url);
    return { action: "deny" };
  });
  mainWindow.loadURL(appUrl);
}

app.on("second-instance", () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  }
});

// IPC handler for opening external URLs securely
import { ipcMain } from "electron";

ipcMain.handle("open-external", async (event, url) => {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:") {
      return { success: false, error: "Only HTTPS URLs are allowed." };
    }
    const hostname = parsed.hostname.toLowerCase();
    if (hostname !== "marketos.app" && hostname !== "www.marketos.app") {
      return { success: false, error: "This host is not allowed." };
    }
    await shell.openExternal(url);
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

app.whenReady().then(async () => {
  try {
    await startServer();
    createWindow();
  } catch (error) {
    dialog.showErrorBox("MarketOS could not start", error?.stack || String(error));
    app.quit();
  }
});

app.on("window-all-closed", () => app.quit());
