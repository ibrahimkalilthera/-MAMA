// Suite for the deployment-freshness brick: scripts/lib/build-stamp.mjs +
// scripts/lib/deployment-freshness.mjs + scripts/wait-for-deployment.mjs.
//
// WHY THIS EXISTS
// ---------------
// Les E2E post-déploiement attendaient un `HTTP 200` de la racine avant de
// lancer leur pixel-check. Un 200 est satisfait par le déploiement PRÉCÉDENT :
// pendant la propagation de l'alias, un cache de bord sert encore l'ancien HTML,
// et le pixel-check jugeait alors un AUTRE commit que celui qu'il croyait
// tester — produisant un rouge qui accusait l'application pour une page jamais
// publiée, ou pire, un vert sur un build qu'il n'avait pas vérifié.
//
// Ces cas tiennent les deux moitiés : l'estampille que le build écrit dans son
// HTML (pure, sur des chaînes), et le verdict qui traduit ce que la page SERVIE
// déclare — avec la règle du dépôt appliquée jusqu'au bout : `unknown`
// (invérifiable) n'est jamais confondu avec `fresh`.
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

import { BUILD_STAMP_META, buildStamp, stampHtml } from '../scripts/lib/build-stamp.mjs';
import { FRESHNESS, RETRYABLE, freshnessVerdict, servedBuildSha } from '../scripts/lib/deployment-freshness.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel: string) => readFileSync(join(root, rel), 'utf8');

const SHA = '4b3837c1a2b3c4d5e6f708192a3b4c5d6e7f8091';
const HTML = '<!doctype html>\n<html lang="fr">\n  <head>\n    <title>App</title>\n  </head>\n  <body><div id="root"></div></body>\n</html>\n';

describe("l'estampille de build : le HTML dit de quel commit il vient", () => {
  it('écrit le sha dans le <head>, et rien d’autre ne change', () => {
    const stamped = stampHtml(HTML, SHA);
    assert.match(stamped, new RegExp(`<meta name="${BUILD_STAMP_META}" content="${SHA}">`));
    // Le reste du document est intact : une estampille ne doit pas réécrire une
    // page, seulement s'y nommer.
    assert.equal(stamped.replace(/\n {4}<meta name="build-sha"[^>]*>/, ''), HTML);
  });

  it('n’invente JAMAIS d’identité : sans sha (build local), rien n’est écrit', () => {
    // Un build hors CI ne peut pas mentir sur son identité — il peut seulement ne
    // rien dire, et c'est le contrôle de fraîcheur qui traduit ce silence en
    // `unknown` au lieu d'un feu vert.
    for (const bad of ['', '   ', 'local', 'dev', 'garbage-sha', 'zzzzzzz']) {
      assert.equal(stampHtml(HTML, bad), HTML, `« ${bad} » ne doit pas produire d’estampille`);
    }
  });

  it('est idempotent : deux passages ne font pas deux balises', () => {
    const once = stampHtml(HTML, SHA);
    assert.equal(stampHtml(once, SHA), once);
    // Et un second passage avec un AUTRE sha ne réécrit pas la première : une
    // seule estampille doit faire foi, sinon on ne sait plus laquelle croire.
    assert.equal(stampHtml(once, 'abcdef1234567'), once);
  });

  it('ne touche pas un document sans <head>', () => {
    assert.equal(stampHtml('<html><body>x</body></html>', SHA), '<html><body>x</body></html>');
  });

  it('le plugin lit la source la plus explicite disponible', () => {
    const plugin = buildStamp({ sha: SHA });
    assert.equal(plugin.transformIndexHtml(HTML), stampHtml(HTML, SHA));
    // Sans sha injecté, le plugin ne décore rien (c'est le cas d'un `vite dev`).
    assert.equal(buildStamp({ sha: '' }).transformIndexHtml(HTML), HTML);
  });
});

describe('ce que la page SERVIE déclare', () => {
  it('lit la balise dans les deux ordres d’attributs, et refuse le reste', () => {
    assert.equal(servedBuildSha(stampHtml(HTML, SHA)), SHA.toLowerCase());
    assert.equal(servedBuildSha(`<head><meta content="${SHA}" name="build-sha"></head>`), SHA.toLowerCase());
    assert.equal(servedBuildSha(HTML), null, 'aucune balise → aucune identité');
    assert.equal(servedBuildSha('<head><meta name="build-sha" content="pas-un-sha"></head>'), null);
  });
});

