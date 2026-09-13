#!/usr/bin/env node
/**
 * repair-frozen-updater.mjs — dégeler les postes qui ne peuvent plus se mettre à
 * jour, SANS réinstallation et SANS droits administrateur.
 *
 *   npm run repair:frozen-updater                      → liste, ne touche à rien
 *   npm run repair:frozen-updater -- --apply           → retire la promesse insatisfiable
 *   npm run repair:frozen-updater -- --dir="%LOCALAPPDATA%\Programs\MamaTheraFinance"
 *   npm run repair:frozen-updater -- --apply --force   → accepte aussi une promesse satisfiable
 *
 * ─── Le problème, mesuré ─────────────────────────────────────────────────────
 * Un poste équipé de la 1.0.6, 1.0.7 ou 1.0.8 porte
 * `<dossier d'install>\resources\app-update.yml` avec
 * `publisherName: [ "Mama Thera Finance (test)" ]`. Or l'application DÉJÀ
 * installée relit ce fichier à chaque vérification (`ElectronAppAdapter.js:23`),
 * et refuse l'installeur téléchargé s'il n'est pas `Valid` **au nom promis**
 * (`NsisUpdater.js:85-90` → `windowsExecutableCodeSignatureVerifier.js`). Aucune
 * version publiée — signée ou non — ne peut donc leur parvenir : le refus tombe
 * chez eux, avant toute exécution. C'est un gel définitif, et aucun geste côté
 * canal ne le lève.
 *
 * ─── Pourquoi un fichier suffit ──────────────────────────────────────────────
 * Le même code, mesuré, dit la sortie : `if (publisherName == null) return null`
 * — **sans promesse, il n'y a plus de vérification de signature du tout**. Une
 * installation par utilisateur vit sous `%LOCALAPPDATA%`, où l'utilisateur écrit
 * sans élever ses droits ; retirer le bloc `publisherName` de ce fichier suffit
 * donc, pourvu que l'application soit relancée (elle ne lit ce fichier qu'au
 * démarrage). Ni désinstallation, ni réinstallation, ni perte de données.
 *
 * ─── Ce que ce script refuse de faire ────────────────────────────────────────
 * Il ne retire QUE ce qu'aucun certificat ne peut honorer : une promesse vide, ou
 * un signataire de test. Une promesse satisfiable est une garantie — la retirer
 * accepterait des octets non signés sur un poste qui n'était pas cassé — donc elle
 * est nommée et laissée en place, sauf `--force` explicite.
 *
 * Les contrats qui ne sont PAS ceux de cette application sont comptés et jamais
 * touchés : ce script ne répare pas les mises à jour des autres.
 */
import { copyFileSync, existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

import { contractState, stripPublisherPromise } from './lib/updater-contract-repair.mjs';
import { parsePublisherNames } from './lib/updater-trust.mjs';

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const FORCE = args.includes('--force');
const dirArg = args.find((a) => a.startsWith('--dir='))?.slice('--dir='.length) ?? null;

/** Le contrat d'une AUTRE application n'est pas notre affaire. */
const isOurContract = (text) =>
  /updaterCacheDirName:\s*mama-thera-finance-updater/m.test(text) || /repo:\s*'?-MAMA'?/m.test(text);

/** Un dossier d'installation, ou son `resources/`, selon ce qu'on nous donne. */
function contractPathOf(dir) {
  const direct = join(dir, 'app-update.yml');
  if (existsSync(direct)) return direct;
  const nested = join(dir, 'resources', 'app-update.yml');
  if (existsSync(nested)) return nested;
  return null;
}

/**
 * Les emplacements d'installation d'un poste Windows, et rien d'autre.
 *
 * La profondeur est bornée : ce chemin est exécuté à la main ou par une stratégie
 * de parc, pas au milieu d'une chaîne où le temps se compte. `resources/` est à
 * deux niveaux sous `Programs` (édition utilisateur) et à trois sous
 * `Program Files` (édition machine), donc 3 suffit pour les deux.
 */
function defaultRoots() {
  const roots = [];
  const local = process.env.LOCALAPPDATA || (process.platform === 'win32' ? join(homedir(), 'AppData', 'Local') : '');
  if (local) {
    roots.push(join(local, 'Programs'));
    roots.push(local);
  }
  for (const key of ['PROGRAMFILES', 'PROGRAMFILES(X86)']) {
    if (process.env[key]) roots.push(process.env[key]);
  }
  return [...new Set(roots.filter(Boolean))];
}

function findContracts(roots, maxDepth = 3) {
  const found = [];
  const walk = (dir, depth) => {
    if (depth > maxDepth) return;
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return; // dossier illisible : ce n'est pas une erreur, c'est un dossier qu'on ne juge pas
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const child = join(dir, entry.name);
      if (entry.name.toLowerCase() === 'resources') {
        const candidate = join(child, 'app-update.yml');
        if (existsSync(candidate)) found.push(candidate);
        continue;
      }
      walk(child, depth + 1);
    }
  };
  for (const root of roots) if (existsSync(root)) walk(root, 0);
  return [...new Set(found.map((p) => resolve(p)))];
}

if (dirArg && !contractPathOf(dirArg)) {
  console.error(`\n❌ aucun « app-update.yml » sous ${dirArg}`);
  console.error('   • donnez le dossier d’installation (celui qui contient `resources/`) ou son dossier `resources/`');
  process.exit(2);
}

const candidates = dirArg ? [contractPathOf(dirArg)] : findContracts(defaultRoots());
console.log(
  `\n🔎 contrats de mise à jour ${dirArg ? `sous ${dirArg}` : `dans ${defaultRoots().join(', ')}`} — ${candidates.length} fichier(s) « app-update.yml »`,
);
if (!dirArg && process.platform !== 'win32') {
  console.log(
    'ℹ️  hors Windows, les emplacements par défaut n’existent pas : visez une installation avec `--dir=<dossier>`',
  );
}

/** Ce qui reste à faire après ce passage, pour que la sortie le dise. */
const outcome = { ours: 0, frozen: 0, repaired: 0, alreadyFree: 0, demanding: 0, foreign: 0 };

for (const contract of candidates) {
  const text = readFileSync(contract, 'utf8');
  if (!isOurContract(text)) {
    outcome.foreign += 1;
    continue;
  }
  outcome.ours += 1;
  const state = contractState(text);
  const promise = state.promised
    ? state.names.map((n) => `« ${n} »`).join(' / ') || '(liste vide)'
    : 'aucune';

  // `--force` est le SEUL chemin par lequel une promesse satisfiable est retirée :
  // elle n'est pas un défaut, c'est une garantie, et la retirer est une décision.
  const forced = FORCE && state.promised && !state.frozen;

  if (!state.frozen && !forced) {
    if (!state.promised) outcome.alreadyFree += 1;
    else outcome.demanding += 1;
    console.log(`\n${!state.promised ? '✅ déjà libre' : '⏸  laissé en place'} — ${contract}`);
    console.log(`   signataire promis : ${promise}`);
    console.log(`   ${state.because}`);
    if (state.promised) {
      console.log('   « --apply --force » retirerait cette promesse — à ne faire que si ce signataire ne viendra jamais');
    }
    continue;
  }

  if (state.frozen) {
    outcome.frozen += 1;
    console.log(`\n🧊 GELÉ — ${contract}`);
  } else {
    console.log(`\n⚠️  promesse satisfiable, RETIRÉE sur demande explicite — ${contract}`);
  }
  console.log(`   signataire promis : ${promise}`);
  console.log(`   ${state.because}`);

  if (!APPLY) {
    console.log('   (rien n’a été écrit : `--apply` est le geste qui répare)');
    continue;
  }

  const repaired = stripPublisherPromise(text);
  if (!repaired.changed || parsePublisherNames(repaired.text).promised) {
    console.error('   ❌ je n’ai pas su retirer cette promesse — ce fichier n’est pas écrit, devinez à la main');
    continue;
  }

  const backup = `${contract}.bak`;
  if (!existsSync(backup)) copyFileSync(contract, backup);
  writeFileSync(contract, repaired.text, 'utf8');

  // On ne conclut pas sur ce qu'on vient d'écrire : on relit le fichier du disque.
  const after = contractState(readFileSync(contract, 'utf8'));
  if (after.promised) {
    console.error(`   ❌ la promesse est encore là après écriture — restaurez ${backup}`);
    process.exitCode = 1;
    continue;
  }
  outcome.repaired += 1;
  console.log(`   ✅ promesse retirée (${repaired.removed.length} ligne(s) : ${repaired.removed.join(' | ')})`);
  console.log(`   sauvegarde : ${backup}`);
  console.log('   → il reste à RELANCER l’application : elle ne lit ce fichier qu’au démarrage');
}

console.log(
  `\n⚖️  ${outcome.ours} contrat(s) de cette application — ` +
    `${outcome.frozen} gelé(s) · ${outcome.repaired} réparé(s) · ${outcome.alreadyFree} déjà libre(s) · ` +
    `${outcome.demanding} promesse(s) satisfiable(s) laissée(s) en place` +
    (outcome.foreign ? ` · ${outcome.foreign} contrat(s) d’une autre application, jamais touché(s)` : ''),
);

if (!outcome.ours) {
  console.log(
    '\nℹ️  aucune installation de cette application sur ce poste — rien à réparer ici.\n' +
      '   Pour un parc : lancer ce script sur chaque poste, ou via une stratégie (tâche de connexion),\n' +
      '   puis relancer l’application pour que le fichier soit relu.',
  );
} else if (outcome.frozen > outcome.repaired) {
  console.log(
    `\n❌ ${outcome.frozen - outcome.repaired} contrat(s) encore GELÉ(S) — ces postes ne recevront rien tant qu’ils le sont.` +
      (APPLY ? '' : ' Relancez avec `--apply`.'),
  );
  process.exitCode = 1;
} else if (outcome.repaired) {
  console.log('\n✅ plus aucun contrat gelé sur ce poste — relancez l’application, la prochaine version s’installera.');
}
