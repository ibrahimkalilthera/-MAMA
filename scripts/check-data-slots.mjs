/**
 * Data-slot gate — un marqueur déclaré et les endroits qui le CITENT doivent
 * dire la même chose.
 *
 * Ce dépôt a posé une convention : les régions et les panneaux portent un
 * `data-slot="…"` — un nom STABLE, jamais un libellé traduit ni un z-index — et
 * les tests (et parfois les styles) sélectionnent par ce nom. C'est ce qui a
 * permis de remplacer des sélecteurs fragiles (classes de mise en page, z-index)
 * par des marqueurs qui ne bougent pas quand le style bouge.
 *
 * Le revers de la convention : le nom vit à DEUX endroits — dans le composant
 * qui le déclare, et dans le sélecteur qui le cite. Rien n'empêche aujourd'hui
 * une faute de frappe (`settings-backups`), un renommage d'un seul côté
 * (`app-header` devenu `app-head`), ou deux composants qui revendiquent le même
 * nom. Les trois reviennent à un test qui cherche un marqueur que personne ne
 * pose — et un test qui ne trouve rien tombe sur un `null`… ou, pire, compte
 * zéro et passe.
 *
 * ─── Ce qui est refusé ─────────────────────────────────────────────────────
 *
 *   • MANQUANT / DIVERGENT — un `data-slot="X"` CITÉ (dans un test ou une
 *     feuille de style) qu'AUCUN composant de `src/` ne déclare. Le marqueur a
 *     été renommé d'un côté, ou retiré du composant : le sélecteur ne résoudra
 *     rien.
 *   • DUPLIQUÉ — le même `data-slot="X"` déclaré plus d'une fois sous `src/`.
 *     Un marqueur doit nommer UNE région ; deux composants qui le revendiquent
 *     se confondent au moment de la sélection.
 *   • PRÉFIXE CREUX — un sélecteur d'espace de noms `[data-slot^="P"]` dont le
 *     préfixe ne correspond à AUCUN marqueur déclaré (le préfixe a survécu à un
 *     renommage, et le sélecteur ne matche plus rien).
 *
 * Ce que le contrôle NE fait PAS : exiger qu'un marqueur déclaré soit cité
 * quelque part. Un `data-slot` interne (une coquille, un conteneur) est
 * légitime sans lecteur ; exiger une citation partout transformerait le
 * contrôle en dette et forcerait à des sélecteurs décoratifs.
 *
 * ─── Les formes lues, et les formes ignorées ───────────────────────────────
 *
 * On lit les littéraux à valeur constante : `data-slot="X"`. Les formes
 * DYNAMIQUES (`data-slot={expr}`, `data-slot="${var}"`) sont ignorées — elles
 * ne nomment pas un marqueur au repos, et les compter fabriquerait une
 * divergence fantôme. Les sélecteurs de VALEUR (`[data-slot="X"]`) sont la
 * référence ; les sélecteurs de PRÉFIXE (`[data-slot^="P"]`) sont vérifiés à
 * part. La prose est blanchie par la couche partagée : un commentaire qui CITE
 * `data-slot="settings-panel"` (les tests en sont pleins) n'est pas une
 * référence.
 *
 * Usage: node scripts/check-data-slots.mjs   (branché sur `npm run lint`)
 */
import fs from 'node:fs';
import path from 'node:path';

import { assertScanned, listFiles, maskComments } from './lib/source-text.mjs';

const SRC = process.env.CHECK_DATA_SLOTS_SRC || 'src';
const TESTS = process.env.CHECK_DATA_SLOTS_TESTS || 'tests';

/**
 * Les TABLES partagées dont les tests DÉRIVENT leurs sélecteurs. Elles portent
 * les noms, donc elles sont un corpus de références à part entière : c'est ce
 * que la table dit qui doit correspondre aux marqueurs déclarés.
 */
const SLOT_TABLES = ['scripts/lib/appshell-slots.mjs', 'scripts/lib/settings-composition.mjs'];

