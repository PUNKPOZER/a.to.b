/* NOESIS desktop shell (Electron): the same static app in its own window, served from a loopback-only HTTP server
 * (so Web Workers, WASM and IndexedDB behave exactly as on the web). In a repo checkout it also starts the optional
 * analysis backend when backend/.venv exists. */
const { app, BrowserWindow, Menu, shell, dialog } = require("electron");
const { spawn } = require("node:child_process");
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const PREFERRED_PORT = 8787;
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css", ".wasm": "application/wasm", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".ttf": "font/ttf", ".webmanifest": "application/manifest+json", ".md": "text/plain" };
let server = null, backend = null, origin = "";

function startServer() {
  return new Promise((resolve, reject) => {
    server = http.createServer((req, res) => {
      let p = decodeURIComponent(new URL(req.url, "http://x").pathname);
      if (p.endsWith("/")) p += "index.html";
      const file = path.normalize(path.join(ROOT, p));
      if (!file.startsWith(ROOT + path.sep) || /(^|[\\/])(node_modules|backend|structure|desktop|build|\.git)([\\/]|$)/.test(path.relative(ROOT, file))) { res.writeHead(403).end(); return; }
      fs.readFile(file, (err, buf) => {
        if (err) { res.writeHead(404).end("not found"); return; }
        res.writeHead(200, { "Content-Type": TYPES[path.extname(file).toLowerCase()] || "application/octet-stream", "Cache-Control": "no-cache" }).end(buf);
      });
    });
    const listen = (port) => server.listen(port, "127.0.0.1", () => resolve(server.address().port));
    server.once("error", () => { server.removeAllListeners("error"); listen(0); }); // preferred port busy -> any free port
    listen(PREFERRED_PORT);
  });
}

async function healthy() {
  try { const r = await fetch("http://127.0.0.1:8000/api/health", { signal: AbortSignal.timeout(1200) }); return r.ok; } catch { return false; }
}
// Optional advanced backend: only when running from a checkout that has been set up (backend/.venv). Never bundled.
async function maybeStartBackend() {
  if (await healthy()) return;
  const bin = process.platform === "win32" ? path.join(ROOT, "backend", ".venv", "Scripts", "uvicorn.exe") : path.join(ROOT, "backend", ".venv", "bin", "uvicorn");
  if (!fs.existsSync(bin)) return;
  backend = spawn(bin, ["app.main:app", "--host", "127.0.0.1", "--port", "8000"], { cwd: path.join(ROOT, "backend"), env: { ...process.env, SELECTOR_CORS_ORIGINS: origin }, stdio: "ignore", windowsHide: true });
  backend.on("exit", () => { backend = null; });
}

function buildMenu() {
  const mac = process.platform === "darwin";
  const tpl = [
    ...(mac ? [{ role: "appMenu" }] : []),
    { role: "editMenu" },
    { label: "View", submenu: [{ role: "reload" }, { role: "forceReload" }, { role: "toggleDevTools" }, { type: "separator" }, { role: "resetZoom" }, { role: "zoomIn" }, { role: "zoomOut" }, { type: "separator" }, { role: "togglefullscreen" }] },
    { role: "windowMenu" },
    { label: "Help", submenu: [{ label: "NOESIS on GitHub", click: () => shell.openExternal("https://github.com/PUNKPOZER/noesis") }] },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(tpl));
}

async function createWindow() {
  const port = await startServer();
  origin = `http://127.0.0.1:${port}`;
  maybeStartBackend();
  const win = new BrowserWindow({
    width: 1440, height: 900, minWidth: 900, minHeight: 600, backgroundColor: "#080909", title: "NOESIS", show: false,
    icon: path.join(ROOT, "build", "icon.png"), autoHideMenuBar: process.platform !== "darwin",
    webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false, spellcheck: false },
  });
  win.once("ready-to-show", () => win.show());
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:/.test(url) && !url.startsWith(origin)) shell.openExternal(url); return { action: "deny" }; });
  win.webContents.on("will-navigate", (e, url) => { if (!url.startsWith(origin)) { e.preventDefault(); if (/^https?:/.test(url)) shell.openExternal(url); } });
  win.webContents.on("did-fail-load", (_e, code, desc) => dialog.showErrorBox("NOESIS", `Could not load the interface (${code} ${desc}).`));
  await win.loadURL(origin + "/index.html");
}

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on("second-instance", () => { const w = BrowserWindow.getAllWindows()[0]; if (w) { if (w.isMinimized()) w.restore(); w.focus(); } });
  app.whenReady().then(() => { buildMenu(); createWindow(); app.on("activate", () => { if (!BrowserWindow.getAllWindows().length) createWindow(); }); });
  app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });
  app.on("before-quit", () => { if (backend) backend.kill(); if (server) server.close(); });
}
