// ─────────────────────────────────────────────────────────────────────────────
// electron/preload.cjs — minimal bridge exposed to the renderer.
//
// contextIsolation is ON and nodeIntegration is OFF (see main.cjs); the app
// itself runs entirely inside the web page and talks to Supabase over HTTPS,
// so only a tiny, read-only surface is exposed here.
// ─────────────────────────────────────────────────────────────────────────────
const { contextBridge } = require('electron');

contextBridge.exposeInMainWorld('desktop', {
  platform: process.platform,
  isDesktop: true,
  versions: {
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node,
  },
});