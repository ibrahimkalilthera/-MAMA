/**
 * Le service worker qui rend le SITE ouvrable à froid sans réseau — et qui
 * n'efface jamais une version en ligne au profit d'une copie périmée.
 *
 * Ce qui est verrouillé ici, et pourquoi chaque point compte :
 *
 *   • la liste mise en réserve est COMPLÈTE (elle est faite depuis le build, pas
 *     écrite à la main) — c'est ce qui met jsPDF, le cachet et les gabarits PDF en
 *     réserve, donc ce qui rend un reçu imprimable hors ligne ;
 *   • une navigation est « réseau d'abord » : en ligne, la coquille vient
 *     TOUJOURS du serveur, et les modules portent leur empreinte dans leur nom —
 *     une version périmée ne peut pas être servie à la place de la nouvelle ;
 *   • la base (autre origine) n'est jamais lue ni mise en réserve : une copie de
 *     réponses de base serait une copie de données d'école, et un piège à données
 *     périmées ;
 *   • l'activation garde la réserve COURANTE et la PRÉCÉDENTE : un onglet resté
 *     ouvert demande ses derniers modules à la demande (bulletin, reçu) à
 *     l'ancien build, et les jeter les lui refuserait au pire moment ;
 *   • `prunePlan` est embarquée dans le worker par `toString()` : ce qui tourne
 *     dans le navigateur est la fonction testée ici, pas une seconde écriture ;
 *   • l'enregistrement est refusé sur `file:` (le poste installé charge son
 *     interface du disque) et hors production (où `sw.js` n'existe pas).
 */
import { describe, it, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  CACHE_PREFIX,
  SHELL_URL,
  SW_FILE_NAME,
  buildVersion,
  cacheName,
  collectPrecacheEntries,
  prunePlan,
  renderServiceWorker,
  serviceWorkerPlugin,
} from '../scripts/lib/service-worker.mjs';
import {
  SERVICE_WORKER_UPDATE_INTERVAL_MS,
  SERVICE_WORKER_URL,
  createUpdateRequester,
  shouldRegisterServiceWorker,
} from '../src/lib/serviceWorker';

const APPLICATION_MODULE = readFileSync(join('src', 'lib', 'serviceWorker.ts'), 'utf8');

describe('le fichier mis en réserve', () => {
  it('normalise les chemins du build et les sert depuis la racine', () => {
    assert.deepEqual(
      collectPrecacheEntries(['index.html', './assets/App-abc123.js', 'fonts\\geist\\Geist.woff2']),
      ['/assets/App-abc123.js', '/fonts/geist/Geist.woff2', '/index.html'],
    );
  });

  it('ne se met JAMAIS lui-même en réserve (un worker périmé ne doit pas se servir)', () => {
    assert.deepEqual(
      collectPrecacheEntries([SW_FILE_NAME, 'index.html']),
      ['/index.html'],
    );
  });

  it('écarte les doublons et les entrées vides', () => {
    assert.deepEqual(collectPrecacheEntries(['index.html', '/index.html', '', 'index.html']), ['/index.html']);
  });
});

describe('l’identité du build en réserve', () => {
  it('prend le sha du commit quand il est connu', () => {
    assert.equal(buildVersion({ sha: ' 4B3837C ', entries: ['/index.html'] }), '4b3837c');
  });

  it('sinon, se fonde sur le CONTENU : deux builds différents ne partagent pas une réserve', () => {
    const first = buildVersion({ sha: '', entries: ['/index.html', '/assets/a-1.js'] });
    const second = buildVersion({ sha: '', entries: ['/index.html', '/assets/a-2.js'] });
    const same = buildVersion({ sha: '', entries: ['/index.html', '/assets/a-1.js'] });
    assert.match(first, /^h[0-9a-f]{8}$/);
    assert.notEqual(first, second, 'un changement de contenu doit changer d’identité');
    assert.equal(first, same, 'et il doit être stable à contenu égal');
  });

  it("accepte un sha de build local et refuse un texte qui n'en est pas un", () => {
    assert.equal(buildVersion({ sha: 'main', entries: ['/index.html'] }).startsWith('h'), true);
  });
});

