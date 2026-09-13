#!/usr/bin/env node
/**
 * prune-release-dir.mjs — décider du sort des octets qui traînent dans `release/`.
 *
 *   npm run release:prune                 → le PLAN, et rien d'autre
 *   npm run release:prune -- --yes        → applique le plan (supprime)
 *   npm run release:prune -- --yes --stale → et les reconstructions d'un numéro déjà publié
 *   npm run release:prune -- --yes --unpublished → et les builds d'une version jamais livrée
 *   npm run release:prune -- --yes --unpacked → et la sortie de build DÉCOMPRESSÉE
 *   npm run release:prune -- --dir=release-test
 *   npm run release:prune -- --check      → OBJECTE (exit 1) si l'atelier détient
 *     des octets que le canal sert déjà ; ne supprime jamais rien
 *   npm run release:prune -- --channel=fixture.json   (le canal depuis un fichier,
 *     pas depuis l'API : c'est la couture qui permet à la suite d'exercer CE CLI
 *     sans réseau)
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
 *   • toucher à un dossier qui ne soit pas une sortie de build décompressée
 *     (la convention `-unpacked` d'electron-builder) : les autres sont des
 *     ENTRÉES de build, et elles sont nommées sans être jugées ;
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
 * `--unpublished` est le troisième acte, et le seul qui n'invoque aucune preuve —
 * parce qu'il n'en existe aucune : le canal n'a jamais eu cette version, donc ni
 * empreinte ni comparaison ne peuvent dire si la copie locale est superflue.
 * **Qui décide, alors ? Un humain, et c'est le drapeau qui le dit.** Ce que
 * l'outil peut faire, c'est contraindre la décision à ce qui est mort, par deux
 * comparaisons chiffrées : un build ne part que s'il est STRICTEMENT PLUS BAS
 * que la version en préparation (ce n'est donc pas celui qu'on s'apprête à
 * livrer) ET strictement plus bas que tout ce que le canal détient — le publier
 * ferait donc DESCENDRE la tête, ce que le contrôle du canal refuse parce que ça
 * coupe les postes installés au-dessus. Soit un build qui ne peut plus atteindre
 * personne. L'autre moitié du dossier est intouchable : un build **au moins
 * aussi haut** que ce qu'on prépare est peut-être celui qui attend sa
 * publication, et sa copie locale en est l'unique exemplaire — aucun drapeau ne
 * l'enlève, et le plan le dit.
 *
 * Par défaut il ne supprime RIEN : un plan qu'on ne relit pas est un plan qu'on
 * n'a pas décidé. `--yes` est l'acte.
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, rmSync, statSync, unlinkSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  DEFAULT_RELEASE_DIR,
  artifactVersion,
  formatBytes,
  noRemovalMessage,
  pruneCommand,
  prunePlan,
} from './lib/release-prune.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const dirArg =
  args.find((a) => a.startsWith('--dir='))?.slice('--dir='.length) || DEFAULT_RELEASE_DIR;
const releaseDir = join(root, dirArg);
const apply = args.includes('--yes');
// Les reconstructions d'un numéro déjà publié : mêmes octets jamais livrés, et
// une justification différente (le numéro est pris), donc un acte à part.
const stale = args.includes('--stale');
// Le seul acte sans preuve possible : le canal n'a jamais eu cette version. Ce
// qui reste prouvable, c'est qu'elle est morte (plus basse que ce qu'on prépare
// et que tout ce que le canal détient), et c'est la règle qui s'en charge.
const unpublished = args.includes('--unpublished');
// La sortie de build décompressée (`win-unpacked`) : un dossier, donc aucun
// numéro, donc aucune empreinte — mais 508 Mo mesurés sur 754 Mo. C'est un acte
// à part pour la même raison que les autres : sa suppression ne se prouve pas,
// elle se décide (et elle demande un `electron:dist` aux preuves locales).
const unpacked = args.includes('--unpacked');
// Le canal lu depuis un FICHIER au lieu de l'API. C'est une couture, et elle est
// assumée : sans elle, la suite ne peut exercer ce CLI qu'en lisant sa source
// (ce qu'elle faisait — et deux des trois défauts du rappel y ont survécu).
const channelFile = args.find((a) => a.startsWith('--channel='))?.slice('--channel='.length) || '';
// Le mode qui OBJECTE, et rien d'autre : il ne supprime jamais, il refuse de
// laisser passer un atelier qui détient des octets PROUVÉS redondants.
const check = args.includes('--check');

const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const currentVersion = String(pkg.version ?? '');
const repo =
  pkg.repository?.url?.replace(/^.*github\.com[:/]/, '').replace(/\.git$/, '') || 'ibrahimkalilthera/-MAMA';

if (!existsSync(releaseDir)) {
  // En mode contrôle, un dossier absent n'est pas une panne : la CI n'a pas
  // d'atelier, donc il n'y a rien à juger — et le dire est plus honnête qu'un
  // vert muet comme qu'un rouge de circonstance.
  if (check) {
    console.log(`✅ atelier non applicable — ${dirArg}/ n'existe pas ici (rien à juger).`);
    process.exit(0);
  }
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
  if (channelFile) {
    releases = JSON.parse(readFileSync(join(root, channelFile), 'utf8'));
  } else {
    const response = await fetch(`https://api.github.com/repos/${repo}/releases?per_page=100`, { headers });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    releases = await response.json();
  }
} catch (error) {
  if (check && process.env.WORKSHOP_SOFT_OFFLINE === '1') {
    // Même partage que le gate d'audit (`AUDIT_SOFT_OFFLINE`) : le hook de commit
    // ne doit pas dépendre du réseau, la CI si. Et la dégradation est DITE —
    // une non-mesure tue était un vert qu'on ne saurait pas expliquer.
    console.warn(
      `\n⚠️  atelier NON jugé — canal illisible (${error.message}) et WORKSHOP_SOFT_OFFLINE=1 :` +
        ' la redondance n’est PAS prouvée. La CI re-vérifie au push.',
    );
    process.exit(0);
  }
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
/** La taille d'un dossier, récursivement — un dossier de build n'en a pas une. */
function dirSize(dir) {
  let total = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) total += dirSize(full);
    else if (entry.isFile()) total += statSync(full).size;
  }
  return total;
}

