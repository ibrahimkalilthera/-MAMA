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
// electron-builder sets PORTABLE_EXECUTABLE_FILE only for the portable target:
// auto-update installs via the NSIS installer, so it is disabled on portable.
const isPortable = !!process.env.PORTABLE_EXECUTABLE_FILE;

// ── Auto-update (electron-updater, GitHub releases) ─────────────────────────
// Checked shortly after startup; a downloaded update is installed on user
// confirmation. Only active in packaged (non-portable) builds — dev and the
// portable exe never touch the update feed.
// E2E hooks (same convention as ELECTRON_DL_DIR):
//   UPDATER_FEED_URL  → override the feed with a local HTTP server (proves
//                       check + download without a published release)
//   UPDATER_LOG_FILE  → append every updater event to this file and skip the
//                       modal (proof mode — the E2E script reads the log)
function setupAutoUpdater(win) {
  if (!app.isPackaged) {
    console.log('[updater] dev — auto-update désactivé');
    return;
  }
  if (isPortable) {
    console.log('[updater] portable — auto-update désactivé (NSIS requis)');
    return;
  }
  const { autoUpdater } = require('electron-updater');
  const logFile = process.env.UPDATER_LOG_FILE;
  const log = (msg) => {
    console.log(`[updater] ${msg}`);
    if (logFile) {
      try { fs.appendFileSync(logFile, `${new Date().toISOString()} ${msg}\n`); } catch { /* best-effort */ }
    }
  };
  if (process.env.UPDATER_FEED_URL) {
    autoUpdater.setFeedURL({ provider: 'generic', url: process.env.UPDATER_FEED_URL });
  }
  autoUpdater.autoDownload = true;
  autoUpdater.on('checking-for-update', () => log('checking-for-update'));
  autoUpdater.on('update-available', (i) => log(`update-available ${i.version}`));
  autoUpdater.on('update-not-available', () => log('update-not-available'));
  autoUpdater.on('error', (e) => log(`error ${(e && e.message) || e}`));
  autoUpdater.on('download-progress', (p) => log(`download-progress ${Math.round(p.percent)}%`));
  autoUpdater.on('update-downloaded', async (i) => {
    log(`update-downloaded ${i.version}`);
    if (process.env.UPDATER_LOG_FILE) return; // proof mode — E2E reads the log
    const { response } = await dialog.showMessageBox(win, {
      type: 'info',
      title: 'Mise à jour disponible',
      message: `La version ${i.version} est prête à être installée.`,
      detail: 'Redémarrer maintenant pour appliquer la mise à jour ?',
      buttons: ['Redémarrer maintenant', 'Plus tard'],
      defaultId: 0,
      cancelId: 1,
    });
    if (response === 0) autoUpdater.quitAndInstall();
  });
  setTimeout(() => {
    autoUpdater.checkForUpdates().catch((e) => log(`check-failed ${(e && e.message) || e}`));
  }, 5000);
}


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

  setupAutoUpdater(win);

  return win;
}

app.whenReady().then(() => {
  // Correct taskbar grouping / notifications on Windows.
  app.setAppUserModelId('com.mamathera.finance');
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});