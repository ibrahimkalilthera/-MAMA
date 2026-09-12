// Suite for scripts/lib/source-text.mjs — the layer that turns a source file
// into "code only" — plus `assertScanned`, its refusal of an empty scan.
//
// Every contract locked here was paid for by a real defect, and the two worst
// ones were structural, not cosmetic:
//
//   • a naive comment strip reads the `//` of `'https://…'` as a comment and
//     deletes the code that follows it on the same line — a gate then judges
//     neither the string nor the code;
//   • the TypeScript scanner ALONE desynchronizes on a shape this repository
//     contains: a template WITH an interpolation followed by a template whose
//     content starts with `//`. After `${…}`, the `}` must be rescanned as a
//     template tail (the parser does it); a token-by-token scan does not, so the
//     next template is read as CODE and its `//` as a real comment. Measured
//     both ways on the repository: a 70-line comment got swallowed into one
//     template token (so the emoji gate stopped seeing its prose — it accused a
//     comment), and fixture text inside a template got exposed (so the
//     test-integrity gate accused the wrong file).
//
// The fixtures below are COMPOSED rather than pasted from the repository, for
// the same reason the gate-sentinels suite composes its own: a suite that
// carries a real violation in its own source is a suite that fails the gate it
// feeds.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { lineAt, lineIndex, listFiles, maskComments, maskProse } from '../scripts/lib/source-text.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

/** A template literal, without writing a backtick in this file's own code. */
const TICK = String.fromCharCode(96);

describe('source-text — lire du code, pas de la prose', () => {
  it('ne bouge ni la longueur ni les lignes : un décalage désigne la bonne ligne', () => {
    const src = [
      "const url = 'https://exemple.fr'; // un commentaire",
      '',
      '/* un bloc',
      '   sur trois lignes */',
      `const t = ${TICK}bonjour${TICK};`,
    ].join('\n');

    for (const options of [{}, { literals: false }, { literals: 'templates' as const }]) {
      const masked = maskProse(src, options);
      assert.equal(masked.length, src.length, 'la longueur ne bouge pas');
      assert.equal(
        masked.split('\n').length,
        src.split('\n').length,
        'les sauts de ligne restent',
      );
    }
  });

  it('une URL dans une chaîne ne fait pas disparaître le code qui suit', () => {
    const src = "const url = 'https://exemple.fr'; const apres = 1;\n";
    const masked = maskProse(src);
    assert.doesNotMatch(masked, /exemple\.fr/, 'le contenu de la chaîne est blanchi');
    assert.match(masked, /const apres = 1;/, 'le code de la même ligne est toujours lu');
  });

  it('la prose est blanchie, le code ne l’est pas', () => {
    const src = '// ce commentaire CITE `as any` et ne l’utilise pas\nconst x = 1;\n';
    const masked = maskProse(src);
    assert.doesNotMatch(masked, /as any/, 'un contrôle ne lit pas sa propre prose');
    assert.match(masked, /const x = 1;/);
  });

  it('un `//` DANS un gabarit est du contenu, pas un commentaire', () => {
    // La forme exacte mesurée : les fixtures de la suite du gate d'intégrité
    // ressemblent à `// mock.module(…)` écrit dans un gabarit.
    const src = [
      "const fixture = 'tests/x.test.ts':",
      `  ${TICK}// mock.module('node:fs', {});${TICK} +`,
      `  ${TICK}const apres = 1;${TICK};`,
      'const vraiment = 2;',
      '',
    ].join('\n');

    const masked = maskComments(src);
    assert.match(masked, /const vraiment = 2;/, 'le code après la fixture reste lisible');
    assert.match(masked, /const apres = 1;/, 'le gabarit est du code, son contenu est de la donnée');
  });

  it('un commentaire RÉEL après un gabarit interpolé reste un commentaire', () => {
    // Le cas mesuré : une interpolation précède, et le scanner seul croyait
    // ensuite lire un gabarit de 70 lignes — d'où un commentaire invisible.
    const src = [
      "const label = danger?.armedLabel || " + TICK + '${confirmLabel} ?' + TICK + ';',
      `// focus it explicitly (resolves to the ✕ when the input is absent).`,
      'useFocusTrap(open, () => rootRef.current);',
      '',
    ].join('\n');

    const masked = maskProse(src);
    assert.match(masked, /useFocusTrap\(open/, 'le code après le commentaire est lu');
    assert.doesNotMatch(masked, /✕/, 'la prose du commentaire est blanchie');
    assert.doesNotMatch(masked, /focus it explicitly/);
  });

  it('ne blanchit que les gabarits quand on le demande', () => {
    const src = `const nom = 'bonjour';\nconst t = ${TICK}bonjour${TICK};\n`;
    const masked = maskProse(src, { literals: 'templates' });
    assert.match(masked, /'bonjour'/, 'une chaîne ordinaire reste visible');
    assert.doesNotMatch(masked, new RegExp(`${TICK}bonjour${TICK}`), 'le gabarit est blanchi');
  });

  it('dit OÙ est le problème, dans le texte d’origine', () => {
    const src = 'const a = 1;\nconst b = 2;\nconst c = 3;\n';
    const at = lineIndex(src);
    assert.equal(at(src.indexOf('const b')), 2);
    assert.equal(at(src.indexOf('const c')), 3);
    assert.equal(lineAt(src, 3), 'const c = 3;');
  });

  it('un contrôle sans rien à lire sort en 2, en nommant sa racine', () => {
    const empty = mkdtempSync(join(tmpdir(), 'mama-vacuum-'));
    try {
      assert.deepEqual(listFiles(empty, {}), [], 'aucun fichier dans une racine vide');
      let status: number | undefined;
      let stderr = '';
      try {
        execFileSync(process.execPath, ['scripts/check-forbidden-any.mjs'], {
          cwd: root,
          encoding: 'utf8',
          env: { ...process.env, CHECK_FORBIDDEN_ANY_ROOT: empty },
          stdio: ['ignore', 'pipe', 'pipe'],
        });
      } catch (err) {
        const failure = err as { status?: number; stderr?: string };
        status = failure.status;
        stderr = failure.stderr ?? '';
      }
      // 2 et non 1 : ce n'est pas une violation trouvée, c'est une vérification
      // impossible — et un contrôle muet sur zéro fichier ressemble exactement à
      // un contrôle vert.
      assert.equal(status, 2, 'une racine vide est un échec, pas un vert');
      assert.match(stderr, /Rien à vérifier/);
      assert.match(stderr, /0 fichier/);
    } finally {
      rmSync(empty, { recursive: true, force: true });
    }
  });

  it('les scans de source passent tous par la même couche', () => {
    const consumers = [
      'check-forbidden-any.mjs',
      'check-date-windows.mjs',
      'check-no-emoji-icons.mjs',
      'check-jsx-i18n.mjs',
      'check-css-selectors.mjs',
      'check-line-budget.mjs',
      'check-test-harness.mjs',
    ];
    for (const file of consumers) {
      const source = readFileSync(join(root, 'scripts', file), 'utf8');
      assert.match(
        source,
        /from '\.\/lib\/source-text\.mjs'/,
        `${file} doit lire par la couche partagée`,
      );
    }
  });
});
