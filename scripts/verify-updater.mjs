// ─────────────────────────────────────────────────────────────────────────────
// scripts/verify-updater.mjs — E2E proof of the auto-update path.
//
// 1. Serves a local update feed (HTTP) that claims version 1.0.1 and serves
//    the REAL installer bytes (sha512 computed from those bytes, so the
//    download verification passes).
// 2. Launches the packaged win-unpacked exe (not the portable — auto-update
//    is disabled there by design) with:
//      UPDATER_FEED_URL=http://127.0.0.1:<port>/   → override the GitHub feed
//      UPDATER_LOG_FILE=<temp>                     → proof mode (no modal)
//      --user-data-dir=<isolated>                  → clean session
// 3. Asserts the updater walks the full chain:
//      checking-for-update → update-available 1.0.1 → download-progress →
//      update-downloaded 1.0.1
// 4. Kills the app + server and cleans the temp dirs.
//
// Exit 0 + PROOF_OK = the packaged app checks, finds, downloads and verifies
// an update — the same code path a published GitHub release would use.
// ─────────────────────────────────────────────────────────────────────────────
import { createServer } from 'node:http';
import { readFileSync, rmSync, existsSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { sweepOrphanElectron } from './lib/orphan-chrome.mjs';

const SETUP = join(process.cwd(), 'release', 'MamaTheraFinance-1.0.0-setup.exe');
const EXE = join(process.cwd(), 'release', 'win-unpacked', 'MamaTheraFinance.exe');
const PORT = 9450 + Math.floor(Math.random() * 100);
const TMP = tmpdir();
const LOG_FILE = join(TMP, `updater-proof-${Date.now()}.log`);
const USER_DATA = join(TMP, `electron-proof-ud-updater-${Date.now()}`);
// electron-updater's shared download cache (app-update.yml → updaterCacheDirName).
const UPDATER_CACHE = join(process.env.LOCALAPPDATA || join(tmpdir(), 'AppData', 'Local'), 'mama-thera-finance-updater');
const FAKE_VERSION = '1.0.1';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

if (!existsSync(SETUP) || !existsSync(EXE)) {
  console.error('❌ artifacts manquants — lance d’abord npm run electron:dist');
  process.exit(1);
}

const exeBytes = readFileSync(SETUP);
const sha512 = createHash('sha512').update(exeBytes).digest('base64');
const latestYml = [
  `version: ${FAKE_VERSION}`,
  'files:',
  `  - url: MamaTheraFinance-${FAKE_VERSION}-setup.exe`,
  `    sha512: ${sha512}`,
  `    size: ${exeBytes.length}`,
  `path: MamaTheraFinance-${FAKE_VERSION}-setup.exe`,
  `sha512: ${sha512}`,
  `releaseDate: '${new Date().toISOString()}'`,
  '',
].join('\n');

const server = createServer((req, res) => {
  const path = (req.url || '/').split('?')[0];
  if (path === '/latest.yml') {
    res.writeHead(200, { 'Content-Type': 'text/yaml' });
    res.end(latestYml);
    console.log(`  [feed] GET /latest.yml → v${FAKE_VERSION}`);
  } else if (path === `/MamaTheraFinance-${FAKE_VERSION}-setup.exe`) {
    res.writeHead(200, { 'Content-Length': exeBytes.length });
    res.end(exeBytes);
    console.log(`  [feed] GET ${path} → ${exeBytes.length} octets`);
  } else {
    res.writeHead(404);
    res.end();
  }
});

let app = null;
try {
  await new Promise((res) => server.listen(PORT, '127.0.0.1', res));
  console.log(`🖥️  feed local: http://127.0.0.1:${PORT}/ (v${FAKE_VERSION} annoncée)`);

  // Startup sweep: kill orphaned MamaTheraFinance.exe from interrupted runs
  // (our electron-proof-ud marker, or past the minimum age window). Replaces
  // the blunt image-name taskkill that also killed a legitimately open app.
  const sweptE = await sweepOrphanElectron();
  if (sweptE) console.log(`🧹 ${sweptE} processus Electron orphelin(s) purgé(s)`);

  // Purge electron-updater's shared download cache: a previous successful run
  // leaves MamaTheraFinance-1.0.1-setup.exe there, so the app would "download"
  // from cache (sha512-validated) with no download-progress event — an
  // incomplete chain. Forcing a real download proves the full path.
  if (existsSync(UPDATER_CACHE)) {
    rmSync(UPDATER_CACHE, { recursive: true, force: true });
    console.log('🧹 cache electron-updater purgé (téléchargement réel forcé)');
  }

  app = spawn(EXE, [`--user-data-dir=${USER_DATA}`], {
    env: {
      ...process.env,
      UPDATER_FEED_URL: `http://127.0.0.1:${PORT}/`,
      UPDATER_LOG_FILE: LOG_FILE,
      // L'application reste OUVERTE quelques secondes de plus que l'intervalle :
      // on prouve ainsi ce qui manquait aux postes d'école — une version
      // publiée pendant que l'application tourne est revue, et non seulement
      // cinq secondes après le démarrage. Sans ce réglage, il faudrait attendre
      // les 30 minutes de production.
      UPDATER_CHECK_INTERVAL_MS: '6000',
      UPDATER_FOCUS_COOLDOWN_MS: '1',
    },
    stdio: 'ignore',
  });
  console.log('🚀 exe empaqueté lancé (win-unpacked, profil isolé)…');

  // `seen` garde l'ORDRE et les DOUBLONS : c'est le nombre de vérifications qui
  // prouve la reprise périodique, donc on ne déduplique plus les événements.
  const seen = [];
  let downloaded = false;
  for (let i = 0; i < 90 && !downloaded; i++) {
    await wait(1000);
    if (!existsSync(LOG_FILE)) continue;
    const lines = readFileSync(LOG_FILE, 'utf8').split('\n').filter(Boolean);
    const messages = lines.map((l) => l.replace(/^\S+\s+/, ''));
    for (const msg of messages.slice(seen.length)) {
      seen.push(msg);
      console.log(`  [updater] ${msg}`);
    }
    downloaded = seen.some((m) => m.startsWith('update-downloaded'));
  }

  // L'application est laissée ouverte ~15 s après le téléchargement pour
  // observer AU MOINS une vérification supplémentaire : c'est la propriété qui
  // manquait (« une version publiée pendant que l'app tourne doit être vue »).
  await wait(15000);
  if (existsSync(LOG_FILE)) {
    const late = readFileSync(LOG_FILE, 'utf8').split('\n').filter(Boolean).map((l) => l.replace(/^\S+\s+/, ''));
    for (const msg of late.slice(seen.length)) {
      seen.push(msg);
      console.log(`  [updater] ${msg}`);
    }
  }
  const checks = seen.filter((m) => m.startsWith('checking-for-update')).length;
  const rechecked = checks >= 2;
  console.log(rechecked ? `✅ ${checks} vérifications pendant la MÊME session (reprise périodique)` : `❌ ${checks} vérification(s) — l'app ouverte ne revoit rien passer`);

  const ok = downloaded && seen.some((m) => m.startsWith('update-available')) &&
    seen.some((m) => m.startsWith('checking-for-update')) &&
    seen.some((m) => m.startsWith('download-progress')) &&
    rechecked;
  console.log(ok ? `\n✅ chaîne complète vérifiée: checking → available ${FAKE_VERSION} → progress → downloaded (+ ${checks} vérifications)` : '\n❌ chaîne incomplète');
  console.log(ok ? 'PROOF_OK' : 'PROOF_FAIL');
  process.exitCode = ok ? 0 : 1;
} catch (e) {
  console.error('❌', e.message);
  process.exitCode = 1;
} finally {
  try { app && app.kill(); } catch { /* ignore */ }
  // Post-run sweep: our own app is killed by PID above; this replaces the
  // blunt taskkill with the age-windowed sweep (marker kills ours regardless
  // of age, a legitimately open fresh app is never touched).
  await sweepOrphanElectron();
  server.close();
  rmSync(LOG_FILE, { recursive: true, force: true });
  rmSync(USER_DATA, { recursive: true, force: true });
}