describe('la fraîcheur : le verdict qui empêche de juger le mauvais build', () => {
  const at = (input: Record<string, unknown>) => freshnessVerdict({ expectedSha: SHA, url: 'https://exemple.test/', ...input });

  it('sert le build du commit → le seul feu vert', () => {
    const v = at({ status: 200, html: stampHtml(HTML, SHA) });
    assert.equal(v.state, FRESHNESS.FRESH);
    assert.equal(v.retryable, false);
    assert.equal(v.warning, null);
  });

  it('sert ENCORE le build d’avant → stale, et l’accusation est la PUBLICATION', () => {
    // C'est le cas mesuré : un 200 satisfaisait l'ancienne attente, et le
    // pixel-check partait juger l'ancien build.
    const v = at({ status: 200, html: stampHtml(HTML, 'aaaaaaaaaaa1111') });
    assert.equal(v.state, FRESHNESS.STALE);
    assert.equal(v.retryable, true, 'la propagation se rattrape : on réessaie');
    assert.equal(v.served, 'aaaaaaaaaaa1111');
    assert.match(v.detail, /propagation en cours/);
  });

  it('une page SANS identité n’est jamais un vert — même en 200', () => {
    const v = at({ status: 200, html: HTML });
    assert.equal(v.state, FRESHNESS.UNKNOWN);
    assert.notEqual(v.state, FRESHNESS.FRESH);
    assert.match(String(v.warning), /invérifiable/);
  });

  it('sans commit attendu, la fraîcheur n’est pas jugée (et ça se dit)', () => {
    const v = freshnessVerdict({ url: 'https://exemple.test/', status: 200, html: stampHtml(HTML, SHA) });
    assert.equal(v.state, FRESHNESS.UNKNOWN);
    assert.equal(v.retryable, false, 'rien à attendre : on ne réessaie pas dans le vide');
    assert.match(String(v.warning), /aucun commit attendu/);
  });

  it('un 5xx de la plateforme et une absence de réponse sont des HOQUETS, pas des verdicts', () => {
    for (const input of [{ status: 503 }, { status: 504 }, { status: null, error: 'ENOTFOUND' }, { status: null, error: 'TimeoutError' }]) {
      const v = at(input);
      assert.ok(RETRYABLE.includes(v.state), `${JSON.stringify(input)} doit rester réessayable`);
      assert.equal(v.state === FRESHNESS.FRESH, false);
    }
    assert.match(at({ status: 504 }).detail, /ce n'est pas un verdict sur l'application/);
  });

  it('un 404 (le domaine mort mesuré) est « pas en ligne », pas « cassé »', () => {
    const v = at({ status: 404 });
    assert.equal(v.state, FRESHNESS.NOT_LIVE);
    assert.equal(v.retryable, true);
  });
});

describe('le câblage : le build s’identifie, et l’attente exige la bonne identité', () => {
  it('le build écrit son sha, et le déploiement le lui donne explicitement', () => {
    assert.match(read('vite.config.ts'), /buildStamp\(\)/, 'le plugin est branché dans le build');
    // `BUILD_SHA` posé par le workflow : la source la plus explicite, pour ne pas
    // dépendre de ce que l’environnement du bâti veut bien transmettre.
    assert.match(read('.github/workflows/deploy.yml'), /BUILD_SHA: \$\{\{ needs\.gate\.outputs\.deploy_sha \|\| github\.sha \}\}/);
  });

  it('le pixel-check attend l’identité du commit, plus seulement un HTTP 200', () => {
    const workflow = read('.github/workflows/pdf-e2e.yml');
    assert.match(workflow, /node scripts\/wait-for-deployment\.mjs/, 'il attend la fraîcheur par le script');
    assert.match(workflow, /--sha=\$\{\{ github\.event\.workflow_run\.head_sha \|\| github\.sha \}\}/, 'avec le commit attendu');
    assert.doesNotMatch(workflow, /code.*=.*200.*exit 0/, 'et plus par une boucle qui se contente d’un 200');
  });

  it('sans commit attendu, le script REFUSE avant de lire quoi que ce soit', () => {
    const script = read('scripts/wait-for-deployment.mjs');
    assert.match(script, /--sha manquant ou invalide/, 'il nomme le refus');
    assert.match(script, /process\.exit\(2\)/, 'et sort en « ne peut pas juger », pas en « échec jugé »');
  });

  it('un run qui a repris le DIT : une reprise n’est jamais silencieuse', () => {
    const script = read('scripts/verify-pdf-download.mjs');
    assert.match(script, /noteTransient/, 'les reprises sont comptées');
    assert.match(script, /reprise\(s\) de transport pendant ce run/, 'et publiées avant le verdict');
    // Et la connexion avalée est réparée : l’ancienne version imprimait
    // « connecté » même quand le formulaire restait affiché.
    assert.match(script, /la connexion n’a pas abouti/);
  });
});
