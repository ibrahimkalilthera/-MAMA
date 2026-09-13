// Suite for the public-origin check (scripts/lib/public-origin.mjs +
// scripts/check-public-origin.mjs).
//
// WHY THIS EXISTS
// ---------------
// Un déploiement Vercel qui rend 0 est vert même quand l'origine ne sert plus
// rien : mesuré le 13/09, `mama-thera.vercel.app` répondait
// `HTTP 404 DEPLOYMENT_NOT_FOUND` pendant que le job de déploiement était vert.
// L'application de bureau, elle, EMBARQUE une origine (`electron/main.cjs`
// bascule dessus quand son interface locale ne démarre pas) : un poste dont le
// chargement local échoue n'a plus aucun repli, et personne ne l'apprend avant
// qu'un utilisateur ne le dise.
//
// Les cas tiennent les trois exigences séparément, parce qu'elles se réparent
// différemment : l'origine RÉPOND (DNS/TLS/statut), elle sert l'APPLICATION
// (pas une page d'erreur servie en 200 — un faux vert de plus), et ses MODULES
// se téléchargent (une coquille dont le bundle 404 est une application qui ne
// démarre pas, c'est-à-dire le même défaut déplacé d'un cran).
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

import { MAX_PROBED_MODULES, moduleUrlsIn, originVerdict } from '../scripts/lib/public-origin.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel: string) => readFileSync(join(root, rel), 'utf8');

const ORIGIN = 'https://exemple.test/';
const ENTRY = `${ORIGIN}assets/index-abc123.js`;

/** La coquille telle que Vite la sert : ce que le contrôle doit reconnaître. */
const shell = (extra = '') =>
  `<!doctype html>\n<html lang="en">\n<head>\n<script type="module" crossorigin src="/assets/index-abc123.js"></script>${extra}\n</head>\n<body>\n<div id="root"></div>\n</body>\n</html>\n`;

const page = (over: Record<string, unknown> = {}) => ({
  url: ORIGIN,
  status: 200,
  body: shell(),
  probes: [{ url: ENTRY, status: 200, contentType: 'application/javascript; charset=utf-8' }],
  ...over,
});

