#!/usr/bin/env node
/**
 * check-font-origins.mjs — ce qu'on expédie demande-t-il une police (ou une
 * feuille) à un domaine que nous ne servons pas ?
 *
 *   npm run check:font-origins            (lecture seule ; sort en 1 s'il y a une demande)
 *   npm run check:font-origins -- --json
 *
 * ─── Pourquoi cette commande existe ─────────────────────────────────────────
 * `f434ae5` (22/08) importait Geist depuis Google Fonts pendant que la CSP valait
 * `style-src 'self' 'unsafe-inline'` et `font-src 'self'` : la feuille était
 * bloquée, la police ne chargeait jamais, et chaque page logait une violation.
 * `69a6f1f` (28/08) a réparé la cause — auto-hébergement dans `public/fonts/geist/`
 * et `preload` — mais **aucune garde n'a été posée par-dessus**. Rouvrir l'import
 * externe reste une ligne, et le symptôme reviendrait en production.
 *
 * ─── Les deux règles ────────────────────────────────────────────────────────
 *   1. les fichiers EXPÉDIÉS (HTML, CSS, et le TS/TSX qui en produit) ne
 *      demandent aucune origine absolue : ni `@import`, ni `<link>`, ni `url(…)`
 *      — la politique du projet les refuserait à l'exécution ;
 *   2. la politique elle-même (`style-src`, `font-src`) ne NOMME aucune origine
 *      externe : élargir la CSP ferait taire la violation en ouvrant la porte.
 *      Le remède est l'auto-hébergement (`public/fonts/…`), jamais l'élargissement.
 *
 * ─── Ce que ce contrôle ajoute au garde-fou Chrome ──────────────────────────
 * `scripts/verify-csp-guard.mjs` visite le site déployé dans un vrai Chrome et
 * attrape réellement les violations — il est la preuve d'exécution. Celui-ci
 * donne la réponse en une seconde, sans réseau ni identifiants, au moment où la
 * ligne est écrite ; et il couvre le paquet Windows, où **aucune CSP n'est
 * déclarée** (mesuré : `font-src` n'apparaît que dans `vercel.json`) — donc où un
 * import externe ne serait bloqué par personne.
 *
 * ─── Lecture seule ──────────────────────────────────────────────────────────
 * Il ne corrige RIEN : remplacer un import externe par un fichier local est un
 * geste (télécharger la police, la versionner, la précharger) qui engage le
 * dépôt — pas le choix d'un contrôle.
 *
 * ─── Non-vacuité ────────────────────────────────────────────────────────────
 * Zéro fichier lu, ou aucune politique lisible, sort en **2** : « je n'ai pas pu
 * regarder » n'est pas un vert — et un `font-src 'self'` qu'on croit avoir
 * vérifié alors qu'on n'a lu aucune politique serait le faux vert exact que ce
 * dépôt pourchasse.
 * ─────────────────────────────────────────────────────────────────────────────
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';

import {
  POLICY_SOURCES,
  SCANNED_EXTS,
  SHIPPED_SOURCES,
  judgeFontOrigins,
} from './lib/font-origins.mjs';
import { maskComments } from './lib/source-text.mjs';

const args = process.argv.slice(2);
const AS_JSON = args.includes('--json');
const HELP = args.includes('--help') || args.includes('-h');

/** Les sorties de build : les scanner accuserait un artefact obsolète. */
const SKIP_DIRS = new Set(['node_modules', 'dist', 'electron-ui-dist', '.vercel', 'release', '.git', 'coverage']);

if (HELP) {
  console.log(`Refuser toute police ou feuille de style demandée à un domaine externe.

  npm run check:font-origins [options]

  (aucune option)   lire le corpus expédié et la politique, nommer ce qui sort, sortir en 1
  --json            rendre le rapport en JSON sur la sortie standard
  --help

Le remède à une violation n'est jamais d'élargir la CSP : c'est d'auto-héberger
la police sous public/fonts/ et de la précharger (voir index.html).`);
  process.exit(0);
}

/**
 * Le corpus : ce qu'on EXPÉDIE, jamais les sorties de build.
 *
 * Les extensions sont filtrées par `SCANNED_EXTS`, et les fichiers sont lus en
 * texte — un fichier illisible est simplement absent du corpus, et c'est le
 * comptage final qui le dit (un corpus vide sort en 2, il ne verdit pas).
 */
function collect(dir, out = []) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    const child = `${dir}/${entry.name}`;
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) collect(child, out);
      continue;
    }
    if (SCANNED_EXTS.some((ext) => entry.name.endsWith(ext))) out.push(child);
  }
  return out;
}

