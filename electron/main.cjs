// ─────────────────────────────────────────────────────────────────────────────
// electron/main.cjs — MamaTheraFinance desktop shell.
//
// Loads the LOCAL production build (electron-ui-dist/, produced by
// `npm run electron:ui`) so the app opens even if the Vercel host is down —
// only the Supabase data calls (login, CRUD, PDFs) need the network.
// Fallback: if the local build is missing (e.g. running `electron .` without
// building first), the hosted production URL is loaded so the app still
// works.
//
// Security: contextIsolation ON, nodeIntegration OFF, sandbox ON. The
// renderer only talks to Supabase over HTTPS; navigation is locked to the
// app surface and external links open in the system browser.
// ─────────────────────────────────────────────────────────────────────────────
const { app, BrowserWindow, dialog, shell } = require('electron');
const path = require('node:path');
const fs = require('node:fs');

const FALLBACK_URL = 'https://mama-thera-finance.vercel.app/';
const isDev = !app.isPackaged;

function uiIndexPath() {
  // Packaged: files are inside app.asar; dev: repo root.
  return path.join(__dirname, '..', 'electron-ui-dist', 'index.html');
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 680,
    title: 'Mama Thera Finance',
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
    },
  });

  win.once('ready-to-show', () => win.show());

  // External links (mailto:, https:// outside the app) → system browser.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url) && !url.startsWith(FALLBACK_URL)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    const isAppUrl =
      url.startsWith('file://') ||
      url.startsWith('app://') ||
      url.startsWith(FALLBACK_URL) ||
      (isDev && url.startsWith('http://127.0.0.1'));
    if (!isAppUrl) {
      e.preventDefault();
      if (/^https?:/i.test(url)) shell.openExternal(url);
    }
  });

  // Downloads: explicit save dialog by default; auto-save when
  // ELECTRON_DL_DIR is set (used by the E2E proof and kiosk-like setups).
  win.webContents.session.on('will-download', (event, item) => {
    const autoDir = process.env.ELECTRON_DL_DIR;
    if (autoDir) {
      fs.mkdirSync(autoDir, { recursive: true });
      item.setSavePath(path.join(autoDir, item.getFilename()));
      return;
    }
    const suggested = item.getFilename();
    dialog
      .showSaveDialog(win, { defaultPath: suggested, title: 'Enregistrer le PDF' })
      .then(({ canceled, filePath }) => {
        if (!canceled && filePath) item.setSavePath(filePath);
        else item.cancel();
      })
      .catch(() => item.cancel());
  });

  // Local build first, hosted URL as fallback when the build is absent.
  const index = uiIndexPath();
  if (fs.existsSync(index)) {
    win.loadFile(index).catch((err) => {
      console.error('loadFile échoué, fallback URL:', err.message);
      win.loadURL(FALLBACK_URL);
    });
  } else {
    console.warn(`[electron] build local introuvable (${index}) — fallback ${FALLBACK_URL}`);
    win.loadURL(FALLBACK_URL);
  }

  return win;
}

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});