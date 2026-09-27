#!/usr/bin/env node
/**
 * verify-updater-channel.mjs — un poste PARTI d'une version publiée antérieure
 * atteint la DERNIÈRE publiée, tout seul, sur le canal RÉEL.
 *
 *   npm run verify:updater:channel
 *   npm run verify:updater:channel -- --keep       (garde les octets téléchargés)
 *
 * ─── La question que personne ne posait ─────────────────────────────────────
 * `verify-updater.mjs` prouve la CHAÎNE (vérification, disponibilité, progression,
 * téléchargement, politique d'obligation) contre un flux LOCAL servi par le
 * script, avec le binaire de ce commit. C'est une excellente preuve de la
 * logique — et elle ne dit pas ce que l'école demande : un poste qui tourne déjà
 * sur une version PUBLIÉE antérieure rejoint-il la dernière publiée, contre le
 * canal réel, sans que personne ne clique ? Aucune étape de cette preuve-là
 * n'installe quoi que ce soit : la chaîne s'arrête à `update-downloaded`.
 *
 * Cette preuve-ci fait donc le parcours entier, dans l'ordre où un poste le vit :
 *   1. elle demande au canal PUBLIÉ la tête, ses actifs et son flux (sans jeton —
 *      un canal qu'on ne sait relire qu'authentifié n'est pas prouvé) ;
 *   2. elle choisit le poste de départ : la plus HAUTE version publiée sous la
 *      tête, et REFUSE de conclure s'il n'y en a pas ;
 *   3. elle télécharge cet installeur, vérifie ses octets en flux contre le
 *      `sha512` de SON flux, et lit son contrat embarqué — un poste dont le
 *      contrat promet un signataire est GELÉ, et ce n'est pas la mise à jour
 *      qu'il faut accuser ;
 *   4. elle l'INSTALLE en silence dans un dossier de travail isolé ;
 *   5. elle lance l'application installée sur le canal réel (aucun
 *      `UPDATER_FEED_URL` : c'est tout l'intérêt), attend que la tête soit
 *      téléchargée, puis FERME la fenêtre comme un utilisateur le fait le soir —
 *      c'est ce geste-là qui installe la mise à jour (`autoInstallOnAppQuit`),
 *      donc aucune boîte, aucun clic ;
 *   6. elle relit la version RÉELLEMENT installée, et exige la tête ;
 *   7. elle désinstalle, purge le cache partagé d'electron-updater et ses
 *      dossiers de travail, et vérifie qu'il ne reste rien.
 *
 * ─── L'échec est rapporté AVEC SA CAUSE ────────────────────────────────────
 * « ça n'a pas marché » n'a jamais réparé un parc. Le verdict nomme la cause —
 * `head-held`, `contract-frozen`, `bytes-refused`, `download-failed`,
 * `feed-unreachable`, `no-update-offered`, `chain-incomplete`, `install-missing`,
 * `install-noop`, `install-other` — et il imprime les dernières lignes du journal
 * du poste, parce que c'est ce journal qui existe aussi sur la machine d'une
 * école (`electron/update-journal.cjs`). Les verdicts sont PURS
 * (`scripts/lib/station-update.mjs`) et testés sans binaire.
 *
 * ─── Ce qu'elle refuse de faire, et c'est la garde qui compte ──────────────
 * Elle installe et DÉSINSTALLE l'application sous le même identifiant qu'une
 * installation existante : lancée sur une machine qui en porte déjà une, elle
 * réécrirait l'entrée de désinstallation du système et laisserait l'installation
 * réelle orpheline. Le script refuse donc AVANT tout téléchargement si une
 * installation est détectée — et hors Windows il refuse aussi (l'installation
 * silencieuse est un geste NSIS, et la version installée se lit par Windows).
 */
