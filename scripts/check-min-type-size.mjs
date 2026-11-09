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
 * ─── Ce qui est refusé, et pourquoi c'est mécanisable ──────────────────────
 *   • un jeton `--text-*` sous 12 px (px, rem à 16 px, pt à 4/3) ;
 *   • une déclaration `font-size:` littérale sous 12 px, `!important` compris
 *     (`font-size: 10px !important` glissait sous le plancher : le motif
 *     s'arrêtait au nombre et laissait ` !important` derrière lui) ;
 *   • une taille arbitraire Tailwind `text-[10px]` / `text-[0.6rem]` ;
 *   • un `fontSize` inline numérique (React : pixels) sous 12 px ;
 *   • un `clamp()` dont le MINIMUM est sous le plancher : le minimum est la
 *     valeur que la taille ne dépassera jamais par le bas, donc la seule qui
 *     réponde à « peut-elle descendre sous 12 px ? » ;
 *   • une taille RELATIVE (`em`, `%`) : sa base est invisible ici (elle dépend
 *     du parent calculé), donc le plancher ne peut pas la juger. On ne devine
 *     pas — on refuse, et le message nomme la sortie (une marche `--text-*` ou
 *     une unité absolue). Une règle qu'on ne sait pas lire n'est pas un vert.
 *   • un `var(--x)` qui ne se résout nulle part dans le corpus — même raison,
 *     même refus, avec le nom du jeton absent.
 *
 * ─── Ce qui est résolu, au lieu d'être supposé ─────────────────────────────
 *   • `font-size: var(--x)` : `--x` est cherchée dans TOUTES les feuilles du
 *     corpus, chaîne de `var()` comprise, puis la valeur atteinte est jugée.
 *     C'est ce qui fait de `var(--text-3xs)` un cas mesuré et non un trou.
 *   • `clamp(a, b, c)` : `a` est jugé (voir ci-dessus).
 *
 * Ce qui n'est PAS jugé, et qui reste écrit : `calc()`. Ses termes peuvent
 * mélanger des unités non résolubles sans le DOM (`vw`, `ch`) ; le refuser
 * reviendrait à interdire une mise à l'échelle légitime. Aucun `font-size` du
 * corpus n'en utilise — le jour où l'un apparaît, ce commentaire sera faux et
 * devra être corrigé avec lui.
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

const files = listFiles(ROOT, { ext: CODE_EXTS });
assertScanned(files, { what: 'fichier .ts/.tsx/.css', root: ROOT });

const sources = new Map();
for (const rel of files) {
  // La prose CITE les valeurs qu'on refuse (`/* 11 px SAVAIT le plancher */`) :
  // elle est blanchie, les littéraux — qui portent les classes et les jetons —
  // restent, parce que c'est la donnée même que ce contrôle mesure.
  sources.set(rel, maskComments(fs.readFileSync(rel, 'utf8')));
}

// ─── Les jetons du corpus, pour résoudre les `var()` ────────────────────────
/** `--name` → valeur brute déclarée (dernière déclaration rencontrée). */
const tokens = new Map();
for (const [rel, text] of sources) {
  if (!rel.endsWith('.css')) continue;
  for (const match of text.matchAll(/(--[\w-]+)\s*:\s*([^;{}\n]+)/g)) {
    tokens.set(match[1], match[2].trim());
  }
}

/** « 0.75rem » → 12 · « 11px » → 11 · « 0.8em » → { relative } · illisible → null. */
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

/** La valeur d'une déclaration, débarrassée du bruit qui collait au nombre. */
function normalize(raw) {
  return String(raw).replace(/!important/gi, '').replace(/\s+/g, ' ').trim();
}

/**
 * Mesure une valeur de taille.
 *
 * Rend `{ px }` quand elle est résoluble, `{ relative: true }` quand elle dépend
 * d'un parent invisible, `{ token }` quand un `var()` ne se résout pas, et `null`
 * quand ce n'est pas une taille qu'on sait lire (`calc()`, mot-clé…).
 *
 * @param {string} raw valeur de la déclaration
 * @param {Set<string>} [seen] jetons déjà traversés (cycle `--a: var(--b)` / `--b: var(--a)`)
 */
function measure(raw, seen = new Set()) {
  const text = normalize(raw);

  const clamp = /^clamp\(([\s\S]+)\)$/i.exec(text);
  if (clamp) {
    // Le minimum d'un clamp est la valeur plancher : c'est lui qu'on juge.
    const first = clamp[1].split(',')[0];
    return first ? measure(first, seen) : null;
  }

  const variable = /^var\(\s*(--[\w-]+)\s*(?:,\s*([\s\S]+))?\)$/i.exec(text);
  if (variable) {
    const [, name, fallback] = variable;
    const declared = tokens.get(name);
    if (declared === undefined) {
      // Un repli explicite reste jugeable : c'est la valeur qui s'appliquera si
      // le jeton manque. Sans repli, le plancher n'a rien à mesurer — on le dit.
      return fallback ? measure(fallback, seen) : { token: name };
    }
    if (seen.has(name)) return { token: name };
    seen.add(name);
    return measure(declared, seen);
  }

  const absolute = toPx(text);
  if (absolute !== null) return { px: absolute };

  if (/^-?\d*\.?\d+\s*(em|%)$/i.test(text)) return { relative: true };
  if (/^-?\d*\.?\d+\s*(ex|ch|vw|vh|vmin|vmax)$/i.test(text)) return { relative: true };

  return null;
}

const problems = [];
let tokensRead = 0;
let sizesRead = 0;

const lineOf = (text, index) => text.slice(0, index).split('\n').length;

/** Enregistre le verdict d'une valeur mesurée, ou nomme ce qui l'empêche. */
function judge(measured, { rel, line, what }) {
  if (!measured) return;
  sizesRead += 1;
  if (measured.relative) {
    problems.push({
      rel, line, what,
      detail: 'taille RELATIVE (em/%/vw…) : sa base est calculée, donc invisible ici — nommez une marche `--text-*` ou passez en rem',
    });
    return;
  }
  if (measured.token) {
    problems.push({
      rel, line, what,
      detail: `\`var(${measured.token})\` ne se résout nulle part dans le corpus — le plancher n’a rien pu mesurer`,
    });
    return;
  }
  if (measured.px < FLOOR_PX) {
    problems.push({ rel, line, what, detail: `${measured.px} px sous le plancher de ${FLOOR_PX} px` });
  }
}

for (const [rel, text] of sources) {
  if (rel.endsWith('.css')) {
    for (const match of text.matchAll(/--text-[\w-]+\s*:\s*([^;{}\n]+)/g)) {
      const measured = measure(match[1]);
      // `--text-*` est un JETON : un corpus où aucun n'est lu n'a pas mesuré le
      // plancher, et c'est le refus de vacuité, plus bas, qui le dit.
      tokensRead += 1;
      judge(measured, { rel, line: lineOf(text, match.index), what: match[0].trim() });
    }
    for (const match of text.matchAll(/\bfont-size\s*:\s*([^;{}\n]+)/g)) {
      judge(measure(match[1]), {
        rel,
        line: lineOf(text, match.index),
        what: `font-size: ${normalize(match[1])}`,
      });
    }
    continue;
  }

  // Classes arbitraires : `text-[10px]`, `text-[0.65rem]` — jamais `text-[#CBD5E1]`.
  for (const match of text.matchAll(/text-\[(\d*\.?\d+)(px|rem|em|pt|%)\]/g)) {
    const measured = measure(`${match[1]}${match[2]}`);
    judge(measured, { rel, line: lineOf(text, match.index), what: match[0] });
  }

  // `fontSize: 10` (React lit des pixels), `fontSize: '10px'`, `fontSize: '0.8em'`.
  for (const match of text.matchAll(/fontSize\s*:\s*(['"]?)(-?\d*\.?\d+)(px|rem|em|pt|%)?\1/g)) {
    const measured = measure(`${match[2]}${match[3] || 'px'}`);
    judge(measured, { rel, line: lineOf(text, match.index), what: match[0] });
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
  for (const { rel, line, what, detail } of problems) {
    console.error(`❌ ${rel}:${line} — ${what} — ${detail}`);
  }
  console.error(`\n${problems.length} taille(s) refusée(s) sous le plancher de ${FLOOR_PX} px ou non mesurable(s) — nommez une marche (« .text-2xs » vaut 12 px) au lieu d’un pixel.`);
  process.exit(1);
}

console.log(`✅ plancher typographique tenu : ${files.length} fichier(s) ${ROOT}/, ${sizesRead} taille(s) lue(s), ${tokensRead} jeton(s) \`--text-*\` et ${tokens.size} jeton(s) résolvable(s) — aucune sous ${FLOOR_PX} px, aucune non mesurable.`);
