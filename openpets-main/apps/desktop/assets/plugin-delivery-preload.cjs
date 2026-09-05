const { ipcRenderer } = require("electron");

let lastInteractiveHit = null;

const getInteractiveTarget = (clientX, clientY) => {
  const target = document.elementFromPoint(clientX, clientY);
  return target && target.closest(".pet-hitbox, .pet-shell");
};

const reportInteractiveHit = (interactive, source) => {
  if (lastInteractiveHit === interactive) return;
  lastInteractiveHit = interactive;
  ipcRenderer.send("openpets:delivery-hit-test", interactive, source);
};

document.addEventListener("DOMContentLoaded", () => {
  document.addEventListener("mousemove", (event) => {
    const isInteractive = Boolean(getInteractiveTarget(event.clientX, event.clientY));
    reportInteractiveHit(isInteractive, "mousemove");
  }, { passive: true });

  document.addEventListener("click", (event) => {
    if (event.button !== 0) return;
    const target = getInteractiveTarget(event.clientX, event.clientY);
    if (target) {
      ipcRenderer.send("openpets:delivery-clicked");
    }
  });

  ipcRenderer.on("openpets:pet-reaction-state", (_event, state) => {
    document.documentElement.dataset.reactionState = state;
  });

  document.addEventListener("mouseleave", () => {
    reportInteractiveHit(false, "mouseleave");
  }, { passive: true });

  // Probe hit test requested by main process (Windows compatibility)
  ipcRenderer.on("openpets:delivery-probe-hit-test", (_event, point) => {
    if (!point || typeof point.clientX !== "number" || typeof point.clientY !== "number") return;
    const isInteractive = Boolean(getInteractiveTarget(point.clientX, point.clientY));
    reportInteractiveHit(isInteractive, "probe");
  });

  reportInteractiveHit(false, "init");
});
