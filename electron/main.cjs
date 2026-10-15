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
// Security: contextIsolation ON, nodeIntegration OFF, sandbox ON, and the
// renderer runs under an ENFORCED Content-Security-Policy (below: the local
// document gets the desktop policy as a response header, and the built HTML
// carries the same policy in a meta — see electron/csp-policy.cjs, whose
// measured reasons are written there). The renderer only talks to Supabase over
// HTTPS; navigation is locked to the app surface and external links open in the
// system browser.
// ─────────────────────────────────────────────────────────────────────────────
const { app, BrowserWindow, dialog, ipcMain, session, shell } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { downloadPlan } = require('./download-policy.cjs');
const { installCsp } = require('./csp-policy.cjs');
const { appendEntry, readEntries, journalPath, pendingReports, markReported } = require('./update-journal.cjs');
const { beatPayload, recordBeat, stationPath } = require('./station-beat.cjs');

// L'origine publique vit dans UN SEUL fichier (`public-origin.cjs`), lu ici par le
// poste et par `scripts/check-public-origin.mjs` : deux écritures de la même URL
// peuvent s'accorder aujourd'hui et diverger le jour où l'une bouge — et c'est
// l'une des deux qui déciderait ce qu'un poste affiche.
const { PUBLIC_ORIGIN: FALLBACK_URL } = require('./public-origin.cjs');
// Où atterrit un poste qui ne peut pas s'auto-installer (portable) : le lien est
// tenu par l'INVENTAIRE des liens embarqués, pour la même raison que l'origine.
// Une URL en clair ici partait dans chaque installeur sans que rien ne la relise
// — un test interdit d'en réécrire une autre en clair dans ce fichier.
const { RELEASES_URL } = require('./embedded-links.cjs');
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

// ─── Un poste = UNE instance ────────────────────────────────────────────────
// Mesuré : deux instances de l'application, ce sont deux boucles de vérification
// qui écrivent dans le MÊME dossier de cache (`updaterCacheDir()`, partagé entre
// installations) — deux téléchargements, deux « Redémarrer », deux installeurs
// pour une seule mise à jour. Le verrou est pris ICI, avant toute fenêtre : la
// seconde instance rend la main et met au premier plan celle qui vit déjà.
const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    const [existing] = BrowserWindow.getAllWindows();
    if (!existing) return;
    if (existing.isMinimized()) existing.restore();
    existing.focus();
  });
}

// L'interface a-t-elle annoncé qu'elle montre la question de mise à jour ?
// C'est l'entrée de `askOwner` (politique). Remise à FAUX à chaque nouveau
// document : un renderer qui recharge n'a plus personne pour poser la question
// tant qu'il n'a pas reparlé.
let rendererReady = false;

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

/**
 * Enlever les octets du cache updater.
 *
 * C'est la SEULE chose qui empêche une réutilisation : electron-updater relit
 * `pending/update-info.json` et, si l'empreinte correspond, ressert le dossier
 * sans aucun GET. Un payload refusé qui resterait là serait donc « téléchargé »
 * à nouveau à chaque vérification sans jamais repasser par le réseau — et un
 * poste pourrait tourner des semaines sur des octets qu'on a jugés mauvais.
 *
 * @returns {boolean} vrai si un dossier existait et a été enlevé.
 */
function wipeUpdaterCache(log, why) {
  const dir = updaterCacheDir();
  if (!fs.existsSync(dir)) return false;
  fs.rmSync(dir, { recursive: true, force: true });
  log(`cache electron-updater purgé (${why})`);
  return true;
}

