#!/usr/bin/env node
/**
 * TOUTES LES URL QUE L'APPLICATION EMBARQUE répondent-elles à ce qu'on exige
 * d'ELLES ?
 *
 *   npm run check:public-origin                     (l'inventaire du poste)
 *   npm run check:public-origin -- --url=https://…  (une autre origine de repli : un aperçu, une origine qu'on répare)
 *
 * Le nom du script est resté celui du câblage (package.json, le job de
 * déploiement, la veille quotidienne) — mais ce qu'il couvre est l'inventaire
 * `electron/embedded-links.cjs`, parce que le défaut mesuré n'était pas de
 * relire l'origine, c'était de ne relire QU'ELLE : les deux autres liens partent
 * dans chaque installeur sans que personne ne les relise, et le plus fragile
 * des trois est le seul dont un poste PORTABLE dépend pour reprendre une
 * version, puisqu'il ne s'auto-installe pas.
 *
 * Chaque lien est jugé par SA catégorie (`scripts/lib/embedded-links.mjs`), et
 * la catégorie décide, jamais ce CLI : une application qu'on sert, une page de
 * téléchargement qu'on ne sert pas et le domaine d'un tiers n'ont pas les mêmes
 * refus possibles. Le seul cas où ce fichier choisit, c'est de remplacer
 * l'origine de repli quand `--url=` le demande — la catégorie `app` a besoin des
 * modules du document, donc elle est jugée par `scripts/lib/public-origin.mjs`.
 *
 * Il tourne là où l'application est LIVRÉE (le job de déploiement, après
 * `vercel deploy --prod`) et une fois par jour (`public-origin-watch.yml`) :
 * jamais dans la chaîne locale, parce qu'un commit ne doit pas dépendre du
 * réseau pour être vérifié.
 */
import { createRequire } from 'node:module';
import { embeddedLinkVerdict, KIND_JUDGED_BY } from './lib/embedded-links.mjs';
import { publishEvidence } from './lib/evidence-publisher.mjs';
import { originVerdict } from './lib/public-origin.mjs';

const require = createRequire(import.meta.url);
// L'inventaire est la SEULE définition des liens embarqués : elle tient l'origine
// depuis `electron/public-origin.cjs` (que `electron/main.cjs` lit aussi), donc
// il n'y a toujours qu'une écriture par URL.
const { EMBEDDED_LINKS } = require('../electron/embedded-links.cjs');

const flag = (name) => {
  const hit = process.argv.slice(2).find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : null;
};

const override = flag('url');
const TIMEOUT_MS = 20000;

