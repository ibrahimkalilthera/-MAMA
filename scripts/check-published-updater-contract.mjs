#!/usr/bin/env node
/**
 * check-published-updater-contract.mjs — le contrat de mise à jour EMBARQUÉ dans
 * l'installeur PUBLIÉ est-il celui que le build a scellé ?
 *
 *   npm run check:updater-contract:live                  (le canal publié, sans jeton)
 *   npm run check:updater-contract:live -- --keep        (garde les octets téléchargés)
 *   npm run check:updater-contract:live -- --dir=<chemin>  (où descendre l'installeur)
 *   npm run check:updater-contract:live -- --allow-test-signer   (dérogation explicite)
 *
 * ─── La question à laquelle rien d'autre ne répond ───────────────────────────
 * `check-updater-trust.mjs` juge le build LOCAL (`release/win-unpacked`). C'est
 * la bonne question AVANT de publier — et la mauvaise après : ce qu'un poste
 * télécharge n'est pas ce dossier, c'est un installeur NSIS posé sur le canal,
 * et entre les deux il y a une compression et un téléversement. Le contrat qui
 * décide de l'avenir du parc est celui que le poste relira DANS le binaire
 * installé ; il fallait donc le lire là, sur les octets publiés.
 *
 * ─── Comment on le prouve, et pourquoi chaque maillon compte ─────────────────
 *   1. la TÊTE du canal, demandée à l'URL exacte qu'un poste interroge
 *      (`GET /releases/latest`, `Accept: application/json`) — et SANS jeton :
 *      un canal qu'on ne sait relire qu'authentifié n'est pas prouvé pour un
 *      poste qui, lui, ne s'authentifie jamais ;
 *   2. le flux (`latest.yml`) annonce un installeur, une taille et un sha512 :
 *      les octets téléchargés doivent y répondre. C'est le premier verrou du
 *      poste (`electron-updater` rehache avant d'installer) — mesurer un contrat
 *      sur d'autres octets serait mesurer ce que personne ne recevra ;
 *   3. l'installeur est OUVERT (7-Zip embarqué par le dépôt) : sa charge utile
 *      NSIS est extraite, puis le contrat `resources/app-update.yml` en sort ;
 *   4. cette extraction est confrontée au MANIFESTE D'ARBORESCENCE PUBLIÉ
 *      (`<produit>-<version>-unpacked.manifest.json`), qui scelle chemin, taille
 *      et sha256 de chaque fichier du build. Sans cette référence, une extraction
 *      ne prouve que l'existence d'un fichier — pas que c'est le bon ;
 *   5. Windows est interrogé sur la signature des octets, et la promesse de
 *      signataire lue dans le contrat extrait passe au verdict PUR
 *      (`updaterTrustVerdict`) : c'est le gel des 1.0.6–1.0.8 qu'on ne veut pas
 *      revoir, où un certificat de test gravé dans ce fichier arrêtait à jamais
 *      les mises à jour de tout le parc.
 *
 * ─── Ce que ce contrôle ne peut pas faire, et le DIT ─────────────────────────
 * Hors Windows, la signature n'est pas mesurable (c'est `Get-
 * AuthenticodeSignature` qui répond) : le contrôle REFUSE de conclure — avant
 * même de télécharger 129 Mo — plutôt que de rendre un vert qu'il n'a pas
 * mesuré. Même refus quand 7-Zip manque : l'extraction EST la mesure.
 */
