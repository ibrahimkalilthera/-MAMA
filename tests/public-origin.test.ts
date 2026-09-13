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

import { createRequire } from 'node:module';

import { KIND_JUDGED_BY, embeddedLinkVerdict } from '../scripts/lib/embedded-links.mjs';
import { MAX_PROBED_MODULES, moduleUrlsIn, originVerdict } from '../scripts/lib/public-origin.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel: string) => readFileSync(join(root, rel), 'utf8');
// La définition que le POSTE lit, chargée telle quelle : le test juge l'inventaire
// réel, pas une copie qui pourrait s'accorder avec lui-même.
type EmbeddedLink = { id: string; url: string; kind: string; where: string; why: string };
const { EMBEDDED_LINKS, WHATSAPP_URL } = createRequire(import.meta.url)('../electron/embedded-links.cjs') as {
  EMBEDDED_LINKS: EmbeddedLink[];
  WHATSAPP_URL: string;
};

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
    // Le contrôle ne connaît plus d'adresse en propre : il lit l'INVENTAIRE des
    // liens embarqués, qui tient l'origine depuis cette définition-ci. Un
    // contrôle qui recopierait l'URL rendrait possible la divergence que les
    // deux écritures partagées viennent d'éliminer.
    assert.match(read('electron/embedded-links.cjs'), /require\('\.\/public-origin\.cjs'\)/, 'l’inventaire tient l’origine depuis sa définition');
    assert.match(read('scripts/check-public-origin.mjs'), /EMBEDDED_LINKS/, 'et le contrôle relit l’inventaire');
  });

  it('le déploiement relit l’origine APRÈS avoir déployé, et publie sa preuve après', () => {
    const workflow = read('.github/workflows/deploy.yml');
    const deploy = workflow.indexOf('vercel deploy --prebuilt --prod');
    const check = workflow.indexOf('npm run check:public-origin');
    const evidence = workflow.indexOf('publish-automation-evidence.mjs');
    assert.ok(deploy > 0 && check > deploy, "le contrôle vient après le déploiement, sinon il juge l'état précédent");
    assert.ok(evidence > check, 'et la preuve « j’ai agi » ne part pas avant que l’origine ait répondu');
    // Le pas est NOMMÉ par ce qu'il juge : son intitulé disait « l'origine » alors
    // qu'il relit maintenant tout l'inventaire, et un intitulé qui nomme la
    // mauvaise porte fait chercher au mauvais endroit.
    assert.match(workflow, /Les liens embarqués par le poste aboutissent-ils tous/, 'le pas est nommé');
  });

  it('le contrôle est un script du projet, donc la CI ne recopie pas la commande', () => {
    const pkg = JSON.parse(read('package.json'));
    assert.equal(pkg.scripts['check:public-origin'], 'node scripts/check-public-origin.mjs');
  });

  it('une bascule côté hébergeur ne produit aucun commit : un cron quotidien relit l’origine', () => {
    const workflow = read('.github/workflows/public-origin-watch.yml');
    // Sans cron, le contrôle ne tournerait qu'aux déploiements — donc jamais
    // dans le cas qui l'a fait naître : un domaine remappé, un projet dont le
    // déploiement de production est supprimé, un certificat expiré. Aucun de ces
    // gestes ne commit rien, donc aucun ne réveille un contrôle déclenché par un
    // push.
    assert.match(workflow, /cron: '\S+ \S+ \S+ \S+ \S+'/, 'la veille porte un cron');
    assert.match(workflow, /AUTOMATION_EVIDENCE: '1'/, 'et elle mandate la preuve de son contrôle');
    const check = workflow.indexOf('npm run check:public-origin');
    const evidence = workflow.indexOf('publish-automation-evidence.mjs');
    assert.ok(check > 0, 'elle lance le MÊME contrôle que le déploiement, par son nom de script');
    assert.ok(evidence > check, 'et la preuve « j’ai agi » ne part pas avant que l’origine ait répondu');
    // Les adresses embarquées doivent être dans le filtre de push : les changer
    // est le seul commit capable de rendre un lien injoignable en silence, et le
    // filtre doit suivre l'inventaire plutôt qu'une de ses entrées.
    assert.match(workflow, /electron\/embedded-links\.cjs/);
    assert.match(workflow, /electron\/public-origin\.cjs/);
  });

  it('la preuve du contrôle est une MESURE publiée par lui, pas une phrase du YAML', () => {
    // Le canal de preuve est parfait et la substance peut manquer : une étape
    // YAML identique qu'un script se soit trompé d'origine ou n'ait rien sondé,
    // tant que les étapes d'avant ne rougissent pas. Ce que le contrôle a LU — le
    // statut, le nombre de modules réellement téléchargés — doit venir de lui.
    const script = read('scripts/check-public-origin.mjs');
    assert.match(script, /publishEvidence\(\{/, 'le contrôle publie sa preuve');
    assert.match(script, /count: read1\.length/, 'et le compte vient des liens réellement relus, pas d’un littéral');
  });
});

