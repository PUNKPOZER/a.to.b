const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld("noesisSetup", {
  onEvent: (cb) => ipcRenderer.on("setup-event", (_e, ev) => cb(ev)),
  skip: () => ipcRenderer.send("setup-skip"),
  retry: () => ipcRenderer.send("setup-retry"),
  info: () => ipcRenderer.invoke("setup-info"),
});