import { createHash } from 'node:crypto';
import { spawn, spawnSync, execFileSync } from 'node:child_process';
import { closeSync, existsSync, mkdirSync, openSync, readdirSync, readFileSync, rmSync, writeSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { publishedInstaller } from './lib/channel-installer.mjs';
import { extractEmbeddedContract, findSevenZip } from './lib/installer-archive.mjs';
import { parseHoldsFile } from './lib/latest-yml.mjs';
import {
  CAUSE,
  CAUSE_DETAIL,
  existingInstallVerdict,
  exitCodeLabel,
  installerDialogVerdict,
  previousPublishedVersion,
  stationReach,
  updateChainVerdict,
} from './lib/station-update.mjs';
import { invalidateUpdaterCache } from './lib/updater-cache.mjs';
import { sweepOrphanElectron } from './lib/orphan-chrome.mjs';
import { contractState } from './lib/updater-contract-repair.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const UA = 'mama-update-live';
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const args = process.argv.slice(2);
const keep = args.includes('--keep');
// S'arrêter après la moitié « canal » sert quand l'INSTALLATION casse : cette
// moitié se prouve alors seule au lieu d'être accusée avec elle. Même précédent
// que `--download-only` du contrôle de la fiche parent installée.
const channelOnly = args.includes('--channel-only');
const DOWNLOAD_TIMEOUT_MS = Number(process.env.UPDATE_PROOF_DOWNLOAD_TIMEOUT_MS || 360000);
const INSTALL_TIMEOUT_MS = Number(process.env.UPDATE_PROOF_INSTALL_TIMEOUT_MS || 300000);

const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const repo =
  pkg.repository?.url?.replace(/^.*github\.com[:/]/, '').replace(/\.git$/, '') || 'ibrahimkalilthera/-MAMA';

const WORK = join(tmpdir(), `mama-update-live-${Date.now()}`);
const INSTALL_DIR = join(WORK, 'app');
const USER_DATA = join(WORK, 'ud');
const LOG_FILE = join(WORK, 'updater.log');
const SETUP = join(WORK, 'older-setup.exe');

/** Le journal du poste, relu en gardant l'ordre — et imprimé chemin faisant. */
let seen = [];
function readProofLog() {
  if (!existsSync(LOG_FILE)) return;
  const lines = readFileSync(LOG_FILE, 'utf8').split('\n').filter(Boolean);
  for (const line of lines.slice(seen.length)) {
    seen.push(line);
    console.log(`  [poste] ${line.replace(/^\S+\s+/, '')}`);
  }
}

let app = null;
let installed = null;
let installedByUs = false;
// L'installateur que l'application déclenche à sa fermeture. Il est suivi (et tué
// au nettoyage) : mesuré le 2026-09-22, il peut rester bloqué des heures sur une
// boîte d'erreur que personne ne cliquera, et un résidu de ce genre est exactement
// ce qu'un run suivant découvre.
let updateInstallerPid = null;

/**
 * Rien ne survit à ce run : une application installée laissée derrière, un cache
 * de 129 Mo, un processus orphelin ou un dossier de travail sont exactement ce
 * qu'un run suivant découvre — et un résidu non nommé passe pour un succès.
 */
async function cleanup() {
  try {
    app?.kill();
  } catch {
    /* déjà mort */
  }
  app = null;
  if (updateInstallerPid) {
    try {
      execFileSync('taskkill.exe', ['/F', '/PID', String(updateInstallerPid)], { stdio: 'ignore' });
      console.log(`🧹 installateur de mise à jour bloqué tué (PID ${updateInstallerPid})`);
    } catch {
      /* déjà parti */
    }
    updateInstallerPid = null;
  }
  await sweepOrphanElectron().catch(() => {});
  if (installedByUs && installed?.uninstaller) {
    console.log('🧹 désinstallation…');
    spawnSync(installed.uninstaller, ['/S'], { stdio: 'ignore', timeout: 240000 });
    await wait(5000);
    installedByUs = false;
  }
  const cache = await invalidateUpdaterCache({}).catch(() => null);
  if (cache?.ok) console.log(`🧹 ${cache.detail}`);
  if (keep) console.log(`   octets conservés : ${WORK}`);
  else rmSync(WORK, { recursive: true, force: true });
}

async function fail(title, problems = [], warnings = []) {
  console.error(`\n❌ ${title}`);
  for (const p of problems) console.error(`   • ${p}`);
  for (const w of warnings) console.error(`   ⚠️  ${w}`);
  if (seen.length) {
    console.error('\n── dernières lignes du journal du poste ──');
    for (const line of seen.slice(-20)) console.error(`   ${line.replace(/^\S+\s+/, '')}`);
  }
  await cleanup();
  console.log('PROOF_FAIL');
  process.exit(1);
}

/** Une lecture du canal publié, par les voies qu'un poste emprunte. */
async function json(url, what, headers = {}) {
  let res;
  try {
    res = await fetch(url, { headers: { 'User-Agent': UA, ...headers }, redirect: 'follow' });
  } catch (error) {
    await fail(`${what} injoignable`, [String(error?.message ?? error), url]);
  }
  if (!res.ok) await fail(`${what} injoignable`, [`HTTP ${res.status} sur ${url}`]);
  return res.json().catch(() => null);
}

/** Le texte d'un petit actif (flux, frein), par la voie qu'un poste suit. */
async function text(url, what) {
  let res;
  try {
    res = await fetch(url, { headers: { 'User-Agent': UA }, redirect: 'follow' });
  } catch (error) {
    await fail(`${what} injoignable`, [String(error?.message ?? error), url]);
  }
  if (!res.ok) await fail(`${what} injoignable`, [`HTTP ${res.status} sur ${url}`]);
  return res.text();
}

/**
 * Une lecture qui n'a PAS le droit de faire échouer le run.
 *
 * Le frein d'urgence est le seul fichier dans ce cas : illisible, il ne retient
 * rien (le poste lit `holds` et n'y trouve aucune version), donc ce n'est pas une
 * panne de la mise à jour — mais le taire ferait passer une lecture ratée pour
 * un frein vide, et c'est exactement le faux vert que ce dépôt refuse.
 */
async function maybeText(url) {
  try {
    const res = await fetch(url, { headers: { 'User-Agent': UA }, redirect: 'follow' });
    return res.ok ? await res.text() : null;
  } catch {
    return null;
  }
}

/**
 * Les installations de CETTE application, telles que Windows les déclare.
 *
 * La garde qui protège la machine : cette preuve installe puis désinstalle sous
 * le même identifiant, donc une installation réelle détectée ici est un refus.
 */
function registryInstalls() {
  const keys = [
    'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall',
    'HKLM\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall',
    'HKLM\\Software\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall',
  ];
  const entries = [];
  for (const key of keys) {
    let out;
    try {
      out = execFileSync('reg.exe', ['query', key, '/s'], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
    } catch {
      continue; // clé absente, ou droits : ce n'est pas une installation
    }
    let current = null;
    for (const raw of out.split(/\r?\n/)) {
      const line = raw.replace(/\s+$/, '');
      if (!line.trim()) continue;
      if (/^HKEY_/i.test(line.trim())) {
        current = { key: line.trim() };
        entries.push(current);
        continue;
      }
      const field = /^\s+(\S[^\t]*?)\s{2,}REG_[A-Z_]+\s+(.*)$/.exec(line);
      if (field && current) current[field[1].trim()] = field[2].trim();
    }
  }
  return entries
    .filter((entry) => /mama[\s-]?thera|mamathera/i.test([entry.DisplayName, entry.InstallLocation, entry.Publisher].join(' ')))
    .map((entry) => ({
      key: entry.key,
      displayName: entry.DisplayName ?? '',
      installLocation: entry.InstallLocation ?? '',
    }));
}

/** L'exécutable de l'application dans une installation, ou `null`. */
function appExeIn(dir) {
  if (!existsSync(dir)) return null;
  const exe = readdirSync(dir).find((name) => /^MamaTheraFinance\.exe$/i.test(name));
  return exe ? join(dir, exe) : null;
}

/**
 * La version RÉELLEMENT installée, lue dans le binaire par Windows.
 *
 * C'est la seule mesure qui compte : une mise à jour « réussie » qui laisse la
 * même version sur le disque est le pire des cas, et aucun journal ne le dit.
 */
function installedVersion(dir) {
  const exe = appExeIn(dir);
  if (!exe) return { version: null, exe: null, detail: `aucun binaire dans ${dir}` };
  const script = `(Get-Item -LiteralPath '${exe.replace(/'/g, "''")}').VersionInfo.FileVersion`;
  let out;
  try {
    out = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
      encoding: 'utf8',
    }).trim();
  } catch (error) {
    return { version: null, exe, detail: `VersionInfo illisible : ${String(error?.message ?? error)}` };
  }
  const found = /(\d+\.\d+\.\d+)/.exec(out);
  return { version: found ? found[1] : null, exe, detail: out || 'VersionInfo.FileVersion vide' };
}

