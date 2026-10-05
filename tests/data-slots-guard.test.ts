// Suite for scripts/check-data-slots.mjs — the gate that keeps a `data-slot`
// marker consistent between the component that DECLARES it and the selectors
// that CITE it (tests and styles).
//
// Why this gate exists: the name lives in two places — the component and the
// selector — and nothing stopped a typo (`settings-backups`), a one-sided rename
// (`app-header` → `app-head`), or two components claiming the same name. All
// three end in a test that hunts a marker nobody paints.
//
// The suite judges the gate the way this repository judges every gate: on
// fabricated fixtures (a rule nobody can trigger is decoration), with the
// prose-as-code trap, the dynamic form that must be ignored, and above all the
// REFUSAL OF VACUITY (no declared marker, or no citation, is exit 2 — never a
// green over nothing).
//
// NOTE — this suite scans `tests/` as its REFERENCE corpus, so it must not paint
// a real-looking `data-slot="x"` in its own source: a fixture built from literal
// strings would be read as a citation of the guard's own test file. The fixtures
// are therefore COMPOSED (`attr`, `sel`, `prefixed`) — the guard sees the
// composed file on disk, never a spurious reference in this source.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { GUARD_INVENTORY, IMMUNITY } from '../scripts/lib/guard-immunity.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const PKG = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));

/** Compose un attribut de déclaration sans peindre un marqueur littéral ici. */
const attr = (value: string) => `data-slot="${value}"`;
/** Compose un sélecteur de valeur `[data-slot="…"]`. */
const sel = (value: string) => `[data-slot="${value}"]`;
/** Compose un sélecteur de préfixe `[data-slot^="…"]`. */
const prefixed = (value: string) => `[data-slot^="${value}"]`;

type Run = { status: number | undefined; stdout: string; stderr: string };

