#!/usr/bin/env node
/**
 * ─── `npm run release:pr -- --version 1.0.44 --summary "…"` ─────────────────
 *
 * Monte la version ET OUVRE LA PR, au lieu de pousser un commit sur `main`.
 *
 * Depuis que la protection de `main` vaut aussi pour l'administrateur
 * (`enforce_admins: true`), plus personne ne peut pousser directement — y
 * compris le propriétaire, y compris un commit `chore(release):`. Ce script est
 * donc le chemin de release : il crée `release/vX.Y.Z`, n'y met QUE les deux
 * fichiers de version, commite, pousse la branche et ouvre la PR. La fusion
 * reste le geste humain (0 approbation requise, mais la décision de publier
 * n'appartient à aucune automatisation) ; la publication de bureau, elle, part
 * seule dès que le numéro est sur `main`.
 *
 * Ce qu'il refuse, et pourquoi :
 *   • une version qui n'est pas strictement supérieure à celle de `package.json`
 *     (republier un numéro n'atteint aucun poste) ;
 *   • un tag `vX.Y.Z` déjà présent sur `origin` (le publieur refuserait plus
 *     tard, après trois minutes de build) ;
 *   • une branche `release/vX.Y.Z` déjà existante ;
 *   • une copie de travail qui n'est pas à `origin/main` — sans elle, la PR de
 *     release embarquerait des commits qui ne sont pas sur `main` ;
 *   • des modifications non indexées sur `package.json` / `package-lock.json`
 *     (elles seraient committées dans la release sans l'avoir dit).
 *
 * Le jeton : `GH_TOKEN` / `GITHUB_TOKEN` s'il est posé (c'est ce que fait la
 * CI), sinon celui que git emploie déjà pour pousser (`git credential fill`) —
 * le même compte, donc les mêmes droits. Il n'est jamais imprimé.
 *
 * Options : `--version X.Y.Z` (défaut : correctif suivant), `--summary "…"`,
 * `--dry-run` (tout est décidé, rien n'est écrit), `--help`.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  REQUIRED_CHECK,
  bumpPackageJsonVersion,
  bumpPackageLockVersions,
  releasePlan,
} from './lib/release-pr.mjs';

const USAGE = `npm run release:pr -- [--version X.Y.Z] [--summary "…"] [--dry-run]

  --version   le numéro à publier (défaut : correctif suivant de package.json)
  --summary   la phrase qui explique le numéro — elle finit dans le titre du commit
  --dry-run   décide tout, n'écrit rien, ne pousse rien

Le jeton vient de GH_TOKEN / GITHUB_TOKEN, sinon du credential helper de git.`;

function arg(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? String(process.argv[index + 1] ?? '') : '';
}

if (process.argv.includes('--help') || process.argv.includes('-h')) {
  console.log(USAGE);
  process.exit(0);
}

const dryRun = process.argv.includes('--dry-run');
const requested = arg('--version');
const summary = arg('--summary');

/** Une précondition non tenue : rien n'a été fait. */
function stop(reason, hints = []) {
  console.error(`❌ ${reason}`);
  for (const hint of hints) console.error(`   • ${hint}`);
  process.exit(2);
}

function git(args, { input, allowFail = false } = {}) {
  try {
    return execFileSync('git', args, {
      encoding: 'utf8',
      input,
      stdio: [input === undefined ? 'ignore' : 'pipe', 'pipe', 'pipe'],
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
    }).trim();
  } catch (error) {
    if (allowFail) return null;
    const stderr = String(error?.stderr ?? '').trim();
    stop(`git ${args.join(' ')} a échoué${stderr ? ` — ${stderr.split('\n').slice(-3).join(' | ')}` : ''}`);
  }
}

const root = git(['rev-parse', '--show-toplevel']);
const remote = git(['remote', 'get-url', 'origin'], { allowFail: true }) ?? '';
const slugMatch = /github\.com[:/]([^/]+)\/([^/.]+?)(?:\.git)?$/.exec(remote);
if (!slugMatch) stop(`le remote « origin » n’est pas un dépôt GitHub lisible (« ${remote || 'absent'} »)`);
const [, owner, repo] = slugMatch;
const slug = `${owner}/${repo}`;

