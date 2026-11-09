#!/usr/bin/env node
/**
 * ─── `npm run branches:status` — le tri des branches, sans le faire à la main ─
 *
 * Le 2026-11-09, trente-sept références de branches ont été supprimées à la
 * main. Deux réflexes ont menti pendant ce tri, et c'est ce qu'ils ont dit :
 *
 *   • `git branch --merged` ne voit AUCUNE fusion en squash — or ce dépôt
 *     fusionne chaque PR en squash, donc aucune branche fusionnée n'est un
 *     ancêtre de `main`. Dix-sept branches mortes ressortaient « non fusionnées ».
 *   • `git log --grep "<sujet>"` ne les retrouve pas davantage : le squash
 *     réécrit le sujet (`… (#127)`), et deux branches distinctes peuvent porter
 *     le même.
 *
 * Ce script assemble donc les seules preuves qui tiennent : l'API des PR (tous
 * états confondus), l'ascendance git, et — comme indice, jamais comme verdict —
 * la part des lignes distinctives de la branche que la base contient déjà. Le
 * module `scripts/lib/branch-status.mjs` porte la décision ; ce fichier n'est
 * que le bord : lire les refs, interroger GitHub, écrire le tableau.
 *
 * ─── Ce qu'il ne fait pas ───────────────────────────────────────────────────
 *
 * Il ne supprime rien, ne pousse rien, ne réécrit rien : `supprimable` est une
 * preuve, pas un ordre. La suppression reste un geste décidé — et le dépôt a
 * déjà payé l'inverse (une sauvegarde supprimée sur un `--merged` menteur serait
 * partie sans un mot).
 *
 * ─── Sortie ─────────────────────────────────────────────────────────────────
 *
 * Code 0 : rapport écrit. Code 2 : rien n'a pu être lu (aucune branche, base
 * absente) — un rapport vide n'est pas un rapport vert, il est un échec.
 *
 * Usage : npm run branches:status   [--help]
 */
import { execFileSync } from 'node:child_process';

import { classifyBranch, contentCoverage, formatReport } from './lib/branch-status.mjs';

const BASE = 'origin/main';
const REMOTE = 'origin';

const USAGE = `npm run branches:status

Liste les branches (locales et distantes) avec :

  PR        l'état de la PR qui a porté la branche (gh, tous états)
  commits   le nombre de commits absents de ${BASE}
  contenu   la part des lignes distinctives de la branche déjà dans ${BASE}
  verdict   supprimable (preuve exacte) / garder (PR ouverte) / à relire

Options : --help. Le script ne supprime rien : il trie.`;

if (process.argv.includes('--help') || process.argv.includes('-h')) {
  console.log(USAGE);
  process.exit(0);
}

/** git, en échec BRUYANT : un `show` manqué ne doit pas devenir un fichier vide. */
function git(args, { input } = {}) {
  return execFileSync('git', args, { encoding: 'utf8', input, maxBuffer: 64 * 1024 * 1024 });
}

const isAncestor = (ref) => {
  try {
    git(['merge-base', '--is-ancestor', ref, BASE]);
    return true;
  } catch {
    return false;
  }
};

const refs = (pattern) =>
  git(['for-each-ref', '--format=%(refname:short)', pattern])
    .trim()
    .split(/\r?\n/)
    .filter(Boolean);

function readBranches() {
  const locals = refs('refs/heads').filter((name) => name !== 'main');
  // `refs/remotes/origin` liste AUSSI le nom du remote lui-même (référence
  // symbolique) : le garder fabriquait une branche « origin » et lisait
  // `origin/origin`, qui n'existe pas.
  const remotes = refs(`refs/remotes/${REMOTE}`)
    .filter((name) => name !== REMOTE && !name.endsWith('/HEAD'))
    .map((name) => name.slice(REMOTE.length + 1))
    .filter((name) => name && name !== 'main');

  const names = [...new Set([...locals, ...remotes])].sort();
  return names.map((name) => {
    const local = locals.includes(name);
    return { name, local, remote: remotes.includes(name), ref: local ? name : `${REMOTE}/${name}` };
  });
}

/** owner/repo depuis l'URL du remote — https, ssh et ssh://. */
function repoSlug() {
  const url = git(['remote', 'get-url', REMOTE]).trim();
  const match = /github\.com[:/]+([^/]+)\/([^/]+?)(?:\.git)?$/.exec(url);
  return match ? `${match[1]}/${match[2]}` : null;
}

/**
 * Les PR, tous états. `null` quand la question n'a pas pu être posée : ce n'est
 * pas « aucune PR », et le rapport le dit.
 */
function readPulls() {
  const slug = repoSlug();
  if (!slug) return null;
  try {
    const out = execFileSync(
      'gh',
      ['api', '--paginate', `repos/${slug}/pulls?state=all&per_page=100`],
      { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
    );
    const pulls = JSON.parse(out);
    const byHead = new Map();
    for (const pull of pulls) {
      const list = byHead.get(pull.head.ref) ?? [];
      // L'API parle en `merged_at` ; le module de décision parle en `mergedAt`.
      // La conversion vit ici, une seule fois : deux vocabulaires dans deux
      // fichiers, c'est un `undefined` qui fait passer une PR fusionnée pour une
      // PR ouverte — le genre d'erreur qui rend le tri faux sans le dire.
      list.push({ number: pull.number, state: pull.state, mergedAt: pull.merged_at ?? null });
      byHead.set(pull.head.ref, list);
    }
    return byHead;
  } catch {
    return null;
  }
}

/** La PR qui compte pour une branche : fusionnée d'abord, puis ouverte, puis fermée. */
function pickPr(pulls, name) {
  const list = pulls?.get(name) ?? [];
  return (
    list.find((pull) => pull.merged_at) ??
    list.find((pull) => pull.state === 'open') ??
    list.find((pull) => pull.state === 'closed') ??
    null
  ) ?? null;
}

let baseSha;
try {
  baseSha = git(['rev-parse', '--verify', `${BASE}^{commit}`]).trim();
} catch {
  console.error(`❌ ${BASE} est introuvable — « ${BASE} » doit exister (git fetch ${REMOTE} main). Rien n'a été lu.`);
  process.exit(2);
}

const branches = readBranches();
if (branches.length === 0) {
  // Un tri qui ne trouve aucune branche n'a rien trié : c'est un échec, pas un succès.
  console.error(`❌ Aucune branche à trier (hors main) — rien n'a été prouvé.`);
  process.exit(2);
}

const pulls = readPulls();

const rows = branches.map((branch) => {
  const pr = pulls ? pickPr(pulls, branch.name) : null;
  const prUnknown = pulls === null;
  const tipInBase = isAncestor(branch.ref);
  const coverage = contentCoverage({ git, base: BASE, ref: branch.ref });
  const { verdict, reasons } = classifyBranch({ tipInBase, pr, prUnknown, coverage });
  return { ...branch, pr, prUnknown, coverage, verdict, reasons };
});

for (const line of formatReport(rows, { base: BASE })) console.log(line);

const toReview = rows.filter((row) => row.verdict === 'à relire');
if (toReview.length > 0) {
  console.log('');
  console.log('À relire, une par une :');
  for (const row of toReview) console.log(`  • ${row.name} — ${row.reasons.join(' ; ')}`);
}

console.log('');
console.log(`Lu sur ${baseSha.slice(0, 7)} — aucune branche modifiée, aucun push.`);