/** Une lecture qui n'aboutit pas devient un MOT, jamais un silence. */
async function read(target) {
  try {
    const res = await fetch(target, {
      redirect: 'follow',
      headers: { 'User-Agent': 'embedded-links-check' },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const body = await res.text();
    return { status: res.status, body, finalUrl: res.url, contentType: res.headers.get('content-type') };
  } catch (error) {
    return { error: String(error?.cause?.code ?? error?.name ?? error?.message ?? error) };
  }
}

const problems = [];
const warnings = [];
const read1 = [];

console.log('🔎 liens embarqués par l’application — relus un par un, chacun jugé par sa catégorie');

for (const link of EMBEDDED_LINKS) {
  const judgedBy = KIND_JUDGED_BY[link.kind];
  // Une catégorie sans règle nommée serait un saut silencieux : le dire ici, au
  // niveau du dispatch, garantit qu'ajouter un lien à l'inventaire ne peut pas
  // aboutir à un lien « vérifié » par personne.
  if (!judgedBy) {
    problems.push(`« ${link.id} » porte la catégorie « ${link.kind} », qui n'a pas de règle — un lien qu'on ne sait pas juger n'est pas un lien vérifié`);
    continue;
  }

  const url = link.kind === 'app' && override ? override : link.url;
  if (link.kind !== 'app') {
    const got = await read(url);
    const verdict = embeddedLinkVerdict({ link, status: got.status ?? null, finalUrl: got.finalUrl, error: got.error, body: got.body });
    problems.push(...verdict.problems);
    warnings.push(...verdict.warnings);
    read1.push({ id: link.id, url, detail: verdict.detail });
    console.log(`   ${verdict.ok ? '✅' : '❌'} ${link.id} · ${link.kind} — ${verdict.detail}`);
    if (!verdict.ok) console.log(`      utilisé par : ${link.where}`);
    continue;
  }

  // Catégorie `app` : les trois refus qui se réparent séparément — l'origine
  // répond, elle sert l'APPLICATION (la coquille, pas une page d'erreur en 200),
  // et ses MODULES se téléchargent (une coquille dont le bundle est en 404 est un
  // écran blanc, le même défaut un cran plus loin).
  const page = await read(url);
  if (page.error) {
    const verdict = originVerdict({ url, error: page.error });
    problems.push(`« ${link.id} » — ${verdict.problems[0]}`);
    read1.push({ id: link.id, url, detail: `injoignable (${page.error})` });
    console.log(`   ❌ ${link.id} · app — injoignable (${page.error})`);
    console.log(`      utilisé par : ${link.where}`);
    continue;
  }

  // Les modules à sonder sont ceux que le DOCUMENT charge : le verdict les nomme,
  // et on ne télécharge qu'eux (une page de 975 octets en référence un).
  const dryRun = originVerdict({ url, status: page.status, body: page.body });
  const probes = [];
  for (const module of dryRun.modules.slice(0, 5)) {
    const got = await read(module);
    probes.push({
      url: module,
      status: got.status ?? 0,
      contentType: got.contentType ?? (got.error ? `injoignable (${got.error})` : null),
    });
  }
  const verdict = originVerdict({ url, status: page.status, body: page.body, probes });
  for (const p of verdict.problems) problems.push(`« ${link.id} » — ${p}`);
  for (const w of verdict.warnings) warnings.push(`« ${link.id} » — ${w}`);
  read1.push({ id: link.id, url, detail: `HTTP ${page.status} · ${String(page.body).length} octet(s) · ${probes.length} module(s)` });
  console.log(
    `   ${verdict.ok ? '✅' : '❌'} ${link.id} · app — HTTP ${page.status} · ${String(page.body).length} octet(s) · ${verdict.modules.length} module(s) référencé(s)`,
  );
  for (const probe of probes) {
    console.log(`      ${probe.status === 200 ? '✅' : '❌'} ${probe.url.replace(url, '')} · HTTP ${probe.status}${probe.contentType ? ` · ${probe.contentType}` : ''}`);
  }
  if (!verdict.ok) console.log(`      utilisé par : ${link.where}`);
  // Un lien jugé mais servi par une AUTRE adresse que celle du poste (le cas de
  // `--url=`) le dit : sans ça, un rapport vert ferait croire que l'adresse
  // embarquée a été relue, alors que c'est une autre qui a répondu.
  if (url !== link.url) warnings.push(`« ${link.id} » a été relu à ${url} au lieu de l’adresse embarquée (${link.url}) — ce rapport ne dit rien de celle que le poste utilise`);
}

for (const w of warnings) console.log(`   ⚠️  ${w}`);

if (problems.length) {
  console.error('');
  console.error(`❌ ${problems.length} problème(s) : un lien embarqué qui n’aboutit pas est un lien que l’utilisateur découvrira à notre place`);
  for (const p of problems) console.error(`   • ${p}`);
  process.exit(1);
}

// La substance, publiée par le contrôle lui-même : ce n'est pas le YAML qui
// affirme « j'ai agi », c'est cette lecture-ci qui dit ce qu'elle a MESURÉ — les
// liens réellement relus, leur statut et leur atterrissage. Sans mandat (une
// exécution à la main, la chaîne locale), le producteur se tait : il ne parle
// qu'au nom du job qui le mandate.
publishEvidence({
  acted: true,
  count: read1.length,
  reason:
    `liens embarqués relus un par un (${read1.length}/${EMBEDDED_LINKS.length}) : ` +
    read1.map((r) => `${r.id} → ${r.detail}`).join(' · '),
});

console.log('✅ chaque lien embarqué aboutit à ce qu’on exige de lui — un poste qui suit l’un d’eux a quelque chose au bout');
