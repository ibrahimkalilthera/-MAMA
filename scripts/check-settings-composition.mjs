/**
 * Settings-composition gate — la coquille des Paramètres importe EXACTEMENT ses
 * sections, les rend DANS L'ORDRE, et la pile de sections porte EXACTEMENT les
 * enfants déclarés par la table.
 *
 * `tests/settings-composition.test.tsx` prouve ce que le navigateur VOIT : les
 * blocs marqués par `data-slot`, leur ordre, la modale hors pile. Cette
 * preuve-là est indispensable — elle mesure le rendu réel — mais elle ne dit pas
 * quel FICHIER compose, ni ce qu'il a le droit d'importer. Elle monterait encore
 * `SettingsView` si la coquille tirait ses sections d'ailleurs, et elle ne
 * distingue pas « les imports du contrat » d'« une liste calculée ».
 *
 * Ce contrôle-ci lit la SOURCE et fige le contrat de la découpe :
 *
 *   • IMPORTS — `SettingsView.tsx` importe exactement les composants de section
 *     (aucun de plus, aucun oublié), chacun depuis son propre module ;
 *   • RENDU — il les rend exactement une fois chacun, dans l'ordre du contrat ;
 *   • ENFANTS DE LA PILE — les composants de section déclarent exactement les
 *     `data-slot` de `SETTINGS_STACK_SLOTS`, dans l'ordre. C'est le NOMBRE
 *     d'enfants que le DOM verra : si un bloc est ajouté ou retiré sans que la
 *     table soit mise à jour, ce contrôle tombe — et le test DOM aussi, parce
 *     qu'il lit la MÊME table (`scripts/lib/settings-composition.mjs`).
 *
 * ─── Lire du code, pas de la prose ─────────────────────────────────────────
 *
 * Les commentaires sont blanchis (`maskComments`) : la prose qui CITE un nom de
 * composant ne doit pas compter — les littéraux sont conservés pour lire les
 * chefs de module. Le scan de rendu blanchit AUSSI les littéraux (`maskProse`) :
 * une chaîne qui contiendrait `<Settings…` n'est pas un rendu.
 *
 * ─── Refuser la vacuité ────────────────────────────────────────────────────
 *
 * Sans table, il n'y a pas de contrat ; sans fichier, plus rien à lire. Les deux
 * sortent en **2** en le DISANT, jamais en vert silencieux.
 *
 * Usage : node scripts/check-settings-composition.mjs   (branché sur `npm run lint`)
 */
import fs from 'node:fs';
import path from 'node:path';

import {
  SETTINGS_SECTIONS,
  SETTINGS_STACK_SECTIONS,
  SETTINGS_STACK_SLOTS,
} from './lib/settings-composition.mjs';
import { maskComments, maskProse } from './lib/source-text.mjs';

const VIEW_FILE = process.env.CHECK_SETTINGS_VIEW_FILE || 'src/components/SettingsView.tsx';
const SECTIONS_DIR = process.env.CHECK_SETTINGS_SECTIONS_DIR || 'src/components';

/** Un `data-slot="settings-…"` — le marqueur stable d'une section. */
const SLOT_MARKER = /data-slot\s*=\s*"(settings-[a-z0-9-]+)"/g;

// Une table vide ne juge rien : une coquille « vérifiée » sur zéro section
// serait un faux vert.
if (SETTINGS_SECTIONS.length === 0 || SETTINGS_STACK_SLOTS.length === 0) {
  console.error(
    '❌ Rien à vérifier : la table de composition des Paramètres est vide — une coquille non vérifiée n’est pas conforme.',
  );
  process.exit(2);
}

/** Lit un fichier, ou `null` s'il est absent (c'est la vacuité qui parle alors). */
const read = (file) => {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch {
    return null;
  }
};

const rawView = read(VIEW_FILE);
if (rawView === null || !rawView.trim()) {
  console.error(
    `❌ Rien à vérifier : ${VIEW_FILE} est introuvable ou vide — un fichier absent n’est pas un contrat tenu.`,
  );
  process.exit(2);
}

