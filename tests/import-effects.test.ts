// Suite for scripts/lib/import-effects.mjs + the gate that runs it.
//
// The subject is an incident that lasted one push and blamed the wrong
// automation: `npm test` imports the Dependabot script to test its decision
// loop, that script ran `main()` at the top level, and without a token it
// PRINTED the inaction annotation — into the log of the test job, which
// `npm run check:automations` re-reads. The audit then declared `Quality &
// performance guard` "green without having acted", on the strength of a suite
// that merely talked about Dependabot.
//
// Two halves are locked here, and the second one cost two corrections:
//   1. the FUNNEL — a module a test imports must not reach outside itself while
//      being imported (log, disk, network, process, timers);
//   2. the BOUNDARY — pure module-scope computation (`join(…)`, `new Set([…])`,
//      `fileURLToPath(import.meta.url)`) is not an effect. The first version
//      flagged ~80 such lines across the repo, and a gate that accuses correct
//      code is not a gate. The guard's three written forms are recognised, and
//      the guard is INHERITED through nested `if`s — forgetting that flagged
//      `orphan-guard.mjs` and `verify-anon-rls.mjs`, whose spawn/fetch sit inside
//      an `if` nested under the entry guard.
// Plain-node suite: no file I/O except reading the repo for the real-corpus case.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  formatImportEffectsReport,
  importEffects,
  inspectImportEffects,
} from '../scripts/lib/import-effects.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const calls = (text: string) => importEffects(text, { file: 'x.mjs' }).map((f) => f.call);

describe('les effets à l’import — ce qui atteint l’extérieur', () => {
  it('un `main()` de niveau supérieur est un effet (l’incident, tel quel)', () => {
    // Le fichier réel DÉFINIT `main` puis l'appelle au niveau supérieur : c'est
    // cette paire qui est jugée. Un `main()` sans définition dans la même unité
    // est un appel étranger, et aucune analyse locale ne peut savoir ce qu'il
    // écrit — la liste d'effets, elle, ne voit que les écritures directes.
    const text = [
      'async function main() {',
      "  console.log('déclaration');",
      '}',
      'main().catch((err) => fail(err?.message ?? String(err)));',
      '',
    ].join('\n');
    const found = importEffects(text, { file: 'x.mjs' });
    assert.equal(found.length, 1, `un seul constat, reçu : ${found.map((f) => f.call).join(' | ')}`);
    assert.match(found[0].call, /^main\(\)/);
    assert.match(found[0].why, /appelle la fonction/);
    assert.equal(found[0].line, 4, 'et il pointe la ligne de l’appel, pas celle de la définition');
  });

  it('les trois formes du garde d’entrée sont reconnues', () => {
    const body = "  console.log('déclaration');\n  process.exit(0);\n";
    const regex = `if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {\n${body}}\n`;
    const variable = `const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;\nif (isMain) {\n${body}}\n`;
    const fn =
      'function invokedDirectly() {\n  return process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;\n}\n' +
      `if (invokedDirectly()) {\n${body}}\n`;
    for (const [label, text] of [['regex', regex], ['variable', variable], ['fonction', fn]] as const) {
      assert.deepEqual(calls(text), [], `la forme « ${label} » doit être reconnue comme le garde`);
    }
  });

  it('le garde se transmet aux `if` imbriqués (deux fichiers accusés à tort)', () => {
    // Reproduit `scripts/lib/orphan-guard.mjs` : le spawn vit sous `if (isMain)`
    // PUIS sous `if (args[0] === '--relay')`. La première version perdait le
    // garde au second niveau et accusait le fichier.
    const text = [
      'const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;',
      'if (isMain) {',
      "  const args = process.argv.slice(2);",
      "  if (args[0] === '--relay') {",
      "    const guard = spawn(process.execPath, ['x'], { detached: true });",
      '  }',
      '}',
      '',
    ].join('\n');
    assert.deepEqual(calls(text), [], 'un garde hérité doit survivre à un `if` imbriqué');
  });

  it('le `else` d’un garde n’est PAS protégé', () => {
    // Un garde ne protège que son `then` : ce qui s'exécute quand nous ne sommes
    // pas le programme est exactement le chemin d'import.
    const text =
      'if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();\n' +
      "else console.error('importé');\n";
    assert.deepEqual(calls(text), ["console.error('importé')"]);
  });

  it('le calcul pur au niveau supérieur n’est pas un effet (sinon le garde est du bruit)', () => {
    const text = [
      "import { join, dirname } from 'node:path';",
      "const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');",
      "const KNOWN = new Set(['a', 'b']);",
      'const RE = /x/g;',
      'const TABLE = Object.freeze({ a: 1 });',
      "const nested = KNOWN.has('a') ? pick() : null;",
      '',
    ].join('\n');
    assert.deepEqual(calls(text), [], 'ces lignes sont au niveau supérieur de presque tout le dépôt');
  });

  it('la règle est une liste d’effets observables, pas une preuve d’innocuité — et c’est assumé', () => {
    // Un appel inconnu (`build()`) n'est pas jugé : on ne peut pas décider de
    // l'extérieur s'il écrit. Ce que la liste couvre, c'est la classe mesurée —
    // un module qui parle au journal, au disque, au réseau, à un processus ou à
    // une horloge. L'incident lui-même (un `console.log` de niveau supérieur)
    // tombe dedans, et le corpus réel de ce dépôt est vérifié à chaque run.
    assert.deepEqual(calls('const x = build();\n'), []);
    assert.deepEqual(calls("build({ log: console.info });\n"), [], 'le nom étranger porte l’écriture : assumé');
    assert.deepEqual(calls("const x = build();\nconsole.info('ok');\n"), ["console.info('ok')"]);
  });

  it('un corps de fonction attend son appel : aucun effet à l’import', () => {
    const text = [
      'async function main() {',
      "  console.log('travail');",
      '  await fetch(url);',
      '  writeFileSync(p, data);',
      '}',
      'const helper = () => process.exit(1);',
      '',
    ].join('\n');
    assert.deepEqual(calls(text), []);
  });

  it('écrire sur le disque, le réseau, un processus ou une horloge compte', () => {
    const text = [
      "import { writeFileSync } from 'node:fs';",
      'fs.appendFileSync(p, x);',
      'spawnSync(cmd, args);',
      'fetch(url);',
      'setInterval(tick, 1000);',
      'new Worker(url);',
      'process.on(SIG, handler);',
      '',
    ].join('\n');
    const why = importEffects(text, { file: 'x.mjs' }).map((f) => f.why);
    assert.equal(why.length, 6, `les six doivent être signalés, reçu : ${why.join(' | ')}`);
    assert.match(why[0], /disque/);
    assert.match(why[1], /processus/);
    assert.match(why[2], /réseau/);
    assert.match(why[3], /après l’import/);
    assert.match(why[4], /fil/);
    assert.match(why[5], /processus/);
  });
});

