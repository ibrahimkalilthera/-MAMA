// ─────────────────────────────────────────────────────────────────────────────
// scripts/verify-updater.mjs — E2E proof of the auto-update path.
//
// Une passe, c'est :
// 1. un flux de mise à jour local (HTTP) qui annonce UNE version et une date de
//    publication, et sert les VRAIS octets de l'installeur (sha512 calculé sur
//    ces octets, donc la vérification du téléchargement passe) ;
// 2. l'exe empaqueté lancé (win-unpacked, jamais le portable — l'auto-update y
//    est désactivé par conception) avec :
//      UPDATER_FEED_URL=http://127.0.0.1:<port>/   → remplacer le flux GitHub
//      UPDATER_LOG_FILE=<temp>                     → mode preuve (pas de modale)
//      --user-data-dir=<isolated>                  → session propre
// 3. l'exigence que la chaîne soit parcourue en entier :
//      checking-for-update → update-available <v> → download-progress →
//      update-downloaded <v>
// 4. la destruction de l'app + du serveur et le nettoyage des temporaires.
//
// ─── Ce que les passes ajoutent, et pourquoi une seule ne suffisait pas ──────
//
// `updater-policy.cjs` rend l'installation OBLIGATOIRE pour TROIS raisons
// distinctes (une majeure de retard, deux mineures, ou une publication vieille
// de 45 jours toujours pas installée), et une passe unique ne peut en prouver
// qu'une : le script ne savait montrer que « majeure de retard ⇒ obligatoire »,
// à la main, avec `UPDATER_FAKE_VERSION`. Or la règle qui attrape le cas réel
// des postes d'école est la DATE — une « petite » version publiée un jour où
// personne n'était devant le poste — et elle ne se prouve qu'en servant une date
// ancienne avec une version de la même majeure. D'où quatre passes, par défaut,
// chacune isolant UNE règle :
//
//   patch  même majeure, correctif récent      → NE DOIT PAS être obligatoire
//   age    même majeure, publié il y a > 45 j  → obligatoire, motif « toujours
//                                                pas installée »
//   minor  deux mineures de retard             → obligatoire, motif « mineure(s) »
//   major  une majeure de retard               → obligatoire, motif « majeure(s) »
//   hold   version RETENUE qui serait sinon obligatoire (même version et même
//          date que « age », avec une ligne de retenue dans le frein)
//                                              → AUCUNE obligation, et
//                                                `update-retenue <v>` au journal
//
// La passe `hold` est celle du frein d'urgence : elle sert un `updates/holds.json`
// (le fichier du dépôt, servi par le même flux) qui retient la version annoncée,
// et exige que l'obligation tombe. Comme les autres, elle ne vaut que sur un
// binaire empaqueté APRÈS le frein : sur un exe antérieur, ce script la dit
// rouge — la propriété n'est pas vraie de ce binaire-là, et le taire serait
// exactement le vert creux que le dépôt refuse.
//
// L'assertion ne porte pas seulement sur « OBLIGATOIRE oui/non » mais sur le
// MOTIF annoncé : sans ça, une règle qui forcerait tout le temps passerait pour
// verte dans les trois passes obligatoires. Les seuils (45 jours, 2 mineures,
// 1 majeure) sont LUS dans `electron/updater-policy.cjs` — jamais recopiés ici,
// sinon la preuve suivrait une valeur que le code a quittée.
//
// `UPDATER_PASSES=age,major` restreint le run (mise au point) ; sans variable,
// les quatre passes tournent.
//
// Exit 0 + PROOF_OK = l'exe empaqueté vérifie, trouve, télécharge et valide une
// mise à jour, et annonce l'obligation EXACTEMENT quand la politique la décide,
// avec le bon motif — le chemin exact qu'un release GitHub publié emprunte.
// ─────────────────────────────────────────────────────────────────────────────
import { createServer } from 'node:http';
import { readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { sweepOrphanElectron } from './lib/orphan-chrome.mjs';

const require = createRequire(import.meta.url);
// Les seuils viennent de la POLITIQUE, pas d'une copie : une preuve qui recopie
// un seuil finit par prouver une règle que le code n'applique plus.
const {
  FORCED_MAJOR_BEHIND,
  FORCED_MINOR_BEHIND,
  FORCED_RELEASE_AGE_DAYS,
} = require('../electron/updater-policy.cjs');

// Le nom de l'installeur PORTE la version (electron-builder : ${version}) : la
// lire dans package.json plutôt que l'écrire ici. Une montée de version a déjà
// rendu ce script muet (« artefacts manquants » sur une chaîne intacte), et une
// preuve qui échoue pour un numéro recopié n'apprend rien sur l'auto-update.
const CURRENT_VERSION = JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf8')).version;

const SETUP = join(process.cwd(), 'release', `MamaTheraFinance-${CURRENT_VERSION}-setup.exe`);
const EXE = join(process.cwd(), 'release', 'win-unpacked', 'MamaTheraFinance.exe');
const PORT = 9450 + Math.floor(Math.random() * 100);
const TMP = tmpdir();
const STAMP = Date.now();
// electron-updater's shared download cache (app-update.yml → updaterCacheDirName).
const UPDATER_CACHE = join(process.env.LOCALAPPDATA || join(tmpdir(), 'AppData', 'Local'), 'mama-thera-finance-updater');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/** [major, minor, patch] du paquet, ou null si la version n'est pas lisible. */
const LOCAL = (() => {
  const [major, minor, patch] = String(CURRENT_VERSION).split('.').map(Number);
  return [major, minor, patch].every(Number.isFinite) ? { major, minor, patch } : null;
})();

const ageDate = (days) => new Date(Date.now() - days * 86400000).toISOString();

/**
 * Les passes, chacune n'activant QU'UNE règle de la politique : la version
 * annoncée et la date de publication sont choisies pour ça. `because` est le
 * fragment de motif que l'app doit avoir écrit — c'est lui qui distingue la
 * règle qui a joué, pas seulement le fait qu'une obligation soit annoncée.
 */
const SCENARIOS = LOCAL ? [
  {
    id: 'patch',
    title: `même majeure, correctif récent (${LOCAL.major}.${LOCAL.minor}.${LOCAL.patch + 1})`,
    version: `${LOCAL.major}.${LOCAL.minor}.${LOCAL.patch + 1}`,
    releaseDate: ageDate(0),
    forced: false,
    detail: 'aucune règle ne doit s’appliquer',
  },
  {
    id: 'age',
    title: `correctif publié il y a ${FORCED_RELEASE_AGE_DAYS + 1} jours`,
    version: `${LOCAL.major}.${LOCAL.minor}.${LOCAL.patch + 1}`,
    releaseDate: ageDate(FORCED_RELEASE_AGE_DAYS + 1),
    forced: true,
    because: 'jour(s), toujours pas installée',
  },
  {
    id: 'minor',
    title: `${FORCED_MINOR_BEHIND} mineures de retard (${LOCAL.major}.${LOCAL.minor + FORCED_MINOR_BEHIND}.0)`,
    version: `${LOCAL.major}.${LOCAL.minor + FORCED_MINOR_BEHIND}.0`,
    releaseDate: ageDate(0),
    forced: true,
    because: 'mineure(s) de retard',
  },
  {
    id: 'hold',
    title: `version RETENUE qui serait obligatoire (${LOCAL.major}.${LOCAL.minor}.${LOCAL.patch + 1}, publiée il y a ${FORCED_RELEASE_AGE_DAYS + 1} jours)`,
    version: `${LOCAL.major}.${LOCAL.minor}.${LOCAL.patch + 1}`,
    releaseDate: ageDate(FORCED_RELEASE_AGE_DAYS + 1),
    // Même version et même date que la passe « age » — qui force. La SEULE
    // différence est la ligne de retenue : si l'obligation tombe quand même, le
    // frein a échoué, et c'est la seule chose que cette passe mesure.
    held: true,
    forced: false,
    chainRequired: false,
  },
  {
    id: 'major',
    title: `${FORCED_MAJOR_BEHIND} majeure de retard (${LOCAL.major + FORCED_MAJOR_BEHIND}.0.0)`,
    version: `${LOCAL.major + FORCED_MAJOR_BEHIND}.0.0`,
    releaseDate: ageDate(0),
    forced: true,
    because: 'majeure(s) de retard',
  },
] : [];

const wanted = (process.env.UPDATER_PASSES || '').split(',').map((s) => s.trim()).filter(Boolean);
const PASSES = wanted.length ? SCENARIOS.filter((s) => wanted.includes(s.id)) : SCENARIOS;

if (!existsSync(SETUP) || !existsSync(EXE)) {
  console.error('❌ artifacts manquants — lance d’abord npm run electron:dist');
  process.exit(1);
}
if (!PASSES.length) {
  console.error('❌ aucune passe à jouer — UPDATER_PASSES ne nomme aucune passe connue.');
  process.exit(2);
}

const exeBytes = readFileSync(SETUP);
const sha512 = createHash('sha512').update(exeBytes).digest('base64');

/** Le `latest.yml` servi : il change à chaque passe, c'est là que vit la règle. */
let feedYml = '';
/** Le frein servi (`updates/holds.json`) : vide, sauf pour la passe « hold ». */
let feedHolds = JSON.stringify({ holds: [] });
let servedSetup = 0;

const server = createServer((req, res) => {
  const path = (req.url || '/').split('?')[0];
  if (path === '/latest.yml') {
    res.writeHead(200, { 'Content-Type': 'text/yaml' });
    res.end(feedYml);
    console.log('  [feed] GET /latest.yml');    } else if (path.endsWith('holds.json')) {
    // Le frein vit HORS du release : c'est ce qui permet de retenir une version
    // publiée. Il est servi ici par le même flux, comme le poste le lit en vrai.
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(feedHolds);
    console.log(`  [feed] GET ${path} → ${JSON.parse(feedHolds).holds.length} retenue(s)`);
  } else if (path.endsWith('-setup.exe')) {
    servedSetup += 1;
    res.writeHead(200, { 'Content-Length': exeBytes.length });
    res.end(exeBytes);
    console.log(`  [feed] GET ${path} → ${exeBytes.length} octets`);
  } else {
    res.writeHead(404);
    res.end();
  }
});

/** Le flux d'une passe : version annoncée + date de publication qui porte la règle. */
function feedFor(scenario) {
  return [
    `version: ${scenario.version}`,
    'files:',
    `  - url: MamaTheraFinance-${scenario.version}-setup.exe`,
    `    sha512: ${sha512}`,
    `    size: ${exeBytes.length}`,
    `path: MamaTheraFinance-${scenario.version}-setup.exe`,
    `sha512: ${sha512}`,
    `releaseDate: '${scenario.releaseDate}'`,
    '',
  ].join('\n');
}

/**
 * Invalider le cache partagé d'electron-updater avant CHAQUE passe.
 *
 * Un run précédent y laisse l'installeur, et comme le flux sert les MÊMES octets
 * pour toute version annoncée (même sha512), le payload d'une version valide
 * aussi la suivante : l'app « téléchargerait » alors depuis le cache, sans le
 * moindre `download-progress` — une chaîne incomplète. Ce qui rend un cache
 * réutilisable n'est pas le dossier, c'est `pending/update-info.json` : c'est LUI
 * qu'electron-updater relit. Le gros installeur, lui, reste volontiers verrouillé
 * (handle d'un run précédent, antivirus) — mesuré : 20 tentatives sur le dossier
 * entier n'y suffisaient pas, le petit JSON part tout de suite. Si ce JSON
 * résiste, on ÉCHOUE au lieu de continuer : une preuve qui sauterait le
 * téléchargement ne prouverait rien.
 */
async function invalidateUpdaterCache() {
  if (!existsSync(UPDATER_CACHE)) return;
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

/** Lit le journal de preuve, en gardant l'ORDRE et les DOUBLONS. */
function readLog(file, seen) {
  if (!existsSync(file)) return;
  const messages = readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => l.replace(/^\S+\s+/, ''));
  for (const msg of messages.slice(seen.length)) {
    seen.push(msg);
    console.log(`  [updater] ${msg}`);
  }
}

/**
 * Une passe complète : flux, app lancée, chaîne observée, verdict.
 * @param {{ id: string, title: string, version: string, releaseDate: string,
 *   forced: boolean, because?: string, detail?: string }} scenario
 * @returns {Promise<{ id: string, ok: boolean }>}
 */
async function runScenario(scenario) {
  const logFile = join(TMP, `updater-proof-${scenario.id}-${STAMP}.log`);
  const userData = join(TMP, `electron-proof-ud-${scenario.id}-${STAMP}`);
  console.log(`\n━━━ passe « ${scenario.id} » — ${scenario.title}`);
  console.log(`    poste en ${CURRENT_VERSION}, flux annonçant ${scenario.version} (publié le ${scenario.releaseDate.slice(0, 10)})`);

  feedYml = feedFor(scenario);
  feedHolds = JSON.stringify({
    holds: scenario.held ? [{ version: scenario.version, reason: 'frein d’urgence — version défectueuse retenue' }] : [],
  });
  await invalidateUpdaterCache();

  let app = null;
  // Déclaré AVANT le `try` : le verdict se lit après le `finally` (une variable
  // déclarée dedans serait hors portée au moment de juger la passe).
  let downloaded = false;
  const seen = [];
  try {
    app = spawn(EXE, [`--user-data-dir=${userData}`], {
      env: {
        ...process.env,
        UPDATER_FEED_URL: `http://127.0.0.1:${PORT}/`,
        UPDATER_LOG_FILE: logFile,
        // L'application reste OUVERTE quelques secondes de plus que l'intervalle :
        // on prouve ainsi ce qui manquait aux postes d'école — une version publiée
        // pendant que l'application tourne est revue, et non seulement cinq
        // secondes après le démarrage. Sans ce réglage, il faudrait attendre les
        // 30 minutes de production.
        UPDATER_CHECK_INTERVAL_MS: '6000',
        UPDATER_FOCUS_COOLDOWN_MS: '1',
      },
      stdio: 'ignore',
    });
    console.log('🚀 exe empaqueté lancé (win-unpacked, profil isolé)…');

    for (let i = 0; i < 90 && !downloaded; i++) {
      await wait(1000);
      readLog(logFile, seen);
      downloaded = seen.some((m) => m.startsWith('update-downloaded'));
    }

    // L'application est laissée ouverte ~15 s après le téléchargement pour
    // observer AU MOINS une vérification supplémentaire : c'est la propriété qui
    // manquait (« une version publiée pendant que l'app tourne doit être vue »).
    await wait(15000);
    readLog(logFile, seen);
  } finally {
    try { app && app.kill(); } catch { /* ignore */ }
    // Laisse partir les handles de l'app avant la prochaine invalidation de cache.
    await wait(2000);
  }

  const checks = seen.filter((m) => m.startsWith('checking-for-update')).length;
  const rechecked = checks >= 2;
  const chainRequired = scenario.chainRequired !== false;
  const chain = downloaded &&
    seen.some((m) => m.startsWith('update-available')) &&
    seen.some((m) => m.startsWith('checking-for-update')) &&
    seen.some((m) => m.startsWith('download-progress'));
  const announced = seen.find((m) => m.startsWith('update-available') && m.includes('OBLIGATOIRE')) || null;
  const announcesForced = announced !== null;
  // Le frein agit AVANT l'annonce : la trace attendue est sa propre ligne, pas
  // une absence (une absence peut venir de dix autres causes).
  const heldLine = seen.find((m) => m.startsWith(`update-retenue ${scenario.version}`)) || null;
  const refusal = seen.find((m) => m.startsWith('update-downloaded') && m.includes('INSTALLATION REFUSÉE')) || null;

  // Le MOTIF fait partie de la preuve : trois règles peuvent forcer, et une règle
  // qui forcerait toujours passerait pour verte si on ne lisait que le drapeau.
  // Chaque passe ci-dessus n'active qu'une règle, donc le motif attendu est celui
  // de CETTE règle.
  const reasonRight = scenario.forced
    ? Boolean(announced && announced.includes(scenario.because))
    : !announcesForced;
  // Une version retenue : rien d'imposé, et la retenue DITE. Si elle a été
  // téléchargée avant la décision, l'installation doit être refusée — le cache
  // ne doit pas devenir une porte dérobée.
  const holdRight = Boolean(heldLine) && !announcesForced && (!downloaded || Boolean(refusal));

  const ok = (chainRequired ? chain && rechecked : checks >= 1) &&
    (scenario.held ? holdRight : reasonRight) && servedSetup > 0;
  console.log(rechecked
    ? `✅ ${checks} vérifications pendant la MÊME session (reprise périodique)`
    : `❌ ${checks} vérification(s) — l'app ouverte ne revoit rien passer`);
  if (scenario.held) {
    console.log(holdRight
      ? `✅ l'exe empaqueté retient la version, et n'impose RIEN : ${heldLine}`
      : `❌ frein inopérant — ligne de retenue=${Boolean(heldLine)}, obligation annoncée=${announcesForced}${announced ? ` (${announced})` : ''}${downloaded && !refusal ? ', installation non refusée' : ''}`);
    if (refusal) console.log(`✅ installation refusée après téléchargement : ${refusal}`);
  } else if (scenario.forced) {
    console.log(ok
      ? `✅ l'exe empaqueté annonce l'obligation, avec le bon motif : ${announced}`
      : `❌ obligation attendue (motif « ${scenario.because} ») — annoncée=${announcesForced}${announced ? `, motif lu : ${announced}` : ''}`);
  } else {
    console.log(reasonRight
      ? `✅ l'exe empaqueté n'impose RIEN — ${scenario.detail}`
      : `❌ obligation annoncée pour un correctif récent : ${announced}`);
  }
  if (chainRequired) {
    console.log(`${chain ? '✅' : '❌'} chaîne ${chain ? 'complète' : 'incomplète'} pour ${scenario.version} (checking → available → progress → downloaded)`);
  } else {
    console.log(`${checks >= 1 ? '✅' : '❌'} ${checks} vérification(s) — une version retenue ne se télécharge pas pour être installée`);
  }

  rmSync(logFile, { recursive: true, force: true });
  rmSync(userData, { recursive: true, force: true });
  return { id: scenario.id, ok };
}

// ── Exécution ───────────────────────────────────────────────────────────────
const results = [];
try {
  await new Promise((res) => server.listen(PORT, '127.0.0.1', res));
  console.log(`🖥️  flux local: http://127.0.0.1:${PORT}/ — poste en ${CURRENT_VERSION}, ${PASSES.length} passe(s)`);
  for (const s of PASSES) {
    // Le début et la fin de chaque passe balaient les orphelins d'un run
    // interrompu (marqueur de preuve, ou plus vieux que la fenêtre d'âge) —
    // jamais une app légitimement ouverte.
    const swept = await sweepOrphanElectron();
    if (swept) console.log(`🧹 ${swept} processus Electron orphelin(s) purgé(s)`);
    results.push(await runScenario(s));
  }

  console.log('\n── verdict des passes ──');
  for (const r of results) console.log(`  ${r.ok ? '✅' : '❌'} ${r.id}`);
  const allOk = results.every((r) => r.ok);
  console.log(allOk
    ? `\n✅ chaîne complète et obligation annoncée avec le bon motif sur ${results.length} passe(s)`
    : '\n❌ au moins une passe a échoué');
  console.log(allOk ? 'PROOF_OK' : 'PROOF_FAIL');
  process.exitCode = allOk ? 0 : 1;
} catch (e) {
  console.error('❌', e.message);
  process.exitCode = 1;
} finally {
  // Post-run sweep: les apps sont tuées par pid ci-dessus ; ceci remplace le
  // taskkill par nom d'image qui tuait aussi une app légitimement ouverte.
  await sweepOrphanElectron();
  server.close();
}
