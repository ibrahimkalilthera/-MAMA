// Suite for scripts/lib/chain-links.mjs + how scripts/quality-chain.mjs uses it.
//
// The subject is a dependency, not a feature: the chain used to reach its tools
// through `npm run <script>`, so the shell resolved `node`, `eslint`, `tsc` and
// `stylelint` through PATH and the pinned runtime was only guaranteed by the
// ORDER of PATH (the reason node_modules/.bin carries node/npm/npx wrappers at
// all). Every link is now turned into an explicit argv for the node that runs
// the chain.
//
// Two properties are worth more than the rest, and both are asserted here:
//   1. the resolution is READ from the installed packages (`bin`), so the
//      explicit path and the path npm would have used are the same FILE — not a
//      convention that a dependency bump could move;
//   2. a link that cannot be resolved explicitly FAILS. Never a PATH fallback:
//      silently resolving one link the old way would put the whole dependency
//      back, one link at a time — the same rule as the version gate, which
//      refuses a chain that ended up on another runtime.
//
// The real repository is asserted against too (its own lint:chain/test/build
// resolved on the installed tree), because a fabricated `node_modules` can prove
// the parser and only the parser — the lesson the node-layout work paid for.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, isAbsolute, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const { classifyLink, linkLabel, resolveLink, resolveScript, resolveToolEntry } = await import(
  '../scripts/lib/chain-links.mjs'
);

const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));

/** A throwaway project whose node_modules is written from scratch. */
function fakeProject(
  packages: Record<string, { bin?: unknown; name?: string }>,
  deps: { dependencies?: Record<string, string>; devDependencies?: Record<string, string> } = {},
) {
  const dir = mkdtempSync(join(tmpdir(), 'mama-chain-links-'));
  for (const [name, manifest] of Object.entries(packages)) {
    const pkgDir = join(dir, 'node_modules', ...name.split('/'));
    mkdirSync(pkgDir, { recursive: true });
    writeFileSync(
      join(pkgDir, 'package.json'),
      JSON.stringify({ name: name.split('/').pop(), ...manifest }),
    );
    const bin = manifest.bin;
    const entries =
      typeof bin === 'string' ? [bin] : bin && typeof bin === 'object' ? Object.values(bin) : [];
    for (const rel of entries) {
      const file = join(pkgDir, String(rel));
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, '// entrée factice\n');
    }
  }
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'fake', version: '0.0.0', ...deps }));
  return dir;
}

describe('découpage — un maillon par commande', () => {
  it('un `node <script>` est classé comme tel, ses drapeaux intacts', () => {
    const link = classifyLink('node scripts/check-line-budget.mjs --strict');
    assert.deepEqual(link, { kind: 'node', tool: null, args: ['scripts/check-line-budget.mjs', '--strict'] });
  });

  it('toute autre tête est un OUTIL à localiser, jamais une commande à déléguer', () => {
    assert.deepEqual(classifyLink('eslint . --max-warnings 0'), {
      kind: 'tool',
      tool: 'eslint',
      args: ['.', '--max-warnings', '0'],
    });
  });

  it('les guillemets du script sont retirés : stylelint reçoit le motif tel quel', () => {
    // Dans package.json la commande est `stylelint "src/**\/*.css"` ; le shell la
    // passait telle quelle (motif littéral, expansé par stylelint lui-même).
    assert.deepEqual(classifyLink('stylelint "src/**/*.css"')?.args, ['src/**/*.css']);
  });

  it('un segment vide ou une fin de chaîne ne fabrique pas de maillon', () => {
    assert.equal(classifyLink('   '), null);
    assert.equal(classifyLink(''), null);
  });

  it('un maillon est nommé par son script, un outil par son nom', () => {
    assert.equal(linkLabel(classifyLink('node scripts/check-ci-commands.mjs')!), 'check-ci-commands.mjs');
    assert.equal(linkLabel(classifyLink('tsc --noEmit')!), 'tsc');
  });

  it('un motif glob ne nomme pas un maillon (c’est une expansion que node fait lui-même)', () => {
    assert.equal(
      linkLabel(classifyLink('node --import tsx --test "tests/*.test.ts"')!),
      'node --import',
    );
  });

  it('un script réel est découpé sur ses `&&`', () => {
    const plan = resolveScript('node a.mjs && eslint . && node b.mjs --check', { root });
    assert.equal(plan.segments, 3);
    assert.deepEqual(
      plan.links.map((l) => l.label),
      ['a.mjs', 'eslint', 'b.mjs'],
    );
  });
});

