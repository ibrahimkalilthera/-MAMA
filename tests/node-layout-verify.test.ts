// Suite for scripts/verify-node-layout.mjs — the pure verdict, the REAL machine
// it runs on, and the CI matrix that proves the other platform.
//
// The gap this closes: the two npm layouts were covered by tests that fabricate
// trees in a temp dir. That proves the candidate LIST — and nothing about what a
// machine actually installed, which is exactly how the resolver stayed green
// here while throwing on the ubuntu runner (it only knew the Windows layout).
// So the suite now asserts three different things, and it is worth keeping them
// apart:
//   • the POLICY (`expectedLayout`, `evaluateLayout`) — injected inputs;
//   • THIS machine (`inspectMachine` + the verdict) — no fabricated tree at all;
//   • the OTHER platform — a CI matrix job, asserted to exist and to call the
//     npm script by name (a check that runs on no runner is a comment).
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const { evaluateLayout, expectedLayout, inspectMachine } = await import(
  '../scripts/verify-node-layout.mjs'
);
const { NPM_NESTED_LAYOUTS } = await import('../scripts/lib/npm-cli.mjs');

const onDisk = (p: string | null) => (p ? join(p, 'bin', 'npm-cli.js') : '/absent');

describe('expectedLayout — le contrat par plateforme', () => {
  it('Windows : npm à côté de node, dans node_modules', () => {
    assert.equal(expectedLayout('win32'), 'node_modules');
  });

  it('Linux et macOS : npm dans lib/node_modules (c’est le layout des runners CI)', () => {
    assert.equal(expectedLayout('linux'), join('lib', 'node_modules'));
    assert.equal(expectedLayout('darwin'), join('lib', 'node_modules'));
    assert.ok(NPM_NESTED_LAYOUTS.includes(join('lib', 'node_modules')));
  });

  it('plateforme inconnue : aucun contrat plutôt qu’un contrat inventé', () => {
    assert.equal(expectedLayout('freebsd'), null);
  });
});

describe('evaluateLayout — le verdict', () => {
  const besideLinux = {
    path: onDisk('/usr/local/lib/node_modules/npm'),
    layout: join('lib', 'node_modules'),
  };

  it('le layout de la plateforme, trouvé à sa vraie place → vert', () => {
    const v = evaluateLayout({
      platform: 'linux',
      resolved: { path: besideLinux.path, source: 'layout', layout: besideLinux.layout },
      beside: besideLinux,
      resolvedExists: true,
      cliVersion: '10.9.2',
    });
    assert.equal(v.ok, true, v.lines.join('\n'));
    assert.match(v.lines.join('\n'), /layout réel de linux prouvé/);
  });

  it('un chemin qui existe mais n’exécute pas npm → rouge', () => {
    const v = evaluateLayout({
      platform: 'linux',
      resolved: { path: besideLinux.path, source: 'layout', layout: besideLinux.layout },
      beside: besideLinux,
      resolvedExists: true,
      cliVersion: null,
    });
    assert.equal(v.ok, false);
    assert.match(v.lines.join('\n'), /n.exécute pas npm/);
  });

  it('la résolution passe à côté du npm de la machine → rouge (le trou vert/rouge)', () => {
    const v = evaluateLayout({
      platform: 'linux',
      resolved: { path: '/usr/bin/node_modules/npm/bin/npm-cli.js', source: 'path', layout: 'node_modules' },
      beside: besideLinux,
      resolvedExists: true,
      cliVersion: '10.9.2',
    });
    assert.equal(v.ok, false);
    assert.match(v.lines.join('\n'), /n.a PAS trouvé le npm de la machine/);
  });

  it('npm installé dans l’autre layout que celui de la plateforme → rouge', () => {
    const v = evaluateLayout({
      platform: 'linux',
      resolved: { path: onDisk('/opt/node/node_modules/npm'), source: 'layout', layout: 'node_modules' },
      beside: { path: onDisk('/opt/node/node_modules/npm'), layout: 'node_modules' },
      resolvedExists: true,
      cliVersion: '10.9.2',
    });
    assert.equal(v.ok, false);
    assert.match(v.lines.join('\n'), /divergé/);
  });

  it('node sans npm à côté (distribution node@) : un chemin explicite suffit, et c’est dit', () => {
    for (const source of ['declared', 'path']) {
      const v = evaluateLayout({
        platform: 'win32',
        resolved: { path: 'C:\\npm\\npm-cli.js', source, layout: null },
        beside: { path: null, layout: null },
        resolvedExists: true,
        cliVersion: '10.9.2',
      });
      assert.equal(v.ok, true, `${source} : ${v.lines.join('\n')}`);
      assert.match(v.lines.join('\n'), /pas applicable ici/);
    }
  });

  it('aucun npm trouvé nulle part → rouge', () => {
    const v = evaluateLayout({
      platform: 'win32',
      resolved: { path: null, source: null, layout: null },
      beside: { path: null, layout: null },
      resolvedExists: false,
      cliVersion: null,
    });
    assert.equal(v.ok, false);
    assert.match(v.lines.join('\n'), /introuvable/);
  });
});