describe('ce que l’activation garde et ce qu’elle jette', () => {
  const names = [
    `${CACHE_PREFIX}h1-1000`, // le plus ancien
    `${CACHE_PREFIX}h2-2000`, // le précédent : un onglet peut encore le demander
    `${CACHE_PREFIX}h3-3000`, // la réserve courante
    'autre-application-42',   // pas à nous
  ];

  it('garde la réserve courante ET la précédente, jette les plus anciennes', () => {
    const plan = prunePlan(names, `${CACHE_PREFIX}h3-3000`);
    assert.deepEqual(plan.keep, [`${CACHE_PREFIX}h3-3000`, `${CACHE_PREFIX}h2-2000`]);
    assert.deepEqual(plan.drop, [`${CACHE_PREFIX}h1-1000`]);
  });

  it('ne touche JAMAIS la réserve d’une autre application', () => {
    const plan = prunePlan(names, `${CACHE_PREFIX}h3-3000`);
    assert.equal(plan.drop.includes('autre-application-42'), false);
    assert.equal(plan.keep.includes('autre-application-42'), false);
  });

  it('première installation : rien à jeter', () => {
    const plan = prunePlan([`${CACHE_PREFIX}h3-3000`], `${CACHE_PREFIX}h3-3000`);
    assert.deepEqual(plan.keep, [`${CACHE_PREFIX}h3-3000`]);
    assert.deepEqual(plan.drop, []);
  });
});