function run(env: Record<string, string> = {}): Run {
  try {
    const stdout = execFileSync(process.execPath, ['scripts/check-data-slots.mjs'], {
      cwd: root,
      encoding: 'utf8',
      env: { ...process.env, ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { status: 0, stdout, stderr: '' };
  } catch (err) {
    const failure = err as { status?: number; stdout?: string; stderr?: string };
    return { status: failure.status, stdout: failure.stdout ?? '', stderr: failure.stderr ?? '' };
  }
}

/** Écrit un arbre `src/` + `tests/` dans un dossier temporaire, lance `fn`. */
function withFixture<T>(files: Record<string, string>, fn: (dir: string) => T): T {
  const dir = mkdtempSync(join(tmpdir(), 'mama-data-slots-'));
  try {
    for (const [name, content] of Object.entries(files)) {
      const full = join(dir, name);
      mkdirSync(dirname(full), { recursive: true });
      writeFileSync(full, content, 'utf8');
    }
    return fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** Lance le garde sur une racine de fixtures (src/ et tests/ dessous). */
const runFixture = (dir: string, tables?: string[]) =>
  run({
    CHECK_DATA_SLOTS_SRC: join(dir, 'src'),
    CHECK_DATA_SLOTS_TESTS: join(dir, 'tests'),
    ...(tables ? { CHECK_DATA_SLOTS_TABLES: tables.join(',') } : {}),
  });

describe('data-slots gate — un marqueur dit la même chose partout', () => {
  it('le dépôt réel est cohérent (déclarations uniques, références résolues)', () => {
    const result = run();
    assert.equal(result.status, 0, `le garde doit passer sur le dépôt : ${result.stderr}`);
    assert.match(result.stdout, /✅ data-slot cohérents/);
  });

  it('une référence à un marqueur que personne ne déclare est accusée (manquant/divergent)', () => {
    withFixture(
      {
        'src/Comp.tsx': `<div ${attr('real')} />\n`,
        'src/base.css': '',
        'tests/ref.test.tsx': "document.querySelector('" + sel('ghost') + "');\n",
      },
      (dir) => {
        const result = runFixture(dir);
        assert.equal(result.status, 1, 'une référence non résolue doit échouer');
        assert.match(result.stderr, /MANQUANT ou DIVERGENT/);
        assert.match(result.stderr, /ghost/);
        assert.match(result.stderr, /ref\.test\.tsx:1/);
      },
    );
  });

  it('un marqueur déclaré deux fois est accusé (dupliqué)', () => {
    withFixture(
      {
        'src/A.tsx': `<div ${attr('dup')} />\n`,
        'src/B.tsx': `<div ${attr('dup')} />\n`,
        'src/base.css': '',
        'tests/ref.test.tsx': "document.querySelector('" + sel('dup') + "');\n",
      },
      (dir) => {
        const result = runFixture(dir);
        assert.equal(result.status, 1);
        assert.match(result.stderr, /DUPLIQUÉ/);
        assert.match(result.stderr, /A\.tsx:1/);
        assert.match(result.stderr, /B\.tsx:1/);
      },
    );
  });

  it('une référence dans une FEUILLE DE STYLE est confrontée aussi', () => {
    withFixture(
      {
        'src/Comp.tsx': `<div ${attr('real')} />\n`,
        'src/base.css': sel('ghost') + ' { color: red; }\n',
        'tests/ref.test.tsx': "document.querySelector('" + sel('real') + "');\n",
      },
      (dir) => {
        const result = runFixture(dir);
        assert.equal(result.status, 1);
        assert.match(result.stderr, /base\.css:1/);
        assert.match(result.stderr, /ghost/);
      },
    );
  });

  it('un préfixe de sélecteur qui ne correspond à aucun marqueur est accusé (préfixe creux)', () => {
    withFixture(
      {
        'src/Comp.tsx': `<div ${attr('app-x')} />\n`,
        'src/base.css': '',
        'tests/ref.test.tsx': "document.querySelectorAll('" + prefixed('zzz-') + "');\n",
      },
      (dir) => {
        const result = runFixture(dir);
        assert.equal(result.status, 1);
        assert.match(result.stderr, /PRÉFIXE/);
        assert.match(result.stderr, /zzz-/);
      },
    );
  });

  it('les formes DYNAMIQUES sont ignorées (elles ne nomment pas un marqueur au repos)', () => {
    withFixture(
      {
        'src/Comp.tsx': '<div data-slot={dyn} />\n<div ' + attr('ok') + ' />\n',
        'src/base.css': '',
        'tests/ref.test.tsx':
          "document.querySelector('" + sel('ok') + "');\nconst t = '" + sel('${x}') + "';\n",
      },
      (dir) => {
        const result = runFixture(dir);
        assert.equal(result.status, 0, `une valeur dynamique ne doit pas fabriquer de divergence : ${result.stderr}`);
      },
    );
  });

  it('la prose qui CITE un marqueur n’est pas une référence', () => {
    withFixture(
      {
        'src/Comp.tsx': '// ' + attr('ghost') + '\n<div ' + attr('real') + ' />\n',
        'src/base.css': '/* ' + sel('ghost') + ' */\n',
        'tests/ref.test.tsx':
          '// ' + attr('ghost') + '\ndocument.querySelector(' + "'" + sel('real') + "'" + ');\n',
      },
      (dir) => {
        const result = runFixture(dir);
        assert.equal(result.status, 0, `un commentaire citant un marqueur ne doit pas être accusé : ${result.stderr}`);
      },
    );
  });

  it('une TABLE partagée est confrontée : un nom de table sans déclaration tombe', () => {
    withFixture(
      {
        'src/Comp.tsx': `<div ${attr('app-shell')} />\n`,
        'src/base.css': '',
        'tests/ref.test.tsx': "document.querySelector('" + sel('app-shell') + "');\n",
        'scripts/lib/appshell-slots.mjs': "export const APPSHELL_SLOTS = ['app-shell', 'app-ghost'];\n",
      },
      (dir) => {
        const result = runFixture(dir, [join(dir, 'scripts/lib/appshell-slots.mjs')]);
        assert.equal(result.status, 1, 'la table dit un nom que personne ne déclare → divergence');
        assert.match(result.stderr, /app-ghost/);
        assert.match(result.stderr, /\(table\)/);
      },
    );
  });

  it('zéro marqueur déclaré est un échec (exit 2), pas un vert sur rien', () => {
    withFixture(
      {
        'src/Comp.tsx': 'const x = 1;\n',
        'src/base.css': '',
        'tests/ref.test.tsx': 'const y = 2;\n',
      },
      (dir) => {
        const result = runFixture(dir);
        assert.equal(result.status, 2);
        assert.match(result.stderr, /Rien à vérifier/);
      },
    );
  });

  it('zéro référence est un échec (exit 2) — la cohérence n’a rien à confronter', () => {
    withFixture(
      {
        'src/Comp.tsx': `<div ${attr('real')} />\n`,
        'src/base.css': '',
        'tests/ref.test.tsx': 'const y = 2;\n',
      },
      (dir) => {
        const result = runFixture(dir);
        assert.equal(result.status, 2);
        assert.match(result.stderr, /rien à confronter/);
      },
    );
  });

  it('le garde est câblé dans `npm run lint` (chaîne pré-commit + CI)', () => {
    const chain = [PKG.scripts.lint, PKG.scripts['lint:chain']].join(' && ');
    assert.match(chain, /node scripts\/check-data-slots\.mjs/);
  });

  it('le garde est déclaré dans l’inventaire d’immunités', () => {
    const entry = GUARD_INVENTORY.find((e: { check: string }) => e.check === 'check-data-slots.mjs');
    assert.ok(entry, 'un contrôle non déclaré est un échec de check-guard-immunity');
    const needs = (entry as { needs?: string[] }).needs ?? [];
    assert.ok(needs.includes(IMMUNITY.NON_VACUOUS), 'il doit refuser la vacuité');
    assert.ok(needs.includes(IMMUNITY.PROSE_BLIND), 'il doit blanchir la prose');
  });
});