describe("l'origine que le poste embarque répond-elle VRAIMENT", () => {
  it('200, coquille servie, module téléchargé ⇒ vert, et il nomme le module jugé', () => {
    const v = originVerdict(page());
    assert.deepEqual(v.problems, []);
    assert.equal(v.ok, true);
    assert.deepEqual(v.modules, [ENTRY]);
  });

  it('un domaine mort est un refus, avec LA raison servie par la plateforme', () => {
    // Le cas mesuré : la plateforme accepte le déploiement, puis l'origine rend
    // une page d'erreur. Le mot « DEPLOYMENT_NOT_FOUND » doit apparaître dans le
    // verdict, sinon on ne sait pas si le domaine est mort ou le contrôle cassé.
    const v = originVerdict(page({ status: 404, body: 'The deployment could not be found on Vercel.\n\nDEPLOYMENT_NOT_FOUND\n' }));
    assert.equal(v.ok, false);
    assert.match(v.problems[0], /HTTP 404/);
    assert.match(v.problems[0], /deployment could not be found/i, 'la raison servie est reprise');
    assert.match(v.problems[0], /faux vert/, 'et il dit ce qu\'un vert signifiait vraiment');
  });

  it('un domaine qui ne résout pas le dit — DNS, TLS ou délai, jamais un silence', () => {
    const v = originVerdict(page({ error: 'ENOTFOUND' }));
    assert.equal(v.ok, false);
    assert.match(v.problems[0], /ne répond pas du tout \(ENOTFOUND\)/);
    assert.match(v.problems[0], /repli/, "et il dit ce qu'un poste y perdrait");
  });

  it('un 200 qui ne sert PAS l’application est un refus — le bon code ne suffit pas', () => {
    // Une page parquée, une page d'erreur de plateforme servie en 200 : c'est la
    // variante la plus trompeuse, parce qu'elle a le statut d'un succès.
    const v = originVerdict(page({ body: '<!doctype html><html><body><h1>Ce domaine est en vente</h1></body></html>' }));
    assert.equal(v.ok, false);
    assert.match(v.problems.join('\n'), /autre chose que l'application/);
    assert.match(v.problems.join('\n'), /#root/);
  });

  it('une coquille sans module référencé est un refus : rien ne peut démarrer', () => {
    const bare = shell().replace(/\s*<script[^>]*><\/script>/, '');
    const v = originVerdict(page({ body: bare }));
    assert.equal(v.ok, false);
    assert.match(v.problems.join('\n'), /ne référence AUCUN module/);
  });

  it('un module qui répond 404 est un refus — la coquille se charge, l’app non', () => {
    const v = originVerdict(page({ probes: [{ url: ENTRY, status: 404, contentType: 'text/plain' }] }));
    assert.equal(v.ok, false);
    assert.match(v.problems.join('\n'), /répond HTTP 404/);
    assert.match(v.problems.join('\n'), /écran blanc/);
  });

  it('un module servi en HTML est une page d’erreur déguisée en fichier', () => {
    const v = originVerdict(page({ probes: [{ url: ENTRY, status: 200, contentType: 'text/html; charset=utf-8' }] }));
    assert.equal(v.ok, false);
    assert.match(v.problems.join('\n'), /servi comme « text\/html/);
  });

  it('un module NON sondé est un avertissement, pas une conformité tacite', () => {
    const v = originVerdict(page({ probes: [] }));
    assert.equal(v.ok, true, 'le reste est vert');
    assert.match(v.warnings.join('\n'), /non sondé/);
  });

  it('au-delà du plafond, il le DIT au lieu de payer la lecture', () => {
    const many = Array.from({ length: MAX_PROBED_MODULES + 2 }, (_, i) => `/assets/chunk-${i}.js`);
    const html = shell().replace(
      '</head>',
      many.map((u) => `<script type="module" src="${u}"></script>`).join('') + '</head>',
    );
    const v = originVerdict(page({ body: html, probes: [] }));
    assert.match(v.warnings.join('\n'), /sondés — les autres ne sont pas jugés/);
  });

  it('seuls les modules du DOCUMENT sont retenus : une CSS n’est pas un module', () => {
    const html = shell().replace('</head>', '<link rel="stylesheet" href="/assets/index-abc.css"></head>');
    assert.deepEqual(moduleUrlsIn(html, ORIGIN).filter((u) => u.endsWith('.css')), []);
    assert.deepEqual(moduleUrlsIn(html, ORIGIN), [ENTRY]);
  });
});

describe('le câblage : une définition, et une relecture là où le poste est livré', () => {
  it("l'origine du poste n'est écrite qu'UNE fois, et les deux la lisent", () => {
    const main = read('electron/main.cjs');
    assert.match(main, /require\('\.\/public-origin\.cjs'\)/, "le poste lit la définition partagée");
    assert.doesNotMatch(main, /https:\/\/[a-z0-9-]+\.vercel\.app/, 'et il ne porte plus la sienne en clair');
    const shared = read('electron/public-origin.cjs');
    const literal = shared.match(/PUBLIC_ORIGIN = '([^']+)'/)?.[1] ?? '';
    assert.match(literal, /^https:\/\/[^']+\/$/, 'la définition est une origine, avec sa barre finale');
    assert.match(read('scripts/check-public-origin.mjs'), /PUBLIC_ORIGIN/, 'et le contrôle lit la même');
  });

  it('le déploiement relit l’origine APRÈS avoir déployé, et publie sa preuve après', () => {
    const workflow = read('.github/workflows/deploy.yml');
    const deploy = workflow.indexOf('vercel deploy --prebuilt --prod');
    const check = workflow.indexOf('npm run check:public-origin');
    const evidence = workflow.indexOf('publish-automation-evidence.mjs');
    assert.ok(deploy > 0 && check > deploy, "le contrôle vient après le déploiement, sinon il juge l'état précédent");
    assert.ok(evidence > check, 'et la preuve « j’ai agi » ne part pas avant que l’origine ait répondu');
    assert.match(workflow, /L’origine publique que le poste embarque répond vraiment/, 'le pas est nommé');
  });

  it('le contrôle est un script du projet, donc la CI ne recopie pas la commande', () => {
    const pkg = JSON.parse(read('package.json'));
    assert.equal(pkg.scripts['check:public-origin'], 'node scripts/check-public-origin.mjs');
  });
});
