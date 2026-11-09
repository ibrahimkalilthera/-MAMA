#!/usr/bin/env node
/**
 * ─── Le plancher typographique : 12 px, et rien en dessous ─────────────────
 *
 * `src/index.css` déclare cinq marches et un plancher de lisibilité de 12 px
 * (8-10 px est illisible sur la tablette d'une école). Ce plancher était une
 * INTENTION : `--text-3xs` valait 11 px et se présentait comme la marche
 * « méta », donc du SENS (badges de classe, pastille de doublon) se retrouvait
 * sous le plancher qu'on croyait respecter — mesuré dans l'audit d'ergonomie.
 *
 * Le commentaire de `index.css` promettait déjà ce garde
 * (`scripts/check-min-type-size.mjs`) : il n'existait pas. Une règle qu'aucune
 * commande ne fait respecter redescend au premier édit distrait, et c'est
 * exactement ce qui s'était passé.
 *
 * Ce qui est refusé, et pourquoi c'est mécanisable :
 *   • un jeton `--text-*` sous 12 px (px, rem à 16 px, pt à 4/3) ;
 *   • une déclaration `font-size:` littérale sous 12 px ;
 *   • une taille arbitraire Tailwind `text-[10px]` / `text-[0.6rem]` ;
 *   • un `fontSize` inline numérique (React : pixels) sous 12 px.
 *
 * Ce qui n'est PAS jugé : `em`, `%`, `clamp()` et les `var()` — relatifs, donc
 * non résolubles sans le DOM. On ne devine pas une contrainte sur l'utilisateur
 * à partir d'une unité qu'on ne sait pas lire (même asymétrie que les versions
 * illisibles de l'updater).
 *
 * Racine surchargeable (`CHECK_MIN_TYPE_ROOT`) pour que le refus de vacuité et
 * les cas rouges soient prouvables sur une arborescence fabriquée.
 *
 * Usage : node scripts/check-min-type-size.mjs   (branché dans `lint:chain`)
 */
import fs from 'node:fs';

import { CODE_EXTS, assertScanned, listFiles, maskComments } from './lib/source-text.mjs';

const ROOT = process.env.CHECK_MIN_TYPE_ROOT || 'src';
const FLOOR_PX = 12;
const REM_PX = 16;
const PT_PX = 4 / 3;

/** « 0.75rem » → 12 · « 11px » → 11 · « 0.8em » → null (relatif, non jugé). */
function toPx(raw) {
  const match = /^(-?\d*\.?\d+)\s*(px|rem|pt)?$/i.exec(String(raw).trim());
  if (!match) return null;
  const value = Number(match[1]);
  if (!Number.isFinite(value)) return null;
  const unit = (match[2] || 'px').toLowerCase();
  if (unit === 'px') return value;
  if (unit === 'rem') return value * REM_PX;
  return value * PT_PX;
}

const files = listFiles(ROOT, { ext: CODE_EXTS });
assertScanned(files, { what: 'fichier .ts/.tsx/.css', root: ROOT });

const problems = [];
let tokensRead = 0;
let sizesRead = 0;

const lineOf = (text, index) => text.slice(0, index).split('\n').length;

for (const rel of files) {
  const raw = fs.readFileSync(rel, 'utf8');
  // La prose CITE les valeurs qu'on refuse (`/* 11 px SAVAIT le plancher */`) :
  // elle est blanchie, les littéraux — qui portent les classes et les jetons —
  // restent, parce que c'est la donnée même que ce contrôle mesure.
  const text = maskComments(raw);

  if (rel.endsWith('.css')) {
    for (const match of text.matchAll(/--text-[\w-]+\s*:\s*([^;{}\n]+)/g)) {
      const px = toPx(match[1]);
      if (px === null) continue;
      tokensRead += 1;
      sizesRead += 1;
      if (px < FLOOR_PX) {
        problems.push({ rel, line: lineOf(text, match.index), px, what: match[0].trim() });
      }
    }
    for (const match of text.matchAll(/\bfont-size\s*:\s*([^;{}\n]+)/g)) {
      if (match[1].includes('var(')) continue; // résolu par le jeton ci-dessus
      const px = toPx(match[1]);
      if (px === null) continue;
      sizesRead += 1;
      if (px < FLOOR_PX) {
        problems.push({ rel, line: lineOf(text, match.index), px, what: `font-size: ${match[1].trim()}` });
      }
    }
    continue;
  }

  // Classes arbitraires : `text-[10px]`, `text-[0.65rem]` — jamais `text-[#CBD5E1]`.
  for (const match of text.matchAll(/text-\[(\d*\.?\d+)(px|rem)\]/g)) {
    const px = toPx(`${match[1]}${match[2]}`);
    if (px === null) continue;
    sizesRead += 1;
    if (px < FLOOR_PX) {
      problems.push({ rel, line: lineOf(text, match.index), px, what: match[0] });
    }
  }

  // `fontSize: 10` (React lit des pixels) et `fontSize: '10px'`.
  for (const match of text.matchAll(/fontSize\s*:\s*['"]?(\d*\.?\d+)(px|rem)?['"]?/g)) {
    const px = toPx(`${match[1]}${match[2] || 'px'}`);
    if (px === null) continue;
    sizesRead += 1;
    if (px < FLOOR_PX) {
      problems.push({ rel, line: lineOf(text, match.index), px, what: match[0] });
    }
  }
}

// Un corpus où AUCUN jeton `--text-*` n'est lu n'a pas mesuré le plancher : le
// motif a disparu, la racine a bougé — et un ✅ sur un scan qui ne lit plus rien
// est le mensonge que ce dépôt refuse ailleurs.
if (tokensRead === 0) {
  console.error(`❌ Aucun jeton \`--text-*\` lu dans ${ROOT}/ — le plancher n’a rien mesuré (motif disparu ou racine déplacée).`);
  process.exit(2);
}

if (problems.length > 0) {
  for (const { rel, line, px, what } of problems) {
    console.error(`❌ ${rel}:${line} — ${px} px sous le plancher de ${FLOOR_PX} px — ${what}`);
  }
  console.error(`\n${problems.length} taille(s) sous le plancher de ${FLOOR_PX} px — nommez une marche (« .text-2xs » vaut 12 px) au lieu d’un pixel.`);
  process.exit(1);
}

console.log(`✅ plancher typographique tenu : ${files.length} fichier(s) ${ROOT}/, ${sizesRead} taille(s) lue(s), ${tokensRead} jeton(s) \`--text-*\`, aucune sous ${FLOOR_PX} px.`);
