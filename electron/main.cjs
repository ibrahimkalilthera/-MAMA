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
const os = require('node:os');

const FALLBACK_URL = 'https://mama-thera-finance.vercel.app/';
const isDev = !app.isPackaged;
// electron-builder sets PORTABLE_EXECUTABLE_FILE only for the portable target:
// auto-update installs via the NSIS installer, so it is disabled on portable.
const isPortable = !!process.env.PORTABLE_EXECUTABLE_FILE;

// ── Updater stale-cache guard ────────────────────────────────────────────────
// electron-updater's download cache dir. Mirrors the derived `updaterCacheDirName`
// (sanitized package name + "-updater", set by electron-builder): it lives under
// %LOCALAPPDATA% and is SHARED across installs of the app. A downloaded update
// stays here (setup exe + update-info.json) and, if sha512-valid, is reused by
// the next run WITHOUT any real GET — so a failed/interrupted install would be
// re-served from cache forever, never re-downloaded.
const updaterCacheDir = () =>
  path.join(
    process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'),
    'mama-thera-finance-updater'
  );
// Sentinel written right before quitAndInstall(). If the app later starts with
// this file present, the previous install never completed (setup cancelled or
// failed) → purge the stale cache so the next check really re-downloads.
const installPendingFlag = () => path.join(app.getPath('userData'), 'update-install-pending');

// Version targeted by the cached update (from update-info.json fileName), or
// null if it cannot be read. Used to tell "install succeeded" (the app now
// runs the cached version) from "install did not complete" (it does not).
function staleCacheVersion() {
  const info = path.join(updaterCacheDir(), 'pending', 'update-info.json');
  if (!fs.existsSync(info)) return null;
  try {
    const { fileName } = JSON.parse(fs.readFileSync(info, 'utf8'));
    const m = /-(\d+\.\d+\.\d+)-/.exec(fileName || '');
    return m ? m[1] : null;
  } catch { /* ignore */ return null; }
}

function purgeStaleUpdaterCache(log) {
  const flag = installPendingFlag();
  if (!fs.existsSync(flag)) return; // no attempted install → cache stays (e.g. "Later")
  fs.rmSync(flag, { force: true });
  const dir = updaterCacheDir();
  if (!fs.existsSync(dir)) {
    log('installation précédente non aboutie — cache updater absent');
    return;
  }
  const cachedVersion = staleCacheVersion();
  fs.rmSync(dir, { recursive: true, force: true });
  const outcome = cachedVersion && cachedVersion !== app.getVersion()
    ? 'installation précédente non aboutie'
    : 'mise à jour appliquée (cache inutile)';
  log(`cache electron-updater purgé (${outcome})`);
}

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
  // Stale-cache guard: runs before the first check. A leftover sentinel means
  // the previous install did not complete — purge the cache, never re-serve it.
  try { purgeStaleUpdaterCache(log); } catch (e) { log(`purge-cache échec ${(e && e.message) || e}`); }

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
    if (response === 0) {
      // Sentinel: marks an install attempt. If the app comes up again on this
      // version, purgeStaleUpdaterCache() wipes the shared cache on next start.
      try { fs.writeFileSync(installPendingFlag(), `${new Date().toISOString()}\n`); } catch { /* best-effort */ }
      autoUpdater.quitAndInstall();
    }
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