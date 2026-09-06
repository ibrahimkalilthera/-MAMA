// Tests for scripts/verify-anon-rls.mjs — the CI guard that proves the anon
// role can neither read nor write any business table after migrations.
// A stub PostgREST simulates the two possible worlds:
//   • healthy   — service_role full access, anon reads empty, anon writes refused
//   • breached  — an anon INSERT policy exists (a 201 sneaks through)
// The guard must pass in the first world and fail loudly in the second.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { verifyAnonRls, PROBE_NAME } from '../scripts/verify-anon-rls.mjs';

const TABLES = ['students', 'payments', 'expenses', 'todos'];

interface StubRow {
  id: string;
  name: string;
}

interface StubOptions {
  /** anon INSERT returns 201 and really stores the row (breach world). */
  allowAnonInsert?: boolean;
  /** anon GET returns the real rows (read breach world). */
  leakAnonReads?: boolean;
}

/** Minimal PostgREST twin: students table only, RLS semantics per world. */
function stubSupabase({ allowAnonInsert = false, leakAnonReads = false }: StubOptions = {}) {
  const rows: StubRow[] = [{ id: 'stu-seed', name: PROBE_NAME }];
  let seq = 1;

  return async (input: Parameters<typeof fetch>[0], init: RequestInit = {}) => {
    const url = String(input);
    const path = url.slice(url.indexOf('/rest/v1/') + 9);
    const method = init.method ?? 'GET';
    const headers = init.headers as Record<string, string>;
    const isService = headers?.Authorization?.includes('service') ?? false;
    const anon = !isService;
    const body = init.body ? JSON.parse(init.body as string) : {};

    const json = (data: unknown, status: number, extra: Record<string, string> = {}) =>
      // 204 No Content interdit tout corps — les réponses vides anon (RLS qui
      // filtre 0 ligne) sont donc sans body, comme le vrai PostgREST.
      status === 204
        ? new Response(null, { status, headers: extra })
        : new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json', ...extra } });

    // GET students (sweep anon, sans filtre) et students?id=eq.<id>
    const idMatch = path.match(/^students\?id=eq\.([\w-]+)$/);
    if (method === 'GET' && (idMatch || path === 'students')) {
      const row = idMatch ? rows.find((r) => r.id === idMatch[1]) : undefined;
      if (anon && leakAnonReads) return json(rows, 200);
      if (anon) return json([], 200); // RLS filters everything
      return json(idMatch ? (row ? [row] : []) : rows, 200);
    }

    // POST students (seed / probes)
    if (method === 'POST' && path === 'students') {
      if (anon && allowAnonInsert) {
        const row: StubRow = { id: `stu-${seq++}`, name: body.name };
        rows.push(row);
        return json([row], 201);
      }
      if (anon) return json({ message: 'new row violates row-level security policy' }, 403);
      const row: StubRow = { id: `stu-${seq++}`, name: body.name };
      rows.push(row);
      return json([row], 201);
    }

    // POST {} sweep on other tables
    if (method === 'POST') {
      if (anon) return json({ message: 'new row violates row-level security policy' }, 403);
      return json([{ id: `row-${seq++}` }], 201);
    }

    // PATCH students?id=eq.<id>
    if (method === 'PATCH' && idMatch) {
      if (anon) return json([], 204); // RLS matches 0 rows: empty success
      const row = rows.find((r) => r.id === idMatch[1]);
      if (row) row.name = body.name ?? row.name;
      return json(row ? [row] : [], 200);
    }

    // DELETE students?id=eq.<id>
    if (method === 'DELETE' && idMatch) {
      if (anon) return json([], 204);
      const idx = rows.findIndex((r) => r.id === idMatch[1]);
      if (idx >= 0) rows.splice(idx, 1);
      return json([], 204);
    }

    return json({ message: 'not stubbed' }, 404);
  };
}

const run = (opts: StubOptions = {}) =>
  verifyAnonRls({
    base: 'http://stub',
    anonKey: 'anon-key',
    serviceKey: 'service-key',
    fetchImpl: stubSupabase(opts),
    tables: TABLES,
  });

describe('verifyAnonRls (garde-fou CI RLS anon)', () => {
  it('passe dans le monde sain : lecture ET écritures anon refusées', async () => {
    const { ok, failures } = await run();
    assert.equal(ok, true, failures.join(' | '));
  });

  it('refuse le monde sain quand INSERT anon réussit (policy anon ajoutée)', async () => {
    const { ok, failures } = await run({ allowAnonInsert: true });
    assert.equal(ok, false, 'le garde-fou doit échouer si un insert anon passe');
    assert.ok(failures.some((f) => f.includes('insert anon refusé sur students')), failures.join(' | '));
  });

  it('refuse le monde sain quand les lectures anon fuient', async () => {
    const { ok, failures } = await run({ leakAnonReads: true });
    assert.equal(ok, false, 'le garde-fou doit échouer si une lecture anon remonte des lignes');
    assert.ok(failures.some((f) => f.includes('lecture anon refusée sur students')), failures.join(' | '));
  });
});