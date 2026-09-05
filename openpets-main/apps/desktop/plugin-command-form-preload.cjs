const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("openPetsCommandForm", {
  submit: (channel, values) => ipcRenderer.invoke(String(channel), values && typeof values === "object" ? values : {}),
  resize: (channel, size) => ipcRenderer.send(String(channel), size && typeof size === "object" ? size : {}),
  close: () => window.close(),
});
