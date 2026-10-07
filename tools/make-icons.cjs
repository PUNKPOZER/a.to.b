/* Renders assets/brand/app-icon.svg to the PNG sizes the app needs.  Run: npx electron tools/make-icons.cjs */
const { app, BrowserWindow } = require("electron");
const fs = require("node:fs"), path = require("node:path");
const root = path.join(__dirname, "..");
const jobs = [["build/icon.png", 1024], ["assets/icons/icon-512.png", 512], ["assets/icons/icon-192.png", 192], ["assets/icons/apple-touch-icon.png", 180], ["assets/icons/favicon-32.png", 32], ["assets/icons/favicon-16.png", 16]];
app.whenReady().then(async () => {
  const svg = fs.readFileSync(path.join(root, "assets/brand/app-icon.svg"), "utf8"), N = 1024;
  const win = new BrowserWindow({ width: N, height: N, show: false, frame: false, useContentSize: true });
  await win.loadURL("data:text/html;charset=utf-8," + encodeURIComponent(`<body style="margin:0;background:transparent">${svg.replace("<svg ", `<svg style="width:${N}px;height:${N}px;display:block" `)}</body>`));
  await new Promise((r) => setTimeout(r, 400));
  const big = await win.webContents.capturePage();            // one render, every size is a high-quality downscale of it
  for (const [out, size] of jobs) {
    const img = size === N ? big : big.resize({ width: size, height: size, quality: "best" });
    fs.mkdirSync(path.dirname(path.join(root, out)), { recursive: true }); fs.writeFileSync(path.join(root, out), img.toPNG());
  }
  console.log("icons written", big.getSize()); app.quit();
});