/** Installer en silence, puis rendre le binaire INSTALLÉ (un nom absent est un refus). */
function installSilently(setup, dir) {
  const result = spawnSync(setup, ['/S', `/D=${dir}`], { stdio: 'ignore', timeout: INSTALL_TIMEOUT_MS });
  if (result.error) return { error: `lancement de l’installeur impossible : ${result.error.message}` };
  if (!existsSync(dir)) return { error: `l’installeur a rendu ${result.status} sans créer ${dir}` };
  const exe = appExeIn(dir);
  if (!exe) return { error: `aucun binaire installé dans ${dir} (${readdirSync(dir).join(', ') || 'vide'})` };
  const uninstaller = readdirSync(dir).find((name) => /^Uninstall.*\.exe$/i.test(name)) ?? null;
  // Le code de sortie est RENDU, pas seulement constaté : mesuré sur les octets
  // publiés, l'installeur NSIS d'electron-builder peut installer correctement
  // TOUT en rendant `0xC0000374` (STATUS_HEAP_CORRUPTION) — et c'est ce même code
  // que l'installeur de mise à jour recevra du désinstalleur, un peu plus tard.
  // Le taire ferait perdre la cause la plus utile du rapport.
  return { exe, uninstaller: uninstaller ? join(dir, uninstaller) : null, status: result.status };
}

/**
 * La boîte VISIBLE d'un processus — son titre et le texte de ses contrôles.
 *
 * C'est la seule façon de savoir ce qu'un installateur attend : mesuré, il
 * consomme 0,9 s de CPU en 470 s, fenêtre visible, sur une boîte d'erreur
 * `class #32770` avec un bouton OK. Le lire transforme « ça ne finit pas » en une
 * cause nommée, avec le code rendu par le désinstalleur.
 */
