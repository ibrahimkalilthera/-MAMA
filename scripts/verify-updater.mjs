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
// 5. Decides WHETHER the update is mandatory, and requires the packaged app to
//    agree with the policy: with `UPDATER_FAKE_VERSION` above the local major,
//    the log must say OBLIGATOIRE (with its reason); at the same major, it must
//    NOT — an obligation announced for a patch release would block a whole
//    school for nothing, so the false direction is asserted too.
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
const FAKE_VERSION = process.env.UPDATER_FAKE_VERSION || '1.0.1';
const CURRENT_VERSION = JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf8')).version;
/** Une majeure d'écart suffit à rendre l'installation obligatoire (updater-policy.cjs). */
const EXPECT_FORCED = Number(FAKE_VERSION.split('.')[0]) > Number(String(CURRENT_VERSION).split('.')[0]);
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
  console.log(`🖥️  feed local: http://127.0.0.1:${PORT}/ (v${FAKE_VERSION} annoncée, poste en ${CURRENT_VERSION})`);
  console.log(EXPECT_FORCED
    ? '   retard d’une majeure ⇒ cette mise à jour DOIT être annoncée comme obligatoire'
    : '   même majeure ⇒ cette mise à jour NE DOIT PAS être obligatoire');

  // Startup sweep: kill orphaned MamaTheraFinance.exe from interrupted runs
  // (our electron-proof-ud marker, or past the minimum age window). Replaces
  // the blunt image-name taskkill that also killed a legitimately open app.
  const sweptE = await sweepOrphanElectron();
  if (sweptE) console.log(`🧹 ${sweptE} processus Electron orphelin(s) purgé(s)`);

  // Purge electron-updater's shared download cache: a previous successful run
  // leaves MamaTheraFinance-1.0.1-setup.exe there, so the app would "download"
  // from cache (sha512-validated) with no download-progress event — an
  // incomplete chain. Forcing a real download proves the full path.
  //
  // The purge can fail with EPERM right after the previous run: Windows still
  // holds the just-killed app's handles for a moment (measured). Retrying is
  // the fix; but when it ultimately fails, what matters is NOT the directory —
  // it is whether the file THE ANNOUNCED VERSION would be served from is
  // already there. Only that case makes the proof vacuous, and it fails loudly
  // instead of printing a green chain that skipped the download.
  // Ce qui rend un cache réutilisable n'est pas le dossier, c'est
  // `pending/update-info.json` : c'est LUI qu'electron-updater relit pour
  // valider le payload déjà téléchargé. Le gros installeur, lui, reste
  // volontiers verrouillé (handle d'un run précédent, analyse antivirus) —
  // mesuré ici, 20 tentatives d'1,5 s sur le dossier entier n'y suffisaient pas,
  // alors que le petit JSON s'enlève tout de suite.
  //
  // Pourquoi c'est une propriété et non un détail : le feed sert les MÊMES
  // octets pour toute version annoncée, donc le payload d'une version valide
  // aussi la suivante (même sha512). Un run l'a montré pour de vrai — annoncer
  // 2.0.0 a été « téléchargé » depuis le fichier 1.0.1 du run précédent, sans
  // aucun `download-progress`, et le script a conclu PROOF_FAIL pour la bonne
  // raison. Retirer l'info invalide le cache sans avoir besoin de toucher au
  // fichier ; et ce qui prouve que le téléchargement a bien eu lieu reste la
  // MÊME assertion qu'avant (`download-progress`), donc un cache encore valide
  // ne peut pas produire un vert vide.
  if (existsSync(UPDATER_CACHE)) {
    const pendingInfo = join(UPDATER_CACHE, 'pending', 'update-info.json');
    for (let i = 0; i < 20 && existsSync(pendingInfo); i++) {
      try { rmSync(pendingInfo, { force: true }); } catch { /* verrouillé un instant */ }
      if (existsSync(pendingInfo)) await wait(1000);
    }
    if (existsSync(pendingInfo)) {
      console.error('❌ pending/update-info.json reste illisible — le cache pourrait servir le download à la place, donc la preuve ne prouverait rien.');
      console.error('   Cause la plus probable : une application précédente tient encore le dossier. Ferme-la et relance.');
      throw new Error('cache electron-updater non invalidé');
    }
    let dirGone = false;
    try { rmSync(UPDATER_CACHE, { recursive: true, force: true }); dirGone = true; } catch { /* payload encore verrouillé : sans conséquence */ }
    console.log(dirGone
      ? '🧹 cache electron-updater purgé (téléchargement réel forcé)'
      : '🧹 pending/update-info.json retiré (payload verrouillé, sans conséquence : le cache ne valide plus rien)');
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

  // L'obligation est décidée par le processus principal de l'exe empaqueté : on
  // exige qu'il l'annonce quand elle est due, et qu'il s'abstienne sinon.
  const announcesForced = seen.some((m) => m.startsWith('update-available') && m.includes('OBLIGATOIRE'));
  const forcedRight = announcesForced === EXPECT_FORCED;
  console.log(forcedRight
    ? (EXPECT_FORCED
      ? `✅ l'exe empaqueté annonce l'obligation, avec son motif : ${seen.find((m) => m.includes('OBLIGATOIRE'))}`
      : '✅ l\'exe empaqueté n\'impose RIEN pour une version de la même majeure')
    : `❌ obligation annoncée=${announcesForced}, attendue=${EXPECT_FORCED}`);

  const ok = downloaded && seen.some((m) => m.startsWith('update-available')) &&
    seen.some((m) => m.startsWith('checking-for-update')) &&
    seen.some((m) => m.startsWith('download-progress')) &&
    rechecked && forcedRight;
  console.log(ok ? `\n✅ chaîne complète vérifiée: checking → available ${FAKE_VERSION} → progress → downloaded (+ ${checks} vérifications, obligation=${announcesForced})` : '\n❌ chaîne incomplète');
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