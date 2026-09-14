/**
 * Suite for the HONEST write path of `src/lib/dataOps/staff.ts`.
 *
 * The defect these cases lock down is the cheapest kind to ship and the most
 * expensive to notice: PostgREST answers 200 with an EMPTY body when the RLS
 * `USING` clause removes every target row. The DELETE "succeeded", removed
 * nothing, and the toast still said « Employé supprimé » — over a member still
 * in the table, whose salary_payments were left behind too (their ON DELETE
 * CASCADE never fires, because no row was deleted). A write that changed nothing
 * MUST NOT be reported as success; that is the whole point of `.select('id')`
 * plus the empty check in deleteStaff/updateStaff.
 *
 * supabaseClient is module-mocked (node:test --experimental-test-module-mocks)
 * before the import, as in tests/calendar-notes-db.test.ts — the real client
 * cannot load under the test runner (no import.meta.env).
 */
import { beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mockModule } from './module-mock';
import type { SupabaseDataCtx } from '../src/lib/dataOpsContext';
import type { Staff } from '../src/lib/domainTypes';

interface Call {
  op: 'insert' | 'update' | 'delete' | 'select';
  table: string;
  payload?: Record<string, unknown>;
  eqColumn?: string;
  eqValue?: unknown;
}

interface Result {
  data: unknown;
  error: unknown;
}

let calls: Call[] = [];
let selects = 0;
// Defined from the start: audit logging writes through the same fake, and an
// undefined result there would print a stack trace on every case.
let insertResult: Result = { data: null, error: null };
let rowsResult: Result = { data: null, error: null };
let currentTable = '';

interface Chain extends PromiseLike<Result> {
  eq: (column: string, value: unknown) => Chain;
  select: (columns?: string) => Chain;
  single: () => Promise<Result>;
}

/** A thenable query builder: awaiting it resolves the scripted result. */
function chain(resolveWith: () => Result): Chain {
  const promise = Promise.resolve().then(resolveWith);
  const api = {
    eq: (column: string, value: unknown) => {
      // One request, one record: the `.eq()` narrows the call already logged by
      // the verb, rather than appearing as a second one.
      const last = calls.at(-1);
      if (last) {
        last.eqColumn = column;
        last.eqValue = value;
      }
      return api;
    },
    select: () => {
      selects += 1;
      return api;
    },
    single: () => Promise.resolve().then(resolveWith),
    then: promise.then.bind(promise),
  } as unknown as Chain;
  return api;
}

const fakeSupabase = {
  auth: { getUser: async () => ({ data: { user: null } }) },
  from: (table: string) => {
    currentTable = table;
    return {
      select: () => {
        calls.push({ op: 'select', table });
        return chain(() => rowsResult);
      },
      insert: (payload: Record<string, unknown>) => {
        calls.push({ op: 'insert', table, payload });
        return chain(() => insertResult);
      },
      update: (payload: Record<string, unknown>) => {
        calls.push({ op: 'update', table, payload });
        return chain(() => rowsResult);
      },
      delete: () => {
        calls.push({ op: 'delete', table });
        return chain(() => rowsResult);
      },
    };
  },
};

mockModule('../src/lib/supabaseClient', { supabase: fakeSupabase });

const { createStaffOps } = await import('../src/lib/dataOps/staff');

const MEMBER: Staff = {
  id: 's1',
  name: 'Fatou Traoré',
  position: 'Enseignante',
  salary: 120000,
  email: 'fatou@mamathera.org',
  phone: '70 00 00 00',
  bankDetails: '',
  emergencyContact: '',
};

function makeOps(list: Staff[] = [MEMBER]): {
  ops: ReturnType<typeof createStaffOps>;
  events: string[];
  staffState: () => Staff[];
} {
  const events: string[] = [];
  let current = [...list];
  const ctx = {
    staff: current,
    setStaff: (next: Staff[] | ((prev: Staff[]) => Staff[])) => {
      current = typeof next === 'function' ? next(current) : next;
    },
    notifySuccess: (operation: string) => events.push(`ok:${operation}`),
    notifyError: (operation: string, message: string) => events.push(`err:${operation}:${message}`),
    isOffline: () => false,
    enqueueOffline: () => events.push('queued'),
  } as unknown as SupabaseDataCtx;
  return { ops: createStaffOps(ctx), events, staffState: () => current };
}

const NEW_MEMBER = {
  name: 'Salif Diarra',
  position: 'Agent technique polyvalent',
  salary: 100000,
  email: 'salif@mamathera.org',
  phone: '70 00 00 00',
  bankDetails: '',
  emergencyContact: '',
} as const;

