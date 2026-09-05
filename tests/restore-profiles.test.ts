/**
 * Unit tests for supabase/restore-profiles.mjs — the server-side
 * user_profiles export/restore script (service role) that closes the
 * "roles on an empty base" gap left by the in-app backup (which
 * deliberately excludes user_profiles).
 *
 * Only the pure helpers are testable here (pickProfilesRows /
 * normalizeProfileRows / ALLOWED_ROLES). The fetch + CLI layer needs a
 * live Supabase project and a service key, so it stays a manual operation
 * (npm run db:profiles:export / db:profiles:restore).
 *
 * Importing the module must be side-effect free (no .env required) — the
 * lazy requireEnv() guard is itself exercised by this suite loading.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  ALLOWED_ROLES,
  normalizeProfileRows,
  pickProfilesRows,
} from '../supabase/restore-profiles.mjs';

const admin = {
  id: 'u1',
  email: 'awa@mama-thera.org',
  full_name: 'Awa Ndiaye',
  role: 'admin',
  created_at: '2026-08-01T09:00:00Z',
};

describe('restore-profiles — pickProfilesRows', () => {
  it('passes a bare array of rows through', () => {
    assert.deepEqual(pickProfilesRows([admin]), [admin]);
  });

  it('extracts rows from this script\'s own export format ({ app, rows })', () => {
    const payload = {
      app: 'mama-thera-finance',
      table: 'user_profiles',
      exportedAt: '2026-09-05T10:00:00Z',
      rows: [admin],
    };
    assert.deepEqual(pickProfilesRows(payload), [admin]);
  });

  it('extracts rows from a full snapshot shape ({ tables: { user_profiles } })', () => {
    const payload = { tables: { user_profiles: [admin], students: [] } };
    assert.deepEqual(pickProfilesRows(payload), [admin]);
  });

  it('throws on any payload that contains no user_profiles rows', () => {
    assert.throws(() => pickProfilesRows(null));
    assert.throws(() => pickProfilesRows({}));
    assert.throws(() => pickProfilesRows({ app: 'something-else', rows: [] }));
    assert.throws(() => pickProfilesRows({ tables: { students: [] } }));
    assert.throws(() => pickProfilesRows('[]'));
  });
});

describe('restore-profiles — normalizeProfileRows', () => {
  it('keeps only the known columns and defaults full_name', () => {
    const { rows, skipped } = normalizeProfileRows([
      admin,
      { ...admin, id: 'u2', full_name: undefined, extra: 'should-be-dropped' },
    ]);
    assert.equal(skipped.length, 0);
    assert.deepEqual(rows[0], admin, 'known columns preserved verbatim');
    assert.deepEqual(rows[1], {
      id: 'u2',
      email: admin.email,
      full_name: 'New User',
      role: 'admin',
      created_at: admin.created_at,
    }, 'missing full_name falls back to the column default');
  });

  it('drops rows with an unknown or missing role and reports the reason', () => {
    const { rows, skipped } = normalizeProfileRows([
      { ...admin, id: 'u2', role: 'superadmin' },
      { ...admin, id: 'u3', role: undefined },
    ]);
    assert.deepEqual(rows, [], 'no invalid rows restored');
    assert.equal(skipped.length, 2);
    assert.equal(skipped[0].id, 'u2');
    assert.ok(skipped[0].reason.includes('superadmin'));
    assert.equal(skipped[1].id, 'u3');
  });

  it('drops rows without a string id or a NOT-NULL email', () => {
    const { rows, skipped } = normalizeProfileRows([
      { ...admin, id: '' },
      { ...admin, id: 'u4', email: undefined },
      { ...admin, id: 'u5', email: '   ' },
      'not-an-object',
    ]);
    assert.deepEqual(rows, []);
    assert.equal(skipped.length, 4);
    assert.ok(skipped.some((s) => s.id === 'u4' && s.reason.includes('email')));
    assert.ok(skipped.some((s) => s.id === 'u5' && s.reason.includes('email')));
    assert.ok(skipped.some((s) => s.id === null));
  });

  it('accepts rows without created_at (the column has a default)', () => {
    const { rows, skipped } = normalizeProfileRows([
      { id: 'u6', email: 'x@y.org', full_name: 'X', role: 'staff' },
    ]);
    assert.equal(skipped.length, 0);
    assert.equal(rows[0].created_at, undefined, 'omitted, letting the DB default apply');
  });
});

describe('restore-profiles — role model alignment', () => {
  it('ALLOWED_ROLES matches the current schema (incl. general_manager/econome)', () => {
    assert.deepEqual(
      [...ALLOWED_ROLES].sort(),
      ['admin', 'dev', 'econome', 'general_manager', 'staff'],
      'must track supabase/migrations (20260902000001_econome_role.sql and friends)',
    );
  });
});