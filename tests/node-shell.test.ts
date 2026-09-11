// Suite for scripts/lib/node-path-shim.mjs + the `npm run shell` entry point.
//
// The shim is the part of the pin that cannot be proven by reasoning alone: it
// is text handed to two different OSes, and both of its contracts were paid for
// by a real bug — handing npm-cli.js to the OS directly made the audit step
// hang on its offline branch, and LF-only `.cmd` files let cmd.exe leak back to
// the host runtime mid-chain. So they are asserted literally here rather than
// described.
//
// The `shell` entry point is the part a developer actually opens, so its wiring
// is asserted too: it must reuse the same shim the launcher writes (one writer,
// not two that can drift) and it must prepend that directory to PATH.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const { shimDirFor, posixShimBody, windowsShimBody, writePathShim } = await import(
  '../scripts/lib/node-path-shim.mjs'
);

const tmp = () => mkdtempSync(join(tmpdir(), 'mama-node-shim-'));

const setup = (withNpx: boolean) => {
  const dir = tmp();
  const node = join(dir, 'node');
  const npmCli = join(dir, 'npm', 'bin', 'npm-cli.js');
  mkdirSync(dirname(npmCli), { recursive: true });
  writeFileSync(node, '');
  writeFileSync(npmCli, '');
  if (withNpx) writeFileSync(join(dirname(npmCli), 'npx-cli.js'), '');
  return { dir, node, npmCli };
};