function visibleDialog(pid) {
  // La sortie est forcée en UTF-8 : sans cela le texte de la boîte revient
  // mojibaké (« �chec de d�sinstallation »), et un refus illisible est un refus
  // qu'on ne peut pas réparer — même réglage que le poste, qui fait `chcp 65001`
  // avant d'interroger le même genre de cmdlet.
  const script = [
    '[Console]::OutputEncoding=[System.Text.Encoding]::UTF8',
    'Add-Type -Namespace P -Name W -MemberDefinition \'[DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);\'',
    'Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes',
    `$p = Get-Process -Id ${pid} -ErrorAction SilentlyContinue`,
    "if (-not $p) { 'PARTI'; exit }",
    '$h = $p.MainWindowHandle',
    '$visible = if ($h -eq 0) { $false } else { [P.W]::IsWindowVisible($h) }',
    '$texts = @()',
    'if ($visible) { $root = [System.Windows.Automation.AutomationElement]::FromHandle($h); $all = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition); foreach ($e in $all) { if ($e.Current.Name) { $texts += $e.Current.Name } } }',
    '[pscustomobject]@{ visible = $visible; title = $p.MainWindowTitle; texts = @($texts) } | ConvertTo-Json -Compress',
  ].join('; ');
  try {
    const out = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
      encoding: 'utf8',
      maxBuffer: 8 * 1024 * 1024,
    }).trim();
    if (!out || out === 'PARTI') return null;
    return JSON.parse(out);
  } catch {
    return null; // fenêtre en cours de création, ou processus déjà parti
  }
}

/**
 * L'installateur de la version CIBLE, s'il tourne.
 *
 * Le nom est précis (`MamaTheraFinance-<cible>-setup.exe`) et pas « un setup » :
 * l'installeur du poste de départ a tourné dans ce même run, et confondre les deux
 * ferait lire le dialogue d'un processus déjà terminé.
 */
