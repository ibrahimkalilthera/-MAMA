// Suite for scripts/lib/bin-shims.mjs + the entry points that write it
// (the pinned launcher, `npm run shell`, `npm run setup:node`).
//
// Why the shims live in `node_modules/.bin` and not in a private PATH directory
// is the whole subject of this suite: the pin is written where npm ALREADY puts
// the project's commands first for every script — so nothing has to be rewritten
// in the environment, and our own wrappers can no longer be mistaken for a real
// npm by a PATH search (that mistake was a real bug: the fallback in
// ./lib/npm-cli.mjs found the wrapper and derived a path containing no npm).
//
// The shim text itself is the part that cannot be proven by reasoning: it is
// handed to two OSes, and both of its contracts were paid for by a real bug —
// handing npm-cli.js to the OS directly made the audit step hang on its offline
// branch, and LF-only `.cmd` files let cmd.exe leak back to the host runtime
// mid-chain. So they are asserted literally here rather than described.
//
// @platform-guard : le bit exécutable n'existe pas sur Windows (chmod n'y
// change que l'attribut lecture seule) — l'assertion d'exécutabilité est posix
// par nature et s'arrête là-bas. Déclaré pour que le gate de neutralisation
// l'affiche au lieu de compter un test vide comme vert.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const {
  binDirFor,
  legacyShimDirFor,
  posixShimBody,
  removeLegacyShimDir,
  windowsShimBody,
  writeBinShims,
} = await import('../scripts/lib/bin-shims.mjs');

const tmp = () => mkdtempSync(join(tmpdir(), 'mama-bin-shims-'));

/** A throwaway project: a fake pinned node and a fake npm-cli.js beside it. */
const setup = (withNpx: boolean) => {
  const dir = tmp();
  const node = join(dir, 'node');
  const npmCli = join(dir, 'npm', 'bin', 'npm-cli.js');
  mkdirSync(dirname(npmCli), { recursive: true });
  writeFileSync(node, '');
  writeFileSync(npmCli, '');
  if (withNpx) writeFileSync(join(dirname(npmCli), 'npx-cli.js'), '');
  return { dir, node, npmCli, project: join(dir, 'project') };
};