import { createHash } from 'node:crypto';
import {
  createReadStream,
  createWriteStream,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { Readable, Transform, Writable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';

import { installerEntry } from './lib/channel-installer.mjs';
import { parseLatestYml } from './lib/latest-yml.mjs';
import { extractEmbeddedContract, findSevenZip } from './lib/installer-archive.mjs';
import {
  compareContractBytes,
  compareInstallerBytes,
  contractEntryFromManifest,
  manifestDigestVerdict,
} from './lib/published-contract.mjs';
import { manifestAssetName, sha256 } from './lib/unpacked-manifest.mjs';
import { parsePublisherNames, updaterTrustVerdict } from './lib/updater-trust.mjs';
import { readAuthenticodeSignatures, signatureMeasurementRefusal } from './lib/windows-signature.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const flag = (name, envName) =>
  args.includes(`--${name}`) || /^(1|true)$/i.test(process.env[envName ?? ''] ?? '');
const keep = flag('keep', 'KEEP_PUBLISHED_BYTES');
const allowTestSigner = flag('allow-test-signer', 'ALLOW_TEST_SIGNER');
// La plateforme est SURCHARGEABLE pour que le refus hors Windows soit PROUVABLE
// sur une machine Windows (et l'inverse) — même précédent que la racine
// surchargeable du contrôle de budget de lignes : un refus qu'on ne peut pas
// déclencher sans changer de machine n'est pas prouvé.
const platform = args.find((a) => a.startsWith('--platform='))?.slice('--platform='.length) || process.platform;
const workDir = join(
  root,
  args.find((a) => a.startsWith('--dir='))?.slice('--dir='.length) || 'node_modules/.cache/published-contract',
);

const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const repo =
  pkg.repository?.url?.replace(/^.*github\.com[:/]/, '').replace(/\.git$/, '') || 'ibrahimkalilthera/-MAMA';
const product = pkg.build?.productName || pkg.name;

const fail = (title, problems = [], warnings = []) => {
  console.error(`\n❌ ${title}`);
  for (const p of problems) console.error(`   • ${p}`);
  for (const w of warnings) console.error(`   ⚠️  ${w}`);
  process.exit(1);
};

// ── 0. La mesure est un geste Windows : hors Windows, on refuse AVANT de ─────
// télécharger 129 Mo pour un verdict qu'on ne pourra pas rendre.
const measurement = signatureMeasurementRefusal({
  platform,
  tests: 'tests/updater-trust.test.ts et tests/published-contract.test.ts',
});
if (!measurement.measurable) fail(measurement.title, measurement.problems);

/** Le texte d'un petit actif du canal, par la voie qu'un poste suit. */
async function fetchText(url, what) {
  let res;
  try {
    res = await fetch(url, {
      headers: { Accept: 'application/octet-stream', 'User-Agent': 'published-contract' },
      redirect: 'follow',
    });
  } catch (error) {
    fail(`${what} injoignable`, [String(error?.message ?? error), `URL : ${url}`]);
  }
  if (!res.ok) fail(`${what} injoignable`, [`HTTP ${res.status} sur ${url}`]);
  return res.text();
}

/**
 * Un fichier déjà sur le disque, haché en flux (129 Mo ne se chargent pas en un
 * bloc pour rien, et l'empreinte reste recalculée sur les octets, pas relue).
 */
async function hashFile(path) {
  const hash = createHash('sha512');
  let size = 0;
  const meter = new Transform({
    transform(chunk, _encoding, callback) {
      hash.update(chunk);
      size += chunk.length;
      callback(null, chunk);
    },
  });
  await pipeline(
    createReadStream(path),
    meter,
    new Writable({
      write(_chunk, _encoding, callback) {
        callback();
      },
    }),
  );
  return { size, sha512: hash.digest('base64') };
}

/**
 * L'installeur, écrit sur le disque ET haché en flux.
 *
 * Les deux moitiés sont nécessaires : l'empreinte pour confronter ce qui a été
 * téléchargé à ce que `latest.yml` promet, les octets pour ouvrir l'archive. Un
 * fichier écrit sans être haché ne prouverait rien, et une empreinte calculée
 * sans fichier ne s'extrait pas.
 */
async function downloadInstaller(url, dest) {
  const res = await fetch(url, {
    headers: { Accept: 'application/octet-stream', 'User-Agent': 'published-contract' },
    redirect: 'follow',
  });
  if (!res.ok) fail('installeur injoignable', [`HTTP ${res.status} sur ${url}`]);
  const hash = createHash('sha512');
  let size = 0;
  const meter = new Transform({
    transform(chunk, _encoding, callback) {
      hash.update(chunk);
      size += chunk.length;
      callback(null, chunk);
    },
  });
  await pipeline(Readable.fromWeb(res.body), meter, createWriteStream(dest));
  return { size, sha512: hash.digest('base64') };
}

// ── 1. La tête du canal, lue comme un poste la lit ───────────────────────────
const headUrl = `https://github.com/${repo}/releases/latest`;
let head = null;
try {
  const res = await fetch(headUrl, {
    headers: { Accept: 'application/json', 'User-Agent': 'published-contract' },
    redirect: 'follow',
  });
  if (!res.ok) fail('la tête du canal est muette', [`HTTP ${res.status} sur ${headUrl}`]);
  head = await res.json();
} catch (error) {
  fail('la tête du canal est injoignable', [String(error?.message ?? error), headUrl]);
}
const tag = String(head?.tag_name ?? '').trim();
if (!tag) fail('la tête du canal ne nomme aucune version', [headUrl]);
const version = tag.replace(/^v/, '');

// ── La liste des actifs, et pourquoi elle vient de l'API ─────────────────────
// L'endpoint que le POSTE interroge (`/releases/latest`) nomme la version mais
// rend une liste d'actifs VIDE — mesuré : `assets: []` sur une release qui en
// porte cinq. C'est l'API qui les donne, avec le `digest` (`sha256:…`) de
// chacun, sans jeton. Quand elle est injoignable (quota anonyme épuisé), l'URL de
// téléchargement est CONSTRUITE — c'est exactement celle qu'un poste suit — et
// cette dégradation est dite : sans `digest`, le manifeste cesse d'être scellé
// par le canal, ce que le verdict nomme au lieu de le taire.
const apiUrl = `https://api.github.com/repos/${repo}/releases/tags/${tag}`;
let listed = [];
let listFallback = '';
try {
  const res = await fetch(apiUrl, {
    headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'published-contract' },
    redirect: 'follow',
  });
  if (!res.ok) listFallback = `l’API des releases a répondu HTTP ${res.status}`;
  else {
    const body = await res.json();
    listed = (Array.isArray(body?.assets) ? body.assets : []).map((asset) => ({
      name: String(asset?.name ?? ''),
      url: asset?.browser_download_url ?? asset?.url ?? null,
      size: Number.isFinite(asset?.size) ? asset.size : null,
      digest: asset?.digest ?? null,
    }));
    if (!listed.length) listFallback = 'l’API des releases n’a listé aucun actif';
  }
} catch (error) {
  listFallback = `l’API des releases est injoignable (${String(error?.message ?? error)})`;
}

/**
 * Un actif par son nom : celui de l'API quand elle a répondu, celui de la voie
 * du poste sinon. `null` veut dire « absent du release », et c'est alors un refus.
 */
function assetNamed(name) {
  const found = listed.find((asset) => asset.name === name);
  if (found) return found;
  if (!listFallback) return null;
  return {
    name,
    url: `https://github.com/${repo}/releases/download/${tag}/${name}`,
    size: null,
    digest: null,
    constructed: true,
  };
}

console.log(`🔎 contrat de mise à jour EMBARQUÉ — octets publiés du canal (${tag}, sans jeton)`);
console.log(`   dépôt ${repo} · tête lue sur ${headUrl}`);
if (listFallback) {
  console.log(
    `   ℹ️  liste des actifs dégradée (${listFallback}) — les URL sont construites sur la voie du poste, et les empreintes d’actifs ne sont donc pas confrontées`,
  );
}

// ── 2. Le flux annonce l'installeur ; les octets devront y répondre ──────────
const feedAsset = assetNamed('latest.yml');
if (!feedAsset?.url) {
  fail('le release publié ne porte pas `latest.yml`', [
    'un poste sans flux ne voit rien : il n’y a donc aucun installeur à ouvrir',
  ]);
}
const feed = parseLatestYml(await fetchText(feedAsset.url, 'latest.yml'));
if (!feed) fail('`latest.yml` publié illisible', ['aucune version, ou aucun `path` : le flux ne se lit pas comme un flux vide']);
if (feed.version !== version) {
  console.log(
    `   ℹ️  le flux annonce ${feed.version} alors que la tête est ${tag} — c’est la tête que le poste suit, et c’est ses octets qui sont mesurés`,
  );
}
const announced = installerEntry(feed);
if (!announced.entry) fail('le flux publié ne nomme aucun installeur utilisable', announced.problems);
const installerName = String(announced.entry.url);
const installerAsset = assetNamed(installerName);
if (!installerAsset?.url) {
  fail('l’installeur annoncé par le flux est absent du release', [
    `« ${installerName} » est annoncé mais introuvable parmi les actifs (${listed.map((a) => a.name).join(', ')})`,
  ]);
}

// ── 3. Le manifeste d'arborescence publié : la référence SCELLÉE ─────────────
// C'est lui qui transforme « un fichier a été extrait » en « le contrat du build
// est bien là » : chemin, taille et sha256 de chaque fichier de `win-unpacked`.
const productPrefix = installerName.replace(new RegExp(`-${version}-setup\\.exe$`, 'i'), '');
const manifestName = manifestAssetName(productPrefix || product, feed.version);
const manifestAsset = assetNamed(manifestName);
if (!manifestAsset?.url) {
  fail('le manifeste d’arborescence publié est introuvable — il n’y a aucune référence scellée', [
    `attendu : ${manifestName}`,
    `actifs du release : ${listed.map((a) => a.name).join(', ') || 'inconnus (API injoignable)'}`,
    'sans lui, une extraction ne prouve que l’existence d’un fichier, pas que c’est celui du build',
  ]);
}
const manifestText = await fetchText(manifestAsset.url, manifestName);
const manifestVerdict = manifestDigestVerdict({ assetDigest: manifestAsset.digest, text: manifestText });
if (!manifestVerdict.ok) fail('la référence publiée n’est pas scellée par le canal', manifestVerdict.problems);
let manifest;
try {
  manifest = JSON.parse(manifestText);
} catch {
  fail('le manifeste d’arborescence publié n’est pas du JSON', [manifestName]);
}
const scelled = contractEntryFromManifest(manifest);
if (!scelled) {
  fail('le manifeste publié ne décrit pas le contrat embarqué', [
    `aucune entrée \`resources/app-update.yml\` dans ${manifestName}`,
    'il n’y a donc aucune empreinte à laquelle confronter ce qui sera extrait',
  ]);
}
console.log(
  `   référence scellée : ${manifestName} · contrat ${scelled.size} octet(s) · sha256 ${scelled.sha256.slice(0, 16)}…` +
    (manifestAsset.digest ? ' (manifeste conforme à l’empreinte du canal)' : ''),
);

// ── 4. Télécharger l'installeur, et exiger qu'il réponde au flux ─────────────
const sevenZipPath = findSevenZip(root);
if (!sevenZipPath) {
  fail('aucun 7-Zip pour ouvrir l’installeur — l’extraction EST la mesure', [
    'attendu : node_modules/electron-winstaller/vendor/7z-x64.exe (ou 7z.exe)',
    'un contrat qu’on ne peut pas extraire n’est pas un contrat vérifié ; lance `npm install`',
  ]);
}
mkdirSync(workDir, { recursive: true });
const installerPath = join(workDir, installerName);
// Un installeur déjà descendu est RÉUTILISÉ quand sa taille est celle du flux :
// ses octets sont rehachés depuis le disque avant tout usage, donc la promesse du
// flux est vérifiée de la même façon — et 129 Mo ne retraversent pas le réseau
// pour un verdict identique.
const cached =
  existsSync(installerPath) &&
  statSync(installerPath).isFile() &&
  (announced.entry.size == null || statSync(installerPath).size === announced.entry.size);
let served;
let how;
if (cached) {
  served = await hashFile(installerPath);
  how = 'rehaché depuis le disque, déjà téléchargé';
  console.log(`   réutilisation de ${installerName} (octets présents dans ${workDir})`);
} else {
  const started = Date.now();
  console.log(`   téléchargement de ${installerName}…`);
  served = await downloadInstaller(installerAsset.url, installerPath);
  how = `téléchargé et rehaché en ${Math.round((Date.now() - started) / 1000)} s`;
}
const bytes = compareInstallerBytes({
  expected: { size: announced.entry.size, sha512: announced.entry.sha512 },
  served,
});
console.log(`   ${installerName} · ${served.size} octet(s) · sha512 ${served.sha512.slice(0, 24)}… (${how})`);
if (!bytes.ok) fail('les octets téléchargés ne répondent pas à la promesse du flux', bytes.problems);

// ── 5. Ouvrir l'installeur : charge utile NSIS, puis le contrat ──────────────
// L'extraction vit dans `scripts/lib/installer-archive.mjs` : elle sert aussi à
// l'E2E de mise à jour, qui doit savoir si le poste qu'il installe est CAPABLE de
// se mettre à jour (un contrat qui promet un signataire est un poste gelé).
rmSync(join(workDir, 'extract'), { recursive: true, force: true });
const opened = extractEmbeddedContract({ sevenZip: sevenZipPath, installerPath, workDir });
if (!opened.ok) fail('le contrat embarqué n’a pas pu être extrait des octets publiés', opened.problems);
const contractBytes = readFileSync(opened.contract.path);
const scelledCheck = compareContractBytes({
  entry: scelled,
  extracted: { size: contractBytes.length, sha256: sha256(contractBytes) },
});
if (!scelledCheck.ok) fail('le contrat embarqué n’est pas celui que le build a scellé', scelledCheck.problems);

// ── 6. La promesse de signataire, et la signature réelle des octets ──────────
const { promised, names } = parsePublisherNames(opened.contract.text);
const publisherNames = promised ? names : null;
const measured = readAuthenticodeSignatures([installerPath]);
const signature = measured.find((row) => String(row?.file) === installerPath) ?? measured[0] ?? null;
const verdict = updaterTrustVerdict({ publisherNames, signature, allowTestSigner });

console.log(`   7-Zip : ${sevenZipPath.where}`);
console.log(`   charge utile : ${opened.payloadName} → resources/app-update.yml`);
console.log(`   contrat embarqué : ${contractBytes.length} octet(s) · sha256 ${sha256(contractBytes).slice(0, 16)}…`);
console.log(
  `   signataire promis : ${publisherNames == null ? 'aucun' : publisherNames.map((n) => `« ${n} »`).join(', ') || '(liste vide)'}`,
);
console.log(
  `   signature des octets publiés : ${signature ? String(signature.status) : 'illisible'}` +
    (signature?.subject ? ` — ${signature.subject}` : ''),
);
for (const note of verdict.notes) console.log(`   ℹ️ ${note}`);
for (const note of scelledCheck.warnings) console.log(`   ℹ️ ${note}`);
if (verdict.overridden.length) {
  console.log('\n⚠️  DÉROGATION « --allow-test-signer » — le parc va être gelé par ce build :');
  for (const o of verdict.overridden) console.log(`   • ${o}`);
  console.log(
    '   ⇒ les postes qui installent cette version ne se mettront plus à jour par le canal : ' +
      'chaque poste devra recevoir la suivante à la main, une fois.',
  );
}

// ── 7. Nettoyage : 129 Mo ont une durée de vie, et elle est courte ───────────
if (!keep) rmSync(workDir, { recursive: true, force: true });
console.log(
  keep
    ? `   octets conservés : ${workDir}`
    : `   octets et extraction purgés (${workDir} — \`--keep\` les garde)`,
);

if (!verdict.ok) {
  fail('publication dangereuse — ce contrat ne laisse pas au parc un chemin de mise à jour', verdict.problems);
}
console.log(
  verdict.overridden.length
    ? '\n✅ dérogation assumée — le gel est DIT ci-dessus, et il est mesuré sur les octets publiés'
    : '\n✅ le contrat embarqué dans les octets publiés est celui du build scellé, et il laisse au parc un chemin de mise à jour',
);
