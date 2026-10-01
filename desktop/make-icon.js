/* Renders assets/logo.svg onto a dark square -> build/icon.png (1024). Run: npx electron desktop/make-icon.js */
const { app, BrowserWindow } = require("electron");
const fs = require("node:fs"), path = require("node:path");
app.whenReady().then(async () => {
  const svg = fs.readFileSync(path.join(__dirname, "..", "assets", "logo.svg"), "utf8").replace(/fill="black"/g, 'fill="#000"');
  const html = `<body style="margin:0;background:#080909;display:grid;place-items:center;width:1024px;height:1024px"><div style="width:620px;filter:drop-shadow(0 0 0 #000)">${svg.replace("<svg ", '<svg style="width:100%;height:auto" ')}</div></body>`;
  const win = new BrowserWindow({ width: 1024, height: 1024, useContentSize: true, show: false, frame: false, webPreferences: { offscreen: false } });
  await win.loadURL("data:text/html;charset=utf-8," + encodeURIComponent(html));
  await new Promise((r) => setTimeout(r, 400));
  const img = await win.webContents.capturePage();
  fs.mkdirSync(path.join(__dirname, "..", "build"), { recursive: true });
  fs.writeFileSync(path.join(__dirname, "..", "build", "icon.png"), img.toPNG());
  console.log("icon written", img.getSize());
  app.quit();
});
