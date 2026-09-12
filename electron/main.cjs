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
const { app, BrowserWindow, dialog, ipcMain, shell } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

const FALLBACK_URL = 'https://mama-thera-finance.vercel.app/';
// Où atterrit un poste qui ne peut pas s'auto-installer (portable) : le lien
// doit être celui des versions, pas une page d'accueil où rien ne se télécharge.
const RELEASES_URL = 'https://github.com/ibrahimkalilthera/-MAMA/releases/latest';
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
  const { autoUpdater } = require('electron-updater');
  const {
    shouldCheck, shouldPrompt, updateAction,
    CHECK_INTERVAL_MS, FOCUS_COOLDOWN_MS, RE_PROMPT_MS,
  } = require('./updater-policy.cjs');
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
  // Le portable ne peut pas s'auto-installer (electron-updater exige l'installeur
  // NSIS) : il VÉRIFIE quand même et reçoit un lien. Rester muet serait pire que
  // ne rien pouvoir faire — l'utilisateur ne saurait jamais qu'une version existe.
  const action = updateAction({ isPortable });
  autoUpdater.autoDownload = !isPortable;

  // État poussé à l'interface : le bandeau du renderer lit cet objet. `diverges`
  // n'existe pas ici, mais l'état d'une mise à jour, lui, doit se voir même si
  // l'utilisateur a fermé la boîte de dialogue.
  let state = { status: 'idle', version: null, portable: isPortable, action: action.action, detail: action.detail };
  const broadcast = (patch) => {
    state = { ...state, ...patch };
    try {
      if (!win.isDestroyed()) win.webContents.send('updates:state', state);
    } catch { /* fenêtre fermée pendant une mise à jour : sans conséquence */ }
  };

  let lastCheckAt = null;
  let lastPromptAt = null;

  autoUpdater.on('checking-for-update', () => {
    lastCheckAt = Date.now();
    broadcast({ status: 'checking' });
    log('checking-for-update');
  });
  autoUpdater.on('update-available', (i) => {
    broadcast({ status: 'available', version: i.version });
    log(`update-available ${i.version}`);
  });
  autoUpdater.on('update-not-available', () => {
    broadcast({ status: 'current', version: app.getVersion() });
    log('update-not-available');
  });
  autoUpdater.on('error', (e) => {
    broadcast({ status: 'error', detail: (e && e.message) || String(e) });
    log(`error ${(e && e.message) || e}`);
  });
  autoUpdater.on('download-progress', (p) => {
    broadcast({ status: 'downloading', percent: Math.round(p.percent) });
    log(`download-progress ${Math.round(p.percent)}%`);
  });
  autoUpdater.on('update-downloaded', async (i) => {
    broadcast({ status: 'downloaded', version: i.version });
    log(`update-downloaded ${i.version}`);
    if (process.env.UPDATER_LOG_FILE) return; // proof mode — E2E reads the log
    await askToInstall(i);
  });

  /**
   * Pose la question — et la repose. « Plus tard » reporte, il ne refuse pas.
   */
  async function askToInstall(info) {
    const verdict = shouldPrompt({ downloaded: true, lastPromptAt, nowMs: Date.now(), rePromptMs: RE_PROMPT_MS });
    if (!verdict.prompt) {
      // Le report court encore : on programme le prochain rappel au lieu de
      // l'abandonner, sinon la version téléchargée serait gardée pour soi.
      const waitMs = Math.max(1000, RE_PROMPT_MS - (Date.now() - (lastPromptAt || Date.now())));
      setTimeout(() => { void askToInstall(info); }, waitMs).unref?.();
      return;
    }
    lastPromptAt = Date.now();
    log(`prompt ${verdict.reason}`);
    if (isPortable) {
      const { response } = await dialog.showMessageBox(win, {
        type: 'info',
        title: 'Mise à jour disponible',
        message: `La version ${info.version} est disponible.`,
        detail: action.detail,
        buttons: ['Ouvrir la page de téléchargement', 'Plus tard'],
        defaultId: 0,
        cancelId: 1,
      });
      if (response === 0) shell.openExternal(RELEASES_URL);
      return;
    }
    const { response } = await dialog.showMessageBox(win, {
      type: 'info',
      title: 'Mise à jour disponible',
      message: `La version ${info.version} est prête à être installée.`,
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
    } else {
      // Report : on repropose plus tard sans attendre un redémarrage.
      setTimeout(() => { void askToInstall(info); }, RE_PROMPT_MS).unref?.();
    }
  }

  // Le rythme est réglable : l'E2E abaisse l'intervalle pour prouver qu'une app
  // OUVERTE revoit passer les versions — sinon il faudrait attendre 30 min.
  const intervalMs = Number(process.env.UPDATER_CHECK_INTERVAL_MS || CHECK_INTERVAL_MS);
  const focusCooldownMs = Number(process.env.UPDATER_FOCUS_COOLDOWN_MS || FOCUS_COOLDOWN_MS);
  const checkNow = () => {
    const verdict = shouldCheck({ kind: 'interval', lastCheckAt, nowMs: Date.now(), checkIntervalMs: intervalMs, focusCooldownMs });
    if (!verdict.check) return;
    log(`check interval — ${verdict.reason}`);
    autoUpdater.checkForUpdates().catch((e) => log(`check-failed ${(e && e.message) || e}`));
  };
  const focusNow = () => {
    const verdict = shouldCheck({ kind: 'focus', lastCheckAt, nowMs: Date.now(), checkIntervalMs: intervalMs, focusCooldownMs });
    if (!verdict.check) return;
    log(`check focus — ${verdict.reason}`);
    autoUpdater.checkForUpdates().catch((e) => log(`check-failed ${(e && e.message) || e}`));
  };

  try { win.on('focus', focusNow); } catch { /* fenêtre déjà détruite */ }
  setInterval(checkNow, intervalMs).unref?.();
  setTimeout(() => {
    const verdict = shouldCheck({ kind: 'startup', lastCheckAt, nowMs: Date.now() });
    log(`check startup — ${verdict.reason}`);
    autoUpdater.checkForUpdates().catch((e) => log(`check-failed ${(e && e.message) || e}`));
  }, 5000);

  // L'interface peut aussi demander elle-même l'état (bandeau monté après coup).
  try {
    ipcMain.handle('updates:get-state', () => state);
    ipcMain.handle('updates:install', async () => {
      if (state.status !== 'downloaded') return { ok: false, reason: 'aucune mise à jour prête' };
      if (isPortable) {
        shell.openExternal(RELEASES_URL);
        return { ok: true, action: 'open-download' };
      }
      try { fs.writeFileSync(installPendingFlag(), `${new Date().toISOString()}\n`); } catch { /* best-effort */ }
      autoUpdater.quitAndInstall();
      return { ok: true, action: 'restart' };
    });
  } catch { /* canaux déjà enregistrés (rechargement) */ }
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