function updateInstaller(name) {
  let out;
  try {
    out = execFileSync('tasklist.exe', ['/FO', 'CSV', '/NH'], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
  } catch {
    return null;
  }
  for (const raw of out.split(/\r?\n/)) {
    const cells = raw.split('","').map((cell) => cell.replace(/^"|"$/g, ''));
    if (cells.length < 2 || !cells[0]) continue;
    if (cells[0].toLowerCase() !== name.toLowerCase()) continue;
    const pid = Number(cells[1]);
    if (Number.isFinite(pid) && pid > 0) return { pid, name: cells[0] };
  }
  return null;
}

/**
 * Fermer la fenêtre COMME UN UTILISATEUR — pas tuer le processus.
 *
 * `taskkill` sans `/F` envoie un `WM_CLOSE` : l'application se ferme normalement,
 * son code de sortie est 0, et c'est exactement l'instant où `electron-updater`
 * installe la mise à jour déjà téléchargée (`autoInstallOnAppQuit`). Un `/F`
 * tuerait le processus : rien ne s'installerait, et la preuve accuserait la mise
 * à jour d'un échec fabriqué par la preuve elle-même.
 */
function closeWindow(pid) {
  try {
    execFileSync('taskkill.exe', ['/PID', String(pid)], { stdio: 'ignore' });
    return 'taskkill (WM_CLOSE)';
  } catch {
    try {
      execFileSync(
        'powershell.exe',
        ['-NoProfile', '-NonInteractive', '-Command', `(Get-Process -Id ${pid}).CloseMainWindow()`],
        { stdio: 'ignore' },
      );
      return 'CloseMainWindow';
    } catch {
      return null;
    }
  }
}

// ── 0. Les refus AVANT toute mesure, et avant tout octet ────────────────────
if (process.platform !== 'win32') {
  console.error(`\n❌ mise à jour non mesurable hors Windows sur ${process.platform}`);
  console.error('   • cette preuve installe l’installeur publié (NSIS `/S`) et lit la version installée par Windows : sans Windows, il n’y a pas de mesure');
  console.error('   • les règles qui décident (scripts/lib/station-update.mjs) restent prouvées par tests/station-update.test.ts sur toutes les plateformes');
  console.log('PROOF_FAIL');
  process.exit(1);
}
const installs = registryInstalls();
const guard = existingInstallVerdict({ entries: installs });
if (!guard.ok) await fail('une installation de l’application est déjà présente sur cette machine', guard.problems);

try {
  console.log(`🔎 canal publié — https://github.com/${repo}/releases/latest (sans jeton)`);
  const head = await json(`https://github.com/${repo}/releases/latest`, 'la tête du canal', {
    Accept: 'application/json',
  });
  const tag = String(head?.tag_name ?? '').trim();
  if (!tag) await fail('la tête du canal ne nomme aucune version', ['/releases/latest n’a rendu aucun `tag_name`']);
  const target = tag.replace(/^v/, '');
  console.log(`   tête : ${tag}`);

  // ── 1. La tête, ses actifs et son flux ────────────────────────────────────
  const headRelease = await json(
    `https://api.github.com/repos/${repo}/releases/tags/${tag}`,
    `le release ${tag}`,
    { Accept: 'application/vnd.github+json' },
  );
  const headAssets = (headRelease?.assets ?? []).map((asset) => ({
    name: asset.name,
    browser_download_url: asset.browser_download_url,
  }));
  const headFeedAsset = headAssets.find((asset) => asset.name === 'latest.yml');
  if (!headFeedAsset) await fail(`le release ${tag} ne porte pas de latest.yml`, ['sans flux, aucun poste ne voit rien']);
  const headInstaller = publishedInstaller({
    text: await text(headFeedAsset.browser_download_url, `latest.yml de ${tag}`),
    assets: headAssets,
    tag,
  });
  if (!headInstaller.ok) await fail(`le canal ${tag} n’annonce pas un installeur utilisable`, headInstaller.problems, headInstaller.warnings);
  console.log(`   ✅ le flux annonce ${headInstaller.installer.name} · ${headInstaller.installer.size} octet(s)`);

  // ── 2. Le frein d'urgence, lu comme le poste le lit ───────────────────────
  const brakeUrl = `https://raw.githubusercontent.com/${repo}/main/updates/holds.json`;
  const brakeText = await maybeText(brakeUrl);
  const brake = parseHoldsFile(brakeText ?? '{"holds":[]}');
  if (brakeText === null) {
    console.log(`   ⚠️  frein d’urgence injoignable (${brakeUrl}) — un poste ne pourrait retenir aucune version, et cette preuve ne peut pas prouver le contraire`);
  }
  if (brake.holds.includes(target)) {
    const entry = brake.entries.find((e) => e.version === target);
    await fail('la version de tête est RETENUE par le frein d’urgence — la preuve ne peut pas prouver une mise à jour', [
      `la tête ${target} est sur la liste du frein (${brakeUrl})${entry?.reason ? ` : « ${entry.reason} »` : ''}`,
      CAUSE_DETAIL[CAUSE.HEAD_HELD],
      'c’est le frein qui agit, pas le canal : un poste ne DOIT pas recevoir cette version, et c’est ce que ce contrôle constate',
    ]);
  }
  console.log(`   frein lisible : ${brake.entries.length} retenue(s)${brake.holds.length ? ` (${brake.holds.join(', ')})` : ' — aucune'}`);
  for (const w of brake.warnings) console.log(`   ⚠️  ${w}`);

  // ── 3. Le poste de départ : la plus haute version publiée sous la tête ────
  const releases = await json(`https://api.github.com/repos/${repo}/releases?per_page=100`, 'la liste des releases', {
    Accept: 'application/vnd.github+json',
  });
  const published = (Array.isArray(releases) ? releases : [])
    .filter((release) => release?.draft !== true && release?.prerelease !== true)
    .map((release) => String(release?.tag_name ?? ''));
  const start = previousPublishedVersion({ versions: published, head: tag });
  if (!start.ok) await fail('aucun poste de départ utilisable', start.problems);
  const from = start.version;
  const fromTag = `v${from}`;
  console.log(`   poste de départ : ${fromTag} (la plus haute version publiée sous ${tag})`);

  const fromRelease = await json(
    `https://api.github.com/repos/${repo}/releases/tags/${fromTag}`,
    `le release ${fromTag}`,
    { Accept: 'application/vnd.github+json' },
  );
  const fromAssets = (fromRelease?.assets ?? []).map((asset) => ({
    name: asset.name,
    browser_download_url: asset.browser_download_url,
  }));
  const fromFeedAsset = fromAssets.find((asset) => asset.name === 'latest.yml');
  if (!fromFeedAsset) await fail(`le release ${fromTag} ne porte pas de latest.yml`, ['les octets du poste de départ ne peuvent pas être vérifiés']);
  const older = publishedInstaller({
    text: await text(fromFeedAsset.browser_download_url, `latest.yml de ${fromTag}`),
    assets: fromAssets,
    tag: fromTag,
  });
  if (!older.ok) await fail(`le canal ${fromTag} n’annonce pas un installeur utilisable`, older.problems, older.warnings);
  const olderInstaller = older.installer;

  // ── 4. Télécharger le poste de départ, et vérifier ses octets EN FLUX ─────
  mkdirSync(WORK, { recursive: true });
  const res = await fetch(olderInstaller.url, { headers: { 'User-Agent': UA }, redirect: 'follow' });
  if (!res.ok) await fail('l’installeur du poste de départ est injoignable', [`HTTP ${res.status} sur ${olderInstaller.url}`]);
  const hash = createHash('sha512');
  const fd = openSync(SETUP, 'w');
  let size = 0;
  try {
    for await (const chunk of res.body) {
      hash.update(chunk);
      writeSync(fd, chunk);
      size += chunk.length;
    }
  } finally {
    closeSync(fd);
  }
  const sha512 = hash.digest('base64');
  if (olderInstaller.size !== null && olderInstaller.size !== size) {
    await fail('les octets du poste de départ ne répondent pas à son flux', [`taille servie ${size} ≠ taille annoncée ${olderInstaller.size}`]);
  }
  if (sha512 !== olderInstaller.sha512) {
    await fail('les octets du poste de départ ne répondent pas à son flux', [
      `sha512 servi ${sha512.slice(0, 12)}… ≠ sha512 annoncé ${olderInstaller.sha512.slice(0, 12)}…`,
    ]);
  }
  console.log(`   ✅ ${olderInstaller.name} · ${size} octet(s) · sha512 ${sha512.slice(0, 12)}… — identiques au flux de ${fromTag}`);

  // ── 5. Le poste de départ est-il seulement CAPABLE de se mettre à jour ? ──
  const sevenZip = findSevenZip(root);
  if (!sevenZip) {
    await fail('aucun 7-Zip pour ouvrir l’installeur du poste de départ', [
      'attendu : node_modules/electron-winstaller/vendor/7z-x64.exe (ou 7z.exe)',
      'sans extraction, le contrat embarqué du poste de départ n’est pas lisible — et un poste gelé serait accusé à tort',
    ]);
  }
  rmSync(join(WORK, 'extract'), { recursive: true, force: true });
  const opened = extractEmbeddedContract({ sevenZip, installerPath: SETUP, workDir: WORK });
  if (!opened.ok) await fail('le contrat du poste de départ n’a pas pu être lu', opened.problems);
  const state = contractState(opened.contract.text);
  if (state.frozen) {
    await fail(`le poste de départ ${from} ne peut PAS se mettre à jour — ce n’est pas la mise à jour qu’il faut accuser`, [
      state.because,
      CAUSE_DETAIL[CAUSE.CONTRACT_FROZEN],
      'remède : `npm run repair:frozen-updater -- --apply` sur le poste (aucune réinstallation), puis relance cette preuve',
    ]);
  }
  console.log(`   ✅ contrat du poste de départ : ${state.because}`);
  if (opened.contract.size === 0) await fail('le contrat extrait du poste de départ est VIDE', ['un contrat vide ne dit rien']);

  if (channelOnly) {
    console.log('⏹  arrêt demandé avant l’installation (--channel-only) — rien n’a été installé sur cette machine');
    await cleanup();
    console.log('CHANNEL_OK');
    process.exit(0);
  }

  // ── 6. Installer le poste de départ, en silence, dans un dossier isolé ────
  await sweepOrphanElectron().catch(() => {});
  installed = installSilently(SETUP, INSTALL_DIR);
  if (installed.error) await fail('l’installeur publié du poste de départ n’a pas produit d’application installée', [installed.error]);
  installedByUs = true;
  const before = installedVersion(INSTALL_DIR);
  if (before.version !== from) {
    await fail(`l’installation ne porte pas la version du poste de départ (${from})`, [
      `version lue dans ${INSTALL_DIR} : ${before.version ?? '—'} (${before.detail})`,
      'mesurer une mise à jour depuis un état qu’on n’a pas vérifié ne prouverait rien',
    ]);
  }
  console.log(`🖥  installé : ${installed.exe} — version lue ${before.version}`);
  if (installed.status !== 0) {
    // Ce n'est PAS un refus : mesuré sur les octets publiés, l'installeur NSIS
    // installe correctement et rend quand même 0xC0000374 (STATUS_HEAP_CORRUPTION).
    // Mais c'est le premier endroit où le code apparaît, et le même code — rendu
    // par le DÉSINSTALLEUR — bloquera l'installation de la mise à jour : le nommer
    // ici donne la cause quatre minutes avant qu'elle ne se manifeste.
    console.log(
      `   ⚠️  l’installeur du poste de départ a rendu ${exitCodeLabel(installed.status)} — fichiers installés malgré tout ; ` +
        'si le désinstalleur rend le même code, l’installation de la mise à jour s’arrêtera sur une boîte',
    );
  }

  // ── 7. Lancer le poste sur le CANAL RÉEL (aucun flux local) ───────────────
  const cacheInvalidation = await invalidateUpdaterCache({});
  if (!cacheInvalidation.ok) await fail('le cache partagé d’electron-updater n’a pas pu être invalidé', cacheInvalidation.problems);
  console.log(`   ${cacheInvalidation.detail}`);

  // Les hooks du poste sont posés explicitement, et ceux qui détourneraient le
  // canal sont RETIRÉS : sans ça un `UPDATER_FEED_URL` hérité de l'environnement
  // ferait prouver un flux local en croyant prouver le canal publié.
  const stationEnv = { ...process.env, UPDATER_LOG_FILE: LOG_FILE, UPDATER_CHECK_INTERVAL_MS: '6000', UPDATER_FOCUS_COOLDOWN_MS: '1' };
  delete stationEnv.UPDATER_FEED_URL;
  delete stationEnv.UPDATER_HOLD_URL;
  app = spawn(installed.exe, [`--user-data-dir=${USER_DATA}`], { env: stationEnv, stdio: 'ignore' });
  console.log('🚀 application installée lancée sur le canal réel (profil isolé, aucune boîte de dialogue)…');

  // ── 8. Attendre le téléchargement de la TÊTE ──────────────────────────────
  const deadline = Date.now() + DOWNLOAD_TIMEOUT_MS;
  let stopped = null;
  while (Date.now() < deadline && !stopped) {
    await wait(2000);
    readProofLog();
    // Chaque condition d'arrêt est une ligne que le POSTE écrit : on s'arrête
    // sur le verdict, pas sur une durée — un échec ne doit pas coûter six minutes
    // d'attente avant d'être dit.
    stopped =
      seen.find((line) => line.includes(`update-downloaded ${target}`)) ??
      seen.find((line) => line.includes(`update-retenue ${target}`)) ??
      seen.find((line) => line.includes('check-failed') || line.includes('error ')) ??
      seen.find((line) => line.includes('octets non conformes au flux')) ??
      seen.find((line) => line.includes('échec de téléchargement')) ??
      seen.find((line) => line.includes('update-not-available')) ??
      null;
  }
  const downloaded = seen.some((line) => line.includes(`update-downloaded ${target}`));
  const chain = updateChainVerdict({ lines: seen, target });
  for (const note of chain.notes) console.log(`   ℹ️ ${note}`);
  if (!downloaded) {
    await fail(`le poste n’a pas téléchargé ${target} — la chaîne s’est arrêtée (cause « ${chain.cause} »)`, chain.problems, chain.warnings);
  }
  console.log(`✅ ${target} téléchargée par le poste installé (${chain.checks} vérification(s) dans la même session)`);

  // ── 9. Fermer la fenêtre : c'est ce geste qui installe ───────────────────
  const pid = app.pid;
  const how = closeWindow(pid);
  if (!how) await fail('la fenêtre du poste n’a pas pu être fermée proprement', [
    'le processus doit se terminer par lui-même (code 0) pour que la mise à jour s’installe à la fermeture',
  ]);
  console.log(`🚪 fenêtre fermée par ${how} — l’installation à la fermeture s’enclenche`);
  for (let i = 0; i < 60; i += 1) {
    await wait(1000);
    if (app.exitCode !== null || app.killed) break;
  }
  try {
    app.kill();
  } catch {
    /* déjà parti */
  }
  readProofLog();

  // ── 10. La version RÉELLEMENT installée, après l'installation ─────────────
  // Et, pendant l'attente, ce que l'installateur FAIT : mesuré, il peut rester
  // des heures sur une boîte d'erreur visible que personne ne cliquera (0,9 s de
  // CPU en 470 s). La lire tôt transforme « ça ne finit pas » en cause nommée.
  const installerName = `MamaTheraFinance-${target}-setup.exe`;
  let after = installedVersion(INSTALL_DIR);
  const installDeadline = Date.now() + INSTALL_TIMEOUT_MS;
  while (after.version !== target && Date.now() < installDeadline) {
    await wait(5000);
    after = installedVersion(INSTALL_DIR);
    if (after.version === target) break;
    const running = updateInstaller(installerName);
    if (!running) continue;
    updateInstallerPid = running.pid;
    const dialog = visibleDialog(running.pid);
    // Ce que le POSTE est devenu se mesure ICI, au moment du blocage : c'est ce
    // fait-là qui sépare « le poste travaille encore, il n’a pas reçu la mise à
    // jour » de « le poste n’a plus d’application ». Le déduire du code rendu par
    // le désinstalleur serait une supposition — mesuré, ce poste-ci garde ses
    // 20 fichiers intacts (0 sur 20 retiré) alors que le code, lui, est un échec.
    const appStillThere = appExeIn(INSTALL_DIR) !== null;
    const blocked = installerDialogVerdict({ dialog, previous: before.version, target, appStillThere });
    for (const note of blocked.notes) console.log(`   ℹ️ ${note}`);
    if (blocked.blocked) {
      // Ce qui RESTE du poste, nommé : « sans application » sans la liste ne dit
      // pas si le dossier est intact (binaire seul retiré) ou déjà à moitié
      // remplacé — et c'est exactement ce qu'un remède doit savoir.
      if (existsSync(INSTALL_DIR)) {
        const reste = readdirSync(INSTALL_DIR);
        console.log(`   ℹ️ dossier d’installation : ${reste.length} entrée(s) — ${reste.slice(0, 8).join(', ')}${reste.length > 8 ? '…' : ''}`);
      } else {
        console.log('   ℹ️ dossier d’installation : ABSENT');
      }
      await fail(
        `l’installation de ${target} est BLOQUÉE sur une boîte que personne ne cliquera (cause « ${blocked.cause} »)`,
        [...blocked.problems, CAUSE_DETAIL[CAUSE.INSTALL_BLOCKED_DIALOG]],
      );
    }
  }
  if (after.version !== target && !appExeIn(INSTALL_DIR)) {
    await fail(`l’installation de ${target} a RETIRÉ l’ancienne version sans installer la nouvelle`, [
      `plus aucun binaire dans ${INSTALL_DIR} (départ ${before.version})`,
      `code rendu par l’installeur du poste de départ : ${exitCodeLabel(installed.status)}`,
      installed.status !== 0
        ? 'ce code-là est celui du plantage de fin d’installeur : c’est le MÊME que le désinstalleur rendra, et c’est lui qui bloque la mise à jour'
        : 'l’installeur du poste de départ a rendu 0 : le blocage vient donc du désinstalleur seul',
      CAUSE_DETAIL[CAUSE.INSTALL_MISSING],
    ]);
  }
  console.log(`🔎 version installée après la fermeture : ${after.version ?? '—'} (départ ${before.version})`);

  const reach = stationReach({ chain, before: before.version, after: after.version, target });
  for (const note of reach.notes) console.log(`   ℹ️ ${note}`);
  if (!reach.ok) {
    await fail(`le poste ${from} n’a pas atteint ${target}`, reach.problems, reach.warnings);
  }

  // ── 11. Le poste ainsi mis à jour se voit-il à la tête ? ─────────────────
  // Ce n'est pas la preuve de la mise à jour (elle est déjà faite) : c'est le
  // contrôle que la station mise à jour LIT le canal et s'y voit à jour. Une
  // version plus récente publiée pendant le run est possible et n'est pas un
  // échec — elle est nommée.
  const verifLog = join(WORK, 'after.log');
  const afterLines = [];
  const verifEnv = { ...stationEnv, UPDATER_LOG_FILE: verifLog };
  app = spawn(after.exe, [`--user-data-dir=${join(USER_DATA, 'after')}`], { env: verifEnv, stdio: 'ignore' });
  for (let i = 0; i < 45; i += 1) {
    await wait(2000);
    if (existsSync(verifLog)) {
      for (const line of readFileSync(verifLog, 'utf8').split('\n').filter(Boolean).slice(afterLines.length)) {
        afterLines.push(line);
        console.log(`  [poste] ${line.replace(/^\S+\s+/, '')}`);
      }
    }
    if (afterLines.some((line) => line.includes('update-not-available'))) break;
  }
  const refreshed = afterLines.find((line) => line.includes('update-not-available'));
  const newerWhileRunning = afterLines.find((line) => line.includes('update-available') && !line.includes(target));
  try {
    app.kill();
  } catch {
    /* déjà parti */
  }
  await wait(2000);
  if (refreshed) console.log(`✅ le poste mis à jour ${after.version} se voit à la tête (update-not-available)`);
  else if (newerWhileRunning) console.log(`   ℹ️  une version plus récente est apparue pendant le run : ${newerWhileRunning.replace(/^\S+\s+/, '')}`);
  else console.log('   ⚠️  le poste mis à jour n’a pas relu le canal dans les 90 s — sans conséquence sur la mise à jour déjà prouvée');

  await cleanup();
  console.log(
    `\n✅ PROUVÉ SUR LE CANAL RÉEL : un poste installé en ${before.version} (installeur publié ${fromTag}) a téléchargé ${target}, ` +
      `l’a installé à la fermeture de la fenêtre — aucun clic, aucune boîte — et porte maintenant ${after.version}.`,
  );
  console.log('   étapes : flux publié lu sans jeton · octets vérifiés contre le sha512 du flux · contrat du poste de départ sans promesse de signataire');
  console.log('            · installation silencieuse isolée · téléchargement réel (cache partagé invalidé) · installation à la fermeture · version relue par Windows');
  console.log('   nettoyé : application désinstallée, cache partagé purgé, dossiers de travail supprimés, aucun processus laissé');
  console.log('PROOF_OK');
  process.exit(0);
} catch (error) {
  console.error('❌', error?.stack || error?.message || error);
  await cleanup();
  console.log('PROOF_FAIL');
  process.exit(1);
}