describe('résolution explicite — l’entrée est LUE, pas devinée', () => {
  it('un script local devient absolu (l’exécution ne dépend plus du cwd)', () => {
    const { args } = resolveLink(classifyLink('node scripts/check-node-version.mjs')!, { root });
    assert.equal(args.length, 1);
    assert.ok(isAbsolute(args[0]));
    assert.ok(existsSync(args[0]));
  });

  it('un drapeau et un motif glob sont transmis inchangés', () => {
    const { args } = resolveLink(classifyLink('node --test "tests/*.test.ts"')!, { root });
    assert.deepEqual(args, ['--test', 'tests/*.test.ts']);
  });

  it('un outil est résolu par le paquet qui porte son nom', () => {
    const dir = fakeProject({ eslint: { bin: { eslint: 'bin/eslint.js' } } });
    const found = resolveToolEntry({ root: dir, tool: 'eslint' });
    assert.equal(found.source, 'bin');
    assert.ok(found.entry && existsSync(found.entry));
    rmSync(dir, { recursive: true, force: true });
  });

  it('un nom de commande différent du paquet passe par la déclaration (`tsc` ← `typescript`)', () => {
    const dir = fakeProject(
      { typescript: { bin: { tsc: 'bin/tsc', tsserver: 'bin/tsserver' } } },
      { devDependencies: { typescript: '~5.8.2' } },
    );
    const found = resolveToolEntry({ root: dir, tool: 'tsc' });
    assert.equal(found.source, 'bin');
    assert.ok(found.entry?.endsWith(join('typescript', 'bin', 'tsc')), found.entry ?? 'aucune entrée');
    rmSync(dir, { recursive: true, force: true });
  });

  it('un `bin` objet ne fournit QUE ce qu’il déclare (aucune valeur « la première »)', () => {
    const dir = fakeProject(
      { typescript: { bin: { tsserver: 'bin/tsserver' } } },
      { devDependencies: { typescript: '~5.8.2' } },
    );
    const found = resolveToolEntry({ root: dir, tool: 'tsc' });
    assert.equal(found.entry, null, 'tsserver ne prouve pas tsc');
    rmSync(dir, { recursive: true, force: true });
  });

  it('un `bin` chaîne est la commande du paquet, sous son propre nom', () => {
    const withMatch = fakeProject({ toto: { bin: './cli.js' } });
    assert.ok(resolveToolEntry({ root: withMatch, tool: 'toto' }).entry);
    const withOther = fakeProject({ toto: { bin: './cli.js' } });
    assert.equal(resolveToolEntry({ root: withOther, tool: 'zizi' }).entry, null);
    for (const dir of [withMatch, withOther]) rmSync(dir, { recursive: true, force: true });
  });

  it('un paquet absent, ou dont l’entrée déclarée n’existe pas, n’est pas « résolu »', () => {
    const missing = fakeProject({});
    assert.equal(resolveToolEntry({ root: missing, tool: 'eslint' }).entry, null);

    const declared = fakeProject({ eslint: { bin: { eslint: 'bin/eslint.js' } } });
    rmSync(join(declared, 'node_modules', 'eslint', 'bin', 'eslint.js'), { force: true });
    const found = resolveToolEntry({ root: declared, tool: 'eslint' });
    assert.equal(found.entry, null, 'déclaré mais absent du disque = non résolu');
    assert.ok(
      found.tried.some((p) => p.endsWith(join('bin', 'eslint.js'))),
      'l’entrée morte doit être dans les chemins essayés',
    );
    for (const dir of [missing, declared]) rmSync(dir, { recursive: true, force: true });
  });

  it('un manifeste illisible ne fait pas tomber la résolution en silence', () => {
    const dir = fakeProject({ eslint: { bin: { eslint: 'bin/eslint.js' } } });
    const found = resolveToolEntry({
      root: dir,
      tool: 'eslint',
      readPackage: () => {
        throw new Error('EACCES');
      },
    });
    assert.equal(found.entry, null);
    rmSync(dir, { recursive: true, force: true });
  });
});

describe('l’échec est un échec — jamais un repli sur PATH', () => {
  it('un outil introuvable fait échouer le maillon, en nommant les paquets essayés', () => {
    const dir = fakeProject({}, { devDependencies: { eslint: '^10.0.0', typescript: '~5.8.2' } });
    assert.throws(
      () => resolveScript('node a.mjs && eslint .', { root: dir }),
      (error: Error) => {
        assert.match(error.message, /eslint/);
        assert.match(error.message, /paquets essayés : eslint, typescript/);
        assert.match(error.message, /Installez la dépendance/, 'le remède doit être nommé');
        return true;
      },
    );
    rmSync(dir, { recursive: true, force: true });
  });

  it('un script vide est une erreur, pas un vert (un plan vide ne prouve rien)', () => {
    assert.throws(() => resolveScript('', { root }), /aucun maillon lu/);
    assert.throws(() => resolveScript('   ', { root }), /aucun maillon lu/);
  });
});

