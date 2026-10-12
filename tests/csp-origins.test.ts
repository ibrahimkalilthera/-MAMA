// Tests de scripts/lib/csp-origins.mjs (et de la commande qui s'en sert,
// `npm run check:csp-origins`, par sa FORME).
//
// WHY THIS EXISTS
// ---------------
// `f434ae5` (22/08) importait Geist depuis Google Fonts pendant que la CSP du
// projet valait `style-src 'self' 'unsafe-inline'` et `font-src 'self'` : la
// feuille était BLOQUÉE, la police ne chargeait jamais, et chaque page logait une
// violation. `69a6f1f` (28/08) a réparé la cause (auto-hébergement + preload),
// mais aucune garde n'a été posée.
//
// La garde posée ensuite ne regardait que DEUX directives (`style-src`,
// `font-src`) : une valeur absolue ajoutée ailleurs — un `img-src https://cdn…`,
// un `frame-src`, un `<iframe src>`, un `fetch('https://…')`, la moindre
// constante d'origine dans `electron/` — n'aurait été lue par personne. Ces cas
// protègent donc l'élargissement : chaque directive est jugée, et chaque valeur
// absolue expédiée doit être DÉCLARÉE avec sa raison.
//
// Ce qui se trompe SANS navigateur, donc sans qu'on s'en aperçoive, est la cible :
// la forme protocole-relative (`//fonts.gstatic.com/…`) qu'un œil distrait lit
// comme un chemin local, la CSP qu'on « répare » en nommant une origine externe
// (le symptôme disparaît, la porte s'ouvre), une directive absente dont le repli
// `default-src` doit être jugé À SA PLACE, une directive sans jetons NI repli qui
// n'est pas « silencieuse » mais SANS LIMITE, une origine déclarée pour un
// fichier qui se propage à un autre, et une politique illisible comptée comme un
// vert — le faux vert que ce dépôt pourchasse.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  FONT_CDNS,
  JUSTIFIED_ORIGINS,
  POLICY_SOURCES,
  SCANNED_EXTS,
  SHIPPED_SOURCES,
  auditPolicy,
  findExternalRequests,
  isFontCdn,
  judgeCspOrigins,
} from '../scripts/lib/csp-origins.mjs';
import { GUARD_INVENTORY, IMMUNITY } from '../scripts/lib/guard-immunity.mjs';
import { SHARED_PROJECT_REF, SHARED_PROJECT_URL } from '../scripts/lib/shared-project.mjs';
import { maskComments, maskMarkupComments } from '../scripts/lib/source-text.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
function read(relative: string): string {
  return readFileSync(join(ROOT, relative), 'utf8');
}

/**
 * Le blanchiment que la COMMANDE applique, extension par extension — recopié ici
 * volontairement : un test qui blanchirait autrement que le contrôle ne
 * prouverait pas ce que le contrôle lit.
 */
const MARKUP_EXTS = ['.css', '.html', '.htm', '.svg'];
function MASK_LIKE_THE_CLI(path: string): string {
  const text = read(path);
  return MARKUP_EXTS.some((ext) => path.endsWith(ext)) ? maskMarkupComments(text) : maskComments(text);
}

/** La CSP servie aujourd'hui (mesurée dans vercel.json). */
const REAL_CSP =
  "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; " +
  "font-src 'self'; connect-src 'self' https://rpcjdohfxwukbqngbprw.supabase.co wss://rpcjdohfxwukbqngbprw.supabase.co; " +
  "frame-ancestors 'self'; object-src 'none'; base-uri 'self'; form-action 'self'";

const DIRECTIVES_COVERED = ['img-src', 'connect-src', 'frame-src'];

describe('csp-origins — le trou mesuré : une origine externe est REFUSÉE et NOMMÉE', () => {
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
    assert.deepEqual(findings[0]?.directives, ['style-src'], 'et la directive qui la gouvernerait');
    assert.ok(isFontCdn('https://fonts.gstatic.com/s/geist/v5/x.woff2'));
    assert.ok(FONT_CDNS.includes('fonts.googleapis.com'));
  });

  it('la forme protocole-relative est refusée comme l’absolue — elle sort de chez nous pareil', () => {
    const findings = findExternalRequests({
      files: [{ path: 'src/a.css', text: 'a { background: url(//fonts.gstatic.com/s/x.woff2) }' }],
    });
    assert.equal(findings.length, 1);
    assert.equal(findings[0]?.kind, 'ressource-externe');
    assert.equal(findings[0]?.host, 'fonts.gstatic.com');
    assert.equal(findings[0]?.scheme, null, 'aucun schéma : la forme le dit aussi');
  });

  it('un <link> de document est vu même sans aucun url(), et sa directive vient de son rel', () => {
    const findings = findExternalRequests({
      files: [
        {
          path: 'index.html',
          text:
            '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Roboto" />\n' +
            '<link rel="preload" href="https://cdn.example.com/x.woff2" as="font" />\n' +
            '<link rel="preload" href="/fonts/geist/Geist-Variable.woff2" as="font" />',
        },
      ],
    });
    assert.equal(findings.length, 2);
    assert.equal(findings[0]?.kind, 'lien-externe');
    assert.deepEqual(findings[0]?.directives, ['style-src']);
    assert.deepEqual(findings[1]?.directives, ['font-src'], 'le `as` décide, et il est lu');
  });

  it('et une police locale n’est PAS accusée : c’est le remède, pas le défaut', () => {
    const findings = findExternalRequests({
      files: [
        {
          path: 'src/assets/fonts/geist.css',
          text: "@font-face { font-family: 'Geist'; src: url('/fonts/geist/Geist-Variable.woff2') format('woff2') }",
        },
        { path: 'src/a.css', text: 'a { background: url(data:image/png;base64,AAAA) }' },
      ],
    });
    assert.deepEqual(findings, []);
  });

  it('un seul texte capturé par deux motifs ne compte QU’UNE fois, et le plus précis gagne', () => {
    const cited = '@import url(https://fonts.googleapis.com/css2?family=Geist);\n';
    const findings = findExternalRequests({ files: [{ path: 'src/a.css', text: cited }] });
    assert.equal(findings.length, 1, 'l’@import et son url() ne sont pas deux valeurs');
    assert.equal(findings[0]?.kind, 'import-externe');
    assert.deepEqual(findings[0]?.directives, ['style-src']);
  });

  it('une origine NUE dans une feuille de style n’est pas prise pour un commentaire', () => {
    // Le fait mesuré le 2026-10-12, et il rendait la garde fausse pour les
    // feuilles de style : `maskComments` lit son texte avec le scanner de
    // TypeScript, où une barre oblique double est un commentaire de ligne. Le CSS
    // n'en a pas — donc l'origine disparaissait de la lecture, et la valeur qu'on
    // veut justement refuser devenait invisible.
    const css = 'a { background: url(https://cdn.example.com/bg.png) }';
    assert.doesNotMatch(maskComments(css), /cdn\.example\.com/, 'le piège, tel qu’il a été mesuré');
    assert.match(maskMarkupComments(css), /cdn\.example\.com/, 'et le blanchiment de balisage le laisse intact');
    assert.equal(
      findExternalRequests({ files: [{ path: 'src/a.css', text: maskMarkupComments(css) }] }).length,
      1,
      'donc la valeur est vue, et elle sera jugée',
    );
    // Un commentaire CSS qui CITE l'origine reste de la prose, lui.
    const cited = '/* ne jamais servir depuis https://cdn.example.com/bg.png */\n';
    assert.deepEqual(findExternalRequests({ files: [{ path: 'src/a.css', text: maskMarkupComments(cited) }] }), []);
  });

  it('une forme qui n’est pas un hôte n’est pas une origine : `//b` ne rougit pas', () => {
    const findings = findExternalRequests({
      files: [{ path: 'src/a.ts', text: "const p = ['a', 'b'].join('//');\nconst q = 'a//b';\n" }],
    });
    assert.deepEqual(findings, []);
  });
});

describe('csp-origins — les directives que la garde NE REGARDAIT PAS', () => {
  it('une valeur ajoutée à img-src, connect-src ou frame-src est refusée et NOMMÉE', () => {
    for (const directive of DIRECTIVES_COVERED) {
      const policy = auditPolicy({ name: 'web', csp: `default-src 'self'; ${directive} 'self' https://cdn.example.com` });
      assert.deepEqual(
        policy.widened.map((w) => [w.directive, w.token, w.via]),
        [[directive, 'https://cdn.example.com', directive]],
        `${directive} doit être jugée (et par elle-même)`,
      );
      const report = judgeCspOrigins({
        files: [{ path: 'a.css', text: '' }],
        policies: [{ name: 'web', csp: `default-src 'self'; ${directive} 'self' https://cdn.example.com` }],
      });
      assert.equal(report.ok, false, `${directive} élargie n’est pas un vert`);
      assert.deepEqual(report.unrestricted, [], 'la politique a bien un default-src');
    }
  });

  it('la base partagée est la SEULE origine que la politique a le droit de nommer', () => {
    const policy = auditPolicy({ name: 'web', csp: REAL_CSP });
    assert.deepEqual(policy.widened, [], 'l’état mesuré est vert');
    const host = new URL(SHARED_PROJECT_URL).host;
    for (const directive of ['connect-src']) {
      for (const scheme of ['https', 'wss']) {
        assert.ok(
          JUSTIFIED_ORIGINS.some(
            (e) => e.origin === host && (e.directives ?? []).includes(directive) && (e.schemes ?? []).includes(scheme),
          ),
          `${scheme}://${host} doit être déclarée pour ${directive}`,
        );
      }
    }
  });

  it('la déclaration est DÉRIVÉE de l’origine partagée : le ref n’est pas recopié une 17ᵉ fois', () => {    assert.ok(JUSTIFIED_ORIGINS.some((e) => e.origin === new URL(SHARED_PROJECT_URL).host),
      'l’entrée de la base est écrite sous sa forme dérivée',
    );
    assert.doesNotMatch(
      read('scripts/lib/csp-origins.mjs'),
      new RegExp(SHARED_PROJECT_REF),
      'écrire le ref en dur serait exactement la copie que shared-project.mjs existe pour supprimer',
    );
  });

  it('une directive ABSENTE est jugée à la place du default-src, et le repli est NOMMÉ', () => {
    const policy = auditPolicy({ name: 'web', csp: "default-src 'self'; style-src 'self' 'unsafe-inline'" });
    assert.equal(policy.judgedVia['font-src'], 'default-src');
    assert.equal(policy.judgedVia['img-src'], 'default-src');
    assert.equal(policy.judgedVia['connect-src'], 'default-src');
    assert.equal(policy.judgedVia['frame-src'], 'default-src');
    assert.deepEqual(policy.widened, []);

    const widened = auditPolicy({ name: 'web', csp: "default-src 'self' https://fonts.googleapis.com" });
    const directives = [...new Set(widened.widened.map((w) => w.directive))];
    for (const directive of ['style-src', 'font-src', ...DIRECTIVES_COVERED]) {
      assert.ok(directives.includes(directive), `le repli gouverne aussi ${directive}`);
    }
    assert.ok(
      widened.widened.every((w) => w.via === 'default-src'),
      'et chaque ligne dit QUELLE directive a tranché',
    );
  });

  it('une directive sans jetons NI repli n’est pas silencieuse : elle autorise TOUT', () => {
    const policy = auditPolicy({ name: 'web', csp: "script-src 'self'" });
    assert.ok(policy.unrestricted.includes('img-src'), 'sans default-src, img-src n’est bornée par rien');
    assert.ok(policy.unrestricted.includes('connect-src'));
    assert.ok(policy.unrestricted.includes('frame-src'));
    assert.equal(
      policy.unrestricted.includes('form-action'),
      false,
      'form-action n’hérite pas du default-src : son absence n’ouvre rien, et l’inventer serait un faux reproche',
    );
    const report = judgeCspOrigins({ files: [{ path: 'a.css', text: '' }], policies: [{ name: 'web', csp: "script-src 'self'" }] });
    assert.equal(report.ok, false);
  });

  it('une politique ILLISIBLE n’est pas une politique conforme', () => {
    const report = judgeCspOrigins({ files: [{ path: 'a.css', text: '' }], policies: [{ name: 'web', csp: '' }] });
    assert.deepEqual(report.unjudgeable, ['web']);
    assert.equal(report.ok, false, 'un vert sur une politique qu’on n’a pas pu lire serait le faux vert exact');
  });

  it('et un regard vide n’est pas un vert : aucun fichier, ou aucune politique', () => {
    for (const input of [
      { files: [], policies: [{ name: 'web', csp: REAL_CSP }] },
      { files: [{ path: 'a.css', text: '' }], policies: [] },
    ]) {
      const report = judgeCspOrigins(input);
      assert.equal(report.vacuous, true);
      assert.equal(report.ok, false);
    }
  });
});

describe('csp-origins — la source : une valeur non déclarée est refusée, même si l’origine est connue ailleurs', () => {
  it('chaque forme expédiée est lue, et dit la directive qui la gouvernerait', () => {
    const forms: [string, string, string[]][] = [
      ['index.html', '<img src="https://cdn.example.com/a.png" alt="" />', ['img-src']],
      ['index.html', '<iframe src="https://frame.example.com/x"></iframe>', ['frame-src']],
      ['index.html', '<script src="https://cdn.example.com/a.js"></script>', ['script-src']],
      ['index.html', '<video src="https://media.example.com/a.mp4"></video>', ['media-src']],
      ['src/app.ts', "fetch('https://api.example.com/v1')", ['connect-src']],
      ['src/app.ts', "new WebSocket('wss://api.example.com/socket')", ['connect-src']],
      ['src/app.ts', "navigator.sendBeacon('https://api.example.com/beacon')", ['connect-src']],
      ['src/app.ts', "new Worker('https://cdn.example.com/worker.js')", ['worker-src']],
      ['src/app.ts', 'new XMLHttpRequest().open("GET", "https://api.example.com/x")', ['connect-src']],
    ];
    for (const [path, text, directives] of forms) {
      const findings = findExternalRequests({ files: [{ path, text }] });
      assert.equal(findings.length, 1, `${text} doit être lu`);
      assert.deepEqual(findings[0]?.directives, directives, `${text} doit dire sa directive`);
    }
  });

  it('une origine déclarée pour un fichier n’est PAS déclarée pour les autres', () => {
    const declared = JUSTIFIED_ORIGINS.find((e) => e.origin === 'wa.me');
    assert.ok(declared, 'wa.me est déclarée');
    const file = (declared.files ?? [])[0] ?? '';
    const ok = judgeCspOrigins({
      files: [{ path: file, text: "const u = 'https://wa.me/123'" }],
      policies: [{ name: 'web', csp: REAL_CSP }],
    });
    assert.deepEqual(ok.undeclared, [], `déclarée dans ${file} — c’est là qu’elle vit`);

    const elsewhere = judgeCspOrigins({
      files: [{ path: 'src/app/useStudents.ts', text: "const u = 'https://wa.me/123'" }],
      policies: [{ name: 'web', csp: REAL_CSP }],
    });
    assert.equal(elsewhere.ok, false, 'le même lien dans un fichier neuf doit rougir');
    assert.deepEqual(elsewhere.undeclared.map((f) => f.host), ['wa.me']);
    assert.equal(elsewhere.undeclared[0]?.path, 'src/app/useStudents.ts', 'et le rapport dit LEQUEL');
  });

  it('une origine INCONNUE est refusée, et nommée avec sa directive', () => {
    const report = judgeCspOrigins({
      files: [{ path: 'src/a.css', text: 'a { background: url(https://cdn.example.com/bg.png) }' }],
      policies: [{ name: 'web', csp: REAL_CSP }],
    });
    assert.equal(report.ok, false);
    assert.equal(report.undeclared.length, 1);
    assert.equal(report.undeclared[0]?.host, 'cdn.example.com');
    assert.deepEqual(report.undeclared[0]?.directives, ['style-src', 'font-src', 'img-src']);
    assert.equal(report.findings[0]?.justified, false, 'le verdict est porté par la trouvaille elle-même');
  });

  it('un identifiant de namespace est NOMMÉ et n’est jamais une demande', () => {
    const report = judgeCspOrigins({
      files: [{ path: 'public/favicon.svg', text: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"></svg>' }],
      policies: [{ name: 'web', csp: REAL_CSP }],
    });
    assert.equal(report.ok, true, 'un `xmlns` n’est pas une requête : le refuser serait un faux reproche');
    assert.deepEqual(report.findings, [], 'il n’entre pas dans les valeurs à déclarer');
    assert.equal(report.namespaces.length, 1);
    assert.equal(report.namespaces[0]?.url, 'http://www.w3.org/2000/svg');
  });
});

describe('csp-origins — l’arbre réel est propre, et chaque déclaration a une raison', () => {
  it('le corpus déclaré couvre les formes expédiées, sorties de build exclues', () => {
    assert.deepEqual(SHIPPED_SOURCES, ['index.html', 'src', 'public', 'electron']);
    assert.ok(SCANNED_EXTS.includes('.svg'), 'un SVG expédié peut demander une ressource');
    assert.deepEqual(
      POLICY_SOURCES.map((p) => p.file),
      ['vercel.json', 'electron/csp-policy.cjs'],
      'DEUX politiques sont jugées : celle du site (en-tête servi) et celle du poste (module lu par le processus principal) — une politique que personne ne juge est un faux vert',
    );
  });

  it('aucune déclaration n’est muette : chacune porte sa raison, ses fichiers et ses directives', () => {
    assert.ok(JUSTIFIED_ORIGINS.length > 0);
    for (const entry of JUSTIFIED_ORIGINS) {
      assert.ok(String(entry.because ?? '').trim().length > 20, `${entry.origin} : une déclaration sans raison est un trou`);
      assert.ok(Array.isArray(entry.files) && Array.isArray(entry.directives), `${entry.origin} : fichiers et directives sont explicites`);
      assert.equal(
        (entry.files ?? []).length > 0 || (entry.directives ?? []).length > 0,
        true,
        `${entry.origin} : une entrée qui n’autorise ni fichier ni directive ne sert à rien`,
      );
    }
  });

  it('le remède est EN PLACE : la police est auto-hébergée et préchargée', () => {
    assert.ok(existsSync(join(ROOT, 'public/fonts/geist/Geist-Variable.woff2')), 'la police servie par nous existe');
    const html = read('index.html');
    assert.match(html, /rel="preload"[^>]*\/fonts\/geist\/Geist-Variable\.woff2/, 'le document la précharge');
    assert.match(read('src/assets/fonts/geist.css'), /@font-face/);
  });

  it('le corpus réel ne contient AUCUNE valeur non déclarée, et la politique ne s’élargit pas', () => {
    const patch = [
      'index.html',
      'src/index.css',
      'src/assets/fonts/geist.css',
      'src/main.tsx',
      'src/app/useParents.ts',
      'electron/main.cjs',
      'electron/embedded-links.cjs',
      'electron/public-origin.cjs',
      'electron/updater-policy.cjs',
      'electron/csp-policy.cjs',
      'public/favicon.svg',
    ].map((path) => ({ path, text: MASK_LIKE_THE_CLI(path) }));
    const report = judgeCspOrigins({ files: patch, policies: [{ name: 'web (vercel.json)', csp: REAL_CSP }] });

    assert.deepEqual(report.undeclared, [], 'l’état mesuré est vert — et c’est cet état-là que la garde tient');
    assert.equal(report.ok, true);
    assert.deepEqual(report.widened, []);
    assert.deepEqual(report.unrestricted, [], 'la politique a un default-src : aucune directive n’est sans limite');
    assert.ok(report.findings.length > 0, 'et le corpus lu contient bien des valeurs, sinon ce vert ne prouverait rien');
    assert.ok(report.namespaces.some((n) => n.path === 'public/favicon.svg'));
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
    assert.match(values[0] ?? '', /connect-src 'self' /, 'et elle nomme la base partagée');
    const policy = auditPolicy({ name: 'web', csp: values[0] });
    assert.deepEqual(policy.widened, []);
    assert.deepEqual(policy.unrestricted, []);
  });
});

describe('check:csp-origins — la commande elle-même, telle qu’elle est écrite', () => {
  const source = read('scripts/check-csp-origins.mjs');
  const code = maskComments(source);
  const pkg = JSON.parse(read('package.json'));

  it('elle existe sous son nom, et tourne dans la chaîne locale (une seconde, sans réseau)', () => {
    assert.equal(pkg.scripts['check:csp-origins'], 'node scripts/check-csp-origins.mjs');
    assert.match(pkg.scripts['lint:chain'], /node scripts\/check-csp-origins\.mjs/, 'la chaîne la lance sur chaque commit');
    assert.equal(
      pkg.scripts['check:font-origins'],
      undefined,
      'l’ancien nom ne doit pas survivre : une garde qui change de portée change de nom',
    );
  });

  it('elle blanchie la prose : un commentaire qui CITE l’URL n’est pas une infraction', () => {
    assert.match(source, /maskComments/, 'le blanchiment est ce qui rend la règle citable sans se faire accuser');
    const cited = '/* ne jamais réintroduire @import url(https://fonts.googleapis.com/css2?family=Geist) */\n';
    assert.equal(findExternalRequests({ files: [{ path: 'src/a.css', text: cited }] }).length, 1);
    assert.deepEqual(findExternalRequests({ files: [{ path: 'src/a.css', text: maskComments(cited) }] }), []);
  });

  it('elle refuse de verdir sans corpus ni politique, et rougit sur une valeur non déclarée', () => {
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

  it('son aide dit les DEUX remèdes : servir soi-même, ou déclarer avec sa raison', () => {
    assert.match(source, /auto-héberger/i);
    assert.match(source, /Élargir la CSP n.est jamais le remède/);
  });
});

describe('l’inventaire des immunités — un contrôle non déclaré fait échouer la chaîne', () => {
  it('check-csp-origins.mjs s’y déclare, avec ses deux immunités prouvées', () => {
    const entry = GUARD_INVENTORY.find((e: { check: string }) => e.check === 'check-csp-origins.mjs') as
      | { needs: string[] }
      | undefined;
    assert.ok(entry, 'un contrôle non déclaré n’a pas d’immunités prouvées');
    assert.deepEqual(entry.needs, [IMMUNITY.NON_VACUOUS, IMMUNITY.PROSE_BLIND]);
    assert.equal(
      GUARD_INVENTORY.some((e: { check: string }) => e.check === 'check-font-origins.mjs'),
      false,
      'l’entrée de l’ancien nom doit disparaître avec lui',
    );
  });
});
