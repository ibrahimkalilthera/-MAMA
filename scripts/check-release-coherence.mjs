#!/usr/bin/env node
/**
 * check-release-coherence.mjs — le contrôle qui refuse de laisser partir un flux
 * incohérent.
 *
 *   npm run check:release          → le dossier `release/` contre package.json
 *   npm run check:release:tag      → le tag existe-t-il DÉJÀ ? (le refus d'avant-publication)
 *   npm run check:release:draft    → les octets téléversés tiennent-ils la promesse ?
 *   npm run check:release:live     → ce que les postes lisent est-il cohérent ?
 *   npm run check:release:channel  → le CANAL tel qu'un poste le voit (sans jeton)
 *
 * ─── Pourquoi ce contrôle existe ────────────────────────────────────────────
 * Un poste se met à jour sur une PROMESSE D'OCTETS : `latest.yml` annonce une
 * taille et un sha512, et `electron-updater` refuse tout ce qui n'y répond pas.
 * Trois incohérences ont déjà été payées ici, chacune d'une façon différente :
 *
 *   • un release inexistant — un flux vide, donc tout le monde à jour de rien ;
 *   • **deux** brouillons pour le même tag, chacun portant la moitié des
 *     artefacts (une passe par cible) — invisibles pour l'updater, et aucun
 *     outil ne les rassemble ;
 *   • un installeur reconstruit sous un numéro déjà publié — une republication
 *     n'atteint AUCUN poste, parce qu'un même numéro ne se voit pas changer.
 *
 * ─── Un mode par piège, et chacun dit ce qu'il prouve ───────────────────────
 *   local  le paquet, le flux et les OCTETS du dossier disent la même chose —
 *          l'empreinte est recalculée, pas relue ;
 *   tag    le numéro est inédit : c'est le refus qui tombe AVANT la publication,
 *          quand il ne coûte encore rien ;
 *   draft  un seul release, encore brouillon, contenant TOUT ce qui est annoncé,
 *          et les octets déjà téléversés se recalculent sur la même empreinte —
 *          c'est ce contrôle qui autorise la promotion vers « publié » ;
 *   live   ce que les postes lisent n'est pas un brouillon, et l'installeur
 *          réellement servi répond à la promesse de `latest.yml`.
 *
 * ─── Le mode `channel` : ce qu'un poste voit VRAIMENT, et sans jeton ─────────
 * Les quatre modes ci-dessus parlent de LA version du `package.json` — donc d'un
 * build local. Aucun ne répond à la question qu'un administrateur se pose le
 * reste du temps : **le canal de mise à jour est-il encore vivant ?** Un canal
 * cassé (release supprimé, latest.yml illisible, installeur disparu, frein
 * corrompu) est silencieux par nature : le dépôt reste vert, et personne ne
 * l'apprend avant qu'un poste ne réclame. D'où ce mode, qui ne suppose RIEN du
 * dossier local : il prend le release publié le plus récent (un brouillon est
 * invisible pour l'updater, donc « le plus récent » n'est pas « le plus récent
 * tag »), il rehache depuis le dépôt PUBLIC ce que ce release annonce, et il lit
 * le **frein d'urgence** (`updates/holds.json`) à l'URL exacte qu'un poste
 * interroge. Tout se fait **sans jeton** : c'est ce qui le rend exécutable par
 * un cron sur un dépôt public, et sur un dépôt privé c'est `raw` qui refuse —
 * un canal qu'on ne peut pas relire de l'extérieur n'est pas prouvé.
 *
 *   node scripts/check-release-coherence.mjs --channel [--branch=<ref>]
 *
 * `--branch` change la branche où le frein est lu (défaut `main`, celle que le
 * poste interroge). Il sert à vérifier une branche de travail, et à pouvoir
 * PROUVER le rouge : une branche qui n'existe pas rend le frein injoignable.
 *
 * Aucun mode ne « regarde » seulement : chacun rend un verdict nommé, et un
 * dépôt qu'on n'a pas pu interroger est un ÉCHEC, jamais un feu vert.
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { publishEvidence } from './lib/evidence-publisher.mjs';
import {
  assetsToPublish,
  compareLatest,
  compareRelease,
  parseHoldsFile,
  parseLatestYml,
  pickLatestPublished,
  publishDecision,
  releaseTag,
} from './lib/release-coherence.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const MODE = ['local', 'tag', 'draft', 'live', 'channel'].find((m) => args.includes(`--${m}`)) || 'local';
const dirArg = args.find((a) => a.startsWith('--dir='))?.slice('--dir='.length) || 'release';
const releaseDir = join(root, dirArg);
// La branche que le poste interroge pour le frein (`HOLD_BRANCH_DEFAULT` dans
// electron/updater-policy.cjs). Surchargeable pour deux raisons : vérifier une
// branche de travail avant de la fusionner, et pouvoir PROUVER le rouge (une
// branche qui n'existe pas rend le frein injoignable).
const branch = args.find((a) => a.startsWith('--branch='))?.slice('--branch='.length) || 'main';
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const version = pkg.version;
const repo = pkg.repository?.url?.replace(/^.*github\.com[:/]/, '').replace(/\.git$/, '') || 'ibrahimkalilthera/-MAMA';
const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN || '';
// Le mode `channel` est la seule preuve qu'un CRON peut porter sur un dépôt
// public : il refuse donc le jeton, même quand il y en a un dans
// l'environnement. Un canal qu'on ne sait relire qu'authentifié n'est pas
// prouvé pour un poste qui, lui, ne s'authentifie jamais.
const useToken = MODE !== 'channel';

const sha512Of = (bytes) => createHash('sha512').update(bytes).digest('base64');

const fail = (title, problems, warnings = []) => {
  console.error(`\n❌ ${title}`);
  for (const p of problems) console.error(`   • ${p}`);
  for (const w of warnings) console.error(`   ⚠️  ${w}`);
  process.exit(1);
};

/** Le dossier `release/`, ses octets, et le verdict local. */
function localFacts() {
  const latestFile = join(releaseDir, 'latest.yml');
  if (!existsSync(latestFile)) return null;
  const latestText = readFileSync(latestFile, 'utf8');
  const dirNames = existsSync(releaseDir) ? readdirSync(releaseDir) : [];
  const assets = new Map();
  for (const name of dirNames) {
    const file = join(releaseDir, name);
    // `release/` contient aussi des DOSSIERS (win-unpacked) : seuls les fichiers
    // sont des artefacts, et hacher un dossier n'a aucun sens.
    if (!existsSync(file) || !statSync(file).isFile()) continue;
    const bytes = readFileSync(file);
    assets.set(name, { size: bytes.length, sha512: sha512Of(bytes) });
  }
  return { latestText, dirNames, assets, verdict: compareLatest({ latestText, packageVersion: version, assets, dirNames }) };
}

