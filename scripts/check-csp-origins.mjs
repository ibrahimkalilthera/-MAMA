#!/usr/bin/env node
/**
 * check-csp-origins.mjs — ce qu'on expédie contient-il une valeur absolue qui
 * n'est pas justifiée ?
 *
 *   npm run check:csp-origins            (lecture seule ; sort en 1 s'il y a une valeur non déclarée)
 *   npm run check:csp-origins -- --json
 *
 * ─── Pourquoi cette commande existe ─────────────────────────────────────────
 * `f434ae5` (22/08) importait Geist depuis Google Fonts pendant que la CSP valait
 * `style-src 'self' 'unsafe-inline'` et `font-src 'self'` : la feuille était
 * bloquée, la police ne chargeait jamais, et chaque page logait une violation.
 * `69a6f1f` (28/08) a réparé la cause — auto-hébergement dans `public/fonts/geist/`
 * et `preload` — mais **aucune garde n'a été posée par-dessus**.
 *
 * La première garde posée ne regardait que `style-src` et `font-src` : c'était le
 * trou suivant. Une valeur absolue ajoutée ailleurs — un `img-src https://cdn…`,
 * un `frame-src https://…`, un `<iframe src="https://…">`, un `fetch('https://…')`,
 * la moindre constante d'origine dans `electron/` — n'aurait été lue par personne.
 * Cette commande-ci lit TOUTES les directives, et exige que chaque valeur absolue
 * expédiée soit déclarée **avec sa raison**.
 *
 * ─── Les deux règles ────────────────────────────────────────────────────────
 *   1. les fichiers EXPÉDITS (HTML, CSS, SVG, et le TS/TSX/JS/CJS/MJS qui en
 *      produit) ne portent aucune valeur absolue non déclarée : origine, fichier
 *      qui a le droit de la porter, et raison. La valeur non déclarée est
 *      NOMMÉE avec la directive qui la gouvernerait ;
 *   2. la politique elle-même (toutes ses directives, pas deux) ne nomme aucune
 *      origine non déclarée pour cette directive-là. Une directive absente qui
 *      hérite du `default-src` est jugée À SA PLACE — le repli qui a tranché est
 *      dit —, et une directive d'extraction qui n'a ni jetons ni repli est un
 *      trou nommé : sans valeur déclarée, tout est permis.
 *
 * ─── Ce que ce contrôle ajoute au garde-fou Chrome ──────────────────────────
 * `scripts/verify-csp-guard.mjs` visite le site déployé dans un vrai Chrome et
 * attrape réellement les violations — il est la preuve d'exécution. Celui-ci
 * donne la réponse en une seconde, sans réseau ni identifiants, au moment où la
 * ligne est écrite ; et il juge **les deux politiques** : celle du site
 * (`vercel.json`) et celle du POSTE (`electron/csp-policy.cjs`), appliquée à
 * l'exécution dans le paquet Windows et écrite dans son artefact au build
 * (`scripts/verify-electron-csp.mjs` en est la preuve d'exécution, la meta et
 * l'en-tête compris). Sans cette seconde entrée, la politique du paquet serait la
 * seule que personne ne relit.
 *
 * ─── Lecture seule ──────────────────────────────────────────────────────────
 * Il ne corrige RIEN : remplacer une origine externe par un fichier local est un
 * geste (télécharger, versionner, précharger) qui engage le dépôt — pas le choix
 * d'un contrôle. Et il n'écrit pas davantage la déclaration à votre place : une
 * justification qu'on ne lit pas est une justification qu'on n'a pas donnée.
 *
 * ─── Non-vacuité ────────────────────────────────────────────────────────────
 * Zéro fichier lu, ou aucune politique lisible, sort en **2** : « je n'ai pas pu
 * regarder » n'est pas un vert — et un contrôle qui verdirait sans avoir lu la
 * politique serait le faux vert exact que ce dépôt pourchasse.
 * ─────────────────────────────────────────────────────────────────────────────
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';

import { POLICY_SOURCES, SCANNED_EXTS, SHIPPED_SOURCES, judgeCspOrigins } from './lib/csp-origins.mjs';
// Deux blanchiments, parce que les langages ne commentent pas pareil : le CSS,
// le HTML et le SVG n'ont PAS de commentaire de ligne, et les lire avec le
// scanner de TypeScript faisait disparaître une origine nue (`url(https://…)`)
// — mesuré le 2026-10-12, et c'est le trou que ce contrôle existe pour fermer.
import { maskComments, maskMarkupComments } from './lib/source-text.mjs';

// Le `.cjs` du poste est lu par `require`, exactement comme le lit le processus
// principal d'Electron : c'est le seul format que les deux peuvent partager.
const require = createRequire(import.meta.url);

const args = process.argv.slice(2);
const AS_JSON = args.includes('--json');
const HELP = args.includes('--help') || args.includes('-h');

/** Les sorties de build : les scanner accuserait un artefact obsolète. */
const SKIP_DIRS = new Set(['node_modules', 'dist', 'electron-ui-dist', '.vercel', 'release', '.git', 'coverage']);

