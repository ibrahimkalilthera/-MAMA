#!/usr/bin/env node
/**
 * ─── Un onglet réservé se garde à UN seul endroit ───────────────────────────
 *
 *   npm run check:reserved-tabs        (branché dans `npm run lint`)
 *
 * LE DÉFAUT, MESURÉ LE 2026-10-15. Le droit d'ouvrir un onglet réservé était
 * écrit à deux endroits : la ligne du rail décidait pour elle seule
 * (`isAdminDev`, `canSeePaymentHistory`), le filet du shell décidait pour lui
 * seul (`!auth.isAdmin` ⇒ settings, audit ET paymentHistory). La base a ouvert la
 * LECTURE de l'historique des paiements à l'économe
 * (`20261020000000_econome_payment_history.sql`), le rail a suivi, le filet non.
 * L'économe voyait la ligne, cliquait, et l'onglet revenait au tableau de bord
 * dans la même seconde : la fonctionnalité était morte À L'ÉCRAN tout en
 * paraissant ouverte. Aucune suite n'était rouge — le rail et l'écran étaient
 * mesurés, le filet ne l'était pas.
 *
 * CE QU'IL REFUSE, ET RIEN D'AUTRE. Une SECONDE décision pour un onglet réservé :
 *
 *   • `tab-role-literal` — « onglet réservé + rôle écrit à la main » sur une
 *     même ligne (la forme exacte du défaut) ;
 *   • `tab-gate-call`    — « onglet réservé + appel à un droit » hors de la
 *     table (le droit n'est pas faux, il est lu au mauvais endroit) ;
 *   • `gate-alias`       — l'alias local (`const isAdminDev = …`) qui garde un
 *     bloc où un onglet réservé est POSÉ : la seule forme qu'un scan ligne à
 *     ligne ne voit pas, et celle qui a coûté le défaut ;
 *   • `tab-list`         — une liste d'onglets réservés écrite à la main (deux
 *     réservés ou plus, et aucun autre onglet du VOCABULAIRE sur la ligne — sans
 *     quoi une déclaration de type qui énumère tous les onglets serait accusée) ;
 *   • `tab-ungated`      — un onglet que la table déclare et qu'une seule des
 *     deux navigations garde (elles montrent le même ensemble) ;
 *   • `roles-inline`, `roles-unimported` — dans la table elle-même : une liste de
 *     rôles écrite en clair, ou un identifiant qui ne vient pas d'un
 *     `src/lib/*Rights.ts` (là où les tests comparent la liste à la MIGRATION).
 *
 * CE QU'IL NE FAIT PAS. Il ne juge pas les droits métier (`roleRights`, les
 * portes d'écriture, `check-write-gates`) et il ne dit pas QUI doit voir quoi :
 * il refuse qu'un onglet réservé soit décidé ailleurs que dans sa table.
 *
 * CE QU'IL REFUSE DE LAISSER PASSER POUR UN VERT — trois absences, sortie 2 :
 * aucun onglet réservé lu dans la table, aucun vocabulaire d'onglets lu dans
 * l'union `AppTab` (c'est lui qui distingue une liste interdite d'une déclaration
 * de type), aucun appelant de la table. Un scan qui ne lit plus rien n'est pas un
 * scan propre : c'est le motif qui a disparu (même discipline que
 * `check-state-hover.mjs`, `check-green-surface.mjs`, `check-data-slots.mjs`).
 *
 * La prose est blanchie par la couche partagée (`maskComments`) : l'en-tête de la
 * table CITE `activeTab === 'settings' && !auth.isAdmin` pour expliquer le défaut,
 * et une explication n'est pas une décision.
 */
import fs from 'node:fs';
import path from 'node:path';

import { SOURCE_EXTS, assertScanned, listFiles, maskComments } from './lib/source-text.mjs';
import {
  RULES,
  gateAliasHits,
  readReservedTabEntries,
  readRightsImports,
  readTabVocabulary,
  reservedTabHits,
} from './lib/reserved-tabs.mjs';

const ROOT = process.env.CHECK_RESERVED_TABS_ROOT || 'src';
const SOURCE = process.env.CHECK_RESERVED_TABS_SOURCE || `${ROOT}/app/tabRights.ts`;
const VOCABULARY_SOURCE =
  process.env.CHECK_RESERVED_TABS_VOCABULARY || `${ROOT}/components/Sidebar.tsx`;

/**
 * Les exceptions tolérées : `file` + `rule` + `reason` — VIDE, et c'est l'état
 * gagné (les trois surfaces demandent à la table ; il n'y a plus de seconde
 * décision). Une entrée dont le couple (fichier, règle) n'est plus accusé devient
 * PÉRIMÉE et fait échouer le contrôle jusqu'à sa suppression — la dette se paie
 * dans le commit qui la gagne. `CHECK_RESERVED_TABS_ALLOWLIST` pointe un fichier
 * JSON de la même forme, employé à la place de celle-ci : c'est la porte par
 * laquelle la suite éprouve le grain et la péremption.
 */