describe('les autres liens embarqués : chacun jugé par SA catégorie', () => {
  const link = (over: Record<string, unknown> = {}) => ({
    id: 'releases-page',
    url: 'https://exemple.test/releases/latest',
    kind: 'release-page',
    where: 'bouton « Ouvrir la page de téléchargement »',
    why: 'un portable ne s’auto-installe pas',
    ...over,
  });

  it('une page de téléchargement morte est un refus, et le refus dit quel geste il casse', () => {
    // Cas mesuré sur un domaine supprimé : 404 pendant que tout le reste est
    // vert. Pour un poste PORTABLE, cette page est la seule porte de sortie — il
    // ne s'auto-installe pas.
    const dead = embeddedLinkVerdict({ link: link(), status: 404, finalUrl: 'https://exemple.test/404', body: 'Not Found\n' });
    assert.equal(dead.ok, false);
    assert.match(dead.problems[0], /HTTP 404/);
    assert.match(dead.problems[0], /porte de sortie/, 'et il dit pourquoi ce lien-là compte');
    assert.match(dead.problems[0], /Ouvrir la page de téléchargement/, 'et il nomme l’endroit à réparer');
  });

  it('un 200 qui n’atterrit PAS sur une page de version est aussi un refus', () => {
    // Le faux vert du canal, transposé au geste de l'utilisateur : la page
    // s'ouvre, et il n'y a rien à y prendre. Mesuré sur le vrai lien :
    // `302 → /releases/tag/v1.0.8`, donc l'atterrissage est vérifiable.
    const off = embeddedLinkVerdict({ link: link(), status: 200, finalUrl: 'https://exemple.test/' });
    assert.equal(off.ok, false);
    assert.match(off.problems[0], /atterrit sur https:\/\/exemple\.test\//);
    assert.match(off.problems[0], /n’est pas permis/);

    const good = embeddedLinkVerdict({ link: link(), status: 200, finalUrl: 'https://exemple.test/releases/tag/v1.0.8' });
    assert.equal(good.ok, true, good.problems.join('\n'));
    assert.match(good.detail, /page de version/);
  });

  it('un tiers qui répond est vert MÊME en 429 : on ne juge que ce qui nous appartient', () => {
    // C'est le cas qui décide si ce contrôle vit ou meurt : juger le code d'un
    // domaine qu'on ne sert pas produirait un rouge permanent sur un lien sain
    // (limitation de débit, filtrage d'IP de centre de données) — et un contrôle
    // toujours allumé ne se lit plus. Le refus est donc réservé à ce qui est
    // vraiment de notre côté : le lien ne répond pas du tout.
    const third = (status: number | null, error: string | null = null) =>
      embeddedLinkVerdict({ link: link({ id: 'whatsapp', kind: 'third-party' }), status, error });

    const limited = third(429);
    assert.equal(limited.ok, true, 'un 429 du tiers ne condamne pas notre installeur');
    assert.equal(limited.warnings.length, 1, 'mais il n’est pas tu : un utilisateur pourrait ne pas aboutir');
    assert.match(limited.warnings[0], /ce n’est pas notre serveur/);

    assert.equal(third(200).ok, true);
    const dead = third(null, 'ENOTFOUND');
    assert.equal(dead.ok, false, 'un domaine qui ne résout plus, lui, est bien un lien mort');
    assert.match(dead.problems[0], /ENOTFOUND/);
  });

  it('une catégorie sans règle est un REFUS, pas un saut silencieux', () => {
    // « Nommé plutôt qu'omis » : ajouter un lien à l'inventaire avec une
    // catégorie que rien ne juge doit faire échouer le contrôle, sinon ce lien
    // serait « vérifié » par personne.
    const unknown = embeddedLinkVerdict({ link: link({ id: 'nouveau', kind: 'a-decider' }), status: 200 });
    assert.equal(unknown.ok, false);
    assert.match(unknown.problems[0], /catégorie que ce contrôle ne sait pas juger/);
    for (const entry of EMBEDDED_LINKS) {
      assert.ok(
        (KIND_JUDGED_BY as Record<string, string>)[entry.kind],
        `la catégorie « ${entry.kind} » de « ${entry.id} » doit avoir une règle nommée`,
      );
    }
  });

  it('l’inventaire ne peut pas contenir un lien muet : chaque entrée dit où il sert et pourquoi il compte', () => {
    assert.ok(EMBEDDED_LINKS.length >= 3, 'les trois liens du poste sont inventoriés');
    for (const entry of EMBEDDED_LINKS) {
      assert.match(entry.url, /^https:\/\/\S+$/, `${entry.id} : une URL absolue`);
      assert.ok(entry.where.length > 10, `${entry.id} : l’endroit où le lien sert, pour réparer au bon endroit`);
      assert.ok(entry.why.length > 20, `${entry.id} : pourquoi ce lien compte, sinon sa catégorie est arbitraire`);
    }
  });

  it('les liens du poste ne sont plus écrits en clair dans le code qui les ouvre', () => {
    const main = read('electron/main.cjs');
    assert.match(main, /require\('\.\/embedded-links\.cjs'\)/, 'le poste prend le lien de l’inventaire');
    assert.doesNotMatch(main, /https:\/\/github\.com\//, 'et il n’en porte plus aucun en clair');
    // Le lien des notifications est fabriqué dans l'APPLICATION (`src/`), pas dans
    // le processus principal : il n'y a donc pas de `require` possible, et la
    // seule façon d'empêcher deux écritures de diverger est de les confronter.
    assert.ok(
      read('src/app/useParents.ts').includes(WHATSAPP_URL),
      `les deux écritures de ${WHATSAPP_URL} doivent s’accorder (inventaire ↔ application)`,
    );
  });
});
