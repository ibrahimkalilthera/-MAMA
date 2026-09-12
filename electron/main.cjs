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
const { appendEntry, readEntries, journalPath, pendingReports, markReported } = require('./update-journal.cjs');

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
  if (!fs.existsSync(flag)) return { attempted: false, cachedVersion: null }; // no attempted install → cache stays (e.g. "Later")
  fs.rmSync(flag, { force: true });
  const dir = updaterCacheDir();
  const cachedVersion = staleCacheVersion();
  if (!fs.existsSync(dir)) {
    log('installation précédente non aboutie — cache updater absent');
    return { attempted: true, cachedVersion };
  }
  fs.rmSync(dir, { recursive: true, force: true });
  const outcome = cachedVersion && cachedVersion !== app.getVersion()
    ? 'installation précédente non aboutie'
    : 'mise à jour appliquée (cache inutile)';
  log(`cache electron-updater purgé (${outcome})`);
  // Le verdict est RENDU, pas seulement journalisé : une installation tentée et
  // revenue sur la même version est le cas le plus silencieux d'un poste bloqué
  // (l'utilisateur a cliqué « Redémarrer maintenant », il a redémarré, rien n'a
  // changé) et c'est l'appelant qui sait quoi en faire.
  return { attempted: true, cachedVersion };
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
    shouldCheck, shouldPrompt, updateAction, updatePressure,
    holdsUrlFrom, holdDecision, updateGate, gateFailure,
    CHECK_INTERVAL_MS, FOCUS_COOLDOWN_MS, RE_PROMPT_MS, FORCED_RE_PROMPT_MS,
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
  let lastInstall = { attempted: false, cachedVersion: null };
  try { lastInstall = purgeStaleUpdaterCache(log) || lastInstall; } catch (e) { log(`purge-cache échec ${(e && e.message) || e}`); }

  // ─── Frein d'urgence : une version retenue n'est pas livrée ────────────────
  // Une version défectueuse publiée ne doit pas être imposée à toute l'école.
  // Retirer le release est le premier geste (il vaut même pour les postes dont
  // la version installée ne connaît pas ce frein) ; la liste de retenues est la
  // seconde, et elle agit PENDANT que le release est encore là. Elle vit hors du
  // release (un fichier du dépôt) : on peut donc retenir une version après
  // l'avoir publiée.
  const holdsUrl = holdsUrlFrom({
    // Un mode preuve peut pointer le frein ailleurs (serveur local) sans rien publier.
    feedOverride: process.env.UPDATER_HOLD_URL || process.env.UPDATER_FEED_URL || null,
    appUpdateYml: (() => {
      try {
        return fs.readFileSync(path.join(process.resourcesPath, 'app-update.yml'), 'utf8');
      } catch { return null; }
    })(),
  });
  log(`retenues ${holdsUrl || 'URL indéterminable — aucune obligation ne sera imposée'}`);
  /** La version que ce poste refuse d'installer (retenue ET lue). */
  let heldVersion = null;

  /**
   * Lire le frein pour une version donnée.
   *
   * Un fichier présent mais illisible (pas de liste) compte comme ILLISIBLE :
   * un frein vidé par accident qui répondrait « aucune retenue » rendrait le
   * geste d'urgence inopérant au moment précis où on en a besoin.
   */
  async function readHold(version) {
    if (!holdsUrl) return holdDecision({ version, readOk: false });
    try {
      const res = await fetch(holdsUrl, { signal: AbortSignal.timeout(4000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const parsed = await res.json();
      if (!parsed || !Array.isArray(parsed.holds)) throw new Error('liste absente');
      return holdDecision({ version, holds: parsed.holds, readOk: true });
    } catch (e) {
      log(`retenues illisibles ${(e && e.message) || e}`);
      return holdDecision({ version, readOk: false });
    }
  }

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

  // ─── Un poste bloqué doit le DIRE ─────────────────────────────────────────
  // La porte ferme le poste ; elle ne le faisait pas parler : ses échecs
  // partaient dans `console.log`, c'est-à-dire nulle part pour qui n'ouvre pas
  // les outils de développement. Le journal local est la moitié qui marche
  // TOUJOURS (aucune session, aucun réseau — voir electron/update-journal.cjs) ;
  // l'envoi au journal d'audit est l'autre moitié, et elle part de l'interface,
  // où l'utilisateur connecté existe.
  const journalFile = journalPath({ userDataDir: app.getPath('userData') });
  const station = os.hostname();
  /** Le dernier état de blocage connu, ou null — poussé à l'interface. */
  let blocked = null;

  /**
   * Inscrire l'état du poste, s'il est bloqué — décidé par la politique, pas ici.
   * @param {{ forced?: boolean, status?: string|null, detail?: string|null,
   *   isPortable?: boolean, installPending?: boolean, version?: string|null }} input
   */
  function reportBlocked(input) {
    const verdict = gateFailure({ ...input, isPortable: isPortable || input.isPortable === true });
    if (!verdict.blocked) return verdict;
    const written = appendEntry(journalFile, {
      code: verdict.code,
      version: input.version ?? null,
      currentVersion: app.getVersion(),
      station,
      detail: verdict.detail,
    });
    blocked = {
      code: verdict.code,
      detail: verdict.detail,
      station,
      journal: journalFile,
      // « inscrit » et « pas pu écrire » sont deux états : un poste bloqué qu'on
      // n'a pas pu journaliser doit le dire, sinon le geste d'ouverture du
      // journal ne mènerait à rien.
      recorded: written,
    };
    log(`poste bloqué (${verdict.code})${written ? '' : ' — journal NON ÉCRIT'} — ${verdict.detail}`);
    broadcast({ blocked });
    return verdict;
  }

  // Une installation tentée et revenue sur la même version est le cas le plus
  // silencieux des trois : on l'inscrit avant même la première vérification.
  if (lastInstall.attempted && lastInstall.cachedVersion && lastInstall.cachedVersion !== app.getVersion()) {
    reportBlocked({ installPending: true, version: lastInstall.cachedVersion });
  }

  let lastCheckAt = null;
  let lastPromptAt = null;
  // Le retard de CE poste, recalculé dès qu'une version est annoncée. Il vit à
  // part de l'état poussé à l'interface : l'interface a besoin de le MONTRER
  // (et de bloquer tant qu'il est obligatoire), le main a besoin de le décider.
  // Les deux champs restent dérivés de la même fonction, jamais d'un doublon.
  let pressure = updatePressure({ currentVersion: app.getVersion() });
  const pressureState = (info) => {
    pressure = updatePressure({
      currentVersion: app.getVersion(),
      availableVersion: info && info.version,
      releaseDate: info && info.releaseDate,
      nowMs: Date.now(),
    });
    return {
      currentVersion: app.getVersion(),
      availableVersion: (info && info.version) || null,
      forced: pressure.forced,
      forcedCode: pressure.code,
      forcedDetail: pressure.detail,
      behindMajor: pressure.behindMajor,
      behindMinor: pressure.behindMinor,
      releaseAgeDays: pressure.releaseAgeDays,
    };
  };

  autoUpdater.on('checking-for-update', () => {
    lastCheckAt = Date.now();
    broadcast({ status: 'checking' });
    log('checking-for-update');
  });
  autoUpdater.on('update-available', async (i) => {
    // Le frein se lit AVANT d'annoncer : une version retenue ne doit ni être
    // proposée, ni imposée, ni installée.
    const hold = await readHold(i.version);
    const patch = pressureState(i);
    const gate = updateGate({ pressure, hold });
    if (!gate.deliverable) {
      heldVersion = i.version;
      // Rien de ce qui est déjà téléchargé ne doit s'installer : le frein couvre
      // aussi le « installation à la fermeture » d'electron-updater.
      autoUpdater.autoInstallOnAppQuit = false;
      broadcast({ ...patch, forced: false, status: 'held', version: i.version });
      log(`update-retenue ${i.version} — ${gate.detail}`);
      return;
    }
    // Une obligation écartée par le frein doit se VOIR dans le journal : sinon
    // un poste qui était « forçable » resterait immobile sans que personne ne
    // sache pourquoi.
    if (!gate.forced && pressure.forced) log(`obligation écartée — ${gate.detail}`);
    broadcast({ ...patch, forced: gate.forced, status: 'available', version: i.version });
    log(`update-available ${i.version}${gate.forced ? ` — OBLIGATOIRE (${pressure.detail})` : ''}`);
    // Le portable ne pourra JAMAIS satisfaire la porte (electron-updater exige
    // l'installeur NSIS) : obligé et portable, c'est un blocage par construction,
    // et il faut une main humaine — donc on le dit tout de suite.
    reportBlocked({ forced: gate.forced, version: i.version });
  });
  autoUpdater.on('update-not-available', () => {
    broadcast({ status: 'current', version: app.getVersion() });
    log('update-not-available');
  });
  autoUpdater.on('error', (e) => {
    const detail = (e && e.message) || String(e);
    broadcast({ status: 'error', detail });
    log(`error ${detail}`);
    // Un échec de téléchargement sur un poste OBLIGÉ ferme la porte : il part au
    // journal avec son motif, au lieu de laisser quelqu'un devant un écran qui
    // dit seulement « téléchargement ».
    reportBlocked({ forced: pressure.forced, status: 'error', detail });
  });
  autoUpdater.on('download-progress', (p) => {
    broadcast({ status: 'downloading', percent: Math.round(p.percent) });
    log(`download-progress ${Math.round(p.percent)}%`);
  });
  autoUpdater.on('update-downloaded', async (i) => {
    if (heldVersion === i.version) {
      // Le seul chemin qui restait ouvert : une version retenue s'installe
      // encore si on la laisse partir à la fermeture. Le frein le ferme ici.
      autoUpdater.autoInstallOnAppQuit = false;
      log(`update-downloaded ${i.version} — INSTALLATION REFUSÉE (version retenue)`);
      return;
    }
    broadcast({ ...pressureState(i), status: 'downloaded', version: i.version });
    log(`update-downloaded ${i.version}${pressure.forced ? ` — OBLIGATOIRE (${pressure.detail})` : ''}`);
    if (process.env.UPDATER_LOG_FILE) return; // proof mode — E2E reads the log
    await askToInstall(i);
  });

  /**
   * Pose la question — et la repose. « Plus tard » reporte, il ne refuse pas.
   */
  async function askToInstall(info) {
    // Une version retenue ne se demande pas, même depuis un rappel déjà
    // programmé : le frein doit tenir sur TOUS les chemins qui mènent à
    // l'installation, pas seulement sur celui qu'on vient d'écrire.
    if (heldVersion === info.version) {
      log(`prompt refusé — ${info.version} est retenue`);
      return;
    }
    // Une obligation ne se reporte pas : on relance tout de suite, et la
    // boîte de dialogue n'offre plus « Plus tard ».
    const forced = pressure.forced;
    const reinvite = forced ? FORCED_RE_PROMPT_MS : RE_PROMPT_MS;
    const verdict = shouldPrompt({ downloaded: true, lastPromptAt, nowMs: Date.now(), rePromptMs: reinvite, forced });
    if (!verdict.prompt) {
      // Le report court encore : on programme le prochain rappel au lieu de
      // l'abandonner, sinon la version téléchargée serait gardée pour soi.
      const waitMs = Math.max(1000, reinvite - (Date.now() - (lastPromptAt || Date.now())));
      setTimeout(() => { void askToInstall(info); }, waitMs).unref?.();
      return;
    }
    lastPromptAt = Date.now();
    log(`prompt ${verdict.reason}`);
    if (isPortable) {
      const { response } = await dialog.showMessageBox(win, {
        type: 'info',
        title: forced ? 'Mise à jour obligatoire' : 'Mise à jour disponible',
        message: `La version ${info.version} est disponible.`,
        detail: forced ? `Mise à jour obligatoire : ${pressure.detail}. ${action.detail}` : action.detail,
        buttons: forced ? ['Ouvrir la page de téléchargement'] : ['Ouvrir la page de téléchargement', 'Plus tard'],
        defaultId: 0,
        ...(forced ? {} : { cancelId: 1 }),
      });
      if (response === 0) shell.openExternal(RELEASES_URL);
      return;
    }
    const { response } = await dialog.showMessageBox(win, {
      type: 'info',
      title: forced ? 'Mise à jour obligatoire' : 'Mise à jour disponible',
      message: forced
        ? `Mise à jour obligatoire : vous êtes en ${app.getVersion()}, la version ${info.version} doit être installée.`
        : `La version ${info.version} est prête à être installée.`,
      detail: forced
        ? `Retard constaté : ${pressure.detail}. Redémarrer maintenant pour l'appliquer.`
        : 'Redémarrer maintenant pour appliquer la mise à jour ?',
      buttons: forced ? ['Redémarrer maintenant'] : ['Redémarrer maintenant', 'Plus tard'],
      defaultId: 0,
      ...(forced ? {} : { cancelId: 1 }),
    });
    if (response === 0) {
      // Sentinel: marks an install attempt. If the app comes up again on this
      // version, purgeStaleUpdaterCache() wipes the shared cache on next start.
      try { fs.writeFileSync(installPendingFlag(), `${new Date().toISOString()}\n`); } catch { /* best-effort */ }
      autoUpdater.quitAndInstall();
    } else {
      // Report : on repropose plus tard sans attendre un redémarrage.
      setTimeout(() => { void askToInstall(info); }, reinvite).unref?.();
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
    // L'interface peut relancer une vérification : une mise à jour obligatoire
    // dont le téléchargement a échoué doit offrir un remède, sinon la seule
    // issue serait d'attendre l'intervalle suivant — ou de fermer l'application.
    ipcMain.handle('updates:check-now', async () => {
      await autoUpdater.checkForUpdates().catch((e) => log(`check-failed ${(e && e.message) || e}`));
      return state;
    });
    // Le journal du poste, lisible par un humain devant la machine : c'est le
    // seul canal qui existe quand le poste n'a aucune session.
    ipcMain.handle('updates:journal', () => ({
      path: journalFile,
      station,
      entries: readEntries(journalFile, { limit: 20 }),
    }));
    // La FILE D'ATTENTE du poste : les blocages inscrits qu'aucun envoi n'a
    // encore emportés. Un poste d'école démarre bloqué sans personne de
    // connecté — l'envoi au journal d'audit est alors impossible — donc ces
    // entrées attendent ici, et le prochain démarrage connecté les remonte.
    ipcMain.handle('updates:pending-reports', () => ({
      path: journalFile,
      station,
      entries: pendingReports(journalFile, { limit: 20 }),
    }));
    // Le marquage : l'interface dit ce qui est RÉELLEMENT parti, et rien d'autre.
    // Borné à 20 clés (autant que la file), et une clé qui ne correspond à aucune
    // entrée du journal ne marque rien — il n'y a pas de surface pour réécrire
    // le journal du poste depuis l'interface.
    ipcMain.handle('updates:mark-reported', (_event, keys) => ({
      ...markReported(journalFile, Array.isArray(keys) ? keys.map(String).slice(0, 20) : []),
      path: journalFile,
    }));
    ipcMain.handle('updates:open-journal', () => {
      // Le fichier peut ne pas exister (aucun blocage) : le créer rend le geste
      // utile au lieu d'échouer sans rien dire.
      try {
        if (!fs.existsSync(journalFile)) {
          fs.mkdirSync(path.dirname(journalFile), { recursive: true });
          fs.writeFileSync(journalFile, '');
        }
        shell.showItemInFolder(journalFile);
      } catch (e) {
        log(`ouverture du journal échouée ${(e && e.message) || e}`);
        return { ok: false, path: journalFile };
      }
      return { ok: true, path: journalFile };
    });
    ipcMain.handle('updates:install', async () => {
      if (heldVersion && heldVersion === state.version) {
        return { ok: false, reason: `version ${heldVersion} retenue — installation refusée` };
      }
      // Le portable n'a jamais « rien de téléchargé » : sa seule action possible
      // est la page de téléchargement, et l'y renvoyer est le geste attendu —
      // surtout quand la mise à jour est obligatoire et qu'il n'a rien d'autre.
      if (!isPortable && state.status !== 'downloaded') return { ok: false, reason: 'aucune mise à jour prête' };
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