const ALLOWLIST_PATH = process.env.CHECK_RESERVED_TABS_ALLOWLIST || '';
if (ALLOWLIST_PATH && !fs.existsSync(ALLOWLIST_PATH)) {
  console.error(`❌ Allowlist injectée introuvable : ${ALLOWLIST_PATH}`);
  process.exit(2);
}
const ALLOWLIST = ALLOWLIST_PATH ? JSON.parse(fs.readFileSync(ALLOWLIST_PATH, 'utf8')) : [];
if (!Array.isArray(ALLOWLIST) || ALLOWLIST.some((e) => !e?.file || !e?.rule || !e?.reason)) {
  console.error(
    `❌ Allowlist injectée illisible (${ALLOWLIST_PATH}) : un tableau de { file, rule, reason } est attendu.`,
  );
  process.exit(2);
}

/**
 * La clé d'un fichier, telle que le lecteur la lit : `src/components/Sidebar.tsx`.
 *
 * Elle est relative au PARENT de la racine SCANNÉE, pas au répertoire courant :
 * lancé depuis le dépôt ou sur une arborescence de fixtures, le même fichier se
 * nomme donc pareil — une entrée d'allowlist (`src/…`) désigne le même fichier
 * partout, et un diagnostic ne cite pas un chemin de `AppData/Local/Temp`.
 */
const SCAN_BASE = path.dirname(path.resolve(ROOT));
const repoKey = (file) => path.relative(SCAN_BASE, path.resolve(file)).replace(/\\/g, '/');

function refuse(title, lines) {
  console.error(`❌ ${title}`);
  for (const line of lines) console.error(`   ${line}`);
  process.exit(2);
}

// ── 1. L'UNIQUE source, lue avant tout jugement ──────────────────────────────
if (!fs.existsSync(SOURCE)) {
  refuse(`${SOURCE} est introuvable — la table des onglets réservés n’est pas lue.`, [
    'sans elle, ce contrôle ne saurait pas quels onglets sont réservés : il refuse plutôt que de rassurer.',
  ]);
}
const sourceText = fs.readFileSync(SOURCE, 'utf8');
const maskedSource = maskComments(sourceText);
const { entries, problems: sourceProblems } = readReservedTabEntries({ text: maskedSource });
const reservedTabs = entries.map((entry) => entry.tab);
if (reservedTabs.length === 0) {
  refuse(`aucun onglet réservé lu dans ${SOURCE}`, [
    'une table vide n’est pas une table propre : le lecteur ne trouve plus ce qu’il doit garder.',
  ]);
}

const rightsImports = readRightsImports(sourceText);
const unimported = entries
  .filter((entry) => !rightsImports.has(entry.roles))
  .map((entry) => ({
    rule: 'roles-unimported',
    file: SOURCE,
    line: entry.line,
    detail: `${entry.tab} → ${entry.roles} n’est pas importé d’un src/lib/*Rights.ts`,
  }));

// ── 2. Le VOCABULAIRE des onglets — la seule distinction liste/type ─────────
if (!fs.existsSync(VOCABULARY_SOURCE)) {
  refuse(`${VOCABULARY_SOURCE} est introuvable — le vocabulaire des onglets n’est pas lu.`, [
    'c’est lui qui distingue une liste d’onglets réservés d’une déclaration de type : sans lui, la règle « liste écrite à la main » juge à l’aveugle.',
  ]);
}
const vocabulary = readTabVocabulary(fs.readFileSync(VOCABULARY_SOURCE, 'utf8'));
if (vocabulary.length === 0) {
  refuse(`aucun onglet lu dans l’union \`AppTab\` de ${VOCABULARY_SOURCE}`, [
    'l’union a été renommée ou déplacée : la règle « liste d’onglets réservés écrite à la main » ne saurait plus ce qui n’est PAS réservé.',
  ]);
}

// ── 3. Le corpus ────────────────────────────────────────────────────────────
const files = listFiles(ROOT, { ext: SOURCE_EXTS });
assertScanned(files, { what: 'fichier .ts/.tsx', root: ROOT });

const SOURCE_KEY = repoKey(SOURCE);
const allowed = new Set(ALLOWLIST.map((entry) => `${entry.file}::${entry.rule}`));
const seen = new Set();
const violations = [];
let gateCalls = 0;

const note = ({ file, line, rule, detail }) => {
  const id = `${file}::${rule}`;
  if (allowed.has(id)) {
    seen.add(id);
    return;
  }
  violations.push({ file, line, rule, detail });
};

