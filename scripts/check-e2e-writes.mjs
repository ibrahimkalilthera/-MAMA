#!/usr/bin/env node
/**
 * check-e2e-writes.mjs — une écriture de démo doit pouvoir être RETROUVÉE, sinon
 * elle ne peut pas être nettoyée.
 *
 *   npm run check:e2e-writes          (dans la chaîne qualité)
 *   npm run check:e2e-writes -- --verbose
 *
 * ─── Ce qui s'est payé le 2026-09-12 ─────────────────────────────────────────
 * Un 504 du gateway Supabase est tombé APRÈS avoir appliqué un POST. Le run a
 * repris — c'est le travail de `withTransientRetry` — et la reprise a créé son
 * risque propre : **un doublon**. Bénin là où une contrainte d'unicité
 * l'interdit ; or il n'y en a aucune, le schéma est formel — `public.staff` n'a
 * rien d'unique sur `email`, `public.students` n'a d'unique que `student_id`
 * (NULL sur les lignes de démo). Le nettoyage supprime par l'id rendu par la
 * tentative gagnante, donc la ligne de la tentative perdue n'aurait **jamais eu
 * de nom**, et rien ne l'aurait signalée : la garde anti-résidus ne connaît que
 * les comptes éphémères.
 *
 * ─── Ce que ce contrôle refuse ───────────────────────────────────────────────
 * Pour chaque fichier de `scripts/` qui touche la base partagée, chaque POST de
 * création doit :
 *   • être **rejouable** — passer par l'enrobage qui sonde avant de rejouer
 *     (`replayableWrite`, `insertOnce`…) : c'est la seule façon de ne pas
 *     doubler une ligne dont la réponse s'est perdue ;
 *   • porter un **jeton d'exécution** — quelque chose qui rattache la ligne à
 *     SON run (`${TS}`, `ephemeralEmail()`, `randomUUID()`) : sans lui, deux
 *     exécutions produisent des lignes indiscernables ;
 *   • avoir une **clé de réconciliation** — une REQUÊTE qui la retrouve
 *     (`email=eq.…`), et pas l'id rendu : c'est la seule qui vaille quand la
 *     réponse est perdue.
 * Une exemption NOMMÉE et BORNÉE peut tolérer des créations restantes, à
 * condition de dire pourquoi et combien — et le compte est vérifié dans les DEUX
 * sens : une exemption trop large (le réel a été corrigé) est refusée aussi,
 * sinon elle autorise un retour en arrière silencieux.
 *
 * C'est un contrôle de TEXTE : il attrape une écriture brute non déclarée, il ne
 * prouve pas que la ligne est nettoyée. La preuve d'exécution appartient à
 * l'enrobage lui-même et au garde anti-résidus (`verify-ephemeral-cleanup.mjs`).
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { EXEMPTIONS, auditAllowlist, judgeWrites } from './lib/e2e-writes.mjs';
import { assertScanned } from './lib/source-text.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const VERBOSE = args.includes('--verbose');

// Les exemptions du dépôt vivent dans la bibliothèque (`EXEMPTIONS`) : elles
// sont ainsi jugées par les tests comme par ce point d'entrée. Une exemption
// qui ne correspond plus au réel — un site migré, un autre ajouté — fait
// échouer le contrôle : c'est ce qui l'empêche de devenir une porte ouverte.

/** Tous les `.mjs` de `scripts/`, récursivement. */
function scriptsOnDisk(dir = join(root, 'scripts')) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...scriptsOnDisk(full));
    else if (name.endsWith('.mjs')) out.push(full);
  }
  return out;
}

const files = scriptsOnDisk();
// Un scan vide n'est pas un vert : une racine déplacée laisserait ce contrôle
// imprimer « tout est traçable » sans avoir lu une seule ligne.
assertScanned(files, { what: 'scripts .mjs lus', root: 'scripts/' });
const present = files.map((f) => relative(root, f).split(sep).join('/'));

// Ce contrôle ne juge pas son propre module : il cite les marqueurs qu'il exige
// (`=eq.`, `replayableWrite`) dans sa prose, et se prendrait pour un site
// d'écriture. Le module qu'il teste, lui, est couvert par sa suite.
const judged = files.filter((f) => {
  const rel = relative(root, f).split(sep).join('/');
  return rel !== 'scripts/lib/e2e-writes.mjs' && rel !== 'scripts/check-e2e-writes.mjs';
});

const problems = [...auditAllowlist({ allowlist: EXEMPTIONS, present })];
const rows = [];

for (const file of judged) {
  const rel = relative(root, file).split(sep).join('/');
  const verdict = judgeWrites({ file: rel, source: readFileSync(file, 'utf8'), allowlist: EXEMPTIONS });
  if (verdict.creates === 0 && verdict.mutations === 0) continue;
  rows.push({ file: rel, ...verdict });
  problems.push(...verdict.problems);
}

if (VERBOSE) {
  for (const row of rows) {
    console.log(
      `${row.file} — ${row.creates} création(s), ${row.mutations} mutation(s)` +
        (row.exempted ? ` · exemption : ${row.exempted}` : ''),
    );
  }
}

if (problems.length) {
  console.error('❌ écriture(s) de démo non nettoyable(s) :');
  for (const p of problems) console.error(`   • ${p}`);
  console.error(
    '\n   Une ligne de démo qu’on ne peut pas retrouver est une ligne qu’on ne peut pas supprimer :' +
      '\n   enrobez la création dans `replayableWrite` (sonde avant rejeu), ou migrez-la vers' +
      '\n   `scripts/lib/transient-http.mjs`. Une exemption doit dire POURQUOI et COMBIEN.',
  );
  process.exit(1);
}

const creates = rows.reduce((n, r) => n + r.creates, 0);
const mutations = rows.reduce((n, r) => n + r.mutations, 0);
console.log(
  `✅ ${rows.length} script(s) touchant la base : ${creates} création(s) toutes traçables ` +
    `(jeton d’exécution + clé de réconciliation), ${mutations} mutation(s) idempotentes.`,
);
