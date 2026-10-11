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
import { OfflineQueueWriteError } from '../src/lib/offlineQueue';
import { mockModule } from './module-mock';
import type { Expense, Parent, Payment, SalaryPayment, Staff, Student, Todo, VendorExpense } from '../src/lib/domainTypes';

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
let insertResult: Result = { data: null, error: null };
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
const { createStaffOps } = await import('../src/lib/dataOps/staff');
const { createExpenseOps } = await import('../src/lib/dataOps/expenses');
const { createTodoOps } = await import('../src/lib/dataOps/todos');
const { createPaymentOps } = await import('../src/lib/dataOps/payments');

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
  insertResult = { data: null, error: null };
});

describe('addStudent — un second envoi du MÊME geste ne crée pas un second élève', () => {
  /** La forme que l'écran envoie : la fiche, plus l'id du geste. */
  type StudentDraft = Omit<Student, 'id' | 'payments'> & { id?: string };
  // Un VRAI uuid : `rowIdColumn` omet la colonne pour tout ce qui n'en est pas un
  // (le repli historique quand WebCrypto manque), et l'idempotence disparaît avec
  // elle — le cas non-uuid est donc mesuré par ce choix, pas supposé.
  const GESTURE_ID = '9f8b7a6c-1111-4222-8333-444455556666';

  it('envoie l’id du geste — c’est lui qui rend l’écriture idempotente', async () => {
    insertResult = { data: { id: GESTURE_ID, name: 'Awa Kanté', status: 'Active' }, error: null };
    const { ops } = studentOps([]);

    const created = await ops.addStudent({ ...PUPIL, id: GESTURE_ID } as StudentDraft);

    const insert = calls.find((c) => c.op === 'insert' && c.table === 'students');
    assert.ok(insert, 'un INSERT part');
    assert.equal(insert.payload?.id, GESTURE_ID, 'la clé primaire est celle du geste, pas une clé générée par la base');
    assert.equal(created?.id, GESTURE_ID);
  });

  it('un 23505 (geste DÉJÀ enregistré) rend la ligne en base — sans erreur ni seconde ligne de journal', async () => {
    // Le second envoi du même geste tombe sur la clé primaire : Postgres refuse.
    // Ce n'est PAS une erreur de l'utilisateur, c'est l'idempotence qui marche.
    insertResult = { data: null, error: { message: 'duplicate key value violates unique constraint "students_pkey"', code: '23505' } };
    rowsResult = {
      data: {
        id: GESTURE_ID, name: 'Awa Kanté', parent_name: 'Tuteur', parent_phone: '70 00 00 00',
        total_due: 36000, amount_paid: 0, due_date: '2026-01-01', status: 'Active', note_entries: [],
      },
      error: null,
    };
    const { ops, events, state } = studentOps([]);

    const existing = await ops.addStudent({ ...PUPIL, id: GESTURE_ID } as StudentDraft);

    assert.equal(existing?.id, GESTURE_ID, 'la ligne déjà en base est rendue');
    assert.equal(events.filter((e) => e.startsWith('err:')).length, 0, 'un double envoi n’est pas annoncé comme un échec');
    assert.equal(
      calls.filter((c) => c.op === 'insert' && c.table === 'audit_logs').length,
      0,
      'un élève, un geste, UNE ligne d’audit — pas une par envoi répété',
    );
    assert.equal(state().filter((s) => s.id === GESTURE_ID).length, 1, 'un seul élève dans la liste locale');
  });
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

/**
 * L'id du GESTE n'est pas propre aux élèves.
 *
 * Le 2026-10-05, la création EN LIGNE d'un élève n'envoyait aucun id : chaque
 * double envoi créait une ligne de plus (« Mahamadou DJIRE » ×7). Le défaut était
 * identique sur les autres tables (« Reste ouvert, et dit »). Ce bloc exige, pour
 * chaque domaine, que l'INSERT porte l'id du geste ET qu'un `23505` (même geste,
 * déjà enregistré) rende la ligne EN BASE — sans erreur, sans doublon, sans une
 * seconde ligne de journal.
 */
function opsCtx(stateKey: string, setterKey: string, initial: unknown[] = []) {
  const events: string[] = [];
  let current: unknown[] = [...initial];
  const track = (next: unknown[] | ((prev: unknown[]) => unknown[])) => {
    current = typeof next === 'function' ? next(current) : next;
  };
  // Les dataOps lisent aussi un état VOISIN (dépenses ↔ charges fournisseur,
  // paiement ↔ élèves) : on les fournit vides, puis l'état SUIVI écrase le sien
  // — sinon le faux setter secondaire masquerait celui qu'on veut observer.
  const ctx: Record<string, unknown> = {
    notifySuccess: (operation: string) => events.push(`ok:${operation}`),
    notifyError: (operation: string, message: string) => events.push(`err:${operation}:${message}`),
    isOffline: () => false,
    enqueueOffline: () => events.push('queued'),
    students: [], setStudents: () => {},
    expenses: [], setExpenses: () => {},
    vendorExpenses: [], setVendorExpenses: () => {},
    salaryPayments: [], setSalaryPayments: () => {},
    staff: [], setStaff: () => {}, parents: [], setParents: () => {}, todos: [], setTodos: () => {},
    updateQueueCount: () => {},
  };
  ctx[stateKey] = current;
  ctx[setterKey] = track;
  return { ctx, events, state: () => current };
}

describe('l’idempotence de création vaut pour TOUTES les tables, pas seulement les élèves', () => {
  const GESTURE_ID = '9f8b7a6c-1111-4222-8333-444455556666';
  const CONFLICT = { message: 'duplicate key value violates unique constraint', code: '23505' };

  type LooseOps = Record<string, (arg: unknown) => Promise<{ id?: string } | null>>;

  // Chaque domaine : une fabrique d'ops, la table visée, la forme envoyée, la
  // ligne que la base renvoie après l'INSERT.
  const domains = [
    {
      label: 'parents', table: 'parents', stateKey: 'parents', setterKey: 'setParents',
      ops: (ctx: unknown) => createParentOps(ctx as Parameters<typeof createParentOps>[0]),
      call: (ops: LooseOps) => ops.addParent({ fullName: 'Moussa', phones: ['70'], address: 'N/A', occupation: 'N/A', relationship: 'Père', id: GESTURE_ID } as Omit<Parent, 'id'> & { id?: string }),
      row: { id: GESTURE_ID, full_name: 'Moussa', phones: ['70'], address: 'N/A', occupation: 'N/A', relationship: 'Père' },
    },
    {
      label: 'personnel', table: 'staff', stateKey: 'staff', setterKey: 'setStaff',
      ops: (ctx: unknown) => createStaffOps(ctx as Parameters<typeof createStaffOps>[0]),
      call: (ops: LooseOps) => ops.addStaff({ name: 'Awa', position: 'Comptable', salary: 120000, id: GESTURE_ID } as Omit<Staff, 'id'> & { id?: string }),
      row: { id: GESTURE_ID, name: 'Awa', position: 'Comptable', salary: 120000, category: 'employee' },
    },
    {
      label: 'dépenses', table: 'expenses', stateKey: 'expenses', setterKey: 'setExpenses',
      ops: (ctx: unknown) => createExpenseOps(ctx as Parameters<typeof createExpenseOps>[0]),
      call: (ops: LooseOps) => ops.addExpense({ category: 'internet', description: 'Fibre', amount: 25000, date: '2026-10-05', id: GESTURE_ID } as Omit<Expense, 'id'> & { id?: string }),
      row: { id: GESTURE_ID, category: 'internet', description: 'Fibre', amount: 25000, date: '2026-10-05' },
    },
    {
      label: 'charges fournisseur', table: 'vendor_expenses', stateKey: 'vendorExpenses', setterKey: 'setVendorExpenses',
      ops: (ctx: unknown) => createExpenseOps(ctx as Parameters<typeof createExpenseOps>[0]),
      call: (ops: LooseOps) => ops.addVendorExpense({ vendorName: 'X', category: 'internet', amount: 1000, dueDate: '2026-10-05', paymentStatus: 'unpaid', amountPaid: 0, id: GESTURE_ID } as Omit<VendorExpense, 'id'> & { id?: string }),
      row: { id: GESTURE_ID, vendor_name: 'X', category: 'internet', amount: 1000, due_date: '2026-10-05', payment_status: 'unpaid', amount_paid: 0 },
    },
    {
      label: 'tâches', table: 'todos', stateKey: 'todos', setterKey: 'setTodos',
      ops: (ctx: unknown) => createTodoOps(ctx as Parameters<typeof createTodoOps>[0]),
      call: (ops: LooseOps) => ops.addTodo({ text: 'Appeler parent', completed: false, id: GESTURE_ID } as Omit<Todo, 'id'> & { id?: string }),
      row: { id: GESTURE_ID, text: 'Appeler parent', completed: false },
    },
    {
      label: 'salaires', table: 'salary_payments', stateKey: 'salaryPayments', setterKey: 'setSalaryPayments',
      ops: (ctx: unknown) => createPaymentOps(ctx as Parameters<typeof createPaymentOps>[0]),
      call: (ops: LooseOps) => ops.addSalaryPayment({ staffId: 's1', amount: 50000, date: '2026-10-05', id: GESTURE_ID } as Omit<SalaryPayment, 'id'> & { id?: string }),
      row: { id: GESTURE_ID, staff_id: 's1', amount: 50000, date: '2026-10-05' },
    },
  ];

  for (const d of domains) {
    it(`add(${d.label}) : l’id du geste part dans l’INSERT`, async () => {
      const { ctx } = opsCtx(d.stateKey, d.setterKey);
      const ops = d.ops(ctx) as unknown as LooseOps;
      insertResult = { data: d.row, error: null };

      await d.call(ops);

      const insert = calls.find((c) => c.op === 'insert' && c.table === d.table);
      assert.ok(insert, `un INSERT vers ${d.table} part`);
      assert.equal(insert.payload?.id, GESTURE_ID, `la clé primaire de ${d.table} est celle du geste`);
    });

    it(`add(${d.label}) : un 23505 = geste déjà enregistré, la ligne en base est rendue (sans erreur ni journal)`, async () => {
      const { ctx, events, state } = opsCtx(d.stateKey, d.setterKey);
      const ops = d.ops(ctx) as unknown as LooseOps;
      insertResult = { data: null, error: CONFLICT };
      rowsResult = { data: d.row, error: null };

      const existing = await d.call(ops);

      assert.equal(existing?.id, GESTURE_ID, 'la ligne déjà en base est rendue');
      assert.equal(events.filter((e) => e.startsWith('err:')).length, 0, 'un double envoi n’est pas un échec');
      assert.equal(
        calls.filter((c) => c.op === 'insert' && c.table === 'audit_logs').length,
        0,
        'un geste, une ligne d’audit — pas une de plus au second envoi',
      );
      assert.equal(state().filter((x) => (x as { id?: string }).id === GESTURE_ID).length, 1, 'une seule ligne locale');
    });
  }
});

describe('addPayment — l’id du geste empêche un second reçu', () => {
  // Le paiement porte l'id du geste : un double envoi retombe sur la même clé
  // primaire (`payments_pkey`), donc la base refuse au lieu d'écrire un second
  // reçu — et le solde de l'élève n'est incrémenté qu'une fois.
  const GESTURE_ID = '9f8b7a6c-1111-4222-8333-444455556666';
  type PaymentDraft = Omit<Payment, 'receiptNumber'> & { receiptNumber?: string };
  const PAYING_STUDENT = {
    id: 'st1', name: 'Ali Diallo', amountPaid: 50000, totalDue: 150000, dueDate: '2026-12-31',
    parentName: '', parentEmail: '', parentPhone: '', notes: '', payments: [],
  };

  function paymentOps() {
    const { ctx, events, state } = opsCtx('students', 'setStudents', [PAYING_STUDENT]);
    return {
      ops: createPaymentOps(ctx as unknown as Parameters<typeof createPaymentOps>[0]),
      events,
      state,
    };
  }

  it('envoie l’id du geste dans l’INSERT et n’ajoute le paiement qu’une fois à l’écran', async () => {
    insertResult = { data: null, error: null };
    const { ops, state } = paymentOps();

    await ops.addPayment('st1', { date: '2026-10-05', amount: 25000, academicYear: '2026-2027', id: GESTURE_ID } as PaymentDraft);

    const insert = calls.find((c) => c.op === 'insert' && c.table === 'payments');
    assert.ok(insert, 'l’INSERT part vers payments');
    assert.equal(insert.payload?.id, GESTURE_ID, 'la clé primaire est celle du geste');
    const s = state()[0] as { payments: unknown[]; amountPaid: number };
    assert.equal(s.payments.length, 1, 'un seul paiement local');
    assert.equal(s.amountPaid, 75000, 'le solde de l’élève avance du montant');
  });

  it('un 23505 (geste déjà enregistré) ne crée pas un second reçu ni ne double le solde', async () => {
    insertResult = { data: null, error: null };
    const { ops, events, state } = paymentOps();
    const draft = { date: '2026-10-05', amount: 25000, id: GESTURE_ID } as PaymentDraft;
    await ops.addPayment('st1', draft);

    // Second envoi du MÊME geste : Postgres refuse la clé primaire déjà prise.
    insertResult = { data: null, error: { message: 'duplicate key value violates unique constraint "payments_pkey"', code: '23505' } };
    const ok = await ops.addPayment('st1', draft);

    assert.equal(ok, true, 'un double envoi n’est pas un échec');
    assert.equal(events.filter((e) => e.startsWith('err:')).length, 0, 'aucun message d’erreur affiché');
    const s = state()[0] as { payments: unknown[]; amountPaid: number };
    assert.equal(s.payments.length, 1, 'un seul reçu local, pas deux');
    assert.equal(s.amountPaid, 75000, 'le solde n’a été incrémenté qu’une fois');
  });
});

/**
 * `deletePayment` — le recours quand un paiement a été saisi par erreur.
 *
 * Trois contrats, et chacun répare un mensonge possible :
 *   • une ligne réellement retirée redescend le solde de l'élève ET laisse une
 *     entrée `DELETE_PAYMENT` au journal (montant, reçu, élève) ;
 *   • une suppression que la policy « Admin delete payments » a filtrée (0 ligne,
 *     HTTP 200) ÉCHOUE et le DIT — la ligne reste à l'écran ;
 *   • hors ligne, rien n'est tenté : le geste part dans la file, l'écran est
 *     mis à jour tout de suite.
 */
describe('deletePayment — retirer le seul reçu fautif, et l’écrire au journal', () => {
  const PAY1 = { id: 'pay1', date: '2026-10-01', amount: 25000, receiptNumber: 'REC-1' } as Payment;
  const PAY2 = { id: 'pay2', date: '2026-10-03', amount: 50000, receiptNumber: 'REC-2' } as Payment;
  const PAYING = {
    id: 'st1', name: 'Ali Diallo', amountPaid: 75000, totalDue: 150000, dueDate: '2026-12-31',
    parentName: '', parentEmail: '', parentPhone: '', notes: '', payments: [PAY1, PAY2],
  };

  function opsFor(list: unknown[] = [PAYING]) {
    const { ctx, events, state } = opsCtx('students', 'setStudents', list);
    return {
      ctx,
      events,
      state,
      ops: createPaymentOps(ctx as unknown as Parameters<typeof createPaymentOps>[0]),
    };
  }

  it('supprime la ligne, redescend le solde, et écrit DELETE_PAYMENT avec montant + reçu', async () => {
    rowsResult = { data: [{ id: 'pay1' }], error: null };
    const { ops, events, state } = opsFor();

    assert.equal(await ops.deletePayment('st1', PAY1), true);
    assert.deepEqual(events, ['ok:deletePayment'], 'un seul succès, aucune erreur');

    const s = state()[0] as { payments: { id: string }[]; amountPaid: number; lastPaymentDate?: string };
    assert.equal(s.payments.length, 1, 'seul le paiement fautif part');
    assert.equal(s.payments[0]!.id, 'pay2');
    assert.equal(s.amountPaid, 50000, 'le solde redescend du montant annulé');
    assert.equal(s.lastPaymentDate, '2026-10-03', 'la dernière date suit le paiement qui reste');

    const deletion = calls.find((c) => c.op === 'delete');
    assert.ok(deletion, 'un DELETE part vers payments');
    assert.equal(deletion.table, 'payments');
    assert.equal(deletion.eqColumn, 'id');
    assert.equal(deletion.eqValue, 'pay1');
    assert.ok(selects > 0, 'la requête demande CE QUI a été supprimé (.select)');

    const audit = calls.find((c) => c.op === 'insert' && c.table === 'audit_logs');
    assert.ok(audit, 'la suppression est consignée dans le journal');
    assert.equal(audit.payload?.action, 'DELETE_PAYMENT');
    assert.equal(audit.payload?.target_type, 'payment');
    // `target_id` = l'id du PAIEMENT : c'est lui qui relie l'entrée à son
    // instantané, donc à une restauration.
    assert.equal(audit.payload?.target_id, 'pay1', 'le journal vise l’id du paiement');
    assert.match(String(audit.payload?.details), /25000/, 'le montant annulé est écrit');
    assert.match(String(audit.payload?.details), /REC-1/, 'le numéro de reçu est écrit');
    assert.match(String(audit.payload?.details), /Ali Diallo/, 'et le nom de l’élève');
    // L'instantané qui rend le geste ANNULABLE : la ligne entière, de quoi la
    // réinsérer à l'identique.
    const meta = audit.payload?.metadata as Record<string, unknown>;
    assert.equal(meta?.kind, 'payment_row');
    assert.equal(meta?.payment_id, 'pay1');
    assert.equal(meta?.student_id, 'st1');
    assert.equal(meta?.date, '2026-10-01');
    assert.equal(meta?.amount, 25000);
    assert.equal(meta?.receipt_number, 'REC-1');
  });

  it('ÉCHOUE et le dit quand la policy a filtré la cible (0 ligne, HTTP 200)', async () => {
    rowsResult = { data: [], error: null };
    const { ops, events, state } = opsFor();

    assert.equal(await ops.deletePayment('st1', PAY1), false, 'pas de faux succès');
    const s = state()[0] as { payments: unknown[]; amountPaid: number };
    assert.equal(s.payments.length, 2, 'le paiement reste listé — il est toujours en base');
    assert.equal(s.amountPaid, 75000, 'le solde ne bouge pas');
    assert.equal(events.filter((e) => e.startsWith('ok:')).length, 0, 'aucun « Paiement supprimé » mensonger');
    const failure = events.find((e) => e.startsWith('err:deletePayment'));
    assert.ok(failure, 'l’échec est signalé');
    assert.ok(failure.length > 'err:deletePayment:'.length, 'avec une raison lisible');
    assert.equal(
      calls.filter((c) => c.op === 'insert' && c.table === 'audit_logs').length,
      0,
      'rien n’est journalisé : la base n’a rien supprimé',
    );
  });

  it('hors ligne, le geste part dans la file et l’écran est mis à jour tout de suite', async () => {
    const { ctx, events, state } = opsFor();
    (ctx as Record<string, unknown>).isOffline = () => true;
    const offlineOps = createPaymentOps(ctx as unknown as Parameters<typeof createPaymentOps>[0]);

    assert.equal(await offlineOps.deletePayment('st1', PAY1), true);
    assert.ok(events.includes('queued'), 'la suppression est mise en file');
    assert.equal(calls.filter((c) => c.op === 'delete').length, 0, 'aucune requête tentée sans réseau');
    const s = state()[0] as { payments: { id: string }[]; amountPaid: number };
    assert.equal(s.payments.length, 1, 'l’écran ne montre plus le paiement annulé');
    assert.equal(s.amountPaid, 50000);
  });

  it('un solde déjà plus bas que le montant annulé ne devient pas négatif', async () => {
    rowsResult = { data: [{ id: 'pay1' }], error: null };
    // Dérive possible des données : le solde enregistré est INFÉRIEUR au montant
    // du reçu qu'on retire. La forme honnête est 0, jamais une dette négative.
    const { ops, state } = opsFor([{ ...PAYING, amountPaid: 10000 }]);

    assert.equal(await ops.deletePayment('st1', PAY1), true);
    assert.equal((state()[0] as { amountPaid: number }).amountPaid, 0);
  });
});

/**
 * `restorePayment` — l'ANNULATION d'une suppression, depuis le journal d'audit.
 *
 * Deux contrats, et chacun répare un mensonge possible :
 *   • restaurer RÉINSÈRE la ligne (même id, donc même reçu), remonte le solde et
 *     écrit une entrée `RESTORE_PAYMENT` ;
 *   • une seconde restauration (ou un rejeu) ne double ni la ligne ni le solde —
 *     la base répond 23505, et on le lit « déjà revenu », pas « erreur ».
 */
describe('restorePayment — remettre le reçu retiré, et l’écrire au journal', () => {
  const PAY1 = { id: 'pay1', date: '2026-10-01', amount: 25000, receiptNumber: 'REC-1' } as Payment;
  const PAY2 = { id: 'pay2', date: '2026-10-03', amount: 50000, receiptNumber: 'REC-2' } as Payment;
  // L'élève APRÈS la suppression : il ne reste que le second paiement.
  const AFTER_DELETE = {
    id: 'st1', name: 'Ali Diallo', amountPaid: 50000, totalDue: 150000, dueDate: '2026-12-31',
    parentName: '', parentEmail: '', parentPhone: '', notes: '', payments: [PAY2],
  };
  const ARCHIVED = {
    paymentId: 'pay1', studentId: 'st1', studentName: 'Ali Diallo', date: '2026-10-01',
    amount: 25000, receiptNumber: 'REC-1', academicYear: '2026-2027',
  };

  function opsFor(list: unknown[] = [AFTER_DELETE]) {
    const { ctx, events, state } = opsCtx('students', 'setStudents', list);
    return { ctx, events, state, ops: createPaymentOps(ctx as unknown as Parameters<typeof createPaymentOps>[0]) };
  }

  it('réinsère la ligne avec son id d’origine, remonte le solde, et journalise RESTORE_PAYMENT', async () => {
    insertResult = { data: null, error: null };
    rowsResult = { data: null, error: null };
    const { ops, events, state } = opsFor();

    assert.equal(await ops.restorePayment(ARCHIVED), true);
    assert.deepEqual(events, ['ok:restorePayment']);

    const insert = calls.find((c) => c.op === 'insert' && c.table === 'payments');
    assert.ok(insert, 'un INSERT part vers payments');
    assert.equal(insert.payload?.id, 'pay1', 'la ligne retrouve son id d’origine');
    assert.equal(insert.payload?.student_id, 'st1');
    assert.equal(insert.payload?.date, '2026-10-01');
    assert.equal(insert.payload?.amount, 25000);
    assert.equal(insert.payload?.receipt_number, 'REC-1');

    const s = state()[0] as { payments: { id: string }[]; amountPaid: number; lastPaymentDate?: string };
    assert.equal(s.payments.length, 2, 'le reçu revient dans la liste');
    assert.ok(s.payments.some((p) => p.id === 'pay1'), 'avec son id');
    assert.equal(s.amountPaid, 75000, 'le solde remonte du montant restauré');
    assert.equal(s.lastPaymentDate, '2026-10-03');

    const audit = calls.find((c) => c.op === 'insert' && c.table === 'audit_logs');
    assert.ok(audit, 'la restauration est consignée dans le journal');
    assert.equal(audit.payload?.action, 'RESTORE_PAYMENT');
    assert.equal(audit.payload?.target_id, 'pay1');
    assert.match(String(audit.payload?.details), /restauré/);
    assert.match(String(audit.payload?.details), /Ali Diallo/);
  });

  it('une seconde restauration (23505) ne double ni la ligne ni le solde', async () => {
    insertResult = { data: null, error: { code: '23505', message: 'duplicate key' } };
    rowsResult = { data: null, error: null };
    const withPayment = [{ ...AFTER_DELETE, payments: [PAY2, PAY1], amountPaid: 75000 }];
    const { ops, events, state } = opsFor(withPayment);

    assert.equal(await ops.restorePayment(ARCHIVED), true, 'déjà revenu = succès, pas erreur');
    assert.equal(events.filter((e) => e.startsWith('err:')).length, 0, 'aucune erreur criée');
    const s = state()[0] as { payments: unknown[]; amountPaid: number };
    assert.equal(s.payments.length, 2, 'pas de seconde ligne');
    assert.equal(s.amountPaid, 75000, 'pas de second crédit');
  });

  it('hors ligne, rien n’est tenté : la restauration demande le réseau', async () => {
    const { ctx, events } = opsFor();
    (ctx as Record<string, unknown>).isOffline = () => true;
    const offlineOps = createPaymentOps(ctx as unknown as Parameters<typeof createPaymentOps>[0]);

    assert.equal(await offlineOps.restorePayment(ARCHIVED), false);
    assert.equal(calls.filter((c) => c.op === 'insert').length, 0, 'aucune requête tentée sans réseau');
    assert.ok(events.find((e) => e.startsWith('err:restorePayment')), 'l’échec est dit');
  });
});

/**
 * « Enregistré » est une PROMESSE — et la file hors ligne peut la refuser.
 *
 * La file vit dans `localStorage`, qui a un quota : quand il est atteint,
 * `setItem` LÈVE. L'ancien chemin avalait cet échec dans un `console.error` et
 * l'écran annonçait quand même « Paiement enregistré » — le reçu était déjà dans
 * la main du parent, et la ligne n'existait nulle part. Ces cas éprouvent le
 * refus sur les TROIS gestes d'argent : le reçu, son annulation, et le salaire.
 *
 * Le refus est injecté par le faux `enqueueOffline` du ctx (c'est la même
 * frontière que la vraie file : `OfflineQueueWriteError`), donc le cas ne dépend
 * ni d'un quota réel ni d'un navigateur.
 */
describe('file hors ligne qui REFUSE — l’argent ne s’annonce pas « enregistré »', () => {
  const PAYING = {
    id: 'st1', name: 'Ali Diallo', amountPaid: 50000, totalDue: 150000, dueDate: '2026-12-31',
    parentName: '', parentEmail: '', parentPhone: '', notes: '', payments: [],
  };
  const PAY1 = { id: 'pay1', date: '2026-10-01', amount: 25000, receiptNumber: 'REC-1' } as Payment;
  const REFUSAL = () => new OfflineQueueWriteError('storage-failed', 'quota atteint');

  /**
   * Un ctx hors ligne dont la file refuse, et les événements qu'il a vus.
   *
   * Le faux `enqueueOffline` imite le VRAI ctx (celui de useSupabaseData) : il
   * annonce le refus à l'écran, PUIS le relance. C'est ce contrat-là que les ops
   * d'argent lisent — annoncer une fois, rendre l'échec, ne pas répéter.
   */
  function refusingOps() {
    const base = opsCtx('students', 'setStudents', [PAYING]);
    const ctx = base.ctx as Record<string, unknown>;
    const notify = ctx.notifyError as (operation: string, message: string) => void;
    ctx.isOffline = () => true;
    ctx.enqueueOffline = () => {
      notify('enqueue', REFUSAL().message);
      throw REFUSAL();
    };
    return { ...base, ops: createPaymentOps(ctx as unknown as Parameters<typeof createPaymentOps>[0]) };
  }

  it('un reçu dont la file refuse n’est PAS enregistré — et l’écran le dit', async () => {
    const { ops, events } = refusingOps();

    assert.equal(
      await ops.addPayment('st1', { id: 'pay9', date: '2026-10-01', amount: 25000, receiptNumber: 'REC-9' }),
      false,
      'pas de faux succès : l’appelant doit savoir que rien n’est retenu',
    );
    assert.equal(events.filter((e) => e.startsWith('ok:')).length, 0, 'aucun « Paiement enregistré » mensonger');
    const failure = events.find((e) => e.startsWith('err:'));
    assert.ok(failure, 'l’échec est signalé');
    assert.match(failure, /PAS été enregistré/, 'et il dit que le geste n’est pas enregistré');
    assert.equal(
      events.filter((e) => e.startsWith('err:')).length,
      1,
      'un seul message : le refus est annoncé par la file, jamais deux fois',
    );
  });

  it('l’annulation d’un reçu dont la file refuse se dit aussi', async () => {
    const { ops, events } = refusingOps();

    assert.equal(await ops.deletePayment('st1', PAY1), false);
    assert.equal(events.filter((e) => e.startsWith('ok:')).length, 0, 'aucune « Paiement supprimé » mensongère');
    assert.ok(events.find((e) => e.startsWith('err:')), 'l’échec est dit');
  });

  it('un salaire dont la file refuse ne rend pas la ligne locale', async () => {
    const { ops, events } = refusingOps();

    assert.equal(
      await ops.addSalaryPayment({ date: '2026-10-01', amount: 50000, staffId: 'sf1' } as SalaryPayment),
      null,
      'rendre la ligne locale ferait croire au bureau qu’elle est rangée',
    );
    assert.equal(events.filter((e) => e.startsWith('ok:')).length, 0);
    assert.ok(events.find((e) => e.startsWith('err:')), 'l’échec est dit');
  });

  it('à l’inverse, une file qui ACCEPTE annonce bien « enregistré » (le refus ne déborde pas)', async () => {
    const base = opsCtx('students', 'setStudents', [PAYING]);
    const ctx = base.ctx as Record<string, unknown>;
    ctx.isOffline = () => true;
    ctx.enqueueOffline = () => base.events.push('queued');
    const ops = createPaymentOps(ctx as unknown as Parameters<typeof createPaymentOps>[0]);

    assert.equal(
      await ops.addPayment('st1', { id: 'pay9', date: '2026-10-01', amount: 25000, receiptNumber: 'REC-9' }),
      true,
    );
    assert.ok(base.events.includes('queued'), 'le geste est bien parti dans la file');
    assert.ok(base.events.includes('ok:addPayment'), 'et il est annoncé');
  });
});