describe('la chaîne réelle — l’arbre INSTALLÉ, pas un arbre inventé', () => {
  const plans = {
    'lint:chain': resolveScript(pkg.scripts['lint:chain'], { root }),
    test: resolveScript(pkg.scripts.test, { root }),
    build: resolveScript(pkg.scripts.build, { root }),
  };

  it('chaque maillon de la chaîne de lint est lu (anti-vacuité)', () => {
    const segments = String(pkg.scripts['lint:chain']).split('&&').length;
    assert.equal(plans['lint:chain'].segments, segments);
    assert.equal(plans['lint:chain'].links.length, segments, 'aucun `&&` ne doit être sauté');
    assert.ok(plans['lint:chain'].links.length >= 15, 'la chaîne compte au moins 15 maillons');
  });

  it('le programme exécuté est toujours un chemin absolu qui existe', () => {
    for (const [name, plan] of Object.entries(plans)) {
      for (const link of plan.links) {
        const program = link.args[0];
        // Un `node --test …` : le premier argument est un drapeau, il n'y a pas
        // de programme à résoudre (node EST le programme).
        if (program.startsWith('-')) continue;
        assert.ok(isAbsolute(program), `${name} / ${link.label} : « ${program} » n’est pas absolu`);
        assert.ok(existsSync(program), `${name} / ${link.label} : « ${program} » est introuvable`);
      }
    }
  });

  it('un script local résolu ne reste jamais relatif', () => {
    for (const link of plans['lint:chain'].links.filter((l) => l.source === null)) {
      for (const arg of link.args) {
        if (arg.startsWith('-') || !/\.(mjs|cjs|js|ts|tsx)$/i.test(arg)) continue;
        if (arg.includes('*')) continue; // motif glob : c’est node qui l’expanse
        assert.ok(isAbsolute(arg), `« ${arg} » doit être absolu (${link.label})`);
      }
    }
  });

  it('eslint, tsc, stylelint et vite viennent de leur paquet installé', () => {
    const byLabel = new Map(plans['lint:chain'].links.map((l) => [l.label, l]));
    for (const [label, pkgDir] of [
      ['eslint', 'eslint'],
      ['tsc', 'typescript'],
      ['stylelint', 'stylelint'],
    ] as const) {
      const link = byLabel.get(label);
      assert.ok(link, `maillon ${label} absent`);
      assert.equal(link.source, 'bin', `${label} doit venir d’une entrée DÉCLARÉE`);
      assert.ok(
        link.args[0].includes(join('node_modules', pkgDir)),
        `${label} doit pointer dans node_modules/${pkgDir} : ${link.args[0]}`,
      );
    }
    // `vite` n'est plus un maillon du script `build` : la commande passe par le
    // lanceur (`--bin vite`), qui épingle le runtime avant de l'exécuter. C'est
    // donc le même résolveur qu'on interroge — et la propriété qui compte, que
    // l'entrée soit DÉCLARÉE par le paquet, ne change pas.
    const vite = resolveToolEntry({ root, tool: 'vite' });
    assert.equal(vite.source, 'bin', 'vite doit venir d’une entrée DÉCLARÉE');
    assert.ok(
      vite.entry?.includes(join('node_modules', 'vite')),
      `vite doit pointer dans node_modules/vite : ${vite.entry}`,
    );
  });

  it('l’entrée résolue exécute vraiment l’outil, et à la version installée', () => {
    const eslint = plans['lint:chain'].links.find((l) => l.label === 'eslint')!;
    const out = execFileSync(process.execPath, [eslint.entry!, '--version'], { encoding: 'utf8' }).trim();
    const installed = JSON.parse(
      readFileSync(join(root, 'node_modules', 'eslint', 'package.json'), 'utf8'),
    ).version;
    assert.ok(out.endsWith(installed), `eslint --version a rendu « ${out} », attendu ${installed}`);
  });
});

/**
 * Source without comments: an assertion about CODE must not trip on a comment
 * that happens to name the thing being removed (the chain's own header explains
 * what replaced `npm run`, in prose).
 */
const codeOf = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

describe('câblage — la chaîne ne repasse plus par npm ni par PATH', () => {
  const chain = codeOf(readFileSync(join(root, 'scripts', 'quality-chain.mjs'), 'utf8'));

  it('les étapes passent par le résolveur explicite', () => {
    assert.match(chain, /import \{ resolveScript \} from '\.\/lib\/chain-links\.mjs'/);
    assert.match(chain, /runScript\('lint', 'lint:chain'/);
    assert.match(chain, /runScript\('tests', 'test'/);
    assert.match(chain, /runScript\('build', 'build'/);
  });

  it('aucun npm dans le chemin des maillons (c’est ce que ce module supprime)', () => {
    assert.doesNotMatch(chain, /npm-cli\.js/, 'la chaîne ne doit plus spawn npm');
    assert.doesNotMatch(chain, /runNpm/, 'le lanceur npm de la chaîne doit avoir disparu');
    assert.doesNotMatch(chain, /'npm'|"npm"/, 'aucune commande npm ne doit subsister');
  });
});
