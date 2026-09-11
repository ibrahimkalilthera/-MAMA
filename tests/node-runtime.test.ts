// Suite for scripts/lib/node-runtime.mjs + its wiring.
//
// The point of this feature is that the project provisions what it pins, so the
// assertions are about ORDER and FAILURE, not about downloading: every provider
// is injected, so the whole resolution — including "nothing worked" — runs
// without a network. The failure message matters as much as the success path: it
// is what a developer sees, and it must never send them to a version manager
// they do not have.
//
// The wiring assertions lock the two halves that carry the guarantee: the npm
// entry points (`lint`, `quality`) and the git hooks both go through the
// launcher. A pin that nothing actually uses is a comment, not a pin.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, rmSync, writeFileSync, mkdtempSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const {
  majorOf,
  runtimeMatches,
  readCachedExecPath,
  writeCachedExecPath,
  resolveNodeRuntime,
} = await import('../scripts/lib/node-runtime.mjs');

const { resolveNpmCliJs } = await import('../scripts/lib/npm-cli.mjs');

const tmp = () => mkdtempSync(join(tmpdir(), 'mama-node-runtime-'));

// Both layouts are contracts, not preferences: Windows installs npm in
// `<prefix>/node_modules/npm`, while the Unix/CI install (setup-node on ubuntu)
// puts it in `<prefix>/lib/node_modules/npm`. Checking only the first is how a
// green local run went red on the runner — the resolver threw there because the
// path it assumed did not exist. These two cases make that specific blind spot
// impossible to re-open without a failing test.
describe('npm-cli — dispositions d’installation', () => {
  const withLayout = (layout: string[], run: (node: string, cli: string) => void) => {
    const prefix = tmp();
    const node = join(prefix, 'bin', 'node');
    const cli = join(prefix, ...layout);
    mkdirSync(dirname(cli), { recursive: true });
    mkdirSync(dirname(node), { recursive: true });
    writeFileSync(cli, '');
    writeFileSync(node, '');
    const declared = process.env.MAMA_NPM_CLI_JS;
    delete process.env.MAMA_NPM_CLI_JS; // the caller must not short-circuit the search
    try {
      run(node, cli);
    } finally {
      if (declared === undefined) delete process.env.MAMA_NPM_CLI_JS;
      else process.env.MAMA_NPM_CLI_JS = declared;
      rmSync(prefix, { recursive: true, force: true });
    }
  };

  it('trouve npm dans <prefix>/lib/node_modules (Linux, runners CI)', () => {
    withLayout(['lib', 'node_modules', 'npm', 'bin', 'npm-cli.js'], (node, cli) => {
      assert.equal(resolveNpmCliJs(node), cli);
    });
  });

  it('trouve npm dans <prefix>/node_modules (Windows)', () => {
    withLayout(['node_modules', 'npm', 'bin', 'npm-cli.js'], (node, cli) => {
      assert.equal(resolveNpmCliJs(node), cli);
    });
  });

  it('un chemin déclaré gagne la recherche, mais seulement s’il existe', () => {
    const prefix = tmp();
    const cli = join(prefix, 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js');
    const node = join(prefix, 'bin', 'node');
    mkdirSync(dirname(cli), { recursive: true });
    mkdirSync(dirname(node), { recursive: true });
    writeFileSync(cli, '');
    writeFileSync(node, '');
    const declared = process.env.MAMA_NPM_CLI_JS;
    try {
      process.env.MAMA_NPM_CLI_JS = join(prefix, 'disparu.js');
      assert.equal(resolveNpmCliJs(node), cli, 'un chemin déclaré mort ne doit pas gagner');
    } finally {
      if (declared === undefined) delete process.env.MAMA_NPM_CLI_JS;
      else process.env.MAMA_NPM_CLI_JS = declared;
      rmSync(prefix, { recursive: true, force: true });
    }
  });
});

describe('node-runtime — résolution', () => {
  it('majeur d’une version, quelle que soit la forme', () => {
    assert.equal(majorOf('22'), 22);
    assert.equal(majorOf('v22.23.2'), 22);
    assert.equal(majorOf('>=22.0.0 <23.0.0'), 22);
    assert.equal(majorOf('lts/*'), null);
    assert.equal(runtimeMatches('22.23.2', '22'), true);
    assert.equal(runtimeMatches('24.20.0', '22'), false);
    assert.equal(runtimeMatches('24.20.0', 'lts/*'), false);
  });

  it('le Node courant gagne : aucun téléchargement quand le majeur correspond', () => {
    let called = false;
    const r = resolveNodeRuntime({
      currentExecPath: '/node22',
      currentVersion: '22.23.2',
      pinned: '22',
      cacheFile: '/nope/cache.json',
      fetchNpm: () => {
        called = true;
        return '/downloaded';
      },
    });
    assert.deepEqual(r, { execPath: '/node22', source: 'current' });
    assert.equal(called, false, 'aucun provider réseau ne doit être sollicité');
  });

  it('un chemin en cache évite aussi le réseau', () => {
    const dir = tmp();
    const cacheFile = join(dir, 'cache.json');
    const fakeNode = join(dir, 'node');
    writeFileSync(fakeNode, '');
    writeCachedExecPath(cacheFile, fakeNode, '22');
    let called = false;
    const r = resolveNodeRuntime({
      currentExecPath: '/node24',
      currentVersion: '24.20.0',
      pinned: '22',
      cacheFile,
      fetchNpm: () => {
        called = true;
        return '/downloaded';
      },
    });
    assert.deepEqual(r, { execPath: fakeNode, source: 'cache' });
    assert.equal(called, false);
    rmSync(dir, { recursive: true, force: true });
  });

  it('sans cache, provisionne puis met en cache', () => {
    const dir = tmp();
    const cacheFile = join(dir, 'nested', 'cache.json');
    const fakeNode = join(dir, 'node');
    writeFileSync(fakeNode, '');
    let asked = -1;
    const r = resolveNodeRuntime({
      currentExecPath: '/node24',
      currentVersion: '24.20.0',
      pinned: '22',
      cacheFile,
      fetchNpm: (major: number) => {
        asked = major;
        return fakeNode;
      },
    });
    assert.deepEqual(r, { execPath: fakeNode, source: 'npm' });
    assert.equal(asked, 22, 'le majeur demandé est celui de .nvmrc');
    assert.equal(readCachedExecPath(cacheFile, '22'), fakeNode, 'le chemin doit être mémorisé');
    rmSync(dir, { recursive: true, force: true });
  });

  it('un cache périmé (fichier disparu) est ignoré, pas utilisé', () => {
    const dir = tmp();
    const cacheFile = join(dir, 'cache.json');
    writeCachedExecPath(cacheFile, join(dir, 'disparu'), '22');
    assert.equal(readCachedExecPath(cacheFile, '22'), null);
    // Sans provider, la résolution doit ÉCHOUER plutôt que « réussir » avec un
    // chemin mort : un cache périmé ne doit jamais devenir le runtime du projet.
    assert.throws(
      () =>
        resolveNodeRuntime({
          currentExecPath: '/node24',
          currentVersion: '24.20.0',
          pinned: '22',
          cacheFile,
          fetchNpm: () => null,
        }),
      /setup:node/,
    );
  });

  it('un cache écrit pour un autre majeur est ignoré', () => {
    const dir = tmp();
    const cacheFile = join(dir, 'cache.json');
    const fakeNode = join(dir, 'node');
    writeFileSync(fakeNode, '');
    writeCachedExecPath(cacheFile, fakeNode, '24');
    assert.equal(readCachedExecPath(cacheFile, '22'), null);
    rmSync(dir, { recursive: true, force: true });
  });

  it('échec : le remède est le projet, jamais un gestionnaire à installer', () => {
    const dir = tmp();
    let error: Error & { code?: string } = new Error('pas d’erreur');
    try {
      resolveNodeRuntime({
        currentExecPath: '/node24',
        currentVersion: '24.20.0',
        pinned: '22',
        cacheFile: join(dir, 'cache.json'),
        fetchNpm: () => null,
      });
    } catch (e) {
      error = e as Error & { code?: string };
    }
    assert.equal(error.code, 'EPINNEDRUNTIME');
    assert.match(error.message, /npm run setup:node/, 'le remède doit être la commande du projet');
    assert.doesNotMatch(error.message, /nvm install/, 'aucun gestionnaire à installer à la main');
    rmSync(dir, { recursive: true, force: true });
  });
});

describe('node-runtime — câblage', () => {
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  const scripts: Record<string, string> = pkg.scripts;

  it('les gates npm passent par le lanceur, la chaîne reste à un seul endroit', () => {
    assert.match(scripts.lint, /with-pinned-node\.mjs/, 'npm run lint doit épingler le runtime');
    assert.match(scripts.quality, /with-pinned-node\.mjs/, 'npm run quality doit épingler le runtime');
    // The links stay in ONE place, and the gate's first link still asserts the
    // runtime the chain actually got — the launcher pins, the gate verifies.
    assert.ok(!scripts.lint.includes('eslint'), 'npm run lint ne doit plus contenir les maillons');
    assert.match(scripts['lint:chain'], /^node scripts\/check-node-version\.mjs &&/);
    assert.match(scripts['lint:chain'], /stylelint/);
    assert.match(scripts['lint:chain'], /regenerate-full-setup\.mjs --check/);
  });

  it('le provisionnement est explicite et le `prepare` ne casse pas un install hors ligne', () => {
    assert.match(scripts['setup:node'], /setup-node-runtime\.mjs/);
    assert.match(scripts.prepare, /setup-node-runtime\.mjs --soft/);
    assert.match(scripts.prepare, /husky/, 'husky doit toujours être installé');
  });

  it('les deux hooks pinent le runtime (c’est là que ça bloquait)', () => {
    for (const hook of ['pre-commit', 'pre-push']) {
      const text = readFileSync(join(root, '.husky', hook), 'utf8');
      const command = text
        .split('\n')
        .filter((line) => !/^\s*#/.test(line))
        .filter((line) => line.includes('hook-quality-chain'));
      assert.equal(command.length, 1, `${hook} doit lancer la chaîne une seule fois`);
      assert.match(
        command[0],
        /with-pinned-node\.mjs --node scripts\/hook-quality-chain\.mjs/,
        `${hook} doit passer par le lanceur`,
      );
    }
  });
});