describe('le worker généré', () => {
  const entries = ['/assets/App-abc.js', '/assets/jspdf.es.min-x.js', '/index.html', '/tampon.png'];
  const source = renderServiceWorker({ version: 'abc1234', entries, stamp: 3000 });

  it('met en réserve TOUT le build, y compris de quoi imprimer (jsPDF, cachet, gabarits)', () => {
    for (const entry of entries) {
      assert.ok(source.includes(JSON.stringify(entry)), `${entry} doit être en réserve`);
    }
    assert.ok(source.includes('jspdf'), 'le module d’impression doit être en réserve');
    assert.ok(source.includes('/tampon.png'), 'le cachet doit être en réserve');
  });

  it('embarque la fonction de purge TESTÉE, pas une seconde écriture', () => {
    // L'assertion paraît tautologique ; elle ne l'est pas : elle refuse qu'une
    // copie de `prunePlan` soit écrite dans le worker. Si quelqu'un la réécrit
    // sur place, les cas ci-dessus ne couvrent plus le code qui tourne vraiment.
    assert.ok(source.includes(prunePlan.toString()), 'la purge du worker doit être la fonction testée');
  });

  it('une navigation est réseau d’abord, la réserve n’étant que le recours hors ligne', () => {
    assert.ok(/request\.mode === 'navigate'[\s\S]{0,120}networkFirstShell\(request\)/.test(source));
    assert.ok(/async function networkFirstShell[\s\S]{0,400}fetch\(request\)/.test(source), 'le réseau est tenté en premier');
    assert.ok(source.includes('matchAnywhere(new Request(SHELL_URL))'), 'et la coquille locale prend le relais');
    assert.ok(source.includes(`const SHELL_URL = ${JSON.stringify(SHELL_URL)}`));
  });

  it('ne touche JAMAIS à une autre origine (la base Supabase en particulier)', () => {
    assert.ok(source.includes('url.origin === self.location.origin'), 'garde d’origine');
    assert.ok(
      /if \(!isOwnOrigin\(url\)\) return;/.test(source),
      'une requête d’une autre origine est laissée au réseau, sans être lue ni écrite',
    );
  });

  it('ne sert JAMAIS une écriture depuis une réserve', () => {
    assert.ok(/request\.method !== 'GET'[\s\S]{0,40}return;/.test(source));
  });

  it('cherche dans toutes les réserves : un onglet peut demander l’ancien build', () => {
    assert.ok(source.includes('caches.match(request)'), 'la recherche couvre les réserves conservées');
  });

  it('prend la main sans recharger une page en cours de saisie', () => {
    assert.ok(source.includes('self.skipWaiting()'), 'la nouvelle réserve est prête tout de suite');
    // Assertion sur l'APPEL, pas sur le mot : le commentaire du worker explique
    // justement pourquoi il ne le fait pas.
    assert.equal(
      /(?:self\.)?clients\.claim\s*\(/.test(source),
      false,
      'aucun vol de contrôle : une saisie en cours n’est pas interrompue',
    );
  });

  it('un fichier manquant ne fait pas échouer l’installation entière', () => {
    assert.ok(source.includes('cache.put(url, response)'), 'mise en réserve fichier par fichier');
    assert.equal(
      /addAll\(/.test(source),
      false,
      '`addAll` échoue en bloc sur un seul fichier : c’est le piège écarté',
    );
  });

  it('le nom de la réserve porte la version ET l’horodatage qui la rend ordonnable', () => {
    assert.ok(source.includes(JSON.stringify(cacheName('abc1234', 3000))));
    assert.ok(cacheName('abc1234', 3000).startsWith(CACHE_PREFIX));
  });
});

describe('le plugin de build', () => {
  const dir = mkdtempSync(join(tmpdir(), 'mama-sw-'));
  after(() => rmSync(dir, { recursive: true, force: true }));

  function stageBuild(files: Record<string, string>) {
    for (const [name, content] of Object.entries(files)) {
      const full = join(dir, name);
      mkdirSync(join(full, '..'), { recursive: true });
      writeFileSync(full, content);
    }
  }

  beforeEach(() => {
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir, { recursive: true });
  });

  it('écrit sw.js à la fin du bundle, avec les fichiers réellement produits', async () => {
    stageBuild({
      'index.html': '<html></html>',
      'assets/App-abc.js': 'console.log(1)',
      'assets/index-def.css': 'body{}',
      'tampon.png': 'png',
    });
    const logs: string[] = [];
    const plugin = serviceWorkerPlugin({ sha: 'abc1234', now: () => 3000, log: (m: string) => logs.push(m) });
    plugin.configResolved({ base: '/', build: { outDir: dir } });
    await plugin.closeBundle();

    const written = readFileSync(join(dir, SW_FILE_NAME), 'utf8');
    for (const url of ['/index.html', '/assets/App-abc.js', '/assets/index-def.css', '/tampon.png']) {
      assert.ok(written.includes(JSON.stringify(url)), `${url} doit être en réserve`);
    }
    assert.ok(written.includes('"abc1234"'), 'la version du build est celle du sha fourni');
    assert.equal(logs.length, 1, 'le build annonce ce qu’il a mis en réserve');
    assert.match(logs[0], /4 fichier\(s\)/);
  });

  it('n’écrit RIEN pour un build en chemins relatifs (l’interface chargée du disque)', async () => {
    stageBuild({ 'index.html': '<html></html>' });
    const warnings: string[] = [];
    const plugin = serviceWorkerPlugin({ warn: (m: string) => warnings.push(m) });
    plugin.configResolved({ base: './', build: { outDir: dir } });
    await plugin.closeBundle();

    assert.throws(() => readFileSync(join(dir, SW_FILE_NAME), 'utf8'), 'aucun worker pour un build local');
    assert.equal(warnings.length, 1);
    assert.match(warnings[0], /aucun service worker écrit/);
  });
});

describe('l’enregistrement côté application', () => {
  it('le chemin enregistré est celui que le générateur écrit', () => {
    // Deux écritures, jamais libres : elles sont reliées ici.
    assert.equal(SERVICE_WORKER_URL, `/${SW_FILE_NAME}`);
  });

  it('refuse le poste installé : son interface vient du disque, pas du réseau', () => {
    assert.equal(
      shouldRegisterServiceWorker({ protocol: 'file:', isProd: true, secureContext: true, supported: true }),
      false,
    );
  });

  it('refuse hors production (sw.js n’existe pas en développement)', () => {
    assert.equal(
      shouldRegisterServiceWorker({ protocol: 'https:', isProd: false, secureContext: true, supported: true }),
      false,
    );
  });

  it('refuse un contexte non sécurisé ou un navigateur sans service worker', () => {
    assert.equal(
      shouldRegisterServiceWorker({ protocol: 'http:', isProd: true, secureContext: false, supported: true }),
      false,
    );
    assert.equal(
      shouldRegisterServiceWorker({ protocol: 'https:', isProd: true, secureContext: true, supported: false }),
      false,
    );
  });

  it('enregistre sur le site servi en HTTPS, en production', () => {
    assert.equal(
      shouldRegisterServiceWorker({ protocol: 'https:', isProd: true, secureContext: true, supported: true }),
      true,
    );
  });

  it('redemande le worker à l’ouverture ET au retour sur l’onglet', () => {
    // Deux écritures, jamais libres : le demandeur testé ci-dessous doit être
    // celui que l'application utilise, et le retour sur l'onglet doit être branché.
    assert.ok(
      /registerServiceWorker[\s\S]*createUpdateRequester\(\{ registration \}\)/.test(APPLICATION_MODULE),
      'l’enregistrement doit passer par le demandeur testé',
    );
    assert.ok(
      /visibilitychange['"][\s\S]{0,120}=== 'visible'[\s\S]{0,60}requestUpdate\(\)/.test(APPLICATION_MODULE),
      'revenir sur l’onglet doit redemander le worker',
    );
  });
});

/**
 * La vérification explicite du worker : ce qui est verrouillé ici, c'est qu'elle
 * DEMANDE vraiment (et qu'on sait quand elle a demandé), sans jamais devenir une
 * boucle de requêtes. Mesuré en vrai navigateur : le navigateur demande bien le
 * nouveau worker à chaque ouverture, mais un onglet resté ouvert pendant un
 * déploiement ne redemande rien — c'est ce cas-là que cette vérification couvre.
 */
describe('la demande de mise à jour du worker', () => {
  function requesterWith(intervalMs = SERVICE_WORKER_UPDATE_INTERVAL_MS) {
    let clock = 1_000_000;
    const calls: number[] = [];
    const requestUpdate = createUpdateRequester({
      registration: {
        update: () => {
          calls.push(clock);
          return Promise.resolve();
        },
      },
      intervalMs,
      now: () => clock,
    });
    return { requestUpdate, calls, advance: (ms: number) => { clock += ms; } };
  }

  it('demande le worker à l’ouverture, et le dit', () => {
    const { requestUpdate, calls } = requesterWith();
    assert.equal(requestUpdate(), true, 'une vérification a réellement été demandée');
    assert.equal(calls.length, 1);
  });

  it('épargne le réseau : rien de plus pendant l’intervalle', () => {
    const { requestUpdate, calls, advance } = requesterWith(15 * 60 * 1000);
    requestUpdate();
    advance(60_000);
    assert.equal(requestUpdate(), false, 'épargné : ce n’est pas une vérification');
    assert.equal(calls.length, 1);
  });

  it('redemande après l’intervalle (un onglet resté ouvert finit par se mettre à jour)', () => {
    const { requestUpdate, calls, advance } = requesterWith(15 * 60 * 1000);
    requestUpdate();
    advance(15 * 60 * 1000);
    assert.equal(requestUpdate(), true);
    assert.equal(calls.length, 2);
  });

  it('un échec (pas de réseau) ne casse rien et n’empêche pas la vérification suivante', async () => {
    let attempts = 0;
    const requestUpdate = createUpdateRequester({
      registration: {
        update: () => {
          attempts += 1;
          return Promise.reject(new Error('Failed to fetch'));
        },
      },
      intervalMs: 0,
      now: () => attempts,
    });
    assert.equal(requestUpdate(), true);
    await Promise.resolve();
    assert.equal(requestUpdate(), true);
    assert.equal(attempts, 2);
  });

  it('un échec synchrone est avalé de la même façon', async () => {
    const requestUpdate = createUpdateRequester({
      registration: {
        update: () => {
          throw new Error('pas de réseau au moment de l’appel');
        },
      },
      intervalMs: 0,
      now: () => 1,
    });
    assert.equal(requestUpdate(), true, 'l’appel ne remonte pas à l’utilisateur');
    await Promise.resolve();
  });
});