// ── Imports : ceux du contrat, chacun depuis son propre module ─────────────
// Commentaires blanchis, littéraux CONSERVÉS : les chefs de module vivent dans
// des chaînes, et c'est exactement ce qu'on veut lire.
const commentsBlanked = maskComments(rawView);
const importedPaths = [];
const importedNames = [];
for (const m of commentsBlanked.matchAll(
  /import\s*\{([^}]*)\}\s*from\s*['"]\.\/(Settings[A-Za-z0-9_]+)['"]/g,
)) {
  importedPaths.push(m[2]);
  for (const part of m[1].split(',')) {
    const name = part.trim().split(/\s+as\s+/)[0].trim();
    if (name) importedNames.push(name);
  }
}

const expected = new Set(SETTINGS_SECTIONS);
const importedSet = new Set(importedNames);
const problems = [];

const missingImports = SETTINGS_SECTIONS.filter((s) => !importedSet.has(s));
const extraImports = importedNames.filter((n) => !expected.has(n));
if (missingImports.length) problems.push(`imports MANQUANTS : ${missingImports.join(', ')}`);
if (extraImports.length) problems.push(`imports en TROP (hors contrat) : ${extraImports.join(', ')}`);
if (importedNames.length !== importedSet.size) {
  problems.push('un composant de section est importé DEUX fois');
}
for (const name of importedNames) {
  if (!importedPaths.includes(name)) {
    problems.push(`« ${name} » n’est pas importé depuis './${name}'`);
  }
}

// ── Rendu : chacun une fois, dans l’ordre ─────────────────────────────────
// Ici les littéraux sont blanchis AUSSI : un rendu est du CODE, jamais le
// contenu d'une chaîne.
const codeOnly = maskProse(rawView, { comments: true, literals: true });
const rendered = [...codeOnly.matchAll(/<(Settings[A-Za-z0-9_]+)\b/g)].map((m) => m[1]);
if (rendered.length !== SETTINGS_SECTIONS.length || rendered.some((n, i) => n !== SETTINGS_SECTIONS[i])) {
  problems.push(`rendu attendu, dans l’ordre : ${SETTINGS_SECTIONS.join(' → ')}`);
  problems.push(`rendu observé : ${rendered.length ? rendered.join(' → ') : '(aucun)'}`);
}

// ── Enfants de la pile : la table fait foi ─────────────────────────────────
// Chaque composant de section déclare ses `data-slot` ; lus dans l'ordre des
// sections, ils DOIVENT être exactement la table — donc la longueur de la table
// est le nombre d'enfants attendus, et changer la structure sans la mettre à
// jour échoue ici.
const sectionFiles = SETTINGS_STACK_SECTIONS.map((section) =>
  path.join(SECTIONS_DIR, `${section}.tsx`),
);
const unreadable = sectionFiles.filter((file) => read(file) === null);
if (unreadable.length) {
  console.error(
    `❌ Rien à vérifier : ${unreadable.join(', ')} introuvable(s) — les enfants de la pile ne peuvent pas être comptés.`,
  );
  process.exit(2);
}

const observedStackSlots = [];
for (const file of sectionFiles) {
  const marked = maskComments(read(file)).matchAll(SLOT_MARKER);
  for (const m of marked) observedStackSlots.push(m[1]);
}

if (
  observedStackSlots.length !== SETTINGS_STACK_SLOTS.length ||
  observedStackSlots.some((slot, i) => slot !== SETTINGS_STACK_SLOTS[i])
) {
  problems.push(
    `la pile doit porter ${SETTINGS_STACK_SLOTS.length} enfants (${SETTINGS_STACK_SLOTS.join(' → ')})`,
  );
  problems.push(
    `marqueurs observés : ${observedStackSlots.length} (${observedStackSlots.join(' → ') || 'aucun'})`,
  );
  problems.push(
    'un bloc a changé SANS que la table (scripts/lib/settings-composition.mjs) soit mise à jour',
  );
}

if (problems.length) {
  console.error(`❌ ${VIEW_FILE} ne respecte pas le contrat de composition des Paramètres :`);
  for (const p of problems) console.error(`   • ${p}`);
  console.error(
    '   → la coquille est un CONTRAT : les imports du contrat, chacun rendu une fois, et la pile porte exactement les enfants de la table.',
  );
  process.exit(1);
}

console.log(
  `✅ ${VIEW_FILE} importe et rend les ${SETTINGS_SECTIONS.length} sections dans l’ordre, ` +
    `et la pile porte ses ${SETTINGS_STACK_SLOTS.length} enfants (${SETTINGS_STACK_SLOTS.join(' → ')}).`,
);