const local = [];
const dirs = [];
for (const name of readdirSync(releaseDir)) {
  const file = join(releaseDir, name);
  if (!existsSync(file)) continue;
  const stat = statSync(file);
  if (stat.isDirectory()) {
    dirs.push({ name, size: dirSize(file) });
    continue;
  }
  if (!stat.isFile()) continue;
  const version = artifactVersion(name);
  const sha256 =
    version && version !== currentVersion ? createHash('sha256').update(readFileSync(file)).digest('hex') : null;
  local.push({ name, size: stat.size, sha256 });
}

const plan = prunePlan({ currentVersion, local, dirs, published, stale, unpublished, unpacked });
const sizeOf = (name) =>
  local.find((f) => f.name === name)?.size ?? dirs.find((d) => d.name === name)?.size ?? 0;

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
        `\n   ${pruneCommand(['stale'], { dir: dirArg })}\n` +
        '   Et si le canal sert vraiment les mauvais octets, c’est un incident de canal, pas un ménage.',
    );
  }
  process.exit(1);
}

// ── Le plan, écrit ──────────────────────────────────────────────────────────
console.log(
  `\n🔎 ${dirArg}/ — ${local.length} fichier(s)${dirs.length ? ` + ${dirs.length} dossier(s)` : ''} · version en cours ${currentVersion} · canal lu ${channelFile ? `depuis ${channelFile}` : token ? 'avec jeton' : 'SANS jeton'}`,
);

