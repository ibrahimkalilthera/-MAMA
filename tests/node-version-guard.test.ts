// Suite for scripts/check-node-version.mjs — the pure version-parity helpers.
//
// Plain-node suite (no DOM, no module mocks): the gate itself is trivial, its
// SEMANTICS are what matter — same major passes, a different major is
// reported, and an unreadable pin (or a malformed engines range) never blocks
// the chain. Context: a green local chain on the wrong major is a false green
// (see the script header), so these cases are the regression guard.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const { majorOf, mismatch } = await import('../scripts/check-node-version.mjs');

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

describe('majorOf', () => {
  it('lit le majeur dans toutes les formes utilisées (.nvmrc, engines, process.versions)', () => {
    assert.equal(majorOf('22'), 22);
    assert.equal(majorOf('v24.20.0'), 24);
    assert.equal(majorOf('>=22.0.0 <23.0.0'), 22);
    assert.equal(majorOf(' 22 \n'), 22);
  });

  it('renvoie null plutôt que de bloquer sur une entrée illisible', () => {
    assert.equal(majorOf(''), null);
    assert.equal(majorOf(undefined), null);
    assert.equal(majorOf('lts/*'), null);
  });
});

describe('mismatch', () => {
  it('même majeur → aucun problème (quel que soit le patch)', () => {
    assert.equal(mismatch('22.23.2', '22'), null);
    assert.equal(mismatch('24.20.0', 'v24.1.0'), null);
  });

  it('majeur différent → problème signalé (le cas qui a menti : 24 local / 22 CI)', () => {
    assert.deepEqual(mismatch('24.20.0', '22'), { current: 24, pinned: 22 });
    assert.deepEqual(mismatch('20.11.0', '>=22.0.0 <23.0.0'), { current: 20, pinned: 22 });
  });

  it('entrée illisible → jamais de blocage', () => {
    assert.equal(mismatch('22.23.2', ''), null);
    assert.equal(mismatch('lts/*', '22'), null);
  });
});

// The gate only protects the paths that actually RUN it. It used to be reachable
// solely through `npm run lint` while the CI job called `npx eslint .` directly,
// so the runner never executed it — the doc header said otherwise. These
// assertions read the workflow as text (no YAML dependency, matching the
// dependency-free style of this suite): removing the step from a job fails here.
describe('câblage CI du gate de parité', () => {
  const workflow = readFileSync(join(root, '.github/workflows/perf-guard.yml'), 'utf8');

  it('chaque job qui installe Node vérifie le majeur réellement exécuté', () => {
    const setups = workflow.match(/actions\/setup-node@/g)?.length ?? 0;
    const gates = workflow.match(/node scripts\/check-node-version\.mjs/g)?.length ?? 0;
    assert.ok(setups > 0, 'perf-guard.yml doit installer Node au moins une fois');
    assert.equal(
      gates,
      setups,
      'tout job qui installe Node doit lancer scripts/check-node-version.mjs',
    );
  });

  it('.nvmrc, .node-version et engines.node épinglent le même majeur', () => {
    const nvmrc = readFileSync(join(root, '.nvmrc'), 'utf8');
    const nodeVersion = readFileSync(join(root, '.node-version'), 'utf8');
    const engines = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).engines.node;
    assert.equal(majorOf(nodeVersion), majorOf(nvmrc));
    assert.equal(majorOf(engines), majorOf(nvmrc));
  });
});
