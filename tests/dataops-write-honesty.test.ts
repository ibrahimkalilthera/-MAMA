/**
 * Suite for the HONEST write path of `src/lib/dataOps/students.ts` and
 * `src/lib/dataOps/parents.ts` — the same rule `staff.ts` already carries.
 *
 * Why the rule exists, measured: PostgREST answers 200 with an EMPTY body when
 * the RLS `USING` clause removes every target row. The DELETE "succeeded",
 * removed nothing, and the toast still said « Élève supprimé(e) » / « Parent
 * supprimé » — over a row still in the table, whose ON DELETE CASCADE (the
 * pupil's payments) never fired, because no row was deleted. And the pupils and
 * parents tables are exactly where a role gate bites: `Authenticated update
 * students` / `Authenticated update parents` allow any signed-in user to update
 * (so a filtered UPDATE is reachable), while `Admin delete students` /
 * `Admin delete parents` confine deletion to admins — a non-admin deleting is
 * precisely the request that returns 200 with nothing done.
 *
 * A write that changed nothing MUST NOT be reported as success; that is the
 * whole point of `.select('id')` plus the empty check.
 *
 * supabaseClient is module-mocked before the import, as in
 * tests/calendar-notes-db.test.ts and tests/staff-write-honesty.test.ts — the
 * real client cannot load under the test runner (no import.meta.env).
 */
import { beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { maskComments } from '../scripts/lib/source-text.mjs';
import { mockModule } from './module-mock';
import type { Parent, Student } from '../src/lib/domainTypes';

const DATAOPS_DIR = join(import.meta.dirname, '..', 'src', 'lib', 'dataOps');

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
// L'écriture du journal d'audit passe par le même faux client : un résultat
// défini dès le départ, sinon chaque cas imprimerait une trace de pile.
const insertResult: Result = { data: null, error: null };
let rowsResult: Result = { data: null, error: null };

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
      // One request, one record: `.eq()` narrows the call already logged by the
      // verb rather than appearing as a second one.
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
  from: (table: string) => ({
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
  }),
};

mockModule('../src/lib/supabaseClient', { supabase: fakeSupabase });

const { createStudentOps } = await import('../src/lib/dataOps/students');
const { createParentOps } = await import('../src/lib/dataOps/parents');

const PUPIL: Student = {
  id: 'st1',
  name: 'Awa Kanté',
  studentId: 'MTH-001',
  grade: '9ème',
  academicYear: '2026-2027',
  parentName: 'Moussa Kanté',
  parentEmail: 'moussa@mamathera.org',
  parentPhone: '70 00 00 00',
  totalDue: 300000,
  amountPaid: 100000,
  dueDate: '2026-12-31',
  notes: '',
  status: 'Active',
  payments: [],
};

const GUARDIAN: Parent = {
  id: 'pa1',
  fullName: 'Moussa Kanté',
  phones: ['70 00 00 00'],
  email: 'moussa@mamathera.org',
  address: '',
  occupation: '',
  relationship: 'Père',
  notes: '',
};

/** Minimal ctx: the ops only read the list, the setters and the notifications. */
function ctxFor<T>(key: 'students' | 'parents', list: T[]) {
  const events: string[] = [];
  let current = [...list];
  const ctx: Record<string, unknown> = {
    [key]: current,
    [key === 'students' ? 'setStudents' : 'setParents']: (next: T[] | ((prev: T[]) => T[])) => {
      current = typeof next === 'function' ? next(current) : next;
    },
    notifySuccess: (operation: string) => events.push(`ok:${operation}`),
    notifyError: (operation: string, message: string) => events.push(`err:${operation}:${message}`),
    isOffline: () => false,
    enqueueOffline: () => events.push('queued'),
  };
  return { ctx, events, state: () => current };
}

function studentOps(list: Student[] = [PUPIL]) {
  const { ctx, events, state } = ctxFor('students', list);
  return {
    ops: createStudentOps(ctx as unknown as Parameters<typeof createStudentOps>[0]),
    events,
    state,
  };
}

function parentOps(list: Parent[] = [GUARDIAN]) {
  const { ctx, events, state } = ctxFor('parents', list);
  return { ops: createParentOps(ctx as unknown as Parameters<typeof createParentOps>[0]), events, state };
}

