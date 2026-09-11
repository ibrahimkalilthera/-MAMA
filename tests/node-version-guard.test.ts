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
  // Comments are dropped before every assertion: these tests judge the
  // COMMANDS a job runs, not the prose around them — a comment explaining what
  // the job used to do must not be mistaken for the job still doing it.
  const workflow = readFileSync(join(root, '.github/workflows/perf-guard.yml'), 'utf8')
    .split('\n')
    .filter((line) => !/^\s*#/.test(line))
    .join('\n');

  /** Job chunks of the `jobs:` block, split on the 2-space job keys. */
  const jobChunks = workflow
    .slice(workflow.indexOf('\njobs:'))
    .split(/\n  (?=[a-z][\w-]*:\s*\n)/)
    .filter((c) => c.includes('steps:'));

  it('reconnaît bien les 4 jobs du workflow', () => {
    assert.equal(jobChunks.length, 4, `jobs détectés : ${jobChunks.length}`);
  });

  it('chaque job qui installe Node prouve le majeur réellement exécuté', () => {
    const withNode = jobChunks.filter((c) => c.includes('actions/setup-node@'));
    assert.ok(withNode.length > 0, 'perf-guard.yml doit installer Node au moins une fois');
    for (const chunk of withNode) {
      const name = chunk.match(/^\s*([\w-]+):/)?.[1] ?? '?';
      // Either the gate itself, or `npm run lint` whose FIRST link is that gate
      // — the point is that every job demonstrates its runtime, not that every
      // job repeats a bespoke command.
      assert.ok(
        chunk.includes('scripts/check-node-version.mjs') || chunk.includes('npm run lint'),
        `le job « ${name} » installe Node sans prouver le majeur exécuté`,
      );
    }
  });

  it('la CI lance la chaîne du poste telle quelle, sans sous-ensemble recopié', () => {
    const quality = jobChunks.find((c) => /^\s*quality:/.test(c));
    assert.ok(quality, 'job quality introuvable');
    assert.ok(quality!.includes('npm run lint'), 'le job quality doit lancer `npm run lint`');
    // The hand-copied subset is how the two chains drifted: it silently skipped
    // stylelint, the test-harness guard, the CSS/emoji/i18n/date/line-budget
    // checks and the SQL snapshot check. Re-introducing one of these here must
    // fail loudly, not quietly reduce CI coverage below the local chain.
    for (const copied of ['npx eslint', 'npx tsc', 'scripts/check-component-props.mjs']) {
      assert.ok(
        !quality!.includes(copied),
        `le job quality recopie « ${copied} » au lieu d'appeler npm run lint`,
      );
    }
  });

  it('.nvmrc, .node-version et engines.node épinglent le même majeur', () => {
    const nvmrc = readFileSync(join(root, '.nvmrc'), 'utf8');
    const nodeVersion = readFileSync(join(root, '.node-version'), 'utf8');
    const engines = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).engines.node;
    assert.equal(majorOf(nodeVersion), majorOf(nvmrc));
    assert.equal(majorOf(engines), majorOf(nvmrc));
  });
});
