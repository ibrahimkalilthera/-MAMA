#!/usr/bin/env node
/**
 * prune-release-dir.mjs — décider du sort des octets qui traînent dans `release/`.
 *
 *   npm run release:prune                 → le PLAN, et rien d'autre
 *   npm run release:prune -- --yes        → applique le plan (supprime)
 *   npm run release:prune -- --yes --stale → et les reconstructions d'un numéro déjà publié
 *   npm run release:prune -- --dir=release-test
 *
 * ─── Pourquoi ───────────────────────────────────────────────────────────────
 * `release/` est un atelier, pas un entrepôt. Chaque build y ajoute un
 * installeur, un portable et un blockmap ; rien ne les enlève, et le nom du
 * fichier est le seul signal qui indique de quelle version il s'agit. Mesuré le
 * 13/09 : sept versions, 2,2 Go, vingt et un fichiers au même niveau — dont
 * quatorze installeurs, c'est-à-dire quatorze occasions de reprendre le mauvais à
 * la main. Le contrôle local les NOMME (avertissement de `check:release`), ce qui
 * n'empêche rien.
 *
 * ─── La règle ───────────────────────────────────────────────────────────────
 * Supprimer est une PREUVE, pas un ménage : un fichier ne part que si le canal
 * déclare un actif du même nom, de la même taille et de la même empreinte —
 * le digest que GitHub calcule sur les octets qu'il sert. Le plan se fait en
 * métadonnées seules (aucun octet d'installeur n'est téléchargé) : on hache les
 * fichiers locaux, ce qui coûte un disque, pas un réseau.
 *
 * Ce que ce script ne fait JAMAIS :
 *   • toucher à la version en cours de construction (la sortie du build) ;
 *   • supprimer une version absente du canal (sa copie peut être l'unique) ;
 *   • supprimer sur une empreinte absente, ou sur un actif non déclaré ;
 *   • autoriser un BROUILLON à quoi que ce soit : il est invisible pour un poste.
 *
 * Et une empreinte qui DIFFÈRE ne produit pas une suppression mais un ROUGE : des
 * octets locaux sous un numéro publié qui ne sont pas ceux du canal sont le
 * piège « un même numéro ne se voit pas changer ». Le fichier reste, et le
 * script sort en échec pour le dire — parce que cette divergence est AUSSI
 * l'alarme d'un canal qui servirait les mauvais octets, et que l'effacer serait
 * effacer l'alarme.
 *
 * `--stale` est le geste séparé qui règle le cas mesuré le 13/09 : la 1.0.3 et
 * la 1.0.5 ont un build local postérieur à leur publication (19:53 contre 18:56,
 * 23:06 contre 22:31), donc la même version en deux exemplaires aux octets
 * différents, impossibles à distinguer à l'œil. Leurs octets ne peuvent plus
 * être livrés — un numéro publié ne se voit pas changer — mais leur
 * conservation ne s'autorise pas par empreinte : elle s'autorise par le fait
 * que le numéro est pris. D'où deux actes distincts.
 *
 * Par défaut il ne supprime RIEN : un plan qu'on ne relit pas est un plan qu'on
 * n'a pas décidé. `--yes` est l'acte.
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, statSync, unlinkSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { artifactVersion, formatBytes, prunePlan } from './lib/release-prune.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const dirArg = args.find((a) => a.startsWith('--dir='))?.slice('--dir='.length) || 'release';
const releaseDir = join(root, dirArg);
const apply = args.includes('--yes');
// Les reconstructions d'un numéro déjà publié : mêmes octets jamais livrés, et
// une justification différente (le numéro est pris), donc un acte à part.
const stale = args.includes('--stale');

const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const currentVersion = String(pkg.version ?? '');
const repo =
  pkg.repository?.url?.replace(/^.*github\.com[:/]/, '').replace(/\.git$/, '') || 'ibrahimkalilthera/-MAMA';

if (!existsSync(releaseDir)) {
  console.error(`❌ ${dirArg}/ n'existe pas — rien à décider.`);
  process.exit(2);
}

// ── Le canal : les releases, leurs noms, tailles et empreintes ───────────────
// L'API expose un `digest` (sha256) par actif : c'est l'empreinte des octets que
// GitHub sert réellement, donc elle permet de prouver sans rien télécharger.
const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN || '';
const headers = {
  Accept: 'application/vnd.github+json',
  'User-Agent': 'release-prune',
  ...(token ? { Authorization: `Bearer ${token}` } : {}),
};

let releases;
try {
  const response = await fetch(`https://api.github.com/repos/${repo}/releases?per_page=100`, { headers });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  releases = await response.json();
} catch (error) {
  // Un plan qu'on n'a pas pu fonder n'est pas un plan vide : c'est un échec.
  console.error(`❌ canal illisible (${error.message}) — on ne supprime rien sur un doute.`);
  process.exit(2);
}

const published = releases.map((release) => ({
  version: String(release.tag_name ?? '').replace(/^v/, ''),
  tag: String(release.tag_name ?? ''),
  draft: release.draft === true,
  assets: (release.assets ?? []).map((asset) => ({
    name: String(asset.name ?? ''),
    size: Number(asset.size ?? 0),
    digest: asset.digest ?? null,
  })),
}));

// ── Les faits locaux ────────────────────────────────────────────────────────
// On ne hache PAS la version en cours : elle ne peut pas partir, donc son
// empreinte ne décide rien. Tout le reste est haché sur les octets du disque —
// une taille relue ne prouve pas une empreinte.
const local = [];
for (const name of readdirSync(releaseDir)) {
  const file = join(releaseDir, name);
  if (!existsSync(file) || !statSync(file).isFile()) continue;
  const size = statSync(file).size;
  const version = artifactVersion(name);
  const sha256 =
    version && version !== currentVersion ? createHash('sha256').update(readFileSync(file)).digest('hex') : null;
  local.push({ name, size, sha256 });
}

const plan = prunePlan({ currentVersion, local, published, stale });

/**
 * Le rouge de ce script, calculé sur ce qui RESTE sur le disque.
 *
 * Une divergence enlevée par `--stale` n'est plus une divergence, et un rouge
 * qui s'affiche après avoir agi apprendrait à ignorer les rouges. Ce qui reste,
 * en revanche, est soit une reconstruction locale à nommer, soit — et c'est
 * l'autre lecture — un canal qui sert les mauvais octets. Le script ne décide
 * pas laquelle : il refuse de confondre les deux.
 */