describe('la machine qui exécute la suite : vérifiée pour de vrai, sans arborescence fabriquée', () => {
  const machine = inspectMachine();

  it('trouve un npm-cli.js réel, et ce fichier existe', () => {
    assert.ok(machine.resolved.path, 'aucune résolution sur cette machine');
    assert.equal(machine.resolvedExists, true, `chemin mort : ${machine.resolved.path}`);
    assert.ok(existsSync(machine.beside.path ?? machine.resolved.path!));
  });

  it('ce chemin exécute réellement npm (un fichier qui existe n’est pas npm)', () => {
    assert.match(String(machine.cliVersion), /^\d+\.\d+\.\d+/, `version npm : ${machine.cliVersion}`);
  });

  it('et le verdict de cette plateforme est vert', () => {
    const v = evaluateLayout(machine);
    assert.equal(v.ok, true, v.lines.join('\n'));
  });
});

describe('câblage CI — l’autre plateforme est prouvée par un runner', () => {
  // Commentaires retirés avant toute assertion : ce sont les COMMANDES que le
  // job exécute qui comptent, pas la prose qui les explique — un commentaire
  // « pas de `npm ci` ici » ne doit pas être lu comme un `npm ci`.
  const workflow = readFileSync(join(root, '.github/workflows/perf-guard.yml'), 'utf8')
    .split('\n')
    .filter((line) => !/^\s*#/.test(line))
    .join('\n');
  const jobChunk = (name: string) => {
    const parts = workflow.slice(workflow.indexOf('\njobs:')).split(/\n  (?=[a-z][\w-]*:\s*\n)/);
    return parts.find((c) => new RegExp(`^\\s*${name}:`).test(c)) ?? '';
  };
  const layouts = jobChunk('node-layouts');

  it('le job existe, sur les DEUX plateformes, en matrice', () => {
    assert.ok(layouts, 'job node-layouts introuvable dans perf-guard.yml');
    assert.match(layouts, /runs-on: \$\{\{ matrix\.os \}\}/);
    assert.match(layouts, /os: \[ubuntu-latest, windows-latest\]/);
    assert.match(layouts, /fail-fast: false/, 'un layout cassé ne doit pas masquer l’autre');
  });

  it('il installe le Node épinglé et prouve le majeur réellement exécuté', () => {
    assert.match(layouts, /node-version-file: \.nvmrc/);
    assert.match(layouts, /node scripts\/check-node-version\.mjs/);
  });

  it('il appelle le script PAR SON NOM, et ne recopie pas sa commande', () => {
    assert.match(layouts, /run: npm run check:node-layout/);
    assert.doesNotMatch(layouts, /run: node scripts\/verify-node-layout\.mjs/);
    assert.match(
      JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).scripts['check:node-layout'],
      /node scripts\/verify-node-layout\.mjs/,
    );
  });

  it('le job reste sans dépendances : ce qu’il vérifie est l’installation du runner', () => {
    assert.doesNotMatch(layouts, /npm ci|npm install/);
  });
});
