import { BrowserWindow, screen } from "electron";

/**
 * Lightweight host toast (§7.1): a small frameless always-on-top window in
 * the work-area corner that fades out on its own. Purely informational; no
 * plugin markup — text only, host-rendered.
 */

const toneColors: Record<string, string> = { info: "#38bdf8", success: "#10b981", warning: "#f59e0b", error: "#ef4444" };
let activeToasts = 0;

export async function showPluginToast(spec: { text: string; tone?: "info" | "success" | "warning" | "error"; durationMs?: number }): Promise<void> {
  const durationMs = Math.min(Math.max(spec.durationMs ?? 4_000, 1_000), 15_000);
  const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()) ?? screen.getPrimaryDisplay();
  const width = 300;
  const height = 64;
  const slot = activeToasts;
  activeToasts += 1;
  const window = new BrowserWindow({
    width,
    height,
    x: Math.round(display.workArea.x + display.workArea.width - width - 16),
    y: Math.round(display.workArea.y + display.workArea.height - height - 16 - slot * (height + 8)),
    frame: false,
    transparent: true,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    focusable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    show: false,
    hasShadow: false,
    backgroundColor: "#00000000",
    webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true },
  });
  window.setMenu(null);
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  const accent = toneColors[spec.tone ?? "info"] ?? toneColors.info;
  const csp = "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'";
  const html = `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${csp}"><style>
    html,body{margin:0;background:transparent;overflow:hidden}
    .toast{box-sizing:border-box;display:flex;align-items:center;gap:9px;height:${height - 8}px;margin:4px;padding:0 14px;border-radius:13px;background:rgba(23,32,51,0.94);color:#f1f5f9;font:600 12px/16px Inter,ui-sans-serif,system-ui,sans-serif;border:1px solid rgba(255,255,255,0.12);box-shadow:0 10px 24px rgba(15,23,42,0.35);animation:toast-in 180ms cubic-bezier(0.2,0,0,1)}
    .dot{flex:0 0 8px;width:8px;height:8px;border-radius:999px;background:${accent}}
    .text{overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical}
    @keyframes toast-in{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}
  </style></head><body><div class="toast"><span class="dot"></span><span class="text">${escapeHtml(spec.text)}</span></div></body></html>`;
  try {
    await window.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
    window.showInactive();
    setTimeout(() => { if (!window.isDestroyed()) window.destroy(); activeToasts = Math.max(0, activeToasts - 1); }, durationMs).unref?.();
  } catch {
    activeToasts = Math.max(0, activeToasts - 1);
    if (!window.isDestroyed()) window.destroy();
  }
}

function escapeHtml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
}