function purgeStaleUpdaterCache(log) {
  const flag = installPendingFlag();
  if (!fs.existsSync(flag)) return { attempted: false, cachedVersion: null }; // no attempted install → cache stays (e.g. "Later")
  fs.rmSync(flag, { force: true });
  const cachedVersion = staleCacheVersion();
  if (!fs.existsSync(updaterCacheDir())) {
    log('installation précédente non aboutie — cache updater absent');
    return { attempted: true, cachedVersion };
  }
  const outcome = cachedVersion && cachedVersion !== app.getVersion()
    ? 'installation précédente non aboutie'
    : 'mise à jour appliquée (cache inutile)';
  wipeUpdaterCache(log, outcome);
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
    shouldCheck, shouldPrompt, downloadConsent, updateAction, updatePressure,
    holdsUrlFrom, holdDecision, updateGate, gateFailure, askOwner, installClaim,
    CHECK_INTERVAL_MS, FOCUS_COOLDOWN_MS, RE_PROMPT_MS, FORCED_RE_PROMPT_MS,
  } = require('./updater-policy.cjs');
  const { feedUrlFrom, inspectUpdateFailure } = require('./update-feed.cjs');
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
  // Read once, used by the brake and by the byte-promise check: the OWNER/REPO
  // and the feed URL come from the same file electron-builder writes, so neither
  // is recopied in this process.
  const appUpdateYml = (() => {
    try {
      return fs.readFileSync(path.join(process.resourcesPath, 'app-update.yml'), 'utf8');
    } catch { return null; }
  })();
  const holdsUrl = holdsUrlFrom({
    // Un mode preuve peut pointer le frein ailleurs (serveur local) sans rien publier.
    feedOverride: process.env.UPDATER_HOLD_URL || process.env.UPDATER_FEED_URL || null,
    appUpdateYml,
  });
  log(`retenues ${holdsUrl || 'URL indéterminable — aucune obligation ne sera imposée'}`);
  /** Où lire la promesse d'octets, sur ce poste. */
  const feedUrlForPoste = () => feedUrlFrom({ feedOverride: process.env.UPDATER_FEED_URL || null, appUpdateYml });
  /** La version que ce poste refuse d'installer (retenue ET lue). */
  let heldVersion = null;
  /**
   * La version dont les OCTETS ne répondent pas à la promesse du flux.
   *
   * Retenue ET octets menteurs refusent la même chose — installer — mais pour
   * deux raisons opposées : le frein dit « cette version est mauvaise », celle-ci
   * dit « ces octets ne sont pas ceux qu'on m'annonce ». Les deux gardes restent,
   * parce qu'une version peut être retenue après avoir été téléchargée, et que
   * des octets menteurs peuvent arriver sur une version que personne n'a retenue.
   */
  let refusedVersion = null;

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
  // AUCUN téléchargement sans que quelqu'un l'ait voulu — ni sur un poste
  // installé, ni sur le portable.
  //
  // Mesuré : « l'app ne demande pas de faire la mise à jour quand on la lance ».
  // Avec `autoDownload = true`, 129 Mo partaient en silence et la seule question
  // du module n'arrivait qu'à `update-downloaded` — donc après la fin du
  // téléchargement, un instant qui peut ne jamais venir sur un lien d'école. Sur
  // le portable (`autoDownload = false`), il ne venait JAMAIS : rien ne lançait le
  // téléchargement, donc `update-downloaded` ne se déclenchait pas, donc la
  // boîte de dialogue qui existait déjà pour lui était **inatteignable**. Le
  // poste apprenait qu'une version existait et n'en parlait à personne.
  //
  // La décision vit dans `electron/updater-policy.cjs` (`downloadConsent`) : la
  // question vient AVANT les octets, et le mode preuve télécharge tout de suite
  // pour que la séquence prouvée par l'E2E reste la même.
  autoUpdater.autoDownload = false;

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
  // Le relevé de parc (§7 du canal) tient à côté du journal, dans `userData` :
  // même disque, même absence de réseau, même absence de session.
  const stationBeatFile = stationPath({ userDataDir: app.getPath('userData') });

  /**
   * Le majeur de Windows, tel que le relevé le publie (« 10 », « 11 »).
   *
   * Il vient de la PLATEFORME, pas de `process.platform` (qui dit seulement
   * « win32 ») : c'est le seul champ du relevé qui parle du système, et il sert
   * à repérer un poste resté sur une version que l'école a cessé d'utiliser.
   */
  const osMajor = () => {
    try {
      return String(process.getSystemVersion() || '').split('.')[0] || null;
    } catch {
      return null;
    }
  };

  /**
   * Inscrire le battement du poste — et JAMAIS faire dépendre une mise à jour
   * de cette écriture. `recordBeat` ne jette pas : un disque plein rend `false`,
   * on le dit dans le journal du poste, et le contrôle continue. Le contraire
   * (une mise à jour bloquée par un relevé) serait le pire des deux sens.
   */
  const recordStationBeat = ({ lastCheck, proposedVersion = null } = {}) => {
    const written = recordBeat(stationBeatFile, {
      appVersion: app.getVersion(),
      osVersion: osMajor(),
      lastCheck,
      lastCheckVersion: proposedVersion,
    });
    if (!written) log(`battement non inscrit (${lastCheck}) — la mise à jour n'en dépend pas`);
    return written;
  };

  /**
   * Classer un échec de contrôle dans les QUATRE états du relevé.
   *
   * La spécification (§7) nomme trois façons d'échouer, et elles n'ont pas le
   * même remède : `feed-absent` (le flux n'existe pas — c'est le canal qu'il faut
   * réparer, et pour TOUS les postes), `html` (l'origine a répondu 200 en HTML :
   * le piège mesuré de cette origine, qui n'est PAS un 404), `unreachable` (le
   * poste n'a pas pu joindre le réseau — le remède est sur le poste). Le
   * classement se fait sur le message de la bibliothèque, faute de mieux :
   * electron-updater ne rend pas de code typé pour ces cas.
   *
   * Le DÉFAUT est `unreachable`, et c'est délibéré : un échec qu'on ne sait pas
   * classer dit « nous n'avons pas eu de réponse exploitable », jamais « tout va
   * bien ». Inventer `ok` sur un échec déclarerait à jour un poste qui vient
   * d'échouer — exactement ce que ce relevé existe pour empêcher.
   */
  const checkStateOfFailure = (detail) => {
    const text = String(detail || '').toLowerCase();
    if (/404|not found|cannot find|no such file|enoent/.test(text)) return 'feed-absent';
    if (/html|yaml|unexpected token|unexpected character|invalid /.test(text)) return 'html';
    if (/enotfound|eai_again|etimedout|econnrefused|econnreset|socket hang up|timeout|network|offline/.test(text)) {
      return 'unreachable';
    }
    return 'unreachable';
  };
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
  // La question du téléchargement a sa propre horloge : « télécharger 129 Mo »
  // et « redémarrer maintenant » sont deux consentements distincts, et reporter
  // l'un ne doit pas taire l'autre.
  let lastDownloadPromptAt = null;
  // ─── Un seul installeur possible ──────────────────────────────────────
  // Le verrou de la DEMANDE (pas de l'octet). Dès qu'une installation a été
  // demandée — boîte native ou bouton de l'interface — la seconde ne lance
  // rien : `quitAndInstall()` était appelé depuis deux endroits sans rien entre
  // eux, et un double clic lançait deux fois l'installeur NSIS.
  let installClaimed = false;
  // Le retard de CE poste, recalculé dès qu'une version est annoncée. Il vit à
  // part de l'état poussé à l'interface : l'interface a besoin de le MONTRER
  // (et de bloquer tant qu'il est obligatoire), le main a besoin de le décider.
  // Les deux champs restent dérivés de la même fonction, jamais d'un doublon.
  let pressure = updatePressure({ currentVersion: app.getVersion() });
  const pressureState = (info) => {
    pressure = updatePressure({
      currentVersion: app.getVersion(),
      availableVersion: info && info.version,
    });
    return {
      currentVersion: app.getVersion(),
      availableVersion: (info && info.version) || null,
      forced: pressure.forced,
      forcedCode: pressure.code,
      forcedDetail: pressure.detail,
      behindMajor: pressure.behindMajor,
      behindMinor: pressure.behindMinor,
      behindPatch: pressure.behindPatch,
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
    // Le flux a répondu, et il propose une version : c'est un contrôle RÉUSSI,
    // même quand le frein retient ensuite cette version. Le relevé publie la
    // version proposée pour qu'une retenue se lise au niveau du parc, et pas
    // seulement dans le journal d'un poste.
    recordStationBeat({ lastCheck: 'ok', proposedVersion: i.version });
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
    // La question, MAINTENANT — pas après 129 Mo, et pas jamais sur le portable.
    void askToDownload({ version: i.version });
  });
  autoUpdater.on('update-not-available', () => {
    recordStationBeat({ lastCheck: 'ok' });
    broadcast({ status: 'current', version: app.getVersion() });
    log('update-not-available');
  });
  /**
   * Classer un échec AVANT de l'inscrire.
   *
   * « Le réseau a lâché » et « le canal sert autre chose que ce qu'il annonce »
   * n'ont pas le même remède : le premier se répare sur le poste (réessayer), le
   * second SEULEMENT sur le canal — et il concerne tous les postes. Un parc qui
   * reçoit le second sous le nom du premier envoie ses administrateurs chercher
   * une panne de réseau scolaire qui n'existe pas.
   *
   * Le verdict vient de `electron/update-feed.cjs` : la promesse est relue dans
   * le flux du poste, et les octets restés sur le disque sont rehachés ici. Quand
   * la bibliothèque a déjà écarté le fichier, son propre refus reste la preuve —
   * c'est elle qui a comparé les octets à la promesse.
   */
  async function reportFailure({ detail, version = null }) {
    let fault = { fault: false, code: 'unknown', detail: 'vérification indisponible' };
    try {
      fault = await inspectUpdateFailure({
        feedUrl: feedUrlForPoste(),
        cacheDir: updaterCacheDir(),
        version,
        updaterDetail: detail,
      });
    } catch (err) {
      log(`promesse du flux non confrontée ${(err && err.message) || err}`);
    }
    if (fault.fault) {
      // REFUSER : la version ne s'installera pas, et les octets menteurs ne
      // pourront plus être resservis depuis le cache.
      refusedVersion = version;
      autoUpdater.autoInstallOnAppQuit = false;
      log(`octets non conformes au flux — installation refusée pour ${version || 'la version annoncée'}`);
      wipeUpdaterCache(log, 'payload refusé (octets non conformes au flux)');
    } else {
      log(`échec de téléchargement — ${fault.detail}`);
    }
    // Un échec sur un poste OBLIGÉ ferme la porte, et une promesse non tenue se
    // signale même hors obligation : il part au journal avec son motif, au lieu
    // de laisser quelqu'un devant un écran qui dit seulement « téléchargement ».
    reportBlocked({
      forced: pressure.forced,
      status: 'error',
      detail,
      version,
      checksumFault: fault.fault ? fault.detail : null,
    });
  }

  autoUpdater.on('error', (e) => {
    const detail = (e && e.message) || String(e);
    recordStationBeat({ lastCheck: checkStateOfFailure(detail) });
    broadcast({ status: 'error', detail });
    log(`error ${detail}`);
    void reportFailure({ detail, version: state.version ?? null });
    // Une question posée puis un téléchargement en échec doit REVENIR — mais
    // seulement quand la porte est fermée : une obligation ne se reporte pas,
    // donc elle se rappelle. Hors obligation, la boîte qui reviendrait toutes
    // les 15 min serait du harcèlement là où le bandeau, lui, reste à l'écran
    // avec un bouton « Réessayer » ; c'est lui qui porte ce cas-là.
    const announced = state.version;
    if (announced && pressure.forced) {
      setTimeout(() => { void askToDownload({ version: announced }); }, FORCED_RE_PROMPT_MS).unref?.();
    }
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
    if (refusedVersion === i.version) {
      // Les octets de cette version ne répondent pas à ce que le flux annonce :
      // ils ne s'installeront pas, ni maintenant, ni à la fermeture — et ils sont
      // retirés du cache pour ne pas être resservis à la prochaine vérification.
      autoUpdater.autoInstallOnAppQuit = false;
      log(`update-downloaded ${i.version} — INSTALLATION REFUSÉE (octets non conformes au flux)`);
      wipeUpdaterCache(log, 'payload refusé (octets non conformes au flux)');
      return;
    }
    broadcast({ ...pressureState(i), status: 'downloaded', version: i.version });
    log(`update-downloaded ${i.version}${pressure.forced ? ` — OBLIGATOIRE (${pressure.detail})` : ''}`);
    if (process.env.UPDATER_LOG_FILE) return; // proof mode — E2E reads the log
    await askToInstall(i);
  });

  /**
   * Demander, DÈS l'annonce, s'il faut télécharger — et pour le portable, où.
   *
   * Pendant de `askToInstall`, qui reste la question d'installation. Les deux
   * existent parce que ce sont deux consentements distincts : vouloir 129 Mo sur
   * le lien de l'école, puis vouloir perdre une minute à redémarrer.
   *
   * Le frein et les octets menteurs sont relus ICI comme partout ailleurs : une
   * version retenue ne se demande pas, même depuis un rappel déjà programmé.
   */
  async function askToDownload(info) {
    if (heldVersion === info.version) {
      log(`téléchargement non demandé — ${info.version} est retenue`);
      return;
    }
    if (refusedVersion === info.version) {
      log(`téléchargement non demandé — les octets de ${info.version} ne répondent pas au flux`);
      return;
    }
    const consent = downloadConsent({
      announced: true,
      proofMode: Boolean(process.env.UPDATER_LOG_FILE),
      portable: isPortable,
    });
    // Mode preuve : personne devant l'écran, et l'E2E lit le journal — on
    // télécharge tout de suite, sans modale, pour que la séquence prouvée
    // (`checking-for-update` → `update-available` → `download-progress` →
    // `update-downloaded`) reste exactement la même.
    if (consent.kind === 'auto') {
      log(`téléchargement lancé — ${consent.detail}`);
      autoUpdater.downloadUpdate().catch((e) => log(`téléchargement refusé ${(e && e.message) || e}`));
      return;
    }
    // Même règle que pour l'installation : un seul demandeur. L'interface
    // montre déjà l'état « disponible » avec son bouton (et, pour le portable,
    // le lien vers la page de téléchargement) ; une modale en plus, c'est deux
    // questions pour une seule réponse.
    if (askOwner({ uiReady: rendererReady }).owner === 'interface') {
      log('question de téléchargement portée par l’interface — aucune boîte native');
      return;
    }
    const forced = pressure.forced;
    const reinvite = forced ? FORCED_RE_PROMPT_MS : RE_PROMPT_MS;
    // `downloaded` vaut ici « il y a quelque chose à proposer », pas « les octets
    // sont là » : la cadence du report est la même pour les deux questions.
    const verdict = shouldPrompt({
      downloaded: true,
      lastPromptAt: lastDownloadPromptAt,
      nowMs: Date.now(),
      rePromptMs: reinvite,
      forced,
    });
    if (!verdict.prompt) {
      const waitMs = Math.max(1000, reinvite - (Date.now() - (lastDownloadPromptAt || Date.now())));
      setTimeout(() => { void askToDownload(info); }, waitMs).unref?.();
      return;
    }
    lastDownloadPromptAt = Date.now();
    log(`question de téléchargement — ${verdict.reason} (${consent.kind})`);
    if (consent.kind === 'open-download') {
      const { response } = await dialog.showMessageBox(win, {
        type: 'info',
        title: forced ? 'Mise à jour obligatoire' : 'Mise à jour disponible',
        message: `La version ${info.version} est disponible.`,
        detail: forced
          ? `Mise à jour obligatoire : ${pressure.detail}. ${consent.detail}`
          : consent.detail,
        buttons: forced ? ['Ouvrir la page de téléchargement'] : ['Ouvrir la page de téléchargement', 'Plus tard'],
        defaultId: 0,
        ...(forced ? {} : { cancelId: 1 }),
      });
      if (response === 0) shell.openExternal(RELEASES_URL);
      else setTimeout(() => { void askToDownload(info); }, reinvite).unref?.();
      return;
    }
    const { response } = await dialog.showMessageBox(win, {
      type: 'info',
      title: forced ? 'Mise à jour obligatoire' : 'Mise à jour disponible',
      message: forced
        ? `Mise à jour obligatoire : vous êtes en ${app.getVersion()}, la version ${info.version} doit être installée.`
        : `La version ${info.version} est disponible.`,
      detail: forced
        ? `Retard constaté : ${pressure.detail}. Le téléchargement puis l'installation suivent.`
        : 'Télécharger la mise à jour maintenant ? L’installation sera proposée ensuite.',
      buttons: forced ? ['Télécharger maintenant'] : ['Télécharger et installer', 'Plus tard'],
      defaultId: 0,
      ...(forced ? {} : { cancelId: 1 }),
    });
    if (response === 0) {
      log(`téléchargement accepté ${info.version}`);
      autoUpdater.downloadUpdate().catch((e) => log(`téléchargement refusé ${(e && e.message) || e}`));
    } else {
      log(`téléchargement reporté ${info.version}`);
      setTimeout(() => { void askToDownload(info); }, reinvite).unref?.();
    }
  }

  /**
   * LE SEUL chemin vers `quitAndInstall()` — et sa garde.
   *
   * Le défaut mesuré (« la mise à jour se lance deux fois ») n'était pas dans
   * l'installeur : il y avait deux portes pour le même paiement — la boîte
   * native et le bouton de l'interface (`updates:install`) — et rien entre elles.
   * Une demande par process ferme le sujet : la seconde réponse dit ce qu'elle a
   * fait (rien) au lieu de lancer un second installeur.
   *
   * `autoInstallOnAppQuit` passe à FAUX ici, et c'est la moitié qui manquait à
   * l'autre bout : sur le chemin normal sa valeur par défaut (`true`) fait
   * installer la mise à jour À LA FERMETURE. Le geste est voulu — une école ferme
   * la fenêtre le soir, et la preuve du canal s'appuie dessus — mais il ne doit
   * pas s'AJOUTER à un clic : deux gestes humains, un seul installeur.
   *
   * ─── L'INSTALLATION NE DEMANDE PLUS RIEN : les deux arguments, et pourquoi ──
   * Mesuré le 2026-10-15, poste de 1.0.35, clic sur « Installer » : au milieu de
   * la barre de progression, « MamaTheraFinance ne peut pas être fermé. Veuillez
   * la fermer manuellement et cliquez sur Réessayer pour continuer. » — et
   * « Réessayer » ne débloque rien, seul « Annuler » fait continuer. Le défaut
   * n'était pas dans l'installeur : il était dans CET appel.
   *
   * `quitAndInstall()` sans argument vaut `install(false, autoRunAppAfterInstall)`
   * (`BaseUpdater.js:13-16`), et `NsisUpdater.doInstall` en tire la ligne de
   * commande (`NsisUpdater.js:107-113`) : `--updated` toujours, `/S` SEULEMENT si
   * silencieux, `--force-run` si relance. L'installeur partait donc en mode
   * ASSISTÉ — l'assistant, ses pages, ses boîtes. Or chacune des boîtes qui
   * peuvent RETENIR une installation porte, dans le gabarit, un défaut `/SD` qui
   * n'est lu qu'en mode silencieux : sans `/S`, ce défaut ne s'applique jamais,
   * et c'est un humain qui répond.
   *
   * La boîte de la capture est l'une des DEUX boucles du gabarit qui portent ce
   * texte, et la mesure désigne celle-ci : `installUtil.nsh:219`, la boucle de
   * relance du désinstalleur de la version EN PLACE — après cinq sorties non nulles
   * (`UninstallLoop` ; et cette sortie non nulle est le plantage que
   * build/installer.nsh tolère plus bas), le gabarit affiche
   * `$(appCannotBeClosed)` avec `/SD IDCANCEL IDRETRY OneMoreAttempt`. Le compteur
   * ne redescend jamais sous cinq : « Réessayer » relance le vieux désinstalleur
   * UNE fois de plus, puis la MÊME boîte revient. Le bouton mis en avant est donc
   * celui qui ne finit pas, et le seul qui finit est celui que personne ne veut
   * cliquer. C'est aussi pourquoi la tolérance de `build/installer.nsh` ne
   * suffisait pas : elle juge le RÉSULTAT (`handleUninstallResult`), pas cette
   * boucle-ci — les deux moitiés se complètent, elles ne se remplacent pas.
   *
   * L'AUTRE boucle qui porte ce texte (`allowOnlyOneInstallerInstance.nsh:156`,
   * « l'application ne peut pas être fermée ») tombe dans le même piège — son
   * `/SD IDCANCEL` est suivi d'un `IDRETRY loop` qui ramène la même boîte — et
   * c'est la même chose qui la règle : le mode silencieux. C'est ce que
   * `tests/updater-silent-install.test.ts` vérifie comme une PROPRIÉTÉ du gabarit
   * installé (« aucune boîte qui peut retenir une installation sans `/SD` »)
   * plutôt que comme une liste de boîtes connues : la prochaine version de
   * `app-builder-lib` peut en ajouter une, et elle sera couverte.
   *
   * Les deux autres boîtes portant ce texte ont, elles aussi, un défaut qui
   * CONTINUE, donc rien n'est contourné : `allowOnlyOneInstallerInstance.nsh:156`
   * (`/SD IDCANCEL` — une application qu'on ne peut vraiment pas fermer laisse le
   * poste sur sa version, jamais à moitié installé) et `extractAppPackage.nsh:116`
   * (`/SD IDRETRY` — le dernier recours écrit en place et l'installation continue).
   * Le mode silencieux ne fait donc qu'une chose : il laisse le gabarit répondre
   * lui-même, dans le seul sens qui termine l'installation. Le chemin est déjà
   * éprouvé sur le canal réel — la fermeture du soir installe en silencieux depuis
   * toujours (`BaseUpdater.js:80`) ; c'est le CLIC qui lançait, pour les mêmes
   * octets, un installeur d'un autre mode.
   *
   * Le second argument est l'autre moitié, et sans lui la mise à jour fermerait
   * l'application pour de bon : sur l'installeur ASSISTÉ, la relance n'a lieu que
   * si `${isForceRun}` ET `${Silent}` (`installSection.nsh:104-108`) — elle vient
   * sinon de la case de la page finale, qu'une installation silencieuse n'a pas.
   * `--force-run` rend donc au bandeau la promesse qu'il affiche déjà (« version
   * prête : redémarrer pour l'installer »), sans qu'un humain ait à cliquer.
   *
   * @param {string} origin qui demande (pour que le journal du poste le dise)
   * @returns {{ ok: boolean, action?: string, reason?: string }}
   */
  function requestInstall(origin) {
    const claim = installClaim({ claimed: installClaimed });
    if (!claim.granted) {
      log(`installation refusée (${origin}) — ${claim.reason}`);
      return { ok: false, reason: claim.reason };
    }
    installClaimed = true;
    autoUpdater.autoInstallOnAppQuit = false;
    // Sentinel: marks an install attempt. If the app comes up again on this
    // version, purgeStaleUpdaterCache() wipes the shared cache on next start.
    try { fs.writeFileSync(installPendingFlag(), `${new Date().toISOString()}\n`); } catch { /* best-effort */ }
    log(`installation demandée (${origin}) — silencieuse, avec relance`);
    // Les deux `true` sont la réparation (voir l'en-tête) : silencieux, pour que
    // les défauts `/SD` du gabarit s'appliquent au lieu d'attendre un clic ;
    // relance, pour que l'application revienne sans page finale à valider.
    autoUpdater.quitAndInstall(true, true);
    return { ok: true, action: 'restart' };
  }

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
    if (refusedVersion === info.version) {
      log(`prompt refusé — les octets de ${info.version} ne répondent pas au flux`);
      return;
    }
    // La question a UN seul demandeur (voir `askOwner`) : tant que l'interface
    // l'affiche, la boîte native se taît. Sans ce partage, le poste demandait
    // deux fois la même chose — une modale ET un bandeau, chacun avec son bouton.
    if (askOwner({ uiReady: rendererReady }).owner === 'interface') {
      log('question d’installation portée par l’interface — aucune boîte native');
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
      // Le SEUL chemin d'installation, verrouillé (voir `requestInstall`) : la
      // sentinelle, le désarmement de l'installation à la fermeture et le
      // redémarrage vivent ensemble, au même endroit.
      requestInstall('boîte native');
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
    // L'interface ANNONCE qu'elle montre la question (bandeau monté) : c'est ce
    // qui fait d'elle le demandeur, et ce qui fait taire la boîte native. Sans ce
    // signal, le processus principal ne peut pas savoir si quelqu'un regarde
    // l'écran — et c'est exactement ce qui laissait les deux demandeurs parler en
    // même temps.
    ipcMain.handle('updates:ui-ready', (_event, active) => {
      // `false` = l'interface ne montre PLUS la question (bandeau masqué) : elle
      // rend la main au processus principal, qui reprend la boîte native et son
      // rappel. Sans ce retour, masquer le bandeau serait un silence — et la mise
      // à jour ne serait plus jamais demandée sur ce poste.
      rendererReady = active !== false;
      return { ok: true, owner: askOwner({ uiReady: rendererReady }).owner };
    });
    // LE BATTEMENT, en LECTURE seule : le rendu emporte ce que le processus
    // principal a inscrit, il ne compose rien lui-même. L'identité du poste ne
    // traverse donc jamais la page — elle ne peut ni être lue, ni être réécrite,
    // ni être fabriquée par ce qui s'exécute dans le navigateur embarqué.
    ipcMain.handle('updates:station-beat', () =>
      beatPayload({ userDataDir: app.getPath('userData'), fs, env: process.env }),
    );
    // L'interface peut relancer une vérification : une mise à jour obligatoire
    // dont le téléchargement a échoué doit offrir un remède, sinon la seule
    // issue serait d'attendre l'intervalle suivant — ou de fermer l'application.
    //
    // Le geste REMET AUSSI les deux questions à zéro. C'est un clic derrière une
    // porte fermée ou un « Réessayer » : faire attendre le report en cours ferait
    // d'un remède un bouton qui ne répond pas.
    ipcMain.handle('updates:check-now', async () => {
      lastDownloadPromptAt = null;
      lastPromptAt = null;
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
      if (isPortable) {
        shell.openExternal(RELEASES_URL);
        return { ok: true, action: 'open-download' };
      }
      // Une version ANNONCÉE mais pas encore téléchargée : le bouton doit
      // télécharger, pas répondre « aucune mise à jour prête ». C'est le seul
      // chemin qui reste au poste dont la question a été fermée puis oubliée.
      if (state.version && state.status !== 'downloaded') {
        // Un téléchargement DÉJÀ en cours ne repart pas : deux appels (la modale
        // et le bandeau, ou deux clics) ne doivent pas faire deux fois 129 Mo sur
        // le lien d'une école.
        if (state.status === 'downloading') return { ok: true, action: 'download' };
        log(`téléchargement demandé depuis l'interface ${state.version}`);
        await autoUpdater.downloadUpdate().catch((e) => log(`téléchargement refusé ${(e && e.message) || e}`));
        return { ok: true, action: 'download' };
      }
      if (state.status !== 'downloaded') return { ok: false, reason: 'aucune mise à jour prête' };
      // Le MÊME verrou que la boîte native : l'interface DEMANDE, elle
      // n'installe pas elle-même. Deux clics sur deux boutons différents ne
      // peuvent donc plus lancer deux installeurs pour une seule mise à jour.
      return requestInstall('interface');
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

  // Un nouveau document, c'est une interface neuve : elle doit RE-annoncer
  // qu'elle montre la question de mise à jour, sinon le processus principal
  // croirait un bandeau vivant alors que le renderer vient de recharger.
  win.webContents.on('did-start-loading', () => { rendererReady = false; });

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

  // Downloads: ONE output per download. Explicit save dialog by default;
  // auto-save when ELECTRON_DL_DIR is set (used by the E2E proof and kiosk-like
  // setups).
  //
  // Le 2026-09-13, le reçu d'un parent arrivait deux fois : tant que le chemin
  // n'est pas fixé, Electron applique sa « routine d'origine » (un dialogue),
  // donc ouvrir EN PLUS notre propre dialogue déclenchait deux enregistrements.
  // Le contrat est désormais dans electron/download-policy.cjs (pur, testé) :
  // soit un chemin imposé, soit les options du dialogue qu'Electron ouvre
  // lui-même — jamais les deux.
  win.webContents.session.on('will-download', (event, item) => {
    const plan = downloadPlan({ autoDir: process.env.ELECTRON_DL_DIR, filename: item.getFilename() });
    if (plan.kind === 'path') {
      fs.mkdirSync(plan.dir, { recursive: true });
      item.setSavePath(plan.path);
      return;
    }
    item.setSaveDialogOptions(plan.options);
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
  // Une seconde instance a déjà rendu la main (`app.quit()` plus haut) : elle ne
  // doit ni installer la CSP, ni ouvrir une fenêtre, ni brancher un updater.
  if (!hasSingleInstanceLock) return;
  // Correct taskbar grouping / notifications on Windows.
  app.setAppUserModelId('com.mamathera.finance');
  // LA CSP, appliquée AVANT que la première fenêtre n'existe : une fenêtre créée
  // d'abord chargerait son document — et un `@import` externe partirait — avant
  // que le filtre ne soit branché. Le filtre ne touche QUE nos documents locaux
  // (`file://`) : le repli HTTPS reçoit déjà sa vraie CSP de Vercel, et lui
  // appliquer la nôtre fermerait `worker-src` — donc son service worker, la
  // réserve hors ligne du site. Raisons mesurées : electron/csp-policy.cjs.
  installCsp(session.defaultSession);
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});