// Tests de scripts/lib/font-origins.mjs (et de la commande qui s'en sert,
// `npm run check:font-origins`, par sa FORME).
//
// WHY THIS EXISTS
// ---------------
// `f434ae5` (22/08) importait Geist depuis Google Fonts pendant que la CSP du
// projet valait `style-src 'self' 'unsafe-inline'` et `font-src 'self'` : la
// feuille était BLOQUÉE, la police ne chargeait jamais, et chaque page logait une
// violation. `69a6f1f` (28/08) a réparé la cause (auto-hébergement + preload),
// mais aucune garde n'a été posée : rouvrir l'import reste une ligne.
//
// Ces cas protègent ce qui se trompe SANS navigateur, donc sans qu'on s'en
// aperçoive : la forme protocole-relative (`//fonts.gstatic.com/…`) qu'un œil
// distrait lit comme un chemin local, le `<link>` d'un document qui n'a pas de
// `url()`, la CSP qu'on « répare » en nommant une origine externe (le symptôme
// disparaît, la porte s'ouvre), une `font-src` absente dont le repli
// `default-src` doit être jugé À SA PLACE, et une politique illisible comptée
// comme un vert — le faux vert que ce dépôt pourchasse.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  FONT_CDNS,
  POLICY_SOURCES,
  SHIPPED_SOURCES,
  auditStylePolicy,
  findExternalRequests,
  isFontCdn,
  judgeFontOrigins,
} from '../scripts/lib/font-origins.mjs';
import { GUARD_INVENTORY, IMMUNITY } from '../scripts/lib/guard-immunity.mjs';
import { maskComments } from '../scripts/lib/source-text.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
function read(relative: string): string {
  return readFileSync(join(ROOT, relative), 'utf8');
}

/** La CSP servie aujourd'hui (mesurée dans vercel.json). */
const REAL_CSP =
  "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; " +
  "font-src 'self'; connect-src 'self' https://rpcjdohfxwukbqngbprw.supabase.co wss://rpcjdohfxwukbqngbprw.supabase.co; " +
  "frame-ancestors 'self'; object-src 'none'; base-uri 'self'; form-action 'self'";

describe('font-origins — le trou mesuré : un import externe est REFUSÉ et NOMMÉ', () => {
  it('l’@import de Google Fonts qui a coûté six jours de console bruyante', () => {
    const findings = findExternalRequests({
      files: [
        {
          path: 'src/index.css',
          text: '@import "https://fonts.googleapis.com/css2?family=Geist:wght@300;400;500&display=swap";\nbody { color: red }',
        },
      ],
    });
    assert.equal(findings.length, 1);
    assert.equal(findings[0]?.kind, 'import-externe');
    assert.equal(findings[0]?.host, 'fonts.googleapis.com');
    assert.equal(findings[0]?.line, 1, 'le rapport dit OÙ');
    assert.equal(findings[0]?.fontCdn, true, 'et NOMME la régie de polices');
    assert.ok(isFontCdn('https://fonts.gstatic.com/s/geist/v5/x.woff2'));
    assert.ok(FONT_CDNS.includes('fonts.googleapis.com'));
  });

  it('la forme protocole-relative est refusée comme l’absolue — elle sort de chez nous pareil', () => {
    const findings = findExternalRequests({
      files: [{ path: 'src/a.css', text: "a { background: url(//fonts.gstatic.com/s/x.woff2) }" }],
    });
    assert.equal(findings.length, 1);
    assert.equal(findings[0]?.kind, 'ressource-externe');
    assert.equal(findings[0]?.host, 'fonts.gstatic.com');
  });

  it('un <link> de document est vu même sans aucun url()', () => {
    const findings = findExternalRequests({
      files: [
        {
          path: 'index.html',
          text: '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Roboto" />\n<link rel="preload" href="/fonts/geist/Geist-Variable.woff2" as="font" />',
        },
      ],
    });
    assert.equal(findings.length, 1);
    assert.equal(findings[0]?.kind, 'lien-externe');
  });

  it('et une police locale n’est PAS accusée : c’est le remède, pas le défaut', () => {
    const findings = findExternalRequests({
      files: [
        {
          path: 'src/assets/fonts/geist.css',
          text: "@font-face { font-family: 'Geist'; src: url('/fonts/geist/Geist-Variable.woff2') format('woff2') }",
        },
        { path: 'src/a.css', text: "a { background: url(data:image/png;base64,AAAA) }" },
      ],
    });
    assert.deepEqual(findings, []);
  });
});

describe('font-origins — la politique : élargir est l’autre façon de rouvrir le trou', () => {
  it('la CSP du dépôt n’élargit rien, et le dit par quelle directive elle a jugé', () => {
    const policy = auditStylePolicy({ name: 'web', csp: REAL_CSP });
    assert.deepEqual(policy.widened, []);
    assert.equal(policy.judgeable, true);
    assert.equal(policy.effective['style-src'], 'style-src');
    assert.equal(policy.effective['font-src'], 'font-src');
  });

  it('nommer une origine externe est un refus, même quand le symptôme disparaît', () => {
    const widened = auditStylePolicy({
      name: 'web',
      csp: "default-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self' https://fonts.gstatic.com",
    });
    assert.deepEqual(widened.widened, [{ directive: 'font-src', token: 'https://fonts.gstatic.com' }]);
    assert.equal(judgeFontOrigins({ files: [{ path: 'a.css', text: '' }], policies: [{ name: 'web', csp: "font-src 'self' https://fonts.gstatic.com" }] }).ok, false);
  });

  it('une font-src ABSENTE est jugée à la place du default-src, et le repli est nommé', () => {
    const policy = auditStylePolicy({ name: 'web', csp: "default-src 'self'; style-src 'self' 'unsafe-inline'" });
    assert.equal(policy.effective['font-src'], 'default-src');
    assert.deepEqual(policy.widened, []);

    const widened = auditStylePolicy({ name: 'web', csp: "default-src 'self' https://fonts.googleapis.com" });
    assert.deepEqual(widened.widened, [
      { directive: 'style-src', token: 'https://fonts.googleapis.com' },
      { directive: 'font-src', token: 'https://fonts.googleapis.com' },
    ]);
  });

  it('une politique ILLISIBLE n’est pas une politique conforme', () => {
    const report = judgeFontOrigins({ files: [{ path: 'a.css', text: '' }], policies: [{ name: 'web', csp: '' }] });
    assert.deepEqual(report.unjudgeable, ['web']);
    assert.equal(report.ok, false, 'un vert sur une politique qu’on n’a pas pu lire serait le faux vert exact');
  });

  it('et un regard vide n’est pas un vert : aucun fichier, ou aucune politique', () => {
    for (const input of [
      { files: [], policies: [{ name: 'web', csp: REAL_CSP }] },
      { files: [{ path: 'a.css', text: '' }], policies: [] },
    ]) {
      const report = judgeFontOrigins(input);
      assert.equal(report.vacuous, true);
      assert.equal(report.ok, false);
    }
  });
});

describe('font-origins — l’arbre réel est propre, et la police est bien servie par nous', () => {
  it('le corpus déclaré ne contient aucun fichier de sortie de build', () => {
    assert.deepEqual(SHIPPED_SOURCES, ['index.html', 'src', 'public', 'electron']);
    assert.deepEqual(
      POLICY_SOURCES.map((p) => p.file),
      ['vercel.json'],
      'la seule politique servie est celle du site — le paquet Windows n’en déclare aucune',
    );
  });

  it('le contrôle ne trouve RIEN dans les sources expédiées, et la CSP ne nomme aucune origine', () => {
    const report = judgeFontOrigins({
      files: ['index.html', 'src/index.css', 'src/assets/fonts/geist.css', 'src/main.tsx'].map((path) => ({
        path,
        text: maskComments(read(path)),
      })),
      policies: [{ name: 'web (vercel.json)', csp: REAL_CSP }],
    });
    assert.deepEqual(report.findings, [], 'l’état mesuré est vert — et c’est cet état-là que la garde tient');
    assert.equal(report.ok, true);
  });

  it('le remède est EN PLACE : la police est auto-hébergée et préchargée', () => {
    assert.ok(existsSync(join(ROOT, 'public/fonts/geist/Geist-Variable.woff2')), 'la police servie par nous existe');
    const html = read('index.html');
    assert.match(html, /rel="preload"[^>]*\/fonts\/geist\/Geist-Variable\.woff2/, 'le document la précharge');
    assert.match(read('src/assets/fonts/geist.css'), /@font-face/);
  });

  it('vercel.json porte réellement la CSP que le contrôle juge', () => {
    const json = JSON.parse(read('vercel.json'));
    const values = [];
    for (const rule of json.headers ?? []) {
      for (const header of rule.headers ?? []) {
        if (/^content-security-policy$/i.test(String(header.key))) values.push(String(header.value));
      }
    }
    assert.equal(values.length, 1, 'une seule politique servie');
    assert.match(values[0] ?? '', /font-src 'self'/);
    assert.deepEqual(auditStylePolicy({ name: 'web', csp: values[0] }).widened, []);
  });
});

