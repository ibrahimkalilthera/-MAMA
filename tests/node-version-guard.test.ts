// Suite for scripts/check-node-version.mjs — the pure version-parity helpers.
//
// Plain-node suite (no DOM, no module mocks): the gate itself is trivial, its
// SEMANTICS are what matter — same major passes, a different major is
// reported, and an unreadable pin (or a malformed engines range) never blocks
// the chain. Context: a green local chain on the wrong major is a false green
// (see the script header), so these cases are the regression guard.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

const { majorOf, mismatch } = await import('../scripts/check-node-version.mjs');

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