/**
 * La dette d'allowlist et les tables du dépôt se jugent sur l'ARBRE RÉEL. Une
 * suite de tests pointe ce contrôle sur une racine de fixtures : les tables du
 * dépôt n'y ont pas cours, et les lire fabriquerait des références fantômes.
 * `CHECK_DATA_SLOTS_TABLES` force la lecture (séparateur virgule) — c'est ce qui
 * permet à la suite de PROUVER le corpus des tables sur une table de fixture.
 */
const TABLES_ENV = process.env.CHECK_DATA_SLOTS_TABLES;
const TABLE_FILES = TABLES_ENV
  ? TABLES_ENV.split(',').map((s) => s.trim()).filter(Boolean)
  : SLOT_TABLES;
const scanningRealTree = path.resolve(SRC) === path.resolve('src') || Boolean(TABLES_ENV);

/** Un `data-slot="X"` à valeur CONSTANTE — ignore `{expr}` et `${var}`. */
const SLOT_DECL = /data-slot\s*=\s*"([^"\n]+)"/g;
/** Un sélecteur de préfixe `[data-slot^="P"]`. */
const SLOT_PREFIX = /data-slot\^\s*=\s*"([^"\n]+)"/g;
/** Un marqueur de table partagée : un littéral kebab (`'app-shell'`). */
const TABLE_SLOT = /['"]([a-z][a-z0-9]*(?:-[a-z0-9]+)*)['"]/g;

/**
 * Blanchit les commentaires CSS (slash-star … star-slash) en gardant longueur et
 * sauts de ligne, pour qu'un commentaire qui cite un marqueur ne soit pas lu
 * comme un sélecteur. (Le scanner de TypeScript de la couche partagée ne
 * connaît pas la syntaxe CSS.)
 */
function maskCssComments(text) {
  return String(text ?? '').replace(/\/\*[\s\S]*?\*\//g, (block) => block.replace(/[^\n\r]/g, ' '));
}

/** Une valeur de marqueur est-elle un nom au repos (kebab), pas une expression ? */
const isStaticSlot = (value) => /^[A-Za-z0-9][\w-]*$/.test(value);

const lineOf = (text, offset) => text.slice(0, offset).split('\n').length;
/** Le chemin de fichier dépôt-relatif, stable d'une racine relative ou absolue. */
const repoFile = (file) => file.replace(/\\/g, '/');

/** Lit les marqueurs DÉCLARÉS sous `src/` (composants). */
function declaredSlots() {
  const files = listFiles(SRC, { ext: /\.tsx$/ });
  assertScanned(files, { what: 'fichier .tsx déclarant des data-slot', root: SRC });
  const out = [];
  for (const file of files) {
    const text = maskComments(fs.readFileSync(file, 'utf8'));
    for (const hit of text.matchAll(SLOT_DECL)) {
      if (!isStaticSlot(hit[1])) continue;
      out.push({ slot: hit[1], where: `${repoFile(file)}:${lineOf(text, hit.index)}` });
    }
  }
  return out;
}

/** Lit les marqueurs CITÉS dans les tests et les styles. */
function referencedSlots() {
  const testFiles = listFiles(TESTS, { ext: /\.(ts|tsx)$/ });
  const styleFiles = listFiles(SRC, { ext: /\.css$/ });
  assertScanned(testFiles, { what: 'fichier de test .ts/.tsx', root: TESTS });
  assertScanned(styleFiles, { what: 'feuille de style .css', root: SRC });

  const values = [];
  const prefixes = [];
  const collect = (file, text) => {
    for (const hit of text.matchAll(SLOT_DECL)) {
      if (!isStaticSlot(hit[1])) continue;
      values.push({ slot: hit[1], where: `${repoFile(file)}:${lineOf(text, hit.index)}` });
    }
    for (const hit of text.matchAll(SLOT_PREFIX)) {
      if (!isStaticSlot(hit[1])) continue;
      prefixes.push({ prefix: hit[1], where: `${repoFile(file)}:${lineOf(text, hit.index)}` });
    }
  };
  for (const file of testFiles) collect(file, maskComments(fs.readFileSync(file, 'utf8')));
  for (const file of styleFiles) collect(file, maskCssComments(fs.readFileSync(file, 'utf8')));
  // Les tables partagées sont un corpus de références : ce sont ELLES que les
  // tests lisent désormais, donc c'est leur contenu qui doit correspondre aux
  // marqueurs déclarés. (Jugé sur l'arbre réel seulement.)
  if (scanningRealTree) {
    for (const file of TABLE_FILES) {
      // Une table absente ne fait pas tomber le contrôle : elle retire des
      // références, et la non-vacuité se juge sur les corpus déclarés/cités.
      let text;
      try {
        text = maskComments(fs.readFileSync(file, 'utf8'));
      } catch {
        continue;
      }
      for (const hit of text.matchAll(TABLE_SLOT)) {
        values.push({ slot: hit[1], where: `${repoFile(file)} (table)` });
      }
    }
  }
  return { values, prefixes };
}

const declared = declaredSlots();
const { values: referenced, prefixes } = referencedSlots();

if (declared.length === 0) {
  console.error(
    `❌ Rien à vérifier : aucun data-slot déclaré sous ${SRC} — un scan vide n'est pas un vert.`,
  );
  process.exit(2);
}
if (referenced.length + prefixes.length === 0) {
  console.error(
    `❌ Rien à vérifier : aucun data-slot cité dans ${TESTS} ni dans les styles de ${SRC} — la cohérence n'a rien à confronter.`,
  );
  process.exit(2);
}

const declaredSet = new Set(declared.map((d) => d.slot));

// 1. DUPLIQUÉ : un marqueur déclaré plus d'une fois.
const bySlot = new Map();
for (const d of declared) {
  if (!bySlot.has(d.slot)) bySlot.set(d.slot, []);
  bySlot.get(d.slot).push(d.where);
}
const duplicates = [...bySlot.entries()].filter(([, wheres]) => wheres.length > 1);

// 2. MANQUANT / DIVERGENT : une référence qu'aucun composant ne déclare.
const undeclared = referenced.filter((r) => !declaredSet.has(r.slot));

// 3. PRÉFIXE CREUX : un préfixe qui ne correspond à aucun marqueur.
const emptyPrefixes = prefixes.filter((p) => !declared.some((d) => d.slot.startsWith(p.prefix)));

const failed = duplicates.length > 0 || undeclared.length > 0 || emptyPrefixes.length > 0;

if (duplicates.length > 0) {
  console.error('❌ data-slot DUPLIQUÉ — un marqueur doit nommer UNE seule région :');
  for (const [slot, wheres] of duplicates) console.error(`   ${slot} — déclaré en ${wheres.join(', ')}`);
  console.error('   → donnez à chaque région un marqueur distinct.');
}

if (undeclared.length > 0) {
  console.error('❌ data-slot MANQUANT ou DIVERGENT — cité sans être déclaré par un composant de src/ :');
  for (const r of undeclared) console.error(`   ${r.slot} — cité en ${r.where}`);
  console.error('   → alignez le sélecteur sur le marqueur déclaré (ou posez le marqueur dans le composant).');
}

if (emptyPrefixes.length > 0) {
  console.error('❌ PRÉFIXE data-slot CREUX — le préfixe ne correspond à aucun marqueur déclaré :');
  for (const p of emptyPrefixes) console.error(`   data-slot^="${p.prefix}" — cité en ${p.where}`);
  console.error('   → corrigez le préfixe, ou le marqueur qu’il devait désigner.');
}

if (failed) process.exit(1);

console.log(
  `✅ data-slot cohérents : ${declared.length} marqueur(s) déclaré(s), ` +
    `${referenced.length} référence(s) et ${prefixes.length} préfixe(s) — aucune duplication ni divergence.`,
);