const branchNow = git(['rev-parse', '--abbrev-ref', 'HEAD']);
if (branchNow !== 'main') {
  stop(`vous êtes sur « ${branchNow} », pas sur main`, [
    'une release part de main : `git switch main` puis relancez',
  ]);
}

git(['fetch', 'origin', 'main', '--quiet'], { allowFail: true });
const ahead = Number(git(['rev-list', '--count', 'origin/main..HEAD'], { allowFail: true }) ?? '0');
const behind = Number(git(['rev-list', '--count', 'HEAD..origin/main'], { allowFail: true }) ?? '0');
if (ahead > 0) {
  stop(`votre main local porte ${ahead} commit(s) absent(s) d’origin/main`, [
    'main n’accepte plus de push direct : ces commits ne peuvent plus partir tels quels',
    'poussez-les sur une branche (`git switch -c …`), ouvrez leur PR, puis revenez sur un main à jour',
  ]);
}
if (behind > 0) {
  stop(`votre main local est en retard de ${behind} commit(s) sur origin/main`, [
    'la PR de release partirait d’un état périmé : `git pull --ff-only` puis relancez',
  ]);
}

const dirty = git(['status', '--porcelain', '--', 'package.json', 'package-lock.json']);
if (dirty) {
  stop('package.json ou package-lock.json porte des modifications non committées', [
    'elles seraient embarquées dans la release : committez-les, ou `git stash` avant de relancer',
  ]);
}

const pkgPath = join(root, 'package.json');
const lockPath = join(root, 'package-lock.json');
const pkgText = readFileSync(pkgPath, 'utf8');
const lockText = readFileSync(lockPath, 'utf8');
const current = JSON.parse(pkgText)?.version;

const plan = releasePlan({ current, requested, summary });
if (!plan.ok) {
  stop('la release demandée ne tient pas', plan.problems);
}
const { version, branch, commitMessage } = plan;

const tag = `v${version}`;
if (git(['ls-remote', '--tags', 'origin', `refs/tags/${tag}`], { allowFail: true })) {
  stop(`le tag ${tag} existe déjà sur origin — ce numéro est publié`, [
    'un numéro ne change pas de contenu : publier le même n’atteint aucun poste',
    'choisissez le numéro suivant : `--version <X.Y.Z>`',
  ]);
}
if (git(['rev-parse', '--verify', '--quiet', `refs/heads/${branch}`], { allowFail: true })) {
  stop(`la branche ${branch} existe déjà en local`, [
    `reprenez-la (git switch ${branch}) ou supprimez-la (git branch -D ${branch})`,
  ]);
}
if (git(['ls-remote', '--heads', 'origin', `refs/heads/${branch}`], { allowFail: true })) {
  stop(`la branche ${branch} existe déjà sur origin`, [
    'une release interrompue se reprend dans sa PR, pas en en ouvrant une seconde',
  ]);
}

// Les fichiers sont calculés AVANT la création de la branche : une forme de
// fichier inconnue échoue ici, quand rien n'a encore bougé.
const bumpedPkg = bumpPackageJsonVersion(pkgText, version);
if (!bumpedPkg) stop('la ligne de version de package.json est introuvable — rien n’a été écrit');
const bumpedLock = bumpPackageLockVersions(lockText, version);
if (!bumpedLock) stop('les lignes de version de package-lock.json sont introuvables — rien n’a été écrit');

// La vérification est faite sur ce qu'on va écrire, pas sur ce qu'on croit
// avoir remplacé : c'est le fichier relu qui décide.
if (JSON.parse(bumpedPkg.text)?.version !== version) {
  stop('package.json réécrit ne porte pas la version demandée — rien n’a été écrit');
}
const lockJson = JSON.parse(bumpedLock.text);
if (lockJson?.version !== version || lockJson?.packages?.['']?.version !== version) {
  stop('package-lock.json réécrit ne porte pas la version demandée — rien n’a été écrit');
}

