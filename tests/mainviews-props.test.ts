// Contract test for src/app/mainViewsProps.ts — the single source of truth for
// the MainViews props (the context the views read and the object App.tsx wires).
// The contract is now COMPOSED: MainViewsProps is a one-line interface extending
// six per-domain slices (AppShellProps + one slice per view) declared in the
// same module. Verifies the invariants the whole type system leans on:
//   1. MainViewsProps is defined EXACTLY ONCE (no stale copy in MainViews.tsx)
//      and is purely composed — it has no own members, only `extends` slices
//   2. every prop across the slices is required (no optional `?`) — tsc then
//      forces full wiring
//   3. no `any` anywhere in the contract module (the forbidden-cast gate's
//      belt, doubled here against this specific file)
//   4. prop names are unique across the union of slices
//   5. the wiring guard (scripts/check-component-props.mjs) parses THIS module
//      and resolves the extends composition
//   6. the module is types-only: importing it has zero runtime side effects
//   7. DOM-free contract: nothing renders or reads globals, so the shared
//      happy-dom harness is intentionally unused (see harness.ts)
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import type {
  MainViewsProps,
  AppShellProps,
  DashboardViewProps,
  StudentsViewProps,
  ParentsViewProps,
  PayrollViewProps,
  ExpensesViewProps,
} from '../src/app/mainViewsProps';

const MODULE_PATH = 'src/app/mainViewsProps.ts';
const source = readFileSync(MODULE_PATH, 'utf8');

// Every `export interface *Props` in the module with its entries (own members).
// Two shapes coexist: the multi-line slices (`{ … }` with two-space props) and
// the composed one-liner (`extends A, B {}` with an empty body).
const parseInterfaces = (src: string): { name: string; extendsClause: string; entries: { name: string; optional: boolean }[] }[] => {
  const multi = [...src.matchAll(/export interface (\w+Props)( extends [^{}\n]*)? \{([\s\S]*?)\n\}/g)];
  const composed = [...src.matchAll(/export interface (\w+Props)( extends [^{}\n]*)? \{\}/g)];
  const both = [
    ...multi.map((m) => ({ name: m[1], extendsClause: m[2] ?? '', body: m[3] })),
    ...composed.map((m) => ({ name: m[1], extendsClause: m[2] ?? '', body: '' })),
  ];
  return both.map(({ name, extendsClause, body }) => ({
    name,
    extendsClause,
    entries: [...body.matchAll(/^\s{2}([A-Za-z0-9_]+)(\?)?:/gm)].map((x) => ({ name: x[1], optional: Boolean(x[2]) })),
  }));
};

const interfaces = parseInterfaces(source);
const mainViews = interfaces.find((i) => i.name === 'MainViewsProps');
const slices = interfaces.filter((i) => i.name !== 'MainViewsProps');
const sliceEntries = slices.flatMap((s) => s.entries);

describe('MainViewsProps contract (src/app/mainViewsProps.ts)', () => {
  it('is the single definition — MainViews.tsx must not redeclare it', () => {
    const mainViewsSrc = readFileSync('src/components/MainViews.tsx', 'utf8');
    assert.ok(!/interface MainViewsProps \{/.test(mainViewsSrc), 'MainViews.tsx must not redeclare MainViewsProps');
  });

  it('is purely composed: extends every slice, declares no own members', () => {
    assert.ok(mainViews, 'MainViewsProps interface must exist in the module');
    assert.ok(slices.length >= 6, `expected at least 6 per-domain slices, got ${slices.length}`);
    for (const slice of slices) {
      assert.match(
        mainViews!.extendsClause,
        new RegExp(`\\b${slice.name}\\b`),
        `MainViewsProps must extend ${slice.name}`
      );
    }
    assert.deepEqual(mainViews!.entries, [], 'MainViewsProps must have no own members (pure composition)');
  });

  it('equals the intersection of its six slices at the type level', () => {
    // MainViewsProps is a type alias for the slices' intersection; tsc enforces
    // the two directions here (any drift between the text and the types fails).
    type Expected = AppShellProps &
      DashboardViewProps &
      StudentsViewProps &
      ParentsViewProps &
      PayrollViewProps &
      ExpensesViewProps;
    const _bidirectional: [MainViewsProps] extends [Expected]
      ? [Expected] extends [MainViewsProps]
        ? true
        : never
      : never = true;
    assert.equal(_bidirectional, true);
  });

  it('declares the full contract across the slices, all required (no optional `?`)', () => {
    assert.ok(sliceEntries.length >= 150, `expected the full contract, got ${sliceEntries.length} props`);
    const optional = sliceEntries.filter((e) => e.optional);
    assert.deepEqual(
      optional,
      [],
      `optional props are not allowed in the contract: ${optional.map((o) => o.name).join(', ')}`
    );
  });

  it('contains no `any` anywhere in the module', () => {
    assert.ok(!/\bas\s+any\b|:\s*any\b|<any>/.test(source), 'the contract must not use `any`');
  });

  it('has unique prop names across the union of slices', () => {
    const names = sliceEntries.map((e) => e.name);
    assert.equal(new Set(names).size, names.length, 'duplicate prop names in the contract');
  });

  it('is the file the wiring guard parses (scripts/check-component-props.mjs)', () => {
    const guard = readFileSync('scripts/check-component-props.mjs', 'utf8');
    const m = guard.match(/\{ name: 'MainViews', file: '([^']+)', render/);
    assert.ok(m, 'MainViews entry not found in the wiring guard');
    assert.equal(m[1], MODULE_PATH, 'check-component-props.mjs must parse the dedicated module');
    assert.match(guard, /extends/, 'the guard must resolve the extends composition');
  });

  it('is types-only: importing it has zero runtime side effects', async () => {
    const mod = await import('../src/app/mainViewsProps');
    assert.deepEqual(Object.keys(mod), [], 'a types-only module must export nothing at runtime');
  });
});