/**
 * Les fichiers du corpus, prose blanchie.
 *
 * Le blanchiment est le même que celui des autres scans de source du dépôt
 * (`maskComments`) : un commentaire qui CITE un `@import` externe — le présent
 * en-tête en est plein — ne doit pas être accusé. C'est la leçon payée par le
 * premier jet du scanner naïf, et elle vaut ici comme ailleurs.
 */
function shippedFiles() {
  const paths = [];
  for (const source of SHIPPED_SOURCES) {
    try {
      if (statSync(source).isDirectory()) collect(source, paths);
      else if (SCANNED_EXTS.some((ext) => source.endsWith(ext))) paths.push(source);
    } catch {
      /* absent : le corpus est simplement plus court, et le comptage le dira */
    }
  }
  return paths.sort().map((path) => ({ path, text: maskComments(readFileSync(path, 'utf8')) }));
}

/**
 * Les énoncés de politique à juger.
 *
 * Un fichier déclaré mais sans en-tête `Content-Security-Policy` pousse un énoncé
 * VIDE : le jugement le refuse (« aucune politique lisible »), au lieu de
 * laisser croire qu'une politique absente est une politique conforme.
 */
function policies() {
  const out = [];
  for (const source of POLICY_SOURCES) {
    let json;
    try {
      json = JSON.parse(readFileSync(source.file, 'utf8'));
    } catch {
      out.push({ name: source.name, csp: '' });
      continue;
    }
    const values = [];
    for (const rule of json.headers ?? []) {
      for (const header of rule.headers ?? []) {
        if (/^content-security-policy$/i.test(String(header.key))) values.push(String(header.value));
      }
    }
    if (values.length === 0) out.push({ name: source.name, csp: '' });
    else for (const value of values) out.push({ name: source.name, csp: value });
  }
  return out;
}

const report = judgeFontOrigins({ files: shippedFiles(), policies: policies() });

if (AS_JSON) {
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
} else {
  console.log('Origines externes — polices et feuilles de style expédiées');
  console.log(`Fichiers lus                      : ${report.scanned.files}`);
  console.log(`Politiques jugées                 : ${report.scanned.policies}`);
  console.log(`Demandes d’origine externe        : ${report.findings.length}`);
  for (const finding of report.findings) {
    console.log(
      `   • ${finding.path}:${finding.line} — ${finding.label}\n` +
        `     ${finding.url}${finding.fontCdn ? '  (régie de polices)' : ''}`,
    );
  }
  for (const policy of report.policies) {
    const style = policy.effective['style-src'];
    const font = policy.effective['font-src'];
    console.log(
      `   · politique ${policy.name} — style-src jugé via ${style ?? '(absente)'}, ` +
        `font-src jugé via ${font ?? '(absente)'}`,
    );
  }
  for (const policy of report.unjudgeable) console.log(`   ⚠️  politique illisible : ${policy}`);
  for (const token of report.widened) {
    console.log(`   ⚠️  politique élargie : ${token.policy} → ${token.directive} ${token.token}`);
  }
  if (report.ok) {
    console.log('✅ Aucune origine externe : les polices et feuilles sont servies par nous (font-src/style-src restent « self »).');
  } else if (report.findings.length > 0) {
    console.log(
      `\n⚠️  ${report.findings.length} demande(s) d’origine externe : la politique les refusera à l’exécution ` +
        '(violation en console, ressource qui n’arrive pas).',
    );
    console.log(
      '   Remède : auto-héberger le fichier sous public/fonts/ et le précharger (voir index.html), ' +
        'jamais élargir la CSP.',
    );
  } else {
    console.log('\n⚠️  La politique elle-même est en cause (illisible, ou élargie à une origine externe).');
  }
}

// Zéro fichier, ou aucune politique lisible : le regard n'a rien atteint.
// `process.exit(2)` et pas une simple `exitCode` : le refus doit être écrit, pas
// déduit — c'est ce que l'inventaire des immunités relit dans ce fichier pour
// prouver qu'il existe.
if (report.vacuous || report.unjudgeable.length > 0) {
  console.error(
    '❌ Rien à juger — corpus vide ou politique illisible.\n' +
      '   « Je n’ai pas pu regarder » n’est pas un vert : un contrôle qui verdit sans avoir lu la politique ne protège rien.',
  );
  process.exit(2);
}
if (!report.ok) process.exitCode = 1;