console.log(`→ release ${current} → ${version}  (branche ${branch})`);
console.log(`→ commit : ${commitMessage}`);

if (dryRun) {
  console.log('⏸  --dry-run : rien n’a été écrit, ni commité, ni poussé.');
  process.exit(0);
}

// Le jeton n'est jamais affiché, et il ne part que vers api.github.com.
function tokenFromGit() {
  const host = 'github.com';
  const out = execFileSync('git', ['credential', 'fill'], {
    input: `protocol=https\nhost=${host}\n\n`,
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'ignore'],
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
  });
  return /^password=(.*)$/m.exec(String(out ?? ''))?.[1]?.trim() ?? '';
}

const token =
  String(process.env.GH_TOKEN ?? '').trim() ||
  String(process.env.GITHUB_TOKEN ?? '').trim() ||
  tokenFromGit();

if (!token) {
  stop('aucun jeton pour ouvrir la PR', [
    'pose GH_TOKEN (jeton qui peut créer une PR) et relancez',
    'la branche sera poussée par le prochain essai : rien n’a encore été créé',
  ]);
}

async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch(`https://api.github.com${path}`, {
    method,
    headers: {
      accept: 'application/vnd.github+json',
      authorization: `Bearer ${token}`,
      'x-github-api-version': '2022-11-28',
      'user-agent': 'mama-thera-release-pr',
      ...(body ? { 'content-type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(20_000),
  });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    /* une réponse non JSON est jugée sur son statut */
  }
  return { ok: res.ok, status: res.status, json, text };
}

git(['switch', '-c', branch]);
writeFileSync(pkgPath, bumpedPkg.text);
writeFileSync(lockPath, bumpedLock.text);

const changed = git(['diff', '--name-only']).split('\n').filter(Boolean);
const unexpected = changed.filter((file) => file !== 'package.json' && file !== 'package-lock.json');
if (unexpected.length > 0) {
  stop(`le bump a touché autre chose que les deux fichiers de version : ${unexpected.join(', ')}`, [
    `la branche ${branch} est créée et les fichiers modifiés — inspectez, puis corrigez à la main`,
  ]);
}

git(['add', '--', 'package.json', 'package-lock.json']);
try {
  git(['commit', '-m', commitMessage]);
} catch {
  /* git() sort de lui-même en nommant l'échec */
}

git(['push', '-u', 'origin', 'HEAD', '--quiet']);

let pr = await api(`/repos/${slug}/pulls`, {
  method: 'POST',
  body: { title: plan.prTitle, head: branch, base: 'main', body: plan.prBody },
});

if (!pr.ok && pr.status === 422) {
  // « A pull request already exists » : la branche avait déjà sa PR (reprise).
  const existing = await api(`/repos/${slug}/pulls?state=open&head=${encodeURIComponent(`${owner}:${branch}`)}`);
  const found = Array.isArray(existing.json) ? existing.json[0] : null;
  if (found) {
    pr = { ok: true, status: 200, json: found };
  }
}

if (!pr.ok) {
  console.error(`❌ la branche ${branch} est poussée, mais la PR n’a pas pu être ouverte (HTTP ${pr.status}).`);
  console.error(`   ${String(pr.json?.message ?? pr.text ?? '').slice(0, 300)}`);
  console.error(`   Ouvrez-la à la main : ${remote.replace(/\.git$/, '')}/compare/main...${branch}?expand=1`);
  process.exit(1);
}

const number = pr.json?.number;
const url = pr.json?.html_url ?? '';
console.log(`✅ PR #${number} ouverte — ${url}`);
console.log(`   Le check requis est « ${REQUIRED_CHECK} ».`);
console.log('   Après la fusion, `Desktop release (Windows)` publie seule : `check:release:needed`');
console.log('   verra un numéro inédit, puis build → signature → brouillon → promotion → relecture.');
