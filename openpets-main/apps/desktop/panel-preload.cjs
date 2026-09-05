const { contextBridge, ipcRenderer } = require("electron");

const tokenArg = process.argv.find((arg) => arg.startsWith("--openpets-panel-token="));
const channel = tokenArg ? `openpets:plugin-panel:${tokenArg.slice("--openpets-panel-token=".length)}` : "";
const handlers = new Set();

ipcRenderer.on(`${channel}:message`, (_event, msg) => {
  for (const handler of handlers) {
    try { handler(msg); } catch { /* panel handler errors stay in the panel */ }
  }
});

contextBridge.exposeInMainWorld("openPetsPanel", {
  postMessage: (msg) => { if (channel) ipcRenderer.send(`${channel}:to-plugin`, msg); },
  onMessage: (handler) => { if (typeof handler === "function") handlers.add(handler); return () => handlers.delete(handler); },
  close: () => { if (channel) ipcRenderer.send(`${channel}:close`); },
});
