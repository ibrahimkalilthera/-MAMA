// Suite for scripts/lib/test-integrity.mjs + its gate (scripts/check-test-integrity.mjs).
//
// The gate exists to catch suites that cannot fail — an inert `mock.module()`, a
// platform branch asserted without injecting the platform, a suite skipped on
// one OS. Every rule is therefore tested on FIXTURES (a throwaway repo in a temp
// dir), positive AND negative: a rule nobody can trigger is decoration, and a
// rule that fires on legitimate code is worse than no rule at all — people learn
// to route around it.
//
// The last case is the calibration one: the real repository, analysed as it is,
// must come out clean. Add a neutralized suite and this test goes red before CI
// even reads the gate's own output.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const { analyzeRepo, stripComments, collectSpecifiers } = await import(
  '../scripts/lib/test-integrity.mjs'
);

/** Build a throwaway repo from `{ 'relative/path': 'content' }` and return its root. */
function fixture(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'mama-integrity-'));
  for (const [rel, content] of Object.entries(files)) {
    const file = join(dir, rel);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, content);
  }
  return dir;
}

const rulesOf = (dir: string): string[] =>
  (analyzeRepo({ root: dir }).findings as { rule: string }[]).map((f) => f.rule);

const withFixture = (files: Record<string, string>, run: (rules: string[], dir: string) => void) => {
  const dir = fixture(files);
  try {
    run(rulesOf(dir), dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
};

const OK = `import assert from 'node:assert/strict';\n`;
const SUITE = (body: string) => `import { describe, it } from 'node:test';\n${OK}${body}\n`;

describe('test-integrity — mocks', () => {
  const SUT_PLAIN = `import { join } from 'node:path';\nexport const thing = () => join('a', 'b');\n`;

  it('signale un mock que personne ne charge (le mock ne peut rien changer)', () => {
    withFixture(
      {
        'scripts/thing.mjs': SUT_PLAIN,
        'tests/x.test.ts':
          `import { it, mock } from 'node:test';\n${OK}` +
          `mock.module('node:child_process', { namedExports: { spawn: () => null } });\n` +
          `const { thing } = await import('../scripts/thing.mjs');\n` +
          `it('works', () => { assert.equal(thing(), 'a/b'); });\n`,
      },
      (rules) => assert.deepEqual(rules, ['mock-orphan']),
    );
  });

  it('accepte le même mock quand le module testé charge bien ce module', () => {
    withFixture(
      {
        'scripts/thing.mjs': `import { spawn } from 'node:child_process';\nexport const thing = () => !!spawn;\n`,
        'tests/x.test.ts':
          `import { it, mock } from 'node:test';\n${OK}` +
          `mock.module('node:child_process', { namedExports: { spawn: () => null } });\n` +
          `const { thing } = await import('../scripts/thing.mjs');\n` +
          `it('works', () => { assert.equal(thing(), false); });\n`,
      },
      (rules) => assert.deepEqual(rules, []),
    );
  });

  it('signale un mock vide — il n’enregistre rien, donc il ne change rien', () => {
    withFixture(
      {
        'scripts/thing.mjs': `import { readFileSync } from 'node:fs';\nexport const thing = () => !!readFileSync;\n`,
        'tests/x.test.ts':
          `import { it, mock } from 'node:test';\n${OK}` +
          `mock.module('node:fs', {});\n` +
          `const { thing } = await import('../scripts/thing.mjs');\n` +
          `it('works', () => { assert.equal(thing(), true); });\n`,
      },
      (rules) => assert.deepEqual(rules, ['mock-empty']),
    );
  });

  it('signale aussi `namedExports: {}` (la forme déguisée du mock vide)', () => {
    withFixture(
      {
        'scripts/thing.mjs': `import { readFileSync } from 'node:fs';\nexport const thing = () => !!readFileSync;\n`,
        'tests/x.test.ts':
          `import { it, mock } from 'node:test';\n${OK}` +
          `mock.module('node:fs', { namedExports: {} });\n` +
          `const { thing } = await import('../scripts/thing.mjs');\n` +
          `it('works', () => { assert.equal(thing(), true); });\n`,
      },
      (rules) => assert.deepEqual(rules, ['mock-empty']),
    );
  });

  it('un mock désactivé en commentaire n’est jamais un constat', () => {
    withFixture(
      {
        'scripts/thing.mjs': `import { join } from 'node:path';\nexport const thing = () => join('a', 'b');\n`,
        'tests/x.test.ts':
          `import { it } from 'node:test';\n${OK}` +
          `const url = 'http://localhost/';\n` +
          `// mock.module('node:child_process', {});\n` +
          `const { thing } = await import('../scripts/thing.mjs');\n` +
          `it('works', () => { assert.equal(thing(), 'a/b'); assert.ok(url.startsWith('http')); });\n`,
      },
      (rules) => assert.deepEqual(rules, []),
    );
  });
});

describe('test-integrity — plateformes', () => {
  const SUT_WIN = `export function run({ platform = process.platform } = {}) {\n  return platform === 'win32' ? 'powershell' : 'sh';\n}\n`;

  it('signale une suite qui exerce la branche d’un OS sans injecter la plateforme', () => {
    withFixture(
      {
        'scripts/lib/win.mjs': SUT_WIN,
        'tests/x.test.ts': SUITE(
          `const { run } = await import('../scripts/lib/win.mjs');\n` +
            `describe('run', () => { it('win32', () => { assert.equal(run(), 'powershell'); }); });`,
        ),
      },
      (rules) => assert.deepEqual(rules, ['platform-not-injected']),
    );
  });

  it('accepte la même suite dès que la plateforme est injectée', () => {
    withFixture(
      {
        'scripts/lib/win.mjs': SUT_WIN,
        'tests/x.test.ts': SUITE(
          `const { run } = await import('../scripts/lib/win.mjs');\n` +
            `describe('run', () => { it('win32', () => { assert.equal(run({ platform: 'win32' }), 'powershell'); }); });`,
        ),
      },
      (rules) => assert.deepEqual(rules, []),
    );
  });

  it('ne réclame rien pour un module à plateforme testé sur du logique pure', () => {
    // Calibration : sans littéral de plateforme, la suite ne prétend rien sur
    // l'OS — l'obligation d'injecter serait du bruit, et le bruit se contourne.
    withFixture(
      {
        'scripts/lib/win.mjs': SUT_WIN,
        'tests/x.test.ts': SUITE(
          `const { run } = await import('../scripts/lib/win.mjs');\n` +
            `describe('run', () => { it('rend une chaîne', () => { assert.equal(typeof run(), 'string'); }); });`,
        ),
      },
      (rules) => assert.deepEqual(rules, []),
    );
  });

  it('signale un saut de suite piloté par l’OS, et l’accepte une fois déclaré', () => {
    const files = (marker: string) => ({
      'tests/x.test.ts':
        `import { describe, it } from 'node:test';\n${OK}` +
        `${marker}\n` +
        `describe('shim .cmd', { skip: process.platform !== 'win32' }, () => {\n` +
        `  it('forwarde', () => { assert.ok(true); });\n});\n`,
    });
    withFixture(files('// pas de déclaration'), (rules) =>
      assert.deepEqual(rules, ['platform-skip-undeclared']),
    );
    withFixture(files('// @platform-skip : le shim EST un .cmd, il exige cmd.exe.'), (rules) =>
      assert.deepEqual(rules, []),
    );
  });

  it('signale une assertion neutralisée par un `return` conditionnel, et l’accepte déclarée', () => {
    const files = (marker: string) => ({
      'tests/x.test.ts':
        `import { describe, it } from 'node:test';\n${OK}` +
        `${marker}\n` +
        `describe('bits de mode', () => {\n` +
        `  it('exécutable', () => {\n` +
        `    if (process.platform === 'win32') return;\n` +
        `    assert.ok(true);\n  });\n});\n`,
    });
    withFixture(files('// rien'), (rules) => assert.deepEqual(rules, ['platform-guard-undeclared']));
    withFixture(files('// @platform-guard : les bits de mode n’existent pas sur Windows.'), (rules) =>
      assert.deepEqual(rules, []),
    );
  });

  it('ne confond pas une simple lecture de process.platform avec une neutralisation', () => {
    withFixture(
      {
        'tests/x.test.ts': SUITE(
          `const host = process.platform;\n` +
            `describe('hôte', () => { it('nomme l’OS', () => { assert.ok(typeof host === 'string'); }); });`,
        ),
      },
      (rules) => assert.deepEqual(rules, []),
    );
  });
});

describe('test-integrity — inertie générale', () => {
  it('signale une suite sans aucune assertion', () => {
    withFixture(
      { 'tests/x.test.ts': `import { it } from 'node:test';\nit('ne vérifie rien', () => {});\n` },
      (rules) => assert.deepEqual(rules, ['no-assertion']),
    );
  });
});

describe('test-integrity — analyse', () => {
  it('les commentaires sont retirés sans casser les chaînes (les spécifieurs y vivent)', () => {
    const src = `const url = 'http://localhost/';\n// mock.module('node:fs', {})\n/* mock.module('node:os', {}) */\nconst x = 1;\n`;
    const stripped = stripComments(src);
    assert.match(stripped, /'http:\/\/localhost\/'/, 'la chaîne doit survivre intacte');
    assert.doesNotMatch(stripped, /mock\.module/, 'aucun mock ne doit subsister');
  });

  it('le texte d’un fixture (template literal) n’est jamais pris pour du code', () => {
    // Le gate lit du texte, pas un AST. Sans cette frontière, une suite qui
    // FABRIQUE des suites — celle-ci — s’accuse elle-même : constat réel du
    // premier run, d’où le masquage du contenu des template literals.
    withFixture(
      {
        'scripts/thing.mjs': `import { spawn } from 'node:child_process';\nexport const thing = () => !!spawn;\n`,
        'tests/x.test.ts': SUITE(
          `const asData = \`mock.module('node:fs', {})\`;\n` +
            `const guardData = \`if (process.platform === 'win32') return;\`;\n` +
            `describe('fixture', () => { it('reste du texte', () => { assert.equal(typeof asData, 'string'); assert.equal(typeof guardData, 'string'); }); });`,
        ),
      },
      (rules) => assert.deepEqual(rules, []),
    );
  });

  it('résout les spécifieurs, y compris les imports dynamiques et de type', () => {
    const specs = collectSpecifiers(
      `import { a } from 'node:path';\nimport type { B } from '../src/lib/types';\nexport type { C } from './c';\nconst d = await import('../scripts/thing.mjs');\n`,
    );
    assert.ok(specs.includes('node:path'));
    assert.ok(specs.includes('../scripts/thing.mjs'), 'l’import dynamique compte (c’est lui qui charge le SUT)');
    assert.ok(!specs.some((s) => s.includes('types')), 'un import de type ne charge rien');
  });

  it('le dépôt RÉEL est propre (calibration : le gate ne rougit pas du code légitime)', () => {
    const report = analyzeRepo({ root });
    assert.deepEqual(report.findings, [], 'une suite neutralisée est peut-être apparue');
    assert.ok(report.suites > 60, `seulement ${report.suites} suites analysées — le scan est cassé`);
    assert.ok(report.mocks > 10, `seulement ${report.mocks} mocks analysés`);
    assert.ok(
      report.declaredSkips.some((s: string) => s.includes('git-shim.test.ts')),
      'le saut Windows de git-shim doit rester déclaré ET affiché dans le résumé',
    );
  });

  it('le gate est branché dans la chaîne lint (pre-commit, pre-push, CI)', () => {
    const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
    const chain = [pkg.scripts.lint, pkg.scripts['lint:chain']].join(' && ');
    assert.match(chain, /node scripts\/check-test-integrity\.mjs/);
  });
});