if (plan.remove.length) {
  // Le titre ne résume PAS l'autorisation : trois actes différents mènent ici
  // (empreinte prouvée, numéro déjà publié, version jamais livrée), et un titre
  // qui les confondrait mentirait sur au moins l'un des trois.
  console.log(`\n🗑  à supprimer (${plan.remove.length}) — ce qui autorise chaque départ est écrit ligne par ligne :`);
  for (const item of plan.remove) {
    // Un dossier n'a pas de numéro de version : l'afficher vide donnerait
    // « win-unpacked  (, 0 o) », c'est-à-dire la taille d'un dossier mesurée
    // comme celle d'un fichier. Les deux se lisent, aucune ne se devine.
    const version = item.version ? `${item.version}, ` : '';
    console.log(`   ${item.name}  (${version}${formatBytes(sizeOf(item.name))}) — ${item.reason}`);
  }
} else {
  console.log(`\n${noRemovalMessage(local.length)}`);
}

if (plan.keep.length) {
  console.log(`\n⛔ conservés (${plan.keep.length}) :`);
  for (const item of plan.keep) console.log(`   ${item.name} — ${item.reason}`);
}

// Les DOSSIERS sont nommés même quand aucun acte ne les touche. C'est ce qui
// manquait : mesuré le 13/09, ils pesaient 508 Mo sur 754 Mo et le plan n'en
// disait pas un mot — le plus gros volume du dossier était muet, donc « combien
// il reste, et pourquoi » n'était pas répondable.
const stillThere = plan.loose.filter((d) => !plan.remove.some((r) => r.name === d.name));
if (stillThere.length) {
  console.log(`\n📦 nommés sans être jugés (${stillThere.length}) — pour que le volume restant s’explique :`);
  for (const item of stillThere) console.log(`   ${item.name}  ${formatBytes(item.size)} — ${item.reason}`);
}

// Les candidats de `--unpublished` sont nommés même quand l'acte n'est pas
// demandé : le plan doit dire ce qu'il ne fait PAS, sinon la décision humaine
// n'existe pas — elle est seulement différée.
if (!unpublished && plan.unpublishedCandidates.length) {
  const versions = [...new Set(plan.unpublishedCandidates.map((c) => c.version))].join(', ');
  const bytes = plan.unpublishedCandidates.reduce(
    (sum, c) => sum + (local.find((f) => f.name === c.name)?.size ?? 0),
    0,
  );
  console.log(
    `\nℹ️  ${plan.unpublishedCandidates.length} artefact(s) d'une version JAMAIS publiée et plus basse que ce que le canal détient (${versions}) :`,
  );
  console.log(
    '   aucune empreinte ne peut prouver quoi que ce soit sur eux — le canal ne les a jamais eus. La décision est humaine :',
  );
  console.log(
    `   ${pruneCommand(['unpublished'], { dir: dirArg })}   (${formatBytes(bytes)} libérables, si ce sont bien d'anciens builds jamais livrés)`,
  );
}

if (plan.ignored.length) {
  console.log(`\n➖ hors sujet (${plan.ignored.length}) : ${plan.ignored.map((i) => i.name).join(', ')}`);
}