describe('bin-shims — le texte remis à l’OS', () => {
  it('écrit dans node_modules/.bin, et les deux formes de chaque outil', () => {
    const { node, npmCli, project } = setup(true);
    const dir = writeBinShims({ root: project, execPath: node, npmEntry: npmCli });
    assert.equal(dir, binDirFor(project));
    assert.ok(dir.endsWith(join('node_modules', '.bin')));
    for (const name of ['node', 'npm', 'npx']) {
      assert.ok(readFileSync(join(dir, name), 'utf8').length > 0, `${name} manquant`);
      assert.ok(readFileSync(join(dir, `${name}.cmd`), 'utf8').length > 0, `${name}.cmd manquant`);
    }
    rmSync(project, { recursive: true, force: true });
  });

  it('ne touche JAMAIS aux entrées d’npm (elles sont à npm, pas à nous)', () => {
    const { node, npmCli, project } = setup(true);
    const bin = binDirFor(project);
    mkdirSync(bin, { recursive: true });
    const npmOwned = join(bin, 'eslint.cmd');
    writeFileSync(npmOwned, '@ECHO off\r\nREM écrit par npm\r\n');
    writeBinShims({ root: project, execPath: node, npmEntry: npmCli });
    assert.equal(readFileSync(npmOwned, 'utf8'), '@ECHO off\r\nREM écrit par npm\r\n');
    rmSync(project, { recursive: true, force: true });
  });

  it('un shim est un PRÉFIXE d’argv, jamais un exécutable seul (le bug npm audit)', () => {
    const { node, npmCli, project } = setup(true);
    const dir = writeBinShims({ root: project, execPath: node, npmEntry: npmCli });
    const npm = readFileSync(join(dir, 'npm'), 'utf8');
    assert.ok(npm.includes(JSON.stringify(node)), 'npm doit être lancé PAR le node épinglé');
    assert.ok(npm.includes(JSON.stringify(npmCli)), 'npm-cli.js doit être l’argument, pas le programme');
    assert.match(npm, /^#!\/bin\/sh\nexec /, 'forme posix : exec <argv…>');
    assert.match(npm, /"\$@"\n$/, 'les arguments de l’appelant doivent être transmis');
    rmSync(project, { recursive: true, force: true });
  });

  it('.cmd est écrit en CRLF (cmd.exe casse sur LF et retombe sur le node du poste)', () => {
    const { node, npmCli, project } = setup(true);
    const dir = writeBinShims({ root: project, execPath: node, npmEntry: npmCli });
    const cmd = readFileSync(join(dir, 'npm.cmd'), 'utf8');
    assert.ok(cmd.includes('\r\n'), '.cmd doit contenir des CRLF');
    assert.equal(/^@echo off\r\n/.test(cmd), true, 'première ligne @echo off en CRLF');
    assert.equal(cmd.replace(/\r\n/g, '').includes('\n'), false, 'aucun LF nu dans un .cmd');
    assert.equal(windowsShimBody(['a b', 'c']), '@echo off\r\n"a b" "c" %*\r\n');
    rmSync(project, { recursive: true, force: true });
  });

  it('node pointe sur le binaire épinglé ; npx suit npm quand il n’existe pas', () => {
    const withNpx = setup(true);
    const withoutNpx = setup(false);
    const a = writeBinShims({ root: withNpx.project, execPath: withNpx.node, npmEntry: withNpx.npmCli });
    const b = writeBinShims({ root: withoutNpx.project, execPath: withoutNpx.node, npmEntry: withoutNpx.npmCli });
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
    const { node, npmCli, project } = setup(true);
    const dir = writeBinShims({ root: project, execPath: node, npmEntry: npmCli });
    assert.ok(statSync(join(dir, 'node')).mode & 0o111, 'node doit être exécutable');
    rmSync(project, { recursive: true, force: true });
  });

  it('réécrire avec le même runtime ne change aucun octet (idempotent)', () => {
    const { node, npmCli, project } = setup(true);
    const first = writeBinShims({ root: project, execPath: node, npmEntry: npmCli });
    const before = readFileSync(join(first, 'npm'), 'utf8');
    const second = writeBinShims({ root: project, execPath: node, npmEntry: npmCli });
    assert.equal(second, first);
    assert.equal(readFileSync(join(second, 'npm'), 'utf8'), before);
    rmSync(project, { recursive: true, force: true });
  });

  it('un changement de runtime RÉÉCRIT les entrées (sinon un majeur périmé gagnerait)', () => {
    const { dir, node, npmCli, project } = setup(true);
    const other = join(dir, 'autre-node'); // `dir` existe déjà, `project` non
    writeFileSync(other, '');
    writeBinShims({ root: project, execPath: node, npmEntry: npmCli });
    writeBinShims({ root: project, execPath: other, npmEntry: npmCli });
    const after = readFileSync(join(binDirFor(project), 'node'), 'utf8');
    assert.ok(after.includes(JSON.stringify(other)), 'le shim doit suivre le runtime résolu');
    assert.ok(!after.includes(JSON.stringify(node)), 'le runtime précédent ne doit plus apparaître');
    rmSync(dir, { recursive: true, force: true });
  });

  it('le dossier PATH retiré est supprimé, sans erreur s’il n’existe pas', () => {
    const { project } = setup(false);
    assert.equal(removeLegacyShimDir({ root: project }), false, 'rien à supprimer : pas d’erreur');
    mkdirSync(legacyShimDirFor(project), { recursive: true });
    writeFileSync(join(legacyShimDirFor(project), 'node'), 'vieux shim\n');
    assert.equal(removeLegacyShimDir({ root: project }), true);
    assert.equal(existsSync(legacyShimDirFor(project)), false, 'le mécanisme retiré ne doit pas survivre');
    rmSync(project, { recursive: true, force: true });
  });
});

describe('câblage — aucun des trois écrivains ne réécrit plus l’environnement', () => {
  const read = (rel: string) => readFileSync(join(root, rel), 'utf8');
  const launcher = read('scripts/with-pinned-node.mjs');
  const shell = read('scripts/node-shell.mjs');
  const setupNode = read('scripts/setup-node-runtime.mjs');

  it('le lanceur écrit les shims et ne touche plus à PATH', () => {
    assert.match(launcher, /from '\.\/lib\/bin-shims\.mjs'/, 'le lanceur doit écrire le pin dans .bin');
    assert.match(launcher, /writeBinShims\(\{ root/);
    assert.doesNotMatch(launcher, /env\.PATH/, 'plus aucune réécriture de PATH dans le lanceur');
    assert.doesNotMatch(launcher, /delimiter/, 'plus de composition de PATH du tout');
    assert.match(launcher, /removeLegacyShimDir/, 'l’ancien dossier doit être nettoyé');
    assert.match(launcher, /MAMA_NPM_CLI_JS/, 'npm reste résolu par chemin exact, pas par recherche PATH');
  });

  it('les shims sont écrits à CHAQUE passage, pas seulement quand le runtime change', () => {
    // Un shim laissé par un majeur précédent survivrait sinon à une bascule de
    // `.nvmrc` et gagnerait pour tous les scripts npm — le gate de version le
    // refuserait, mais autant ne pas le laisser exister.
    assert.doesNotMatch(
      launcher,
      /if \(runtime\.source !== 'current'\) \{\s*writeBinShims/,
      'l’écriture ne doit pas être conditionnée à la source du runtime',
    );
  });

  it('`npm run shell` préfixe le dossier .bin du projet, et `--print` n’imprime que lui', () => {
    assert.match(shell, /writeBinShims\(\{ root/);
    assert.match(shell, /PATH: shimDir \+ delimiter \+ \(process\.env\.PATH \?\? ''\)/);
    assert.match(shell, /console\.log\(shimDir\)/, '--print sert à `export PATH="$(…)"`');
    assert.match(shell, /MAMA_NPM_CLI_JS/, 'npm est résolu par chemin exact, jamais par recherche PATH');
  });

  it('`npm run setup:node` pin aussi le projet (c’est ce que `prepare` lance après install)', () => {
    assert.match(setupNode, /writeBinShims\(\{/);
    assert.match(setupNode, /resolveNpmCliJs\(runtime\.execPath\)/);
    assert.match(
      JSON.parse(read('package.json')).scripts.prepare,
      /setup-node-runtime\.mjs --soft/,
      'prepare doit continuer à appeler le setup',
    );
  });

  it('la documentation dit comment ouvrir ce terminal', () => {
    assert.match(read('README.md'), /npm run shell/, 'le README doit mentionner le shell épinglé');
  });
});