describe('inspectImportEffects — la portée, et l’anti-vacuité', () => {
  it('ne juge QUE les modules qu’un test importe', () => {
    const files = [
      { file: 'scripts/imported.mjs', text: "console.log('boom');\n" },
      { file: 'scripts/never-imported.mjs', text: "console.log('libre');\n" },
    ];
    const { findings, scanned } = inspectImportEffects({
      files,
      importedBy: { 'scripts/imported.mjs': ['a.test.ts'] },
    });
    assert.equal(scanned.modules, 1, 'un script jamais importé garde le droit de tout faire au niveau supérieur');
    assert.equal(findings.length, 1);
    assert.deepEqual(findings[0].importedBy, ['a.test.ts']);
  });

  it('zéro module examiné est un ÉCHEC, jamais un vert', () => {
    const result = inspectImportEffects({ files: [], importedBy: {} });
    assert.equal(result.scanned.modules, 0);
    const report = formatImportEffectsReport(result);
    assert.match(report[0], /ne prouve rien/);
  });

  it('le rapport nomme le fichier, la ligne et l’importateur', () => {
    const result = inspectImportEffects({
      files: [{ file: 'scripts/x.mjs', text: "console.log('boom');\n" }],
      importedBy: { 'scripts/x.mjs': ['x.test.ts'] },
    });
    const report = formatImportEffectsReport(result).join('\n');
    assert.match(report, /scripts\/x\.mjs:1:1/);
    assert.match(report, /x\.test\.ts/);
    assert.match(report, /invokedDirectly/);
  });
});

describe('le corpus réel : les modules que les suites importent', () => {
  /** Les modules que les tests importent vraiment, résolus (comme le CLI). */
  function importedModules() {
    const specs = new Map<string, string[]>();
    for (const test of readdirSync(join(root, 'tests')).filter((f) => /\.test\.tsx?$/.test(f))) {
      const text = readFileSync(join(root, 'tests', test), 'utf8');
      for (const m of text.matchAll(/(?:from\s*|\bimport\s*\()\s*['"]([^'"]+)['"]/g)) {
        const spec = m[1];
        if (spec.startsWith('node:') || !/^\.{1,2}\//.test(spec)) continue;
        const target = resolve(join(root, 'tests'), spec);
        // Un exemple cité dans une fixture n'est pas un import : seule
        // l'existence du fichier tranche (le balayage naïf « trouvait »
        // scripts/thing.mjs, qui n'existe pas).
        try {
          if (!statSync(target).isFile()) continue;
        } catch {
          continue;
        }
        const key = relative(root, target).split(sep).join('/');
        (specs.get(key) ?? specs.set(key, []).get(key)!).push(test);
      }
    }
    return specs;
  }

  it('aucun ne travaille à l’import (c’est l’incident, vu de loin)', () => {
    const specs = importedModules();
    assert.ok(specs.size >= 20, `attendu >= 20 modules importés, lu ${specs.size}`);
    const result = inspectImportEffects({
      files: [...specs.keys()].map((file) => ({ file, text: readFileSync(join(root, file), 'utf8') })),
      importedBy: Object.fromEntries(specs),
    });
    assert.deepEqual(formatImportEffectsReport(result).filter((l) => l.startsWith('❌')), []);
  });

  it('le CLI écarte les exemples cités par existence du fichier, et ne peut pas être vide', () => {
    const cli = readFileSync(join(root, 'scripts', 'check-import-effects.mjs'), 'utf8');
    assert.match(cli, /statSync\(target\)/, 'un exemple cité dans une fixture ne doit pas être pris pour un import');
    assert.match(cli, /scanned\.modules > 0/, 'zéro module lu ne doit jamais sortir en 0');
    const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
    assert.match(pkg.scripts['check:import-effects'], /check-import-effects\.mjs/);
    // La chaîne qualité est ce qui fait tourner ce garde sur le runner : un
    // garde câblé nulle part est un garde décoratif.
    assert.match(pkg.scripts['lint:chain'], /node scripts\/check-import-effects\.mjs/);
  });
});