// ── Le mode qui OBJECTE ─────────────────────────────────────────────────────
// Ce qui manquait : `check:release` AVERTIT puis sort en 0, donc le jour où
// personne ne lance la commande, l'atelier redevient exactement celui du
// départ — quatorze installeurs, et quatorze occasions de reprendre le mauvais
// fichier à la main. Ici, dès qu'un fichier est PROUVÉ redondant (le canal sert
// déjà ces octets exacts), on sort en échec. On ne supprime RIEN : l'acte reste
// humain, l'objection devient automatique.
if (check) {
  const redundant = plan.remove.filter((item) => item.kind === 'digest');
  // Ce qu'aucune preuve ne condamne se lit dans les FAITS du plan, pas dans
  // `remove` : `remove` ne contient que les actes qu'on a demandés, donc un
  // `--check` seul aurait répondu « propre » devant une reconstruction — le plan
  // la gardait, mais elle n'y figurait que comme une conservation.
  const undecided = [
    ...plan.divergences.map((d) => [d.name, 'stale', 'reconstruction locale d’un numéro déjà publié']),
    ...plan.unpublishedCandidates.map((c) => [c.name, 'unpublished', 'build d’une version jamais livrée']),
    ...plan.loose.filter((d) => d.kind === 'unpacked').map((d) => [d.name, 'unpacked', 'sortie de build décompressée']),
  ];
  if (!redundant.length) {
    // Une reconstruction, un build jamais livré et une sortie de build demandent
    // une DÉCISION, pas un verdict : ils sont dit, jamais reprochés.
    if (undecided.length) {
      console.error(`\n⚠️  ${undecided.length} entrée(s) qu’aucune preuve ne condamne — décision humaine, donc PAS un échec :`);
      for (const [name, , why] of undecided) console.error(`   • ${name} — ${why}`);
      console.error(
        `\n   Les actes correspondants, si ce sont bien des restes :\n   ${pruneCommand(
          undecided.map(([, how]) => how),
          { dir: dirArg },
        )}`,
      );
    }
    console.log('\n✅ atelier propre — aucun octet prouvé redondant.');
    process.exit(0);
  }
  console.error(
    `\n❌ l'atelier détient ${redundant.length} fichier(s) que le canal sert DÉJÀ, octet pour octet —` +
      ' c’est précisément ce qui permet de reprendre le mauvais fichier à la main :\n',
  );
  for (const item of redundant) {
    console.error(`   • ${item.name} (${item.version}, ${formatBytes(sizeOf(item.name))})`);
  }
  console.error(
    `\n   L'acte qui les enlève, sans rien re-prouver :\n   ${pruneCommand(
      redundant.map((item) => item.kind),
      { dir: dirArg },
    )}`,
  );
  process.exit(1);
}

// ── L'acte, seulement s'il est demandé ──────────────────────────────────────
if (!plan.remove.length) {
  console.log('');
  reportLeftoverDivergencesAndExit();
}

if (!apply) {
  // Le rappel dit par quel acte, parce que « relance avec --yes » ne suffit pas :
  // selon la catégorie, l'acte est celui d'une empreinte, d'un numéro pris, ou
  // d'une décision humaine qui n'invoque aucune preuve.
  const how = plan.remove.every((r) => r.kind === 'digest')
    ? '   Ce n’est pas la date du fichier qui l’autorise, c’est l’empreinte que le canal déclare.'
    : plan.remove.every((r) => r.kind === 'unpublished')
      ? '   Aucune empreinte ne peut les autoriser : c’est la comparaison qui les dit morts, et la décision qui les enlève.'
      : plan.remove.every((r) => r.kind === 'unpacked')
        ? '   C’est une sortie de build décompressée : aucun poste ne la lit, et c’est le rebuild qui la refait.'
        : '   Chaque ligne dit par quoi elle est autorisée — empreinte, numéro déjà pris, ou décision humaine.';
  // La commande vient du plan, pas d'une phrase écrite d'avance : `--yes` seul
  // n'applique que les départs prouvés par une empreinte, donc la recopier sur un
  // plan de reconstructions ou de builds jamais livrés n'enlèverait rien.
  console.log(
    `\nℹ️  plan seulement — rien n'a été supprimé (${plan.remove.length} entrée(s), ${formatBytes(plan.bytesFreed)} libérables).\n` +
      `   Applique-le : ${pruneCommand(
        plan.remove.map((item) => item.kind),
        { dir: dirArg },
      )}\n` +
      how,
  );
  reportLeftoverDivergencesAndExit();
}

let freed = 0;
let removed = 0;
for (const item of plan.remove) {
  const target = join(releaseDir, item.name);
  // Un dossier ne se supprime pas comme un fichier, et c'est le seul cas où
  // `remove` n'est pas un des artefacts versionnés.
  if (statSync(target).isDirectory()) rmSync(target, { recursive: true, force: true });
  else unlinkSync(target);
  freed += sizeOf(item.name);
  removed += 1;
}

const remaining = readdirSync(releaseDir).length;
console.log(
  `\n🧹 ${removed} entrée(s) supprimée(s) — ${formatBytes(freed)} libérés · ${remaining} entrée(s) restante(s) dans ${dirArg}/`,
);
reportLeftoverDivergencesAndExit();