describe('deleteStaff — une suppression filtrée par RLS n’est pas une suppression', () => {
  beforeEach(() => {
    calls = [];
    selects = 0;
    rowsResult = { data: null, error: null };
  });

  it('dit la vérité quand la ligne est réellement supprimée', async () => {
    rowsResult = { data: [{ id: 's1' }], error: null };
    const { ops, events, staffState } = makeOps();

    assert.equal(await ops.deleteStaff('s1'), true);
    assert.deepEqual(staffState(), [], 'la ligne quitte la liste locale');
    assert.deepEqual(events, ['ok:deleteStaff'], 'un seul succès, pas d’erreur');

    const deletion = calls.find((c) => c.op === 'delete');
    assert.ok(deletion, 'une requête DELETE est bien partie');
    assert.equal(deletion.table, 'staff');
    assert.equal(deletion.eqColumn, 'id');
    assert.equal(deletion.eqValue, 's1');
    assert.ok(selects > 0, 'la requête demande CE QUI a été supprimé (.select)');
  });

  it('ÉCHOUE et le dit quand la policy a filtré la cible (0 ligne, HTTP 200)', async () => {
    rowsResult = { data: [], error: null };
    const { ops, events, staffState } = makeOps();

    assert.equal(await ops.deleteStaff('s1'), false, 'pas de faux succès');
    assert.deepEqual(staffState(), [MEMBER], 'la ligne reste listée — elle est toujours en base');
    assert.equal(events.filter((e) => e.startsWith('ok:')).length, 0, 'aucun « Employé supprimé » mensonger');
    const failure = events.find((e) => e.startsWith('err:deleteStaff'));
    assert.ok(failure, 'l’échec est signalé');
    assert.ok(failure.length > 'err:deleteStaff:'.length, 'avec une raison lisible, pas un message vide');
  });

  it('une erreur PostgREST reste une erreur', async () => {
    rowsResult = { data: null, error: { message: 'permission denied' } };
    const { ops, events, staffState } = makeOps();

    assert.equal(await ops.deleteStaff('s1'), false);
    assert.deepEqual(staffState(), [MEMBER]);
    assert.ok(events.some((e) => e.includes('permission denied')), 'le message du serveur remonte');
  });
});

describe('updateStaff — même règle pour une modification qui ne modifie rien', () => {
  beforeEach(() => {
    calls = [];
    selects = 0;
    rowsResult = { data: null, error: null };
  });

  it('dit la vérité quand la ligne est réellement modifiée', async () => {
    rowsResult = { data: [{ id: 's1' }], error: null };
    const { ops, events } = makeOps();

    assert.equal(await ops.updateStaff('s1', { salary: 140000 }), true);
    assert.deepEqual(events, ['ok:updateStaff']);
    const update = calls.find((c) => c.op === 'update');
    assert.equal(update?.payload?.salary, 140000, 'le salaire part bien en base');
    assert.ok(selects > 0, '.select demande ce qui a été modifié');
  });

  it('ÉCHOUE quand la policy a filtré la cible — sans mentir dans la liste locale', async () => {
    rowsResult = { data: [], error: null };
    const { ops, events, staffState } = makeOps();

    assert.equal(await ops.updateStaff('s1', { salary: 140000 }), false);
    assert.equal(staffState()[0]!.salary, 120000, 'la liste locale n’affiche pas un salaire que la base n’a pas');
    assert.equal(events.filter((e) => e.startsWith('ok:')).length, 0);
    assert.ok(events.some((e) => e.startsWith('err:updateStaff')));
  });

  it('transporte la catégorie quand elle est fournie, et ne l’efface pas sinon', async () => {
    rowsResult = { data: [{ id: 's1' }], error: null };
    const { ops } = makeOps();

    await ops.updateStaff('s1', { category: 'technique' });
    const withKind = calls.filter((c) => c.op === 'update').at(-1);
    assert.equal(withKind?.payload?.category, 'technique');

    calls = [];
    await ops.updateStaff('s1', { salary: 130000 });
    const withoutKind = calls.filter((c) => c.op === 'update').at(-1);
    assert.equal('category' in (withoutKind?.payload ?? {}), false, 'une édition sans catégorie ne la remet pas à zéro');
  });
});

describe('addStaff — le kind écrit est celui du flux, jamais celui du libellé', () => {
  beforeEach(() => {
    calls = [];
    selects = 0;
    insertResult = { data: { id: 'db-1' }, error: null };
  });

  it('écrit la catégorie du flux qui a créé le membre', async () => {
    const payload = { ...NEW_MEMBER, category: 'technique' as const };
    insertResult = { data: { id: 'db-2', ...payload }, error: null };
    const { ops } = makeOps();

    const created = await ops.addStaff(payload);
    assert.ok(created, 'le membre créé est retourné');
    const insert = calls.find((c) => c.op === 'insert' && c.table === 'staff');
    assert.ok(insert, 'un INSERT part');
    assert.equal(insert.payload?.category, 'technique', 'la catégorie est écrite avec le membre');
    assert.equal(
      insert.payload?.position,
      'Agent technique polyvalent',
      'le libellé humain est conservé tel quel — la catégorie ne le remplace pas',
    );
  });

  it('un membre sans catégorie est écrit comme employé (colonne NOT NULL)', async () => {
    const { ops } = makeOps();
    await ops.addStaff({ ...NEW_MEMBER, position: 'Comptable' });

    const insert = calls.find((c) => c.op === 'insert');
    assert.equal(insert?.payload?.category, 'employee', 'jamais NULL : la valeur par défaut est explicite');
  });
});
