// Contract test for src/app/mainViewsProps.ts — the single source of truth for
// the MainViews props (the context the views read and the object App.tsx wires).
// Verifies the invariants the whole type system leans on:
//   1. the interface is defined EXACTLY ONCE (no stale copy in MainViews.tsx)
//   2. every prop is required (no optional `?`) — tsc then forces full wiring
//   3. no `any` anywhere in the contract module (the forbidden-cast gate's
//      belt, doubled here against this specific file)
//   4. prop names are unique
//   5. the wiring guard (scripts/check-component-props.mjs) parses THIS module
//   6. the module is types-only: importing it has zero runtime side effects
//   7. DOM-free contract: nothing renders or reads globals, so the shared
//      happy-dom harness is intentionally unused (see harness.ts)
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import type { MainViewsProps } from '../src/app/mainViewsProps';

const MODULE_PATH = 'src/app/mainViewsProps.ts';
const source = readFileSync(MODULE_PATH, 'utf8');

const extractPropsBody = (src: string): string => {
  const m = src.match(/interface MainViewsProps \{([\s\S]*?)\n\}/);
  assert.ok(m, 'interface MainViewsProps must exist in the module');
  return m[1];
};

const propEntries = (body: string) =>
  [...body.matchAll(/^\s{2}([A-Za-z0-9_]+)(\?)?:/gm)].map((x) => ({ name: x[1], optional: Boolean(x[2]) }));

describe('MainViewsProps contract (src/app/mainViewsProps.ts)', () => {
  it('is the single definition — MainViews.tsx must not redeclare it', () => {
    const mainViews = readFileSync('src/components/MainViews.tsx', 'utf8');
    assert.ok(!/interface MainViewsProps \{/.test(mainViews), 'MainViews.tsx must not redeclare MainViewsProps');
  });

  it('declares the full 186-prop contract, all required (no optional `?`)', () => {
    const entries = propEntries(extractPropsBody(source));
    assert.ok(entries.length >= 150, `expected the full contract, got ${entries.length} props`);
    const optional = entries.filter((e) => e.optional);
    assert.deepEqual(
      optional,
      [],
      `optional props are not allowed in the contract: ${optional.map((o) => o.name).join(', ')}`
    );
  });

  it('contains no `any` anywhere in the module', () => {
    assert.ok(!/\bas\s+any\b|:\s*any\b|<any>/.test(source), 'the contract must not use `any`');
  });

  it('has unique prop names', () => {
    const names = propEntries(extractPropsBody(source)).map((e) => e.name);
    assert.equal(new Set(names).size, names.length, 'duplicate prop names in the contract');
  });

  it('is the file the wiring guard parses (scripts/check-component-props.mjs)', () => {
    const guard = readFileSync('scripts/check-component-props.mjs', 'utf8');
    const m = guard.match(/\{ name: 'MainViews', file: '([^']+)', render/);
    assert.ok(m, 'MainViews entry not found in the wiring guard');
    assert.equal(m[1], MODULE_PATH, 'check-component-props.mjs must parse the dedicated module');
  });

  it('is types-only: importing it has zero runtime side effects', async () => {
    const mod = await import('../src/app/mainViewsProps');
    assert.deepEqual(Object.keys(mod), [], 'a types-only module must export nothing at runtime');
  });
});