for (const problem of sourceProblems) note({ file: SOURCE_KEY, line: problem.line, rule: problem.rule, detail: problem.token });
for (const problem of unimported) note(problem);

/** Les onglets gardés par chaque fichier CONSOMMATEUR de la table. */
const gated = new Map(reservedTabs.map((tab) => [tab, new Set()]));

for (const file of files) {
  const key = repoKey(file);
  const raw = fs.readFileSync(file, 'utf8');
  const masked = maskComments(raw);
  const maskedLines = masked.split(/\r?\n/);
  const rawLines = raw.split(/\r?\n/);

  for (let i = 0; i < maskedLines.length; i += 1) {
    const line = maskedLines[i];
    for (const tab of reservedTabs) {
      if (line.includes(`canOpenTab('${tab}'`)) gated.get(tab).add(key);
    }
    if (line.includes('canOpenTab(') && key !== SOURCE_KEY) gateCalls += 1;
    if (key === SOURCE_KEY) continue; // ses propres entrées sont jugées plus haut
    for (const hit of reservedTabHits(line, { reservedTabs, vocabulary })) {
      note({
        file: key,
        line: i + 1,
        rule: hit.rule,
        detail: `${hit.token}\n      ${(rawLines[i] ?? '').trim().slice(0, 160)}`,
      });
    }
  }

  for (const hit of gateAliasHits({ text: masked, reservedTabs })) {
    note({
      file: key,
      line: hit.useLine,
      rule: 'gate-alias',
      detail: `${hit.token}\n      ${(rawLines[hit.useLine - 1] ?? '').trim().slice(0, 160)}`,
    });
  }
}

// ── 4. Chaque onglet réservé est gardé dans les DEUX navigations ────────────
// « La barre reflète le rail » est la règle écrite dans l'en-tête de MobileNav :
// un onglet gardé d'un seul côté est un onglet à moitié ouvert — visible sur un
// écran, absent de l'autre, ou l'inverse.
for (const [tab, holders] of gated) {
  if (holders.size >= 2) continue;
  note({
    file: [...holders][0] ?? SOURCE_KEY,
    line: 0,
    rule: 'tab-ungated',
    detail: `${tab} est gardé par ${holders.size} fichier(s) (${[...holders].join(', ') || 'aucun'}) — le rail ET la barre mobile le gardent`,
  });
}

// Un scan qui ne LIT aucun appelant de la table n'est pas un vert : c'est un scan
// dont le motif a disparu (racine, filtre, table déplacée).
if (gateCalls === 0) {
  refuse(`aucun appel à \`canOpenTab\` lu sous ${ROOT}`, [
    'les trois surfaces (rail, barre mobile, filet du shell) demandent à la table : si plus aucune ne le fait, ce contrôle ne garde rien.',
  ]);
}

// ── 5. Le verdict ───────────────────────────────────────────────────────────
const stale = ALLOWLIST.map((entry) => `${entry.file}::${entry.rule}`).filter((id) => !seen.has(id));
let failed = false;

if (violations.length > 0) {
  failed = true;
  console.error('❌ Une SECONDE décision pour un onglet réservé — elle divergera de la table :');
  for (const v of violations) {
    console.error(`   ${v.file}${v.line ? `:${v.line}` : ''}  —  ${RULES[v.rule]?.label ?? v.rule}`);
    console.error(`      ${v.detail}`);
    console.error(`      → ${RULES[v.rule]?.remedy ?? ''}`);
  }
  console.error(
    '\n   La table est `RESERVED_TABS` (src/app/tabRights.ts) : un onglet réservé, son droit, et la liste\n' +
      '   de rôles que ce droit lit — importée de src/lib/*Rights.ts, où les tests la comparent à la\n' +
      '   MIGRATION. Les trois surfaces la DEMANDENT (`canOpenTab`) au lieu de la recopier.',
  );
}

if (stale.length > 0) {
  failed = true;
  console.error('❌ Entrée(s) PÉRIMÉE(S) dans l’ALLOWLIST — le couple (fichier, règle) n’est plus accusé :');
  for (const id of stale) console.error(`   ${id}`);
  console.error('   → retirez l’entrée dans le commit qui l’a gagnée.');
}

if (failed) process.exit(1);

console.log(
  `✅ ${reservedTabs.length} onglet(s) réservé(s) (${reservedTabs.join(', ')}) — une seule table, ` +
    `${gateCalls} garde(s) qui la demandent, ${files.length} fichier(s) .ts/.tsx lu(s), ` +
    `${vocabulary.length} onglet(s) au vocabulaire, ${ALLOWLIST.length} exception(s) motivée(s).`,
);
