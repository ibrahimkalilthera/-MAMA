// ─────────────────────────────────────────────────────────────────────────────
// scripts/lib/installer-archive.mjs — OUVRIR un installeur publié, et en sortir
// le contrat de mise à jour qu'il EMBARQUE.
//
// POURQUOI CE MODULE EXISTE
// -------------------------
// Deux mesures différentes ont besoin du même geste — ouvrir un installeur NSIS
// publié et lire `resources/app-update.yml` dedans :
//
//   • le contrôle d'atelier `check-published-updater-contract.mjs`, qui compare
//     ce fichier au manifeste d'arborescence publié (le build scellé) ;
//   • l'E2E de mise à jour `verify-updater-channel.mjs`, qui doit savoir si le
//     poste qu'il installe est CAPABLE de se mettre à jour — un poste dont le
//     contrat promet un signataire est un poste gelé, et le prouver serait
//     mesurer autre chose que la mise à jour.
//
// Deux copies finiraient par ne plus ouvrir le même chemin, et une extraction qui
// dérive rendrait l'un des deux verdicts inexplicable. Le geste vit donc ici, une
// fois, avec ses refus.
//
// CE QUI EST REFUSÉ, ET POURQUOI
// ------------------------------
// Chaque refus est nommé parce qu'il change le remède : pas de 7-Zip (outil
// manquant sur la machine), pas de charge utile 7z (ce n'est pas un installeur
// NSIS d'electron-builder), deux charges utiles sans nom 64 bits (l'ambiguïté ne
// se tranche pas à la place de la mesure), pas de contrat dans la charge utile
// (binaire incapable de se mettre à jour), extraction muette (le fichier a été
// listé mais pas écrit — 7-Zip a changé, ou le dossier est verrouillé).
// ─────────────────────────────────────────────────────────────────────────────

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { contractFromArchiveListing, payloadArchiveFromListing } from './published-contract.mjs';
import { sha256 } from './unpacked-manifest.mjs';

/** Les 7-Zip EMBARQUÉS par le dépôt, dans l'ordre de préférence. */
export const SEVEN_ZIP_CANDIDATES = [
  'node_modules/electron-winstaller/vendor/7z-x64.exe',
  'node_modules/electron-winstaller/vendor/7z.exe',
  'node_modules/7zip-bin/win/x64/7za.exe',
];

/**
 * Le 7-Zip à utiliser, ou `null` quand il n'y en a aucun.
 *
 * Un `null` est un REFUS pour l'appelant, jamais un repli silencieux : sans
 * décompresseur, il n'y a pas d'extraction, donc pas de mesure.
 *
 * @param {string} root la racine du dépôt
 * @returns {{ path: string, where: string }|null}
 */
export function findSevenZip(root) {
  for (const candidate of SEVEN_ZIP_CANDIDATES) {
    const full = join(root, candidate);
    if (existsSync(full)) return { path: full, where: candidate };
  }
  return null;
}

/**
 * Une commande 7-Zip, dont l'échec est un refus NOMMÉ.
 *
 * @param {{ path: string, where: string }} sevenZip
 * @param {string[]} argv
 * @param {string} what le geste, en clair (« lister l'installeur »)
 * @returns {{ ok: boolean, out: string, problems: string[] }}
 */
export function sevenZipRun(sevenZip, argv, what) {
  try {
    return {
      ok: true,
      out: execFileSync(sevenZip.path, argv, { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 }),
      problems: [],
    };
  } catch (error) {
    const detail = String(error?.stderr ?? error?.message ?? error)
      .split(/\r?\n/)
      .filter((line) => line.trim())
      .slice(-3)
      .join(' · ');
    return {
      ok: false,
      out: '',
      problems: [
        `7-Zip n’a pas pu ${what}`,
        `commande : ${sevenZip.where} ${argv.join(' ')}`,
        detail ? `réponse de 7-Zip : ${detail}` : '7-Zip n’a rien répondu',
      ],
    };
  }
}

