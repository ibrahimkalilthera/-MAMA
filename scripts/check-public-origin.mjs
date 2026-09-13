#!/usr/bin/env node
/**
 * L'ORIGINE PUBLIQUE QUE LE POSTE EMBARQUE répond-elle VRAIMENT ?
 *
 *   npm run check:public-origin                     (l'origine du dépôt)
 *   npm run check:public-origin -- --url=https://…  (une autre origine, un aperçu)
 *
 * Ce qu'il refuse : un domaine qui ne répond pas, une origine qui répond 200
 * avec autre chose que l'application, et une coquille dont les modules ne se
 * téléchargent pas — les trois façons dont un déploiement VERT peut ne livrer
 * personne. Mesuré le 13/09 : `mama-thera.vercel.app` rendait
 * `HTTP 404 DEPLOYMENT_NOT_FOUND` pendant que le job de déploiement était vert.
 *
 * Il tourne là où l'application est LIVRÉE (le job de déploiement, après
 * `vercel deploy --prod`), pas dans la chaîne locale : un commit ne doit pas
 * dépendre du réseau pour être vérifié. La lecture, elle, est la seule partie
 * non pure — le verdict vit dans `scripts/lib/public-origin.mjs`, où chaque
 * branche de refus est assertée sans site en ligne.
 */
import { createRequire } from 'node:module';
import { publishEvidence } from './lib/evidence-publisher.mjs';
import { originVerdict } from './lib/public-origin.mjs';

const require = createRequire(import.meta.url);
// L'origine par DÉFAUT est celle que le poste embarque : une seule définition,
// partagée avec `electron/main.cjs` (et non recopiée ici).
const { PUBLIC_ORIGIN } = require('../electron/public-origin.cjs');

const flag = (name) => {
  const hit = process.argv.slice(2).find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : null;
};

const url = (flag('url') ?? PUBLIC_ORIGIN).replace(/\/+$/, '') + '/';
const TIMEOUT_MS = 20000;

/** Une lecture qui n'aboutit pas devient un MOT, jamais un silence. */
async function read(target) {
  try {
    const res = await fetch(target, {
      redirect: 'follow',
      headers: { 'User-Agent': 'public-origin-check' },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const body = await res.text();
    return { status: res.status, body, contentType: res.headers.get('content-type') };
  } catch (error) {
    return { error: String(error?.cause?.code ?? error?.name ?? error?.message ?? error) };
  }
}

const page = await read(url);
if (page.error) {
  const verdict = originVerdict({ url, error: page.error });
  console.error(`❌ ${verdict.problems[0]}`);
  process.exit(1);
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

console.log(`🔎 origine publique — ${url}`);
console.log(`   réponse HTTP ${page.status} · ${String(page.body).length} octet(s) · ${verdict.modules.length} module(s) référencé(s)`);
for (const probe of probes) {
  console.log(`   ${probe.status === 200 ? '✅' : '❌'} ${probe.url.replace(url, '')} · HTTP ${probe.status}${probe.contentType ? ` · ${probe.contentType}` : ''}`);
}
if (!verdict.ok) {
  console.error('');
  console.error(`❌ ${verdict.problems.length} problème(s) : l'origine que le poste embarque n'est pas un service rendu à l'utilisateur`);
  for (const p of verdict.problems) console.error(`   • ${p}`);
  for (const w of verdict.warnings) console.error(`   ⚠️  ${w}`);
  process.exit(1);
}
// La substance, publiée par le contrôle lui-même : ce n'est pas le YAML qui
// affirme « j'ai agi », c'est cette lecture-ci qui dit ce qu'elle a MESURÉ —
// l'origine relue, le statut, et le nombre de modules réellement téléchargés.
// Sans mandat (une exécution à la main, ou la chaîne locale), le producteur se
// taît : il ne parle qu'au nom du job qui le mandate.
publishEvidence({
  acted: true,
  count: probes.length,
  reason:
    `origine publique relue à l'adresse qu'un poste embarque : HTTP ${page.status}, ` +
    `coquille servie (${String(page.body).length} octet(s)), ${probes.length} module(s) réellement téléchargé(s) ` +
    `(${probes.map((p) => `${p.url.replace(url, '')}=HTTP ${p.status}`).join(', ')})`,
});

console.log("✅ l'origine répond, sert l'application, et ses modules se téléchargent — un poste qui bascule dessus a quelque chose à charger");
for (const w of verdict.warnings) console.log(`   ⚠️  ${w}`);