beforeEach(() => {
  calls = [];
  selects = 0;
  rowsResult = { data: null, error: null };
});

describe('deleteStudent — une suppression filtrée par RLS n’est pas une suppression', () => {
  it('dit la vérité quand la ligne est réellement supprimée', async () => {
    rowsResult = { data: [{ id: 'st1' }], error: null };
    const { ops, events, state } = studentOps();

    assert.equal(await ops.deleteStudent('st1'), true);
    assert.deepEqual(state(), [], 'la ligne quitte la liste locale');
    assert.deepEqual(events, ['ok:deleteStudent'], 'un seul succès, pas d’erreur');

    const deletion = calls.find((c) => c.op === 'delete');
    assert.ok(deletion, 'une requête DELETE est bien partie');
    assert.equal(deletion.table, 'students');
    assert.equal(deletion.eqColumn, 'id');
    assert.equal(deletion.eqValue, 'st1');
    assert.ok(selects > 0, 'la requête demande CE QUI a été supprimé (.select)');
  });

  it('ÉCHOUE et le dit quand la policy a filtré la cible (0 ligne, HTTP 200)', async () => {
    // Le cas réel : un utilisateur connecté non administrateur. La policy
    // « Admin delete students » écarte la ligne, PostgREST répond 200, et
    // l'écran annonçait « Élève supprimé(e) ».
    rowsResult = { data: [], error: null };
    const { ops, events, state } = studentOps();

    assert.equal(await ops.deleteStudent('st1'), false, 'pas de faux succès');
    assert.deepEqual(state(), [PUPIL], 'la ligne reste listée — elle est toujours en base');
    assert.equal(events.filter((e) => e.startsWith('ok:')).length, 0, 'aucun « Élève supprimé » mensonger');
    const failure = events.find((e) => e.startsWith('err:deleteStudent'));
    assert.ok(failure, 'l’échec est signalé');
    assert.ok(failure.length > 'err:deleteStudent:'.length, 'avec une raison lisible, pas un message vide');
  });

  it('une erreur PostgREST reste une erreur', async () => {
    rowsResult = { data: null, error: { message: 'permission denied' } };
    const { ops, events, state } = studentOps();

    assert.equal(await ops.deleteStudent('st1'), false);
    assert.deepEqual(state(), [PUPIL]);
    assert.ok(events.some((e) => e.includes('permission denied')), 'le message du serveur remonte');
  });
});

describe('deleteParent — la même règle pour un parent', () => {
  it('dit la vérité quand la ligne est réellement supprimée', async () => {
    rowsResult = { data: [{ id: 'pa1' }], error: null };
    const { ops, events, state } = parentOps();

    assert.equal(await ops.deleteParent('pa1'), true);
    assert.deepEqual(state(), []);
    assert.deepEqual(events, ['ok:deleteParent']);

    const deletion = calls.find((c) => c.op === 'delete');
    assert.equal(deletion?.table, 'parents');
    assert.equal(deletion?.eqValue, 'pa1');
    assert.ok(selects > 0, '.select demande ce qui a été supprimé');
  });

  it('ÉCHOUE et le dit quand la policy a filtré la cible (0 ligne, HTTP 200)', async () => {
    rowsResult = { data: [], error: null };
    const { ops, events, state } = parentOps();

    assert.equal(await ops.deleteParent('pa1'), false);
    assert.deepEqual(state(), [GUARDIAN], 'le parent reste listé — il est toujours en base');
    assert.equal(events.filter((e) => e.startsWith('ok:')).length, 0);
    assert.ok(events.some((e) => e.startsWith('err:deleteParent')));
  });

  it('une erreur PostgREST reste une erreur', async () => {
    rowsResult = { data: null, error: { message: 'permission denied' } };
    const { ops, events } = parentOps();

    assert.equal(await ops.deleteParent('pa1'), false);
    assert.ok(events.some((e) => e.includes('permission denied')));
  });
});