/**
 * Où 7-Zip a RÉELLEMENT écrit un fichier extrait.
 *
 * 7-Zip préserve l'arborescence de l'archive (`x`) : le contrat ressort sous
 * `resources/app-update.yml`, pas à la racine du dossier de sortie — et la charge
 * d'un installeur NSIS sous `$PLUGINSDIR/app-64.7z`. Recomposer ce chemin à la
 * main marcherait sur cette version de 7-Zip et pas sur la suivante ; on cherche
 * donc le fichier, et on REFUSE quand il y en a plusieurs (un doublon rendrait le
 * choix inexplicable).
 *
 * @param {string} dir le dossier d'extraction
 * @param {string} basename le nom de fichier attendu
 * @returns {string|null}
 */
export function locateExtracted(dir, basename) {
  const found = [];
  const walk = (current, depth) => {
    if (depth > 8) return;
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const full = join(current, entry.name);
      if (entry.isDirectory()) walk(full, depth + 1);
      else if (entry.isFile() && entry.name === basename) found.push(full);
    }
  };
  walk(dir, 0);
  return found.length === 1 ? found[0] : null;
}

/** Le dernier segment d'un chemin d'archive (`$PLUGINSDIR\app-64.7z` → `app-64.7z`). */
const basenameOf = (path) => String(path ?? '').split(/[\\/]/).pop() ?? '';

/**
 * Le contrat de mise à jour EMBARQUÉ dans un installeur publié.
 *
 * @param {{ sevenZip: { path: string, where: string }, installerPath: string, workDir: string }} input
 * @returns {{ ok: boolean, problems: string[], notes: string[],
 *   payloadName: string|null, contract: { text: string, size: number, sha256: string, path: string }|null }}
 */
export function extractEmbeddedContract({ sevenZip, installerPath, workDir }) {
  const problems = [];
  const notes = [];
  const refuse = (extra) => ({ ok: false, problems, notes, payloadName: null, contract: null, ...extra });
  const extractDir = join(workDir, 'extract');
  try {
    mkdirSync(extractDir, { recursive: true });
  } catch (error) {
    problems.push(`dossier d’extraction impossible à créer (${extractDir}) : ${String(error?.message ?? error)}`);
    return refuse();
  }

  const installer = sevenZipRun(sevenZip, ['l', '-slt', installerPath], 'lister l’installeur');
  if (!installer.ok) {
    problems.push(...installer.problems);
    return refuse();
  }
  const payload = payloadArchiveFromListing(installer.out);
  if (!payload.ok) {
    problems.push(...payload.problems);
    return refuse();
  }
  notes.push(`charge utile listée : ${payload.name}`);

  const unloaded = sevenZipRun(
    sevenZip,
    ['x', installerPath, payload.name.replace(/\\/g, '/'), `-o${extractDir}`, '-y'],
    'extraire la charge utile',
  );
  if (!unloaded.ok) {
    problems.push(...unloaded.problems);
    return refuse();
  }
  const payloadPath = locateExtracted(extractDir, basenameOf(payload.name));
  if (!payloadPath) {
    problems.push(
      `la charge utile « ${payload.name} » a été listée mais reste introuvable sous ${extractDir} — ` +
        '7-Zip ne l’a pas écrite, ou le dossier est verrouillé',
    );
    return refuse({ payloadName: payload.name });
  }

  const listing = sevenZipRun(sevenZip, ['l', '-slt', payloadPath], 'lister la charge utile');
  if (!listing.ok) {
    problems.push(...listing.problems);
    return refuse({ payloadName: payload.name });
  }
  const inside = contractFromArchiveListing(listing.out);
  if (!inside.ok) {
    problems.push(...inside.problems);
    return refuse({ payloadName: payload.name });
  }

  const written = sevenZipRun(sevenZip, ['x', payloadPath, inside.name, `-o${extractDir}`, '-y'], 'extraire le contrat');
  if (!written.ok) {
    problems.push(...written.problems);
    return refuse({ payloadName: payload.name });
  }
  const contractPath = locateExtracted(extractDir, basenameOf(inside.name));
  if (!contractPath || !statSync(contractPath).isFile()) {
    problems.push(`« ${inside.name} » a été listé dans la charge utile mais reste introuvable sous ${extractDir}`);
    return refuse({ payloadName: payload.name });
  }
  const bytes = readFileSync(contractPath);
  return {
    ok: true,
    problems,
    notes,
    payloadName: payload.name,
    contract: { text: bytes.toString('utf8'), size: bytes.length, sha256: sha256(bytes), path: contractPath },
  };
}
