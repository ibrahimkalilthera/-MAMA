#!/usr/bin/env node
/**
 * check-signing-transition.mjs — signer (ou cesser de signer) va-t-il couper le
 * parc de sa prochaine mise à jour ?
 *
 *   npm run check:signing-transition                          (build local)
 *   npm run check:signing-transition -- --publisher="MaMA THERA FINANCE"   (répétition)
 *   npm run check:signing-transition -- --station="%LOCALAPPDATA%\Programs\MamaTheraFinance"
 *   npm run check:signing-transition -- --field-installer=…/MamaTheraFinance-1.0.17-setup.exe
 *   npm run check:signing-transition -- --channel             (interroge le canal, sans jeton)
 *
 * ─── La question, et pourquoi elle n'est pas celle de `check:updater-trust` ──
 * `check:updater-trust` juge UN artefact : « ce contrat-ci promet-il une
 * signature, et la tient-il ? ». Ce contrôle-ci juge une BASCULE : « le contrat
 * qu'on s'apprête à livrer est-il accepté par les postes qui tournent déjà ? »
 * Les deux refus qui n'existent nulle part ailleurs :
 *
 *   • `unsigned-after-commitment` — livrer NON signé alors que des postes
 *     promettent un signataire : ils refusent la version et restent où ils sont.
 *     Le piège est que le build local est sain (il ne promet rien, donc
 *     `check:updater-trust` est vert) : la faute est dans ce que le PARC a gravé,
 *     et il faut le lire pour la voir ;
 *   • `promise-changed` — le nom promis n'est plus celui gravé chez eux. Le nom
 *     gravé est le **CN du certificat** (`windowsSignToolManager.js` :
 *     `publisherName = [certInfo.commonName]`), donc un renouvellement qui
 *     change de CN, ou un certificat pris chez un autre fournisseur, gèle le
 *     parc machine par machine.
 *
 * ─── Comment on lit le parc sans télécharger 129 Mo par version ─────────────
 * Trois lectures, et chacune dit d'où vient sa preuve :
 *   1. `--station=<dossier>` — le contrat d'un poste, tel que le poste l'exécute ;
 *   2. `--field-installer=<installeur>` — le contrat embarqué dans des octets
 *      publiés déjà présents sur le disque (typiquement ceux que
 *      `check:updater-contract:live --keep` a laissés) ;
 *   3. `--channel` — les manifestes PUBLIÉS, qui scellent l'empreinte du contrat
 *      de chaque version : comparer des empreintes ne dit pas ce qu'un contrat
 *      contient, mais **une empreinte identique à celle du contrat qu'on a sous
 *      les yeux dit exactement ce qu'il contient**. Une empreinte qui CHANGE est
 *      donc un refus de conclure (sortie 2) tant que le contenu du parc n'a pas
 *      été lu — jamais un vert.
 *
 * ─── Ce qu'il ne fait pas ───────────────────────────────────────────────────
 * Il ne mesure pas la signature des octets qu'on s'apprête à livrer : c'est
 * `npm run check:updater-trust` sur le build réel (Windows), que le publieur
 * appelle avant toute écriture sur le canal. En répétition (`--publisher=…`), le
 * contrat n'existe pas encore, donc il n'y a rien à mesurer — et c'est dit.
 */
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { extractEmbeddedContract, findSevenZip } from './lib/installer-archive.mjs';
import { contractEntryFromManifest } from './lib/published-contract.mjs';
import { DEFAULT_RELEASE_DIR } from './lib/release-prune.mjs';
import { isManifestAsset } from './lib/unpacked-manifest.mjs';
import {
  TRANSITION,
  contractFingerprint,
  contractPromise,
  fieldContractGroups,
  signingTransitionVerdict,
} from './lib/signing-transition.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const value = (flag) => args.find((a) => a.startsWith(`${flag}=`))?.slice(flag.length + 1) ?? null;
const values = (flag) => args.filter((a) => a.startsWith(`${flag}=`)).map((a) => a.slice(flag.length + 1));
const dirArg = value('--dir') || DEFAULT_RELEASE_DIR;
const publishers = values('--publisher').map((p) => p.trim()).filter(Boolean);
const stations = values('--station');
const fieldInstallers = values('--field-installer');
const channel = args.includes('--channel');
const limit = Number(value('--versions') ?? 10);
const simulated = publishers.length > 0;

const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const repo =
  pkg.repository?.url?.replace(/^.*github\.com[:/]/, '').replace(/\.git$/, '') || 'ibrahimkalilthera/-MAMA';
const UA = 'mama-signing-transition';

