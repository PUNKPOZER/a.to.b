const { contextBridge, ipcRenderer, webUtils } = require("electron");
// real file paths for exports (Rekordbox / M3U8): the browser cannot see them, the desktop app can
contextBridge.exposeInMainWorld("atobDesktop", { pathForFile: (f) => { try { return webUtils.getPathForFile(f) || null; } catch (e) { return null; } } });
contextBridge.exposeInMainWorld("noesisSetup", {
  onEvent: (cb) => ipcRenderer.on("setup-event", (_e, ev) => cb(ev)),
  skip: () => ipcRenderer.send("setup-skip"),
  retry: () => ipcRenderer.send("setup-retry"),
  info: () => ipcRenderer.invoke("setup-info"),
});