function reportLeftoverDivergencesAndExit() {
  const left = plan.divergences.filter((d) => existsSync(join(releaseDir, d.name)));
  if (left.length === 0) process.exit(0);
  console.error(
    `\n❌ ${left.length} artefact(s) locaux portent un numéro PUBLIÉ avec d'AUTRES octets — un même numéro ne se voit pas changer :\n`,
  );
  for (const item of left) console.error(`   • ${item.reason}`);
  if (!stale) {
    console.error(
      '\n   S’il s’agit de reconstructions locales (le canal sert déjà ce numéro), elles ne partiront jamais sur un poste :' +
        '\n   npm run release:prune -- --yes --stale\n' +
        '   Et si le canal sert vraiment les mauvais octets, c’est un incident de canal, pas un ménage.',
    );
  }
  process.exit(1);
}

// ── Le plan, écrit ──────────────────────────────────────────────────────────
console.log(
  `\n🔎 ${dirArg}/ — ${local.length} fichier(s) · version en cours ${currentVersion} · canal lu ${token ? 'avec jeton' : 'SANS jeton'}`,
);

if (plan.remove.length) {
  console.log(`\n🗑  à supprimer (${plan.remove.length}) — le canal détient déjà ces octets :`);
  for (const item of plan.remove) {
    const size = local.find((f) => f.name === item.name)?.size ?? 0;
    console.log(`   ${item.name}  (${item.version}, ${formatBytes(size)}) — ${item.reason}`);
  }
} else {
  console.log('\n✅ rien à supprimer — le dossier ne contient que ce que le canal ne détient pas encore.');
}

if (plan.keep.length) {
  console.log(`\n⛔ conservés (${plan.keep.length}) :`);
  for (const item of plan.keep) console.log(`   ${item.name} — ${item.reason}`);
}

if (plan.ignored.length) {
  console.log(`\n➖ hors sujet (${plan.ignored.length}) : ${plan.ignored.map((i) => i.name).join(', ')}`);
}

// ── L'acte, seulement s'il est demandé ──────────────────────────────────────
if (!plan.remove.length) {
  console.log('');
  reportLeftoverDivergencesAndExit();
}

if (!apply) {
  console.log(
    `\nℹ️  plan seulement — rien n'a été supprimé (${plan.remove.length} fichier(s), ${formatBytes(plan.bytesFreed)} libérables).\n` +
      '   Applique-le : npm run release:prune -- --yes\n' +
      '   Ce n’est pas la date du fichier qui l’autorise, c’est l’empreinte que le canal déclare.',
  );
  reportLeftoverDivergencesAndExit();
}

let freed = 0;
let removed = 0;
for (const item of plan.remove) {
  unlinkSync(join(releaseDir, item.name));
  freed += local.find((f) => f.name === item.name)?.size ?? 0;
  removed += 1;
}

const remaining = readdirSync(releaseDir).length;
console.log(
  `\n🧹 ${removed} fichier(s) supprimé(s) — ${formatBytes(freed)} libérés · ${remaining} entrée(s) restante(s) dans ${dirArg}/`,
);
reportLeftoverDivergencesAndExit();
