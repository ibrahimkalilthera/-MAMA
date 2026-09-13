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
 *   npm run check:release:needed   → y a-t-il QUELQUE CHOSE à publier ? (le déclencheur)
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
 *   needed l'ÉTAT du canal répond à la question du déclencheur automatique —
 *          « ce numéro est-il déjà publié ? » Sinon il y a un release à faire
 *          (créer, reprendre une publication interrompue, ou consolider) ;
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
import { appendFileSync, existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { publishEvidence } from './lib/evidence-publisher.mjs';
import {
  assetsToPublish,
  compareLatest,
  compareRelease,
  deliveryReach,
  parseHoldsFile,
  parseLatestYml,
  pickLatestPublished,
  publishDecision,
  releaseTag,
} from './lib/release-coherence.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const MODE = ['local', 'tag', 'draft', 'live', 'channel', 'needed'].find((m) => args.includes(`--${m}`)) || 'local';
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

/**
 * La tête que le POSTE lit, demandée à l'endpoint que le poste interroge.
 *
 * MESURÉ sur le canal réel, et c'est la moitié qui manquait : `electron-updater`
 * ne déduit pas la version la plus récente, il DEMANDE `/<owner>/<repo>/releases/latest`
 * avec `Accept: application/json` et lit `tag_name` de la réponse (le dépôt
 * d'à côté, `getLatestTagName` : « do not use API for GitHub to avoid limit » —
 * c'est bien cette URL-là, et elle répond du JSON). Un canal qui calcule sa
 * propre tête — la plus récente par date de publication — juge donc un flux que
 * personne ne lit, et les deux peuvent diverger en silence.
 *
 * Sans jeton : c'est l'appel exact d'un poste, et un dépôt public y répond.
 *
 * @returns {Promise<{ tag: string|null, detail: string }>}
 */
async function clientLatestTag() {
  const url = `https://github.com/${repo}/releases/latest`;
  try {
    const res = await fetch(url, {
      headers: { Accept: 'application/json', 'User-Agent': 'release-coherence' },
      redirect: 'follow',
    });
    if (!res.ok) return { tag: null, detail: `l’endpoint du poste a répondu HTTP ${res.status} sur ${url}` };
    const body = await res.json().catch(() => null);
    const tag = String(body?.tag_name ?? '').trim();
    return tag
      ? { tag, detail: `GET /releases/latest → ${tag} (Accept: application/json, sans jeton)` }
      : { tag: null, detail: `l’endpoint du poste n’a nommé aucune version (${url})` };
  } catch (error) {
    return { tag: null, detail: `l’endpoint du poste est injoignable (${String(error?.message ?? error)})` };
  }
}

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

// ── Mode needed : le déclencheur automatique a-t-il quelque chose à faire ? ───
// C'est la réponse MACHINE à la question qu'un humain se posait à la main :
// « est-ce qu'il y a un release à faire ? ». Il existe pour que la chaîne de
// publication puisse se déclencher TOUT SEUL sur un push, sans qu'aucune de ses
// étapes (téléversement, consolidation des brouillons en double, promotion) ne
// dépende d'un clic ou d'un appel d'API manuel.
//
// Il réutilise la décision du gate d'avant-publication (`publishDecision`), donc
// il ne peut pas en divergier : « déjà publié » veut dire « rien à faire ». Ce
// n'est pas une FAUTE pour autant — le parc a déjà ce numéro — donc la sortie est
// un ÉTAT (`needed=true|false`), jamais un code de sortie : un numéro déjà publié
// qui ferait rougir ce mode transformerait chaque push en rouge.
//
// Un dépôt qu'on ne peut pas interroger reste un ÉCHEC (le `fail` d'avant), parce
// qu'un état illisible qui passerait pour « rien à faire » serait un vert muet.
if (MODE === 'needed') {
  const published = sameTag.find((r) => r.draft !== true) || null;
  const drafts = sameTag.filter((r) => r.draft === true);
  const needed = publishDecision({ version, existingTag: Boolean(published) }).publish;
  if (!needed) {
    console.log(
      `➖ ${releaseTag(version)} est DÉJÀ publié (${published.published_at ?? 'date inconnue'}) — rien à publier : ` +
        'le parc a ce numéro, et un même numéro ne peut pas changer de contenu.',
    );
  } else if (drafts.length) {
    console.log(
      `✅ ${releaseTag(version)} : ${drafts.length} brouillon(s) à reprendre et à consolider en UN seul — ` +
        'publication interrompue, la suite est le rôle du publieur.',
    );
  } else {
    console.log(`✅ ${releaseTag(version)} est inédit — il y a un release à faire.`);
  }
  // La ligne lisible dans le journal ET la sortie d'étape : le workflow lit la
  // seconde, un humain lit la première sans ouvrir un fichier d'outputs.
  console.log(`needed=${needed}`);
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `needed=${needed}\n`);
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
  // La tête vient d'abord de l'ENDPOINT DU POSTE : c'est lui qui décide laquelle
  // un poste installeur lit, pas notre propre tri.
  const head = await clientLatestTag();
  const newestPublished = pickLatestPublished(releases);
  const target =
    (head.tag && releases.find((r) => r.tag_name === head.tag && r.draft !== true)) || newestPublished;
  if (!target) {
    fail('aucun release PUBLIÉ — le canal est muet', [
      `${releases.length} release(s) existent, aucun n’est promu (brouillons ou liste vide) : aucun poste ne lit quoi que ce soit`,
      head.detail,
    ]);
  }
  // Divergence entre ce que l'endpoint du poste nomme et ce que notre tri
  // désigne : elle est nommée, jamais tue — les deux ordres ne se confondent pas
  // (le dépôt du côté du client ordonne par création, pas par publication).
  const divergence =
    head.tag && newestPublished && head.tag !== newestPublished.tag_name
      ? `l’endpoint du poste nomme ${head.tag}, notre tri désigne ${newestPublished.tag_name} — c’est le premier que le poste lit`
      : null;
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

  // ── Le chemin de CHAQUE version publiée, pas seulement de la tête ────────
  // Chaque release publié est une population de postes. Une population sortie du
  // chemin ne le dit jamais : la tête reste cohérente, et rien ne rougit — sauf
  // si on demande, version par version, ce qu'elle recevrait.
  const reach = deliveryReach({
    published: releases,
    headTag: head.tag ?? targetTag,
    holds: brake.holds,
  });

  console.log(
    `🔎 canal — ${releases.length} release(s) dont ${releases.filter((r) => r.draft !== true).length} publié(s) ` +
      `(mode channel, sans jeton${token ? ' — le jeton de l’environnement est délibérément ignoré' : ''})`,
  );
  console.log(`   la tête que le poste lit : ${head.detail}`);
  console.log(`   le plus récent publié : ${targetTag} (${target.published_at || target.created_at})`);
  if (divergence) console.log(`   ⚠️  ${divergence}`);
  console.log(`   chemin de chaque version publiée — ce qu’un poste resté là recevrait :`);
  for (const client of reach.clients) {
    console.log(`   ${client.receives ? '✅' : '❌'} ${client.version} → ${client.detail}`);
  }
  for (const r of newerDrafts) {
    console.log(`   ℹ️  ${r.tag_name} est en BROUILLON plus récent — invisible pour les postes tant qu’il n’est pas promu`);
  }
  if (!verdict.ok || brake.problems.length || reach.problems.length || !head.tag) {
    fail(
      `canal cassé — la tête, le frein d’urgence, ou le chemin de versions entières est inutilisable`,
      [
        ...verdict.problems,
        ...brake.problems,
        ...reach.problems,
        ...(head.tag ? [] : [head.detail]),
      ],
      [...verdict.warnings, ...brake.warnings, ...reach.warnings, ...(divergence ? [divergence] : [])],
    );
  }
  console.log(
    `✅ canal vivant : les ${reach.clients.filter((c) => c.receives).length} version(s) publiée(s) rejoignent la tête ` +
      `${reach.head}, le frein est lisible`,
  );
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
    count: reach.clients.filter((c) => c.receives).length,
    reason:
      `canal vérifié sans jeton : la tête ${head.tag} est livrable (${facts.installer ? 'installeur rehaché depuis le dépôt public' : 'latest.yml relu'}), ` +
      `les ${reach.clients.length} version(s) publiées y sont rattachées (postes en ${reach.clients
        .filter((c) => c.version !== reach.head)
        .map((c) => c.version)
        .join(', ') || 'aucune'}), ` +
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