const fail = (title, problems = []) => {
  console.error(`\n❌ ${title}`);
  for (const p of problems) console.error(`   • ${p}`);
  console.log('SIGNING_TRANSITION_FAIL');
  process.exit(1);
};
const neutral = (title, problems = [], notes = []) => {
  console.log(`\n⚖️  ${title}`);
  for (const p of problems) console.log(`   • ${p}`);
  for (const n of notes) console.log(`   ℹ️ ${n}`);
  console.log('SIGNING_TRANSITION_UNPROVEN');
  process.exit(2);
};

async function json(url, what) {
  let res;
  try {
    res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/vnd.github+json' }, redirect: 'follow' });
  } catch (error) {
    fail(`${what} injoignable`, [String(error?.message ?? error), url]);
  }
  if (!res.ok) fail(`${what} injoignable`, [`HTTP ${res.status} sur ${url}`]);
  return res.json().catch(() => null);
}

async function text(url, what) {
  let res;
  try {
    res = await fetch(url, { headers: { 'User-Agent': UA }, redirect: 'follow' });
  } catch (error) {
    fail(`${what} injoignable`, [String(error?.message ?? error), url]);
  }
  if (!res.ok) fail(`${what} injoignable`, [`HTTP ${res.status} sur ${url}`]);
  return res.text();
}

// ── 1. Le contrat qu'on s'apprête à livrer ──────────────────────────────────
// `resolve` et non `join` : un `--dir` ABSOLU (un dossier de travail, un autre
// checkout) doit rester absolu — `join` le collerait sous la racine du dépôt, et
// le contrôle refuserait alors pour « pas de contrat » un contrat bien présent.
const releaseDir = resolve(root, dirArg);
const contractFile = join(releaseDir, 'win-unpacked', 'resources', 'app-update.yml');
let promises;
let fingerprint = null;
if (simulated) {
  promises = publishers;
  console.log(`🧪 répétition — contrat SIMULÉ, promettant ${publishers.map((p) => `« ${p} »`).join(' / ')}`);
} else {
  if (!existsSync(contractFile)) {
    fail(`aucun contrat de mise à jour embarqué (${contractFile}) — il n’y a rien à juger`, [
      'construisez d’abord le paquet (`npm run electron:dist`), ou faites une répétition avec `--publisher="<CN du certificat>"`',
      'c’est `resources/app-update.yml` qui est gravé dans les postes, pas une intention de configuration',
    ]);
  }
  const candidateText = readFileSync(contractFile, 'utf8');
  promises = contractPromise(candidateText);
  fingerprint = contractFingerprint(candidateText);
  console.log(`🔎 contrat livré — ${contractFile}`);
  console.log(`   ${fingerprint.size} octet(s) · sha256 ${fingerprint.sha256.slice(0, 16)}…`);
}

console.log(
  `   signataire promis par ce contrat : ${promises == null ? 'AUCUN' : promises.map((n) => `« ${n} »`).join(' / ') || '(liste vide)'}`,
);

// ── 2. Ce que le parc promet, lu là où c'est lisible ────────────────────────
const fieldPromises = [];
const fieldEvidence = [];
for (const station of stations) {
  const file = join(station, 'resources', 'app-update.yml');
  if (!existsSync(file)) {
    fail(`contrat introuvable sur le poste ${station}`, [
      `attendu : ${file}`,
      'l’emplacement dépend de l’installation (`Programs\\<app>\\resources\\` en édition utilisateur, `Program Files\\…` en édition machine)',
    ]);
  }
  const promise = contractPromise(readFileSync(file, 'utf8'));
  fieldPromises.push(promise);
  fieldEvidence.push(`poste ${station}`);
  console.log(`   poste : ${promise == null || !promise.length ? 'aucune promesse' : promise.map((n) => `« ${n} »`).join(' / ')}`);
}

if (fieldInstallers.length) {
  const sevenZip = findSevenZip(root);
  if (!sevenZip) {
    fail('aucun 7-Zip pour ouvrir les installeurs publiés', [
      'attendu : node_modules/electron-winstaller/vendor/7z-x64.exe',
      'sans extraction, le contrat embarqué des octets publiés n’est pas lisible — et une promesse non lue est un refus de conclure',
    ]);
  }
  for (const installer of fieldInstallers) {
    if (!existsSync(installer)) fail(`installeur introuvable (${installer}) — rien à ouvrir`, []);
    const work = mkdtempSync(join(tmpdir(), 'mama-signing-transition-'));
    try {
      const opened = extractEmbeddedContract({ sevenZip, installerPath: installer, workDir: work });
      if (!opened.ok) fail(`le contrat embarqué de ${installer} n’a pas pu être lu`, opened.problems);
      const promise = contractPromise(opened.contract.text);
      fieldPromises.push(promise);
      fieldEvidence.push(`installeur ${installer}`);
      console.log(
        `   ${installer.split(/[\\/]/).pop()} : ${
          promise == null || !promise.length ? 'aucune promesse' : promise.map((n) => `« ${n} »`).join(' / ')
        } (${opened.contract.size} octet(s))`,
      );
    } finally {
      rmSync(work, { recursive: true, force: true });
    }
  }
}