describe('check:font-origins — la commande elle-même, telle qu’elle est écrite', () => {
  const source = read('scripts/check-font-origins.mjs');
  const code = maskComments(source);
  const pkg = JSON.parse(read('package.json'));

  it('elle existe sous son nom, et tourne dans la chaîne locale (une seconde, sans réseau)', () => {
    assert.equal(pkg.scripts['check:font-origins'], 'node scripts/check-font-origins.mjs');
    assert.match(pkg.scripts['lint:chain'], /node scripts\/check-font-origins\.mjs/, 'la chaîne la lance sur chaque commit');
  });

  it('elle blanchie la prose : un commentaire qui CITE l’URL n’est pas une infraction', () => {
    assert.match(source, /maskComments/, 'le blanchiment est ce qui rend la règle citable sans se faire accuser');
    // La démonstration, sur le texte exact qu'une explication écrirait — sans le
    // blanchiment, la prose est lue comme du code (la leçon payée par le premier
    // jet du scanner naïf de ce dépôt).
    const cited = '/* ne jamais réintroduire @import url(https://fonts.googleapis.com/css2?family=Geist) */\n';
    assert.deepEqual(
      findExternalRequests({ files: [{ path: 'src/a.css', text: cited }] }).map((f) => f.kind),
      ['import-externe', 'ressource-externe'],
      'sans blanchiment, la prose est lue deux fois — l’@import ET son url()',
    );
    assert.deepEqual(findExternalRequests({ files: [{ path: 'src/a.css', text: maskComments(cited) }] }), []);
  });

  it('elle refuse de verdir sans corpus ni politique, et rougit sur une demande', () => {
    assert.match(code, /process\.exit\(2\)/, 'un refus ÉCRIT, celui que l’inventaire des immunités relit');
    assert.match(code, /if \(report\.vacuous \|\| report\.unjudgeable\.length > 0\)/);
    assert.match(code, /if \(!report\.ok\) process\.exitCode = 1;/);
  });

  it('elle n’écrit RIEN : la réparation est un geste humain, pas un choix de contrôle', () => {
    assert.doesNotMatch(code, /\b(writeFileSync|writeFile|mkdirSync|rmSync|unlinkSync)\b/);
  });

  it('elle lit le corpus et la politique par leurs noms déclarés', () => {
    assert.match(source, /SHIPPED_SOURCES/);
    assert.match(source, /POLICY_SOURCES/);
    assert.match(source, /content-security-policy/i);
  });
});

describe('l’inventaire des immunités — un contrôle non déclaré fait échouer la chaîne', () => {
  it('check-font-origins.mjs s’y déclare, avec ses deux immunités prouvées', () => {
    const entry = GUARD_INVENTORY.find((e: { check: string }) => e.check === 'check-font-origins.mjs') as
      | { needs: string[] }
      | undefined;
    assert.ok(entry, 'un contrôle non déclaré n’a pas d’immunités prouvées');
    assert.deepEqual(entry.needs, [IMMUNITY.NON_VACUOUS, IMMUNITY.PROSE_BLIND]);
  });
});
