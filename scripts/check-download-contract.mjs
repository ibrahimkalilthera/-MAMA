#!/usr/bin/env node
/**
 * check-download-contract.mjs — un aperçu ajouté sans l'E2E qui le suit est un
 * pixel-check qui attend un fichier que rien n'émet.
 *
 *   npm run check:download-contract          (dans la chaîne qualité)
 *   npm run check:download-contract -- --verbose
 *
 * ─── Ce qui s'est payé le 2026-10-05 ────────────────────────────────────────
 * La 1.0.23 a doté le reçu des parents d'un aperçu : « Télécharger Reçu PDF »
 * n'enregistre plus, il publie le reçu dans une modale, et le fichier ne part
 * qu'au second clic. Le script `verify-pdf-download.mjs` cliquait encore le seul
 * premier bouton, puis attendait 60 s un PDF que rien n'émettait — run rouge sur
 * la seule étape « reçu parent », la paie (qui télécharge d'un trait) passant
 * ses 9/9.
 *
 * Le défaut vivait dans le LIEN entre deux fichiers, et rien ne le vérifiait :
 * la sortie terminale d'un générateur PDF a changé de nature (direct → aperçu)
 * sans que le script qui le pilote l'apprenne. Cette garde relie les deux bouts —
 * le générateur, la modale et son libellé, et l'étape de confirmation de l'E2E.
 *
 * ─── Ce que ce contrôle refuse ───────────────────────────────────────────────
 * Pour chaque `src/lib/pdf*.ts` :
 *   • un `show*Preview` NON DÉCLARÉ dans `PREVIEW_FLOWS` → refus (l'aperçu que
 *     l'E2E ignore) ;
 *   • une entrée déclarée dont le générateur n'ouvre plus d'aperçu, ou plus CE
 *     générateur → refus (une garantie sur du code disparu) ;
 *   • une modale qui ne REND pas le libellé de confirmation → refus ;
 *   • un libellé présent dans une seule langue → refus ;
 *   • une étape de confirmation absente du script E2E → refus (l'incident).
 *
 * C'est un contrôle de TEXTE : il attrape l'aperçu non déclaré et l'étape
 * manquante, il ne joue pas le clic. La preuve d'exécution appartient au run
 * (`pdf-e2e.yml`), pas au texte — mais un texte est là pour que le run ne parte
 * pas condamné.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { PREVIEW_FLOWS, I18N_FILE, judgeDownloadContract } from './lib/download-contract.mjs';
import { assertScanned } from './lib/source-text.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const VERBOSE = process.argv.slice(2).includes('--verbose');

/** Tous les générateurs PDF du dépôt : `src/lib/pdf*.ts`. */
function generatorPaths() {
  let names;
  try {
    names = readdirSync(join(root, 'src', 'lib'));
  } catch {
    return [];
  }
  return names
    .filter((n) => /^pdf.*\.ts$/.test(n))
    .sort()
    .map((n) => `src/lib/${n}`);
}

const generators = generatorPaths().map((path) => ({ path, source: readFileSync(join(root, path), 'utf8') }));
// Un scan vide n'est pas un vert : une racine déplacée laisserait ce contrôle
// imprimer « aucun aperçu sans étape E2E » sans avoir lu un seul générateur.
assertScanned(generators, { what: 'générateurs PDF lus (src/lib/pdf*.ts)', root: 'src/lib/' });

// Les fichiers cités par l'inventaire (modales, scripts E2E) + le fichier i18n.
const files = {};
for (const flow of PREVIEW_FLOWS) {
  for (const path of [flow.modal, flow.e2e]) {
    if (files[path] !== undefined) continue;
    try {
      files[path] = readFileSync(join(root, path), 'utf8');
    } catch {
      /* illisible : le jugement nomme le fichier manquant, il ne devine pas */
    }
  }
}
try {
  files[I18N_FILE] = readFileSync(join(root, I18N_FILE), 'utf8');
} catch {
  /* idem */
}

const { problems, classified, flowsChecked } = judgeDownloadContract({ generators, flows: PREVIEW_FLOWS, files });

if (VERBOSE) {
  console.log(
    `Générateurs — aperçu : ${classified.preview.join(', ') || 'aucun'} · direct : ${classified.direct.join(', ') || 'aucun'}`,
  );
  for (const path of classified.unknown) console.log(`  (sans sortie connue : ${path})`);
}

if (problems.length) {
  console.error('❌ contrat aperçu ↔ E2E rompu :');
  for (const p of problems) console.error(`   • ${p}`);
  console.error(
    '\n   Un générateur qui ouvre un aperçu ne télécharge plus : le script E2E qui le pilote' +
      '\n   doit cliquer le bouton de confirmation de la modale avant d’attendre le fichier.' +
      '\n   Déclarez le flux dans scripts/lib/download-contract.mjs et ajoutez l’étape côté E2E.',
  );
  process.exit(1);
}

console.log(
  `✅ ${generators.length} générateur(s) PDF : ${classified.preview.length} par aperçu (suivi(s) jusqu'à la confirmation E2E : ` +
    `${flowsChecked.length}), ${classified.direct.length} en téléchargement direct.`,
);
