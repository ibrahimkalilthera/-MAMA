// Suite for electron/csp-policy.cjs — the DESKTOP policy, which is delivered
// through two channels (a response header at runtime, a meta in the built
// artifact) and enforced by Chromium on `file://`.
//
// What this suite locks, and why each one was worth writing:
//
//   • the policy is judged by the REPOSITORY'S OWN judge (scripts/lib/csp-origins.mjs):
//     a directive that names an undeclared origin, or one left with neither tokens
//     nor a `default-src` fallback, is not "strict", it is a hole — and that is
//     exactly the kind of widening this repository refuses everywhere;
//   • the base host is a LITERAL (a packaged main process reads no environment),
//     so it must equal the single definition (scripts/lib/shared-project.mjs);
//   • the policy travels in a meta too, so it may not use a directive a meta cannot
//     carry (`frame-ancestors`, `sandbox`, `report-uri`, `report-to`) — a policy
//     that silently loses a directive in one channel is enforced differently
//     depending on how it was delivered;
//   • the runtime filter appends and never REPLACES: two CSP policies intersect, so
//     dropping someone else's value could only widen what is allowed;
//   • the filter touches the LOCAL document only. The HTTPS fallback already
//     receives a real CSP from Vercel, and our `default-src 'none'` would close
//     `worker-src` — killing the site's service worker (the offline reserve)
//     silently, on a path nobody exercises daily.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { auditPolicy, justificationFor } from '../scripts/lib/csp-origins.mjs';
import { SHARED_PROJECT_URL } from '../scripts/lib/shared-project.mjs';
import { META_TAG, electronCspMetaPlugin, isDesktopBuild } from '../scripts/lib/electron-csp-meta.mjs';

const require = createRequire(import.meta.url);
const { DESKTOP_CSP, META_INCOMPATIBLE, cspHeaders, installCsp, isLocalDocument } = require(
  '../electron/csp-policy.cjs',
);

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (path: string) => readFileSync(join(root, path), 'utf8');

/** L'en-tête CSP d'un jeu d'en-têtes, quelle que soit la casse de la clé. */
function cspValues(headers: Record<string, string[]>): string[] {
  const key = Object.keys(headers).find((name) => name.toLowerCase() === 'content-security-policy');
  return key ? headers[key] ?? [] : [];
}

describe('electron/csp-policy.cjs — la politique du poste, jugée par le garde du dépôt', () => {
  it('aucune directive élargie, aucune directive sans limite', () => {
    const judged = auditPolicy({ name: 'bureau', csp: DESKTOP_CSP });
    assert.ok(judged.judgeable, 'une politique qu’on n’a pas pu lire ne prouverait rien');
    assert.deepEqual(judged.widened, [], 'un jeton non déclaré serait une origine qu’on contacte sans l’avoir dit');
    assert.deepEqual(judged.unrestricted, [], 'sans default-src, une directive absente autoriserait TOUT');
    assert.ok(Object.keys(judged.directives).length >= 9, 'et elle a bien été lue, directive par directive');
  });

  it('elle nomme la base partagée, jamais autre chose — et la définition unique en est la source', () => {
    const connect = auditPolicy({ name: 'bureau', csp: DESKTOP_CSP }).directives['connect-src'] ?? [];
    const hosts = connect.filter((token) => /supabase\.co/.test(token));
    assert.equal(hosts.length, 2, 'l’hôte en https ET en wss : le temps réel passe par un websocket');
    const sharedHost = new URL(SHARED_PROJECT_URL).host;
    for (const token of hosts) {
      assert.equal(token.split('://')[1], sharedHost, 'le littéral du poste vaut la définition unique');
      assert.ok(
        justificationFor({ origin: sharedHost, directive: 'connect-src', url: token }),
        'et il est DÉCLARÉ pour cette directive, dans le seul fichier autorisé à l’écrire',
      );
    }
  });

  it('elle n’emploie aucune directive qu’une meta ne peut pas porter', () => {
    for (const directive of META_INCOMPATIBLE) {
      assert.doesNotMatch(
        DESKTOP_CSP,
        new RegExp(`\\b${directive}\\b`),
        `« ${directive} » est sans effet dans une meta : la politique des deux canaux ne peut pas l’utiliser`,
      );
    }
    assert.doesNotMatch(DESKTOP_CSP, /unsafe-eval/, 'et elle n’ouvre jamais l’exécution de code construit');
  });

  it('le verrou est bien default-src \'none\' : tout ce qui n’est pas nommé est fermé', () => {
    const judged = auditPolicy({ name: 'bureau', csp: DESKTOP_CSP });
    assert.deepEqual(judged.directives['default-src'], ["'none'"]);
    // Ce qui n'est pas nommé hérite de `default-src` et est donc jugé À SA PLACE :
    // c'est ce qui ferme worker-src, media-src, frame-src… sans les énumérer.
    for (const directive of ['frame-src', 'media-src', 'worker-src', 'manifest-src']) {
      assert.equal(judged.judgedVia[directive], 'default-src', `${directive} n’est pas laissée ouverte`);
    }
  });
});

describe('electron/csp-policy.cjs — le canal « en-tête », et sa portée volontairement étroite', () => {
  it('un document local reçoit la politique ; celui du repli, non', () => {
    assert.equal(isLocalDocument('file:///C:/app/resources/app.asar/electron-ui-dist/index.html'), true);
    assert.equal(isLocalDocument('https://mama-thera-finance.vercel.app/'), false);

    const local = cspHeaders({ url: 'file:///C:/x/electron-ui-dist/index.html', responseHeaders: {} });
    assert.deepEqual(cspValues(local), [DESKTOP_CSP], 'l’installeur porte sa politique');

    const remote = cspHeaders({
      url: 'https://mama-thera-finance.vercel.app/',
      responseHeaders: { 'content-security-policy': ["default-src 'self'"] },
    });
    assert.deepEqual(
      cspValues(remote),
      ["default-src 'self'"],
      'le repli garde SA politique, servie par Vercel — la nôtre fermerait worker-src, donc son service worker',
    );
  });

  it('un en-tête existant n’est jamais écrasé : la nôtre s’AJOUTE, elle ne remplace pas', () => {
    const merged = cspHeaders({
      url: 'file:///C:/x/index.html',
      responseHeaders: { 'Content-Security-Policy': ["default-src 'self'"], 'X-Other': ['1'] },
    });
    const keys = Object.keys(merged).filter((k) => k.toLowerCase() === 'content-security-policy');
    assert.equal(keys.length, 1, 'une seule clé : sinon Electron enverrait deux fois la même chose');
    assert.deepEqual(
      cspValues(merged),
      ["default-src 'self'", DESKTOP_CSP],
      'les deux valeurs coexistent — deux politiques se cumulent, donc remplacer ne pourrait qu’élargir',
    );
    assert.deepEqual(merged['X-Other'], ['1'], 'et les autres en-têtes sont rendus intacts');
  });

  it('les valeurs reçues sont copiées, jamais partagées avec l’objet d’Electron', () => {
    const source = { 'X-Source': ['a'] };
    const merged = cspHeaders({ url: 'file:///C:/x/index.html', responseHeaders: source });
    (merged['X-Source'] ?? []).push('b');
    assert.deepEqual(source['X-Source'], ['a'], 'mutiler la réponse d’Electron serait un effet de bord invisible');
  });

  it('installCsp branche un filtre qui RÉPOND des en-têtes (pas seulement un écouteur posé)', () => {
    type Listener = (details: unknown, callback: (response: unknown) => void) => void;
    let listener: Listener | undefined;
    installCsp({ webRequest: { onHeadersReceived: (fn: Listener) => { listener = fn; } } });
    assert.ok(listener, 'le filtre est branché sur la session');

    let answered: { responseHeaders?: Record<string, string[]> } | undefined;
    listener({ url: 'file:///C:/x/electron-ui-dist/index.html', responseHeaders: {} }, (response) => {
      answered = response as typeof answered;
    });
    assert.deepEqual(cspValues(answered?.responseHeaders ?? {}), [DESKTOP_CSP], 'et il répond la politique');

    let untouched: { responseHeaders?: Record<string, string[]> } | undefined;
    listener({ url: 'https://example.test/page', responseHeaders: {} }, (response) => {
      untouched = response as typeof untouched;
    });
    assert.deepEqual(cspValues(untouched?.responseHeaders ?? {}), [], 'sans toucher au reste du web');
  });

  it('le processus principal le branche sur la session par défaut, AVANT la première fenêtre', () => {
    const main = read('electron/main.cjs');
    assert.match(main, /require\('\.\/csp-policy\.cjs'\)/, 'le même module que celui jugé ici');
    assert.match(main, /installCsp\(session\.defaultSession\)/, 'branché sur la session qui sert le document');
    assert.match(main, /\bsession,/, 'et la session est bien prise sur electron');
    const wired = main.indexOf('installCsp(session.defaultSession)');
    const firstWindow = main.indexOf('createWindow();');
    assert.ok(wired >= 0 && firstWindow >= 0 && wired < firstWindow,
      'une fenêtre créée d’abord chargerait son document — et un @import externe partirait — avant le filtre');
  });
});

describe('scripts/lib/electron-csp-meta.mjs — le second canal, écrit dans l’artefact', () => {
  it('il n’agit QUE sur le build de bureau, quel que soit le séparateur du chemin', () => {
    for (const dir of ['electron-ui-dist', './electron-ui-dist', '/tmp/x/electron-ui-dist', 'D:\\build\\electron-ui-dist']) {
      assert.equal(isDesktopBuild(dir), true, `${dir} est le build du poste`);
    }
    for (const dir of ['dist', '/tmp/x/dist', '.vercel/output']) {
      assert.equal(isDesktopBuild(dir), false, `${dir} n’est pas le build du poste : le site a déjà sa CSP en en-tête`);
    }
  });

  it('il injecte la meta en TÊTE de <head>, avec la politique du module', () => {
    const plugin = electronCspMetaPlugin();
    plugin.configResolved({ build: { outDir: 'electron-ui-dist' } });
    const result = plugin.transformIndexHtml.handler('<html><head><meta charset="utf-8"></head><body></body></html>');
    assert.notEqual(typeof result, 'string', 'il rend une injection, pas une chaîne réécrite à la main');
    const tags = (result as { tags: { tag: string, attrs: Record<string, string>, injectTo: string }[] }).tags;
    assert.equal(tags.length, 1);
    const tag = tags[0] ?? { tag: '', attrs: {} as Record<string, string>, injectTo: '' };
    assert.equal(tag.tag, 'meta');
    assert.equal(tag.attrs['http-equiv'], 'Content-Security-Policy');
    assert.equal(tag.attrs.content, DESKTOP_CSP, 'la MÊME constante que l’en-tête : deux politiques divergentes se cumuleraient, donc la plus permissive gagnerait en silence');
    assert.equal(tag.injectTo, 'head-prepend', 'une meta ne s’applique qu’à partir de l’endroit où l’analyseur la lit');
  });

  it('et il ne touche à RIEN quand ce n’est pas le build du poste', () => {
    const plugin = electronCspMetaPlugin();
    plugin.configResolved({ build: { outDir: 'dist' } });
    const html = '<html><head></head><body></body></html>';
    assert.equal(plugin.transformIndexHtml.handler(html), html, 'le site servi garde la politique de vercel.json, et une seule');
  });

  it('la balise d’artefact et la constante ne peuvent pas diverger', () => {
    assert.match(META_TAG, /^<meta http-equiv="Content-Security-Policy" content="/);
    assert.ok(META_TAG.includes(DESKTOP_CSP), 'la balise citée dans la documentation est bien celle qui sortira du build');
  });

  it('vite.config.ts branche ce plugin, et le document source n’a AUCUN script en ligne', () => {
    const config = read('vite.config.ts');
    assert.match(config, /electronCspMetaPlugin\(\)/, 'un plugin écrit mais non branché ne verrouille rien');
    // Ce que la mesure a rendu nécessaire : sous `script-src 'self'`, un script en
    // ligne est BLOQUÉ (mesuré dans Electron 44 : « Executing inline script
    // violates… »). Le document source n'en contient aucun, donc la politique
    // stricte ne casse pas le démarrage — c'est cette assertion qui le tient.
    const html = read('index.html');
    const inline = [...html.matchAll(/<script\b[^>]*>/gi)].filter((m) => !/\bsrc\s*=/i.test(m[0]));
    assert.deepEqual(inline.map((m) => m[0]), [], 'aucun script en ligne dans le document d’entrée');
  });
});
