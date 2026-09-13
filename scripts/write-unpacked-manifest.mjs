#!/usr/bin/env node
/**
 * write-unpacked-manifest.mjs — décrire chaque sortie de build décompressée.
 *
 *   npm run manifest:unpacked                          (dans electron:dist / electron:release)
 *   npm run manifest:unpacked -- --dir=release-probe    (un atelier de sonde)
 *
 * Ce que ça produit, et pourquoi : `release/win-unpacked` (507 Mo mesurés) n'a ni
 * numéro ni empreinte, donc le contrôle d'atelier ne peut RIEN prouver à son
 * sujet — il le nomme, le pèse, et laisse la décision à un humain. Le manifeste
 * lui donne une empreinte publiable : l'arbre est décrit fichier par fichier
 * (chemin, taille, sha256), et cette description est une fonction DÉTERMINISTE de
 * l'arbre. Publiée à côté de l'installeur, elle permet au contrôle de comparer
 * deux empreintes sans télécharger un octet — donc de CONDAMNER le dossier quand
 * le canal détient déjà exactement ce qu'il décrit.
 *
 * Il tourne à la fin du build, jamais à la main : un manifeste qui décrirait un
 * arbre d'avant-hier prouverait la redondance d'octets qui ne sont plus là.
 */
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { DEFAULT_RELEASE_DIR } from './lib/release-prune.mjs';
import { manifestAssetName, manifestOfTree, sha256 } from './lib/unpacked-manifest.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const dirArg = args.find((a) => a.startsWith('--dir='))?.slice('--dir='.length) || DEFAULT_RELEASE_DIR;
const releaseDir = join(root, dirArg);

// Le produit est lu là où il est DÉFINI (la configuration du build), jamais
// deviné à partir d'un nom de fichier : deux sources pour un nom finiraient par
// désigner deux choses.
const builderConfig = existsSync(join(root, 'electron-builder.yml'))
  ? readFileSync(join(root, 'electron-builder.yml'), 'utf8')
  : '';
const product =
  args.find((a) => a.startsWith('--product='))?.slice('--product='.length) ||
  /^productName:\s*(.+)$/m.exec(builderConfig)?.[1]?.trim() ||
  'app';
const version = String(JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version ?? '').trim();

if (!existsSync(releaseDir)) {
  console.log(`✅ manifestes non applicables — ${dirArg}/ n'existe pas ici (rien à décrire).`);
  process.exit(0);
}

const unpacked = readdirSync(releaseDir, { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && /-unpacked$/.test(entry.name))
  .map((entry) => entry.name);

if (!unpacked.length) {
  // Rien à décrire n'est pas un échec : un build sans sortie décompressée (un
  // `electron:dist` interrompu, un atelier déjà purgé) n'a simplement pas
  // d'arborescence à empreindre — et le dire vaut mieux qu'un message vide.
  console.log(`✅ aucun dossier « -unpacked » dans ${dirArg}/ — rien à décrire.`);
  process.exit(0);
}

let written = 0;
for (const name of unpacked) {
  const dir = join(releaseDir, name);
  if (!statSync(dir).isDirectory()) continue;
  // Le parcours vit dans le module : c'est le MÊME que celui qui recomposera le
  // manifeste côté atelier, donc les deux descriptions ne peuvent pas diverger.
  const { manifest, text } = manifestOfTree(dir, { label: name });
  const asset = manifestAssetName(product, version);
  writeFileSync(join(releaseDir, asset), text);
  written += 1;
  console.log(
    `📄 ${asset} — ${manifest.files.length} fichier(s), ${manifest.bytes} octet(s), ` +
      `empreinte ${sha256(text).slice(0, 12)}… (décrit ${name}/)`,
  );
}

console.log(
  `\n✅ ${written} manifeste(s) écrit(s) — publiés à côté de l'installeur, ils rendent un dossier ` +
    'de sortie condamnable par une preuve au lieu d’une décision humaine.',
);