describe('node-path-shim — le texte remis à l’OS', () => {
  it('vit sous node_modules/.cache et écrit les deux formes de chaque outil', () => {
    const { dir, node, npmCli } = setup(true);
    const project = join(dir, 'project');
    const shimDir = writePathShim({ root: project, execPath: node, npmEntry: npmCli });
    assert.equal(shimDir, shimDirFor(project));
    assert.ok(shimDir.startsWith(join(project, 'node_modules', '.cache')));
    for (const name of ['node', 'npm', 'npx']) {
      assert.ok(readFileSync(join(shimDir, name), 'utf8').length > 0, `${name} manquant`);
      assert.ok(readFileSync(join(shimDir, `${name}.cmd`), 'utf8').length > 0, `${name}.cmd manquant`);
    }
    rmSync(dir, { recursive: true, force: true });
  });

  it('un shim est un PRÉFIXE d’argv, jamais un exécutable seul (le bug npm audit)', () => {
    const { dir, node, npmCli } = setup(true);
    const shimDir = writePathShim({ root: join(dir, 'p'), execPath: node, npmEntry: npmCli });
    const npm = readFileSync(join(shimDir, 'npm'), 'utf8');
    assert.ok(npm.includes(JSON.stringify(node)), 'npm doit être lancé PAR le node épinglé');
    assert.ok(npm.includes(JSON.stringify(npmCli)), 'npm-cli.js doit être l’argument, pas le programme');
    assert.match(npm, /^#!\/bin\/sh\nexec /, 'forme posix : exec <argv…>');
    assert.match(npm, /"\$@"\n$/, 'les arguments de l’appelant doivent être transmis');
    rmSync(dir, { recursive: true, force: true });
  });

  it('.cmd est écrit en CRLF (cmd.exe casse sur LF et retombe sur le node du poste)', () => {
    const { dir, node, npmCli } = setup(true);
    const shimDir = writePathShim({ root: join(dir, 'p'), execPath: node, npmEntry: npmCli });
    const cmd = readFileSync(join(shimDir, 'npm.cmd'), 'utf8');
    assert.ok(cmd.includes('\r\n'), '.cmd doit contenir des CRLF');
    assert.equal(/^@echo off\r\n/.test(cmd), true, 'première ligne @echo off en CRLF');
    assert.equal(cmd.replace(/\r\n/g, '').includes('\n'), false, 'aucun LF nu dans un .cmd');
    assert.equal(windowsShimBody(['a b', 'c']), '@echo off\r\n"a b" "c" %*\r\n');
    rmSync(dir, { recursive: true, force: true });
  });

  it('node pointe sur le binaire épinglé ; npx suit npm quand il n’existe pas', () => {
    const withNpx = setup(true);
    const withoutNpx = setup(false);
    const a = writePathShim({ root: join(withNpx.dir, 'p'), execPath: withNpx.node, npmEntry: withNpx.npmCli });
    const b = writePathShim({ root: join(withoutNpx.dir, 'p'), execPath: withoutNpx.node, npmEntry: withoutNpx.npmCli });
    assert.ok(readFileSync(join(a, 'node'), 'utf8').includes(JSON.stringify(withNpx.node)));
    assert.ok(readFileSync(join(a, 'npx'), 'utf8').includes('npx-cli.js'), 'npx-cli.js utilisé quand présent');
    assert.ok(
      readFileSync(join(b, 'npx'), 'utf8').includes(JSON.stringify(withoutNpx.npmCli)),
      'repli sur npm-cli.js (npx reste fonctionnel via npm)',
    );
    rmSync(withNpx.dir, { recursive: true, force: true });
    rmSync(withoutNpx.dir, { recursive: true, force: true });
  });

  it('les shims posix sont exécutables (un shim non exécutable serait ignoré)', () => {
    if (process.platform === 'win32') return; // les bits de mode n’y veulent rien dire
    const { dir, node, npmCli } = setup(true);
    const shimDir = writePathShim({ root: join(dir, 'p'), execPath: node, npmEntry: npmCli });
    assert.ok(statSync(join(shimDir, 'node')).mode & 0o111, 'node doit être exécutable');
    rmSync(dir, { recursive: true, force: true });
  });

  it('réécrire avec le même runtime ne change aucun octet (idempotent)', () => {
    const { dir, node, npmCli } = setup(true);
    const project = join(dir, 'p');
    const first = writePathShim({ root: project, execPath: node, npmEntry: npmCli });
    const before = readFileSync(join(first, 'npm'), 'utf8');
    const second = writePathShim({ root: project, execPath: node, npmEntry: npmCli });
    assert.equal(second, first);
    assert.equal(readFileSync(join(second, 'npm'), 'utf8'), before);
    rmSync(dir, { recursive: true, force: true });
  });
});

describe('node-shell — câblage', () => {
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  const scripts: Record<string, string> = pkg.scripts;
  const source = readFileSync(join(root, 'scripts', 'node-shell.mjs'), 'utf8');

  it('`npm run shell` ouvre un shell sur le runtime épinglé', () => {
    assert.match(scripts.shell, /node-shell\.mjs/, 'npm run shell doit exister');
    assert.match(source, /pinnedMajor\(root\)/, 'le majeur vient de .nvmrc, source unique');
    assert.match(source, /resolveNodeRuntime\(/, 'la résolution passe par le résolveur partagé');
  });

  it('le shell réutilise le shim du lanceur — un seul écrivain, pas deux qui dérivent', () => {
    assert.match(source, /from '\.\/lib\/node-path-shim\.mjs'/, 'node-shell doit importer le shim partagé');
    const launcher = readFileSync(join(root, 'scripts', 'with-pinned-node.mjs'), 'utf8');
    assert.match(launcher, /from '\.\/lib\/node-path-shim\.mjs'/);
    assert.doesNotMatch(
      launcher,
      /@echo off/,
      'plus aucune écriture de shim en ligne dans le lanceur (elle a été extraite)',
    );
  });

  it('le shim est préfixé à PATH, et `--print` n’imprime que le dossier', () => {
    assert.match(source, /PATH: shimDir \+ delimiter \+ \(process\.env\.PATH \?\? ''\)/);
    assert.match(source, /console\.log\(shimDir\)/, '--print sert à `export PATH="$(…)"`');
    assert.match(source, /MAMA_NPM_CLI_JS/, 'npm est résolu par chemin exact, jamais par recherche PATH');
  });

  it('la documentation dit comment ouvrir ce terminal', () => {
    const readme = readFileSync(join(root, 'README.md'), 'utf8');
    assert.match(readme, /npm run shell/, 'le README doit mentionner le shell épinglé');
  });
});