if (HELP) {
  console.log(`Refuser toute valeur absolue expédiée qui n'est pas justifiée, et toute
directive CSP qui nomme une origine non déclarée.

  npm run check:csp-origins [options]

  (aucune option)   lire le corpus expédié et toutes les directives, nommer ce qui sort, sortir en 1
  --json            rendre le rapport en JSON sur la sortie standard
  --help

Deux remèdes, selon ce qui manque :
  • une origine visée par une requête : l'auto-héberger (public/fonts/, etc.) ;
  • une origine qui DOIT rester absolue (une base, un lien ouvert par le système) :
    la déclarer dans scripts/lib/csp-origins.mjs avec le fichier qui la porte et
    sa raison. Élargir la CSP n'est jamais le remède : ça fait taire la violation
    en ouvrant la porte.`);
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

/** Les extensions qui se lisent avec le blanchiment de BALISAGE, jamais TSX. */
const MARKUP_EXTS = ['.css', '.html', '.htm', '.svg'];

/**
 * Les fichiers du corpus, prose blanchie — par la couche partagée, et selon la
 * langue du fichier.
 *
 * Un commentaire qui CITE une origine — le présent en-tête en est plein — ne doit
 * pas être accusé : c'est la leçon payée par le premier jet du scanner naïf du
 * dépôt. Mais le blanchiment doit connaître la langue qu'il lit : pour le CSS,
 * le HTML et le SVG, c'est `maskMarkupComments` (bloc slash-étoile, délimiteurs
 * HTML), parce que le scanner de TypeScript y prend une origine nue pour un
 * commentaire de ligne et blanchit la fin de la ligne — donc la valeur qu'on
 * veut nommer.
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
  return paths.sort().map((path) => ({
    path,
    text: maskFor(path, readFileSync(path, 'utf8')),
  }));
}

/** Le blanchiment d'un fichier, selon sa langue (et non selon son humeur). */
function maskFor(path, text) {
  return MARKUP_EXTS.some((ext) => path.endsWith(ext)) ? maskMarkupComments(text) : maskComments(text);
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
    // Une politique de POSTE n'est pas du JSON d'en-têtes : c'est une constante
    // du module que le processus principal branche. La lire à la SOURCE évite
    // d'en garder une copie ici — une copie jugée à la place de l'originale
    // rendrait un vert sur un texte que personne ne sert.
    if (source.module) {
      let csp;
      try {
        csp = String(require(`../${source.file}`)[source.export ?? ''] ?? '');
      } catch {
        // Illisible ⇒ énoncé VIDE : le jugement le refuse plus bas (« aucune
        // politique lisible ») au lieu de le laisser passer pour conforme.
        csp = '';
      }
      out.push({ name: source.name, csp });
      continue;
    }
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

const report = judgeCspOrigins({ files: shippedFiles(), policies: policies() });

if (AS_JSON) {
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
} else {
  const directivesJudged = report.policies.reduce((sum, p) => sum + Object.keys(p.directives).length, 0);
  const viaFallback = report.policies.reduce(
    (sum, p) => sum + FETCH_FALLBACKS(p.judgedVia).length,
    0,
  );
  console.log('Valeurs absolues expédiées — sources et politique');
  console.log(`Fichiers lus                       : ${report.scanned.files}`);
  console.log(`Politiques jugées                  : ${report.scanned.policies} (${directivesJudged} directive(s), dont ${viaFallback} jugée(s) via default-src)`);
  console.log(`Valeurs absolues trouvées          : ${report.findings.length}`);
  console.log(`Déclarées                          : ${report.findings.length - report.undeclared.length}`);

  for (const finding of report.findings) {
    const governs = finding.directives.length ? finding.directives.join(' | ') : 'aucune — la forme ne tranche pas';
    console.log(
      `   • ${finding.path}:${finding.line} — ${finding.label}\n` +
        `     ${finding.url}${finding.fontCdn ? '  (régie de polices)' : ''}\n` +
        `      gouvernerait : ${governs} · ${finding.justified ? '✅ déclarée' : '❌ non déclarée'}` +
        (finding.because ? ` — ${finding.because}` : ''),
    );
  }

  // Les noms qu'on ne juge pas : les dire est la seule façon de ne pas les faire
  // passer pour des requêtes, ni pour des oublis.
  for (const ns of report.namespaces) {
    console.log(`   · ${ns.path}:${ns.line} — identifiant de namespace (un NOM, jamais une requête) : ${ns.url}`);
  }

  for (const policy of report.policies) {
    const via = FETCH_FALLBACKS(policy.judgedVia);
    console.log(
      `   · politique ${policy.name} — ${Object.keys(policy.directives).length} directive(s) lue(s)` +
        (via.length ? `, ${via.length} jugée(s) via default-src : ${via.join(', ')}` : ''),
    );
  }
  for (const policy of report.unjudgeable) console.log(`   ⚠️  politique illisible : ${policy}`);

  // Un jeton est dit UNE fois, avec la liste des directives qu'il touche : le
  // même `default-src` élargi gouverne quinze directives, et quinze lignes
  // identiques se lisent comme du bruit, donc pas du tout.
  for (const [token, hits] of groupByToken(report.widened)) {
    const directives = [...new Set(hits.map((h) => h.directive))].sort();
    console.log(
      `   ⚠️  politique élargie : ${hits[0].policy} → « ${token} » (via ${hits[0].via}) ` +
        `nommé pour ${directives.length} directive(s) : ${directives.join(', ')}`,
    );
  }
  for (const item of report.unrestricted) {
    console.log(
      `   ⚠️  politique ${item.policy} → « ${item.directive} » n'a ni jetons ni default-src : ` +
        'rien n’est déclaré, donc TOUT est permis pour cette directive',
    );
  }

  if (report.ok) {
    console.log(
      '✅ Aucune valeur absolue non déclarée : chaque origine expédiée est justifiée, ' +
        `et les ${report.scanned.policies} politique(s) ne nomment rien d'autre que la base partagée.`,
    );
  } else if (report.undeclared.length > 0) {
    console.log(
      `\n⚠️  ${report.undeclared.length} valeur(s) absolue(s) NON DÉCLARÉE(S) : la politique les refusera ` +
        '(violation en console, ressource qui n’arrive pas) — et le paquet Windows aussi, par SA politique, ' +
        'depuis le 2026-10-12 (electron/csp-policy.cjs).',
    );
    console.log(
      '   Remède : servir soi-même (public/fonts/, etc.), ou — si l’origine doit rester absolue — la DÉCLARER\n' +
        '   dans scripts/lib/csp-origins.mjs avec le fichier qui la porte et sa raison. Jamais élargir la CSP.',
    );
  } else {
    console.log('\n⚠️  La politique elle-même est en cause (illisible, élargie, ou sans limite sur une directive).');
  }
}

/** Les directives qu'un repli a réellement tranchées (pour le dire, pas pour le cacher). */
function FETCH_FALLBACKS(judgedVia) {
  return Object.entries(judgedVia ?? {})
    .filter(([directive, via]) => via === 'default-src' && directive !== 'default-src')
    .map(([directive]) => directive);
}

/** Les jetons élargis, groupés par jeton — un jeton, une ligne. */
function groupByToken(widened) {
  const groups = new Map();
  for (const item of widened) {
    if (!groups.has(item.token)) groups.set(item.token, []);
    groups.get(item.token).push(item);
  }
  return [...groups].sort((a, b) => a[0].localeCompare(b[0]));
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