// ── 3. La forme du parc publié : empreintes de contrat, sans les octets ─────
let digests = [];
if (channel) {
  const releases = await json(`https://api.github.com/repos/${repo}/releases?per_page=100`, 'la liste des releases');
  const published = (Array.isArray(releases) ? releases : [])
    .filter((release) => release?.draft !== true && release?.prerelease !== true)
    .slice(0, limit);
  const described = [];
  for (const release of published) {
    const version = String(release?.tag_name ?? '').replace(/^v/, '');
    // Le nom du produit est cherché DANS les actifs, pas recomposé depuis
    // `package.json` : le produit s'appelle `MamaTheraFinance` (electron-builder)
    // alors que le paquet s'appelle autrement, et un nom recomposé de travers
    // ferait « aucun manifeste » — c'est-à-dire un refus sur un parc qui va bien.
    const asset = (release.assets ?? []).find(
      (a) => isManifestAsset(a?.name) && String(a.name).endsWith(`-${version}-unpacked.manifest.json`),
    );
    if (!asset) continue;
    const name = String(asset.name);
    const manifest = JSON.parse(await text(asset.browser_download_url, `${name}`));
    const entry = contractEntryFromManifest(manifest);
    if (entry) described.push({ version, contract: entry });
  }
  digests = fieldContractGroups({ versions: described });
  console.log(
    `🌐 canal : ${described.length} version(s) publiée(s) décrite(s), ${digests.length} contrat(s) distinct(s)`,
  );
  for (const group of digests) {
    console.log(
      `   contrat ${group.size} octet(s) · sha256 ${group.digest.slice(0, 16)}… — ${group.versions.length} version(s) : ${group.versions
        .slice(0, 6)
        .join(', ')}${group.versions.length > 6 ? '…' : ''}`,
    );
  }
  if (!described.length) {
    fail('aucun manifeste publié n’a pu être lu — la forme du parc est donc inconnue', [
      'les manifestes d’arborescence sont l’actif qui scelle le contrat embarqué de chaque version',
      'sans eux, comparer une empreinte est impossible : c’est un refus, pas un parc vide',
    ]);
  }
}

const verdict = signingTransitionVerdict({
  candidate: { promises, fingerprint, simulated },
  field: {
    promises: fieldPromises.length ? fieldPromises : null,
    digests: digests.map((group) => group.digest),
    evidence: fieldEvidence.join(' · '),
  },
  previous: '',
  target: String(pkg.version ?? ''),
});

console.log(`\n── le parc acceptera-t-il le contrat qu’on livre ? ──`);
console.log(`   cause : ${verdict.cause}`);
console.log(`   ${verdict.conclusion}`);
for (const note of verdict.notes) console.log(`   ℹ️ ${note}`);
for (const warning of verdict.warnings) console.log(`   ⚠️  ${warning}`);
if (verdict.frozen.length) {
  console.log(
    `   ⚠️  ${verdict.frozen.length} contrat(s) du parc promettent un signataire de TEST et sont déjà gelés — ` +
      '`npm run repair:frozen-updater -- --apply`, puis un redémarrage de l’application sur ces postes',
  );
}
if (!simulated) {
  console.log(
    '   ℹ️ la SIGNATURE des octets livrés se juge à part : `npm run check:updater-trust` sur Windows ' +
      '(le publieur l’appelle avant toute écriture sur le canal)',
  );
}

if (verdict.cause === TRANSITION.UNPROVEN) {
  neutral('impossible de conclure : le contrat change, et la promesse du parc n’a pas été lue', verdict.problems, verdict.notes);
}
if (!verdict.ok) fail('publication refusée — ce contrat couperait des postes de la prochaine mise à jour', verdict.problems);

console.log('\n✅ ce contrat laisse au parc un chemin de mise à jour');
if (verdict.commitment) {
  console.log(`   engagement pris pour toutes les versions suivantes : ${verdict.commitment.map((n) => `« ${n} »`).join(' / ')}`);
}
console.log('SIGNING_TRANSITION_OK');