describe('updateStudent / updateParent — une modification qui ne modifie rien se dit', () => {
  it('updateStudent échoue quand la policy a filtré la cible', async () => {
    rowsResult = { data: [], error: null };
    const { ops, events, state } = studentOps();

    assert.equal(await ops.updateStudent('st1', { totalDue: 450000 }), false);
    assert.equal(state()[0]!.totalDue, 300000, 'la liste locale n’affiche pas un montant que la base n’a pas');
    assert.ok(events.some((e) => e.startsWith('err:updateStudent')));
    assert.ok(selects > 0, '.select demande ce qui a été modifié');
  });

  it('updateStudent réussit quand la ligne est réellement modifiée', async () => {
    rowsResult = { data: [{ id: 'st1' }], error: null };
    const { ops, events, state } = studentOps();

    assert.equal(await ops.updateStudent('st1', { totalDue: 450000 }), true);
    assert.equal(state()[0]!.totalDue, 450000);
    assert.deepEqual(events, ['ok:updateStudent']);
  });

  it('updateParent échoue quand la policy a filtré la cible, et réussit sinon', async () => {
    rowsResult = { data: [], error: null };
    const filtered = parentOps();
    assert.equal(await filtered.ops.updateParent('pa1', { occupation: 'Commerçant' }), false);
    assert.equal(filtered.state()[0]!.occupation, '', 'rien de faux dans la liste locale');

    rowsResult = { data: [{ id: 'pa1' }], error: null };
    const real = parentOps();
    assert.equal(await real.ops.updateParent('pa1', { occupation: 'Commerçant' }), true);
    assert.equal(real.state()[0]!.occupation, 'Commerçant');
  });
});

/**
 * Le garde-fou de la CLASSE, pas de l'occurrence : le défaut réparé trois fois
 * de suite (staff, puis élèves/parents, puis dépenses et tâches) n'était pas
 * trois bugs — c'était une règle appliquée à la main, endroit par endroit.
 * Ce cas lit TOUTE la couche d'écriture et exige, pour chaque suppression :
 *   • la demande de ce qui a été supprimé (`.select`) — sans elle, PostgREST
 *     répond 200 avec un corps vide et rien ne distingue « supprimé » de
 *     « filtré par la policy » ;
 *   • la lecture de ce retour vide dans le fichier (`data.length === 0`) — la
 *     demande sans vérification ne prouve rien.
 * Les commentaires sont blanchis (maskComments) : la prose qui CITE la règle
 * n'est pas la règle.
 */
describe('toute suppression des dataOps est honnête — la règle vaut pour la classe', () => {
  const files = readdirSync(DATAOPS_DIR).filter((name) => name.endsWith('.ts')).sort();
  const sources = files.map((name) => ({ name, masked: maskComments(readFileSync(join(DATAOPS_DIR, name), 'utf8')) }));

  /** Le texte de la requête : de `.delete()` au `;` qui termine l'instruction. */
  const deletionsOf = (masked: string) =>
    [...masked.matchAll(/\.delete\(\)/g)].map((match) => {
      const rest = masked.slice(match.index);
      const end = rest.indexOf(';');
      return end === -1 ? rest : rest.slice(0, end);
    });

  it('lit le corpus — un contrôle qui ne lit rien ne prouve rien', () => {
    assert.ok(files.length >= 6, `les ${files.length} modules d'écriture sont lus`);
    const total = sources.reduce((n, s) => n + deletionsOf(s.masked).length, 0);
    assert.ok(total >= 5, `au moins cinq suppressions à juger (${total} lues)`);
  });

  it('chaque suppression demande ce qui a été supprimé (.select)', () => {
    const silent = sources.flatMap((s) =>
      deletionsOf(s.masked)
        .filter((statement) => !/\.select\(/.test(statement))
        .map(() => s.name),
    );
    assert.deepEqual(
      silent,
      [],
      'ces suppressions ne sauraient pas dire si elles ont supprimé quelque chose : ' + silent.join(', '),
    );
  });

  it('et chaque fichier qui supprime lit le retour vide (0 ligne n’est pas un succès)', () => {
    const filesThatDelete = sources.filter((s) => deletionsOf(s.masked).length > 0).map((s) => s.name);
    const blind = filesThatDelete.filter(
      (name) => !/data\.length === 0/.test(sources.find((s) => s.name === name)!.masked),
    );
    assert.deepEqual(blind, [], 'ces fichiers suppriment sans vérifier ce que la base a rendu : ' + blind.join(', '));
  });
});