// ── Mode local ────────────────────────────────────────────────────────────────
const local = localFacts();
if (MODE === 'local') {
  if (!local) {
    console.error(
      `❌ ${dirArg}/latest.yml introuvable — rien à vérifier, donc rien à publier.\n` +
        '   Lance `npm run electron:dist` (ou electron:release) d’abord.',
    );
    process.exit(1);
  }
  if (!local.verdict.ok) {
    fail(`flux local incohérent (${dirArg}/latest.yml ↔ installeur ↔ package.json)`, local.verdict.problems, local.verdict.warnings);
  }
  const latest = local.verdict.latest;
  const promised = local.assets.get(latest.path);
  console.log('✅ flux local cohérent — les trois sources disent la même chose');
  console.log(`   version ${version} (paquet) = ${latest.version} (latest.yml)`);
  console.log(`   ${latest.path} · ${promised.size} octet(s) · sha512 ${promised.sha512.slice(0, 24)}… (recalculé sur les octets)`);
  console.log(`   blockmap présent · ${latest.files.length} fichier(s) annoncé(s)`);
  for (const w of local.verdict.warnings) console.log(`   ⚠️  ${w}`);
  console.log(`   à publier : ${assetsToPublish({ latest, dirNames: local.dirNames }).join(', ')}`);
  process.exit(0);
}

// ── Modes distants ────────────────────────────────────────────────────────────
// Ce qu'on ATTEND du release : les noms locaux quand on vient de construire,
// et à défaut ce que le flux publié annonce lui-même (mode `live` depuis un
// arbre propre, sans artefacts).
const expectedFromLocal = local?.verdict.ok
  ? assetsToPublish({ latest: local.verdict.latest, dirNames: local.dirNames })
  : [];

const auth = useToken && token ? { Authorization: `Bearer ${token}` } : {};

const api = (path) =>
  fetch(`https://api.github.com/repos/${repo}${path}`, {
    headers: {
      Accept: 'application/vnd.github+json',
      'User-Agent': 'release-coherence',
      ...auth,
    },
  });

/** Lit un asset : le texte pour un petit fichier, l'empreinte des octets sinon. */
async function readAsset(asset, { asText }) {
  const res = await fetch(asset.url, {
    headers: {
      Accept: 'application/octet-stream',
      'User-Agent': 'release-coherence',
      ...auth,
    },
    redirect: 'follow',
  });
  if (!res.ok) return { status: res.status };
  if (asText) {
    const buf = Buffer.from(await res.arrayBuffer());
    return { status: res.status, text: buf.toString('utf8') };
  }
  // L'installeur est gros : il est haché EN FLUX. C'est la seule façon de
  // prouver que les octets servis sont ceux promis, et c'est exactement ce que
  // cette preuve doit faire — la relire depuis le disque ne prouverait rien du
  // dépôt.
  const hash = createHash('sha512');
  let size = 0;
  for await (const chunk of res.body) {
    hash.update(chunk);
    size += chunk.length;
  }
  return { status: res.status, sha512: hash.digest('base64'), size };
}

const listRes = await api('/releases?per_page=100');
if (!listRes.ok) {
  fail(`GitHub injoignable (HTTP ${listRes.status}) — un dépôt qu'on ne peut pas interroger n'est pas un feu vert`);
}
const releases = await listRes.json();
const sameTag = releases.filter((r) => r.tag_name === releaseTag(version));
const release = sameTag[0] || null;

if (MODE === 'tag') {
  const published = sameTag.find((r) => r.draft !== true) || null;
  const decision = publishDecision({ version, existingTag: Boolean(published) });
  if (!decision.publish) {
    fail(`publication refusée pour ${releaseTag(version)}`, [decision.reason]);
  }
  console.log(`✅ ${releaseTag(version)} est inédit — la publication peut commencer`);
  if (sameTag.length) console.log(`   ℹ️  ${sameTag.length} brouillon(s) existant(s) seront réutilisés (relance d'une tentative interrompue)`);
  process.exit(0);
}

/**
 * Les faits d'UN release distant : ses artefacts, son `latest.yml` (le petit
 * fichier, lu en texte) et l'empreinte de l'installeur qu'il annonce (rehachée
 * EN FLUX sur les octets servis).
 */
async function factsFor(rel) {
  const assets = (rel?.assets || []).map((a) => ({ name: a.name, size: a.size }));
  const latestAsset = (rel?.assets || []).find((a) => a.name === 'latest.yml');
  const remoteLatest = latestAsset ? await readAsset(latestAsset, { asText: true }) : null;
  const announced = remoteLatest?.text ? parseLatestYml(remoteLatest.text) : null;
  let installer = null;
  if (announced?.path) {
    const asset = (rel?.assets || []).find((a) => a.name === announced.path);
    if (asset) {
      const got = await readAsset(asset, { asText: false });
      if (got.sha512) installer = { name: announced.path, size: got.size, sha512: got.sha512 };
    }
  }
  return { assets, latestText: remoteLatest?.text ?? null, announced, installer };
}

/** Ce qu'un release doit contenir, d'après son PROPRE `latest.yml`. */
const expectedFor = (announced) =>
  ['latest.yml', ...(announced?.path ? [announced.path, `${announced.path}.blockmap`] : [])];

// ── Mode channel : le canal vivant, vu de l'extérieur et SANS jeton ───────────
if (MODE === 'channel') {
  const target = pickLatestPublished(releases);
  if (!target) {
    fail('aucun release PUBLIÉ — le canal est muet', [
      `${releases.length} release(s) existent, aucun n’est promu (brouillons ou liste vide) : aucun poste ne lit quoi que ce soit`,
    ]);
  }
  const targetTag = target.tag_name;
  const targetVersion = String(targetTag).replace(/^v/, '');
  const targetSameTag = releases.filter((r) => r.tag_name === targetTag);
  const facts = await factsFor(target);
  const expected = expectedFor(facts.announced);
  const verdict = compareRelease({
    mode: 'live',
    version: targetVersion,
    expected,
    remote: {
      count: targetSameTag.length,
      isDraft: target.draft === true,
      tag: targetTag,
      assets: facts.assets,
      latestText: facts.latestText,
      announced: facts.announced,
      installer: facts.installer,
    },
  });

  // Le frein d'urgence, à l'URL exacte qu'un poste interroge à chaque
  // vérification (`holdsUrlFrom`, branche `main`, dans electron/updater-policy.cjs).
  const brakeUrl = `https://raw.githubusercontent.com/${repo}/${branch}/updates/holds.json`;
  const brakeRes = await fetch(brakeUrl, {
    headers: { 'User-Agent': 'release-coherence' },
    redirect: 'follow',
  });
  const brake = brakeRes.ok
    ? parseHoldsFile(await brakeRes.text())
    : {
        ok: false,
        holds: [],
        entries: [],
        warnings: [],
        problems: [
          `frein injoignable (HTTP ${brakeRes.status}) sur ${brakeUrl} — un poste ne pourrait retenir AUCUNE version`,
        ],
      };

  // Un brouillon plus récent n'est PAS une panne : c'est une publication en
  // cours. Il est nommé, sinon « le plus récent » se lirait de travers.
  const publishedWhen = Date.parse(String(target.published_at || target.created_at || ''));
  const newerDrafts = releases.filter(
    (r) => r.draft === true && Date.parse(String(r.created_at || '')) > publishedWhen,
  );

  console.log(
    `🔎 canal — ${releases.length} release(s) dont ${releases.filter((r) => r.draft !== true).length} publié(s) ` +
      `(mode channel, sans jeton${token ? ' — le jeton de l’environnement est délibérément ignoré' : ''})`,
  );
  console.log(`   le plus récent publié : ${targetTag} (${target.published_at || target.created_at})`);
  for (const r of newerDrafts) {
    console.log(`   ℹ️  ${r.tag_name} est en BROUILLON plus récent — invisible pour les postes tant qu’il n’est pas promu`);
  }
  if (!verdict.ok || brake.problems.length) {
    fail(
      `canal cassé — ${targetTag} ou le frein d’urgence est inutilisable`,
      [...verdict.problems, ...brake.problems],
      [...verdict.warnings, ...brake.warnings],
    );
  }
  console.log('✅ canal vivant : le release publié le plus récent est livrable, et le frein est lisible');
  if (facts.installer) {
    console.log(
      `   ${facts.installer.name} · ${facts.installer.size} octet(s) · sha512 ${facts.installer.sha512.slice(0, 24)}… (rehaché depuis le dépôt public)`,
    );
  }
  console.log(
    `   frein ${brakeUrl} · ${brake.entries.length} retenue(s)` +
      (brake.holds.length ? ` : ${brake.holds.join(', ')}` : ' (aucune version retenue)'),
  );
  for (const w of brake.warnings) console.log(`   ⚠️  ${w}`);
  publishEvidence({
    acted: true,
    count: expected.length,
    reason:
      `canal vérifié sans jeton : ${targetTag} publié et livrable (${facts.installer ? 'installeur rehaché depuis le dépôt public' : 'latest.yml relu'}), ` +
      `frein lisible (${brake.entries.length} retenue(s)${brake.holds.length ? ` : ${brake.holds.join(', ')}` : ''})`,
  });
  process.exit(0);
}

const facts = await factsFor(release);
const { assets, announced, installer } = facts;
const expected = expectedFromLocal.length ? expectedFromLocal : expectedFor(announced);

const verdict = compareRelease({
  mode: MODE,
  version,
  expected,
  localLatestText: local?.latestText ?? null,
  remote: {
    count: sameTag.length,
    isDraft: release ? release.draft === true : undefined,
    tag: release?.tag_name,
    assets,
    latestText: facts.latestText,
    announced,
    installer,
  },
});

console.log(`🔎 ${releaseTag(version)} — ${sameTag.length} release(s), brouillon=${release ? release.draft === true : '—'} (mode ${MODE})`);
if (!verdict.ok) {
  fail(
    MODE === 'draft'
      ? 'brouillon incohérent — la promotion vers « publié » DOIT être refusée'
      : 'flux publié incohérent — des postes liraient une promesse que les octets ne tiennent pas',
    verdict.problems,
    verdict.warnings,
  );
}
console.log(MODE === 'draft'
  ? '✅ brouillon cohérent : les octets téléversés répondent à latest.yml — la promotion est autorisée'
  : '✅ flux publié cohérent : ce que les postes lisent répond exactement à la promesse');
if (installer) console.log(`   ${installer.name} · ${installer.size} octet(s) · sha512 ${installer.sha512.slice(0, 24)}… (rehaché depuis le dépôt)`);
