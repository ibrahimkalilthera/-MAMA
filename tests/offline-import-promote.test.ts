/**
 * Import Excel et passage de classe HORS LIGNE.
 *
 * Ce que ces deux gestes avaient en commun, mesuré : ils parlaient à Supabase
 * en direct. Sans réseau, l'import échouait ligne par ligne et la promotion
 * rendait `true` pour ZÉRO élève promu — l'écran annonçait « Passage de classe
 * effectué avec succès » sur une base inchangée, la pire des sorties possibles
 * (un succès affiché sur une écriture qui n'a pas eu lieu).
 *
 * Ce que ce fichier verrouille :
 *   • hors ligne, les deux gestes passent par les fonctions d'écriture du
 *     DOMAINE — donc par la file d'attente — et l'écran montre tout de suite ce
 *     qui a été saisi ;
 *   • AUCUNE requête ne part dans cet état (compté, pas supposé) ;
 *   • le contrat de retour est exact : `true` seulement si tous les élèves du lot
 *     sont passés, en ligne comme hors ligne.
 *
 * supabaseClient est simulé avant l'import (le vrai client ne se charge pas sous
 * le lanceur de tests) et chaque appel est enregistré : c'est ce journal qui
 * prouve le « zéro réseau ».
 */
import { beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mockModule } from './module-mock';
import type { Expense, Parent, Staff, Student } from '../src/lib/domainTypes';

// ── faux client Supabase (enregistre chaque appel) ───────────────────────────
interface Call {
  op: 'insert' | 'update' | 'delete' | 'select';
  table: string;
  payload?: Record<string, unknown>;
}

let calls: Call[] = [];
let rowsResult: { data: unknown; error: unknown } = { data: null, error: null };

interface Chain extends PromiseLike<{ data: unknown; error: unknown }> {
  eq: (column: string, value: unknown) => Chain;
  select: (columns?: string) => Chain;
  single: () => Promise<{ data: unknown; error: unknown }>;
}

function chain(resolveWith: () => { data: unknown; error: unknown }): Chain {
  const promise = Promise.resolve().then(resolveWith);
  const api = {
    eq: () => api,
    select: () => api,
    single: () => Promise.resolve().then(resolveWith),
    then: promise.then.bind(promise),
  } as unknown as Chain;
  return api;
}

const fakeSupabase = {
  auth: {
    getUser: async () => ({ data: { user: null } }),
    getSession: async () => ({ data: { session: null } }),
    onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }),
  },
  from: (table: string) => ({
    select: () => {
      calls.push({ op: 'select', table });
      return chain(() => rowsResult);
    },
    insert: (payload: Record<string, unknown>) => {
      calls.push({ op: 'insert', table, payload });
      return chain(() => ({ data: null, error: null }));
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
  rpc: async () => ({ data: null, error: null }),
};

mockModule('../src/lib/supabaseClient', { supabase: fakeSupabase });

const { importBatchData } = await import('../src/lib/batchImport');
const { createStudentOps } = await import('../src/lib/dataOps/students');
const { createParentOps } = await import('../src/lib/dataOps/parents');
const { createStaffOps } = await import('../src/lib/dataOps/staff');
const { createExpenseOps } = await import('../src/lib/dataOps/expenses');
const { createPaymentOps } = await import('../src/lib/dataOps/payments');
const { clearOfflineQueue, getOfflineQueue, enqueueOfflineAction } = await import('../src/lib/offlineQueue');
const { isUuid } = await import('../src/lib/rowMappers');

// ── Fixtures ─────────────────────────────────────────────────────────────────
const pupil = (over: Partial<Student> = {}): Student => ({
  id: 'st1',
  name: 'Awa Kanté',
  studentId: 'MTH-001',
  grade: '9ème',
  academicYear: '2025-2026',
  parentName: 'Moussa Kanté',
  parentEmail: 'moussa@mamathera.org',
  parentPhone: '70 00 00 00',
  totalDue: 300000,
  amountPaid: 100000,
  dueDate: '2026-12-31',
  notes: '',
  status: 'Active',
  payments: [],
  ...over,
});

const staffMember = (over: Partial<Staff> = {}): Staff => ({
  id: 'sf1',
  name: 'Fatou Traoré',
  position: 'teacher',
  salary: 150000,
  email: '',
  phone: '',
  bankDetails: '',
  emergencyContact: '',
  ...over,
});

const expense = (over: Partial<Expense> = {}): Expense => ({
  id: 'ex1',
  category: 'stationery',
  description: 'Craies',
  amount: 5000,
  date: '2026-01-05',
  ...over,
});

// ── Un poste complet, hors ligne ou non ──────────────────────────────────────
interface HarnessOptions {
  offline: boolean;
  students?: Student[];
  parents?: Parent[];
  staff?: Staff[];
  expenses?: Expense[];
}

function station(options: HarnessOptions) {
  const state = {
    students: [...(options.students ?? [pupil()])],
    parents: [...(options.parents ?? [])],
    staff: [...(options.staff ?? [staffMember()])],
    expenses: [...(options.expenses ?? [expense()])],
    salaryPayments: [] as Array<{ id: string }>,
  };
  const events: string[] = [];
  const setter = <K extends keyof typeof state>(key: K) =>
    (next: (typeof state)[K] | ((prev: (typeof state)[K]) => (typeof state)[K])) => {
      state[key] = (typeof next === 'function' ? (next as (p: (typeof state)[K]) => (typeof state)[K])(state[key]) : next) as (typeof state)[K];
    };

  const ctx = {
    students: state.students,
    staff: state.staff,
    parents: state.parents,
    vendorExpenses: [],
    expenses: state.expenses,
    setParents: setter('parents'),
    setStudents: setter('students'),
    setStaff: setter('staff'),
    setSalaryPayments: setter('salaryPayments'),
    setExpenses: setter('expenses'),
    setVendorExpenses: () => {},
    setTodos: () => {},
    setCustomClasses: () => {},
    notifySuccess: (operation: string) => events.push(`ok:${operation}`),
    notifyError: (operation: string, message: string) => events.push(`err:${operation}:${message}`),
    isOffline: () => options.offline,
    enqueueOffline: (type: never, payload: never, localId?: string) => {
      enqueueOfflineAction(type, payload, localId);
    },
    updateQueueCount: () => {},
  } as unknown as Parameters<typeof createStudentOps>[0];

  const students = createStudentOps(ctx);
  const parents = createParentOps(ctx);
  const staff = createStaffOps(ctx);
  const expenses = createExpenseOps(ctx);
  const payments = createPaymentOps(ctx);

  return {
    state,
    events,
    students,
    write: {
      addStudent: students.addStudent,
      updateStudent: students.updateStudent,
      addParent: parents.addParent,
      updateParent: parents.updateParent,
      addStaff: staff.addStaff,
      updateStaff: staff.updateStaff,
      addExpense: expenses.addExpense,
      updateExpense: expenses.updateExpense,
      addPayment: payments.addPayment,
    },
    /** Les dépendances de l'import, avec des lectures VIVANTES de l'état local. */
    deps() {
      return {
        get students() { return state.students; },
        get parents() { return state.parents; },
        get staff() { return state.staff; },
        get expenses() { return state.expenses; },
        fetchAll: async () => { events.push('fetchAll'); },
        notifySuccess: (operation: string) => events.push(`ok:${operation}`),
        notifyError: (operation: string, message: string) => events.push(`err:${operation}:${message}`),
        isOffline: () => options.offline,
        write: this.write,
      };
    },
  };
}

const IMPORTS = { academicYear: '2026-2027', duplicateStrategy: 'skip' as const };

beforeEach(() => {
  calls = [];
  rowsResult = { data: [{ id: 'st1' }], error: null };
  clearOfflineQueue();
});

// ── Tests ────────────────────────────────────────────────────────────────────

describe('import Excel HORS LIGNE — rien n’exige la ligne', () => {
  const NEW_PUPILS = [
    { name: 'Sidi Coulibaly', grade: '9B', parentName: 'Cheick Coulibaly', parentPhone: '83040998', totalDue: 90000 },
    { name: 'Aminata Bah', grade: '9B', parentName: 'Ibrahim Bah', parentPhone: '79160594', totalDue: 90000 },
  ];

  it('met les élèves importés en FILE, met l’écran à jour, et ne touche PAS à la base', async () => {
    const s = station({ offline: true });

    const result = await importBatchData('students', NEW_PUPILS, IMPORTS, s.deps());

    assert.deepEqual(result, { inserted: 2, updated: 0, errors: 0 });
    assert.deepEqual(calls, [], 'hors ligne, AUCUNE requête ne doit partir');
    assert.equal(s.state.students.length, 3, 'les deux élèves sont visibles tout de suite');

    const queue = getOfflineQueue();
    assert.equal(queue.length, 2);
    assert.deepEqual(queue.map((i) => i.type), ['addStudent', 'addStudent']);
    for (const [index, item] of queue.entries()) {
      const localId = item.localId;
      assert.ok(isUuid(localId), 'la ligne garde son identité jusqu’à la base');
      assert.equal(s.state.students[index + 1].id, localId, 'l’id en file est celui de l’élève à l’écran');
    }
  });

  it('n’écrit RIEN en base mais n’exige pas non plus de relire : l’état optimiste est la vérité', async () => {
    const s = station({ offline: true });
    await importBatchData('students', NEW_PUPILS, IMPORTS, s.deps());

    assert.ok(!s.events.includes('fetchAll'), 'relire effacerait de l’écran ce qui vient d’être saisi');
    assert.ok(s.events.includes('ok:batchImport_students'), 'l’utilisateur est prévenu que l’import est pris en compte');
  });

  it('relancer le même fichier ne double rien (doublons reconnus sur les lignes en file)', async () => {
    const s = station({ offline: true });
    await importBatchData('students', NEW_PUPILS, IMPORTS, s.deps());
    const afterFirst = getOfflineQueue().length;

    const second = await importBatchData('students', NEW_PUPILS, IMPORTS, s.deps());

    assert.deepEqual(second, { inserted: 0, updated: 2, errors: 0 });
    assert.equal(getOfflineQueue().length, afterFirst, 'aucune ligne en file en plus');
    assert.equal(s.state.students.length, 3);
  });

  it('stratégie « mettre à jour » : la modification part en file, elle aussi', async () => {
    const s = station({ offline: true });

    const result = await importBatchData(
      'students',
      [{ name: 'Awa Kanté', grade: '9ème', parentName: 'Moussa Kanté', totalDue: 350000 }],
      { academicYear: '2026-2027', duplicateStrategy: 'update' },
      s.deps(),
    );

    assert.deepEqual(result, { inserted: 0, updated: 1, errors: 0 });
    assert.deepEqual(calls, []);
    const [item] = getOfflineQueue();
    assert.equal(item.type, 'updateStudent');
    assert.equal(item.payload.id, 'st1');
    assert.equal(s.state.students[0].totalDue, 350000, 'l’écran montre la nouvelle valeur');
  });

  it('les règlements importés suivent l’élève, hors ligne', async () => {
    const s = station({ offline: true });

    const result = await importBatchData(
      'payments',
      [{ studentName: 'Awa Kanté', amount: 50000, date: '2026-01-10', receiptNumber: 'R-9' }],
      IMPORTS,
      s.deps(),
    );

    assert.deepEqual(result, { inserted: 1, updated: 0, errors: 0 });
    assert.deepEqual(calls, []);
    const [item] = getOfflineQueue();
    assert.equal(item.type, 'addPayment');
    assert.equal(item.payload.studentId, 'st1');
  });

  it('le personnel et les dépenses passent par la même voie', async () => {
    const s = station({ offline: true });

    const staffResult = await importBatchData('staff', [{ name: 'Awa Sow', position: 'teacher', salary: 120000 }], IMPORTS, s.deps());
    const expenseResult = await importBatchData('expenses', [{ description: 'Carburant', amount: 20000, date: '2026-01-11' }], IMPORTS, s.deps());

    assert.equal(staffResult.inserted, 1);
    assert.equal(expenseResult.inserted, 1);
    assert.deepEqual(calls, []);
    assert.deepEqual(getOfflineQueue().map((i) => i.type), ['addStaff', 'addExpense']);
  });
});

describe('passage de classe HORS LIGNE — et un contrat de retour exact', () => {
  const PROMOTIONS = [
    { studentId: 'st1', action: 'promote' as const, targetGrade: '1ère', targetAcademicYear: '2026-2027', newTotalDue: 320000 },
    { studentId: 'st2', action: 'graduate' as const, targetAcademicYear: '2026-2027' },
  ];

  it('met les promotions en file, met l’écran à jour, sans aucune requête', async () => {
    const s = station({ offline: true, students: [pupil(), pupil({ id: 'st2', name: 'Bakary Diarra' })] });

    const ok = await s.students.batchPromoteStudents(PROMOTIONS);

    assert.equal(ok, true, 'tous les élèves du lot sont passés (en file)');
    assert.deepEqual(calls, [], 'hors ligne, la promotion ne parle pas à la base');
    const promoted = s.state.students[0];
    assert.equal(promoted.academicYear, '2026-2027');
    assert.equal(promoted.grade, '1ère');
    assert.equal(promoted.totalDue, 320000);
    assert.equal(promoted.amountPaid, 0, 'le nouveau total repart de zéro');
    assert.equal(promoted.status, 'Active');
    assert.equal(s.state.students[1].status, 'Graduated');

    assert.deepEqual(getOfflineQueue().map((i) => i.type), ['updateStudent', 'updateStudent']);
    const first = getOfflineQueue()[0];
    assert.equal(first.type === 'updateStudent' ? first.payload.id : null, 'st1');
  });

  it('rend false si un élève du lot n’est pas passé — plus jamais « succès » pour zéro', async () => {
    const s = station({ offline: true, students: [pupil()] });

    const ok = await s.students.batchPromoteStudents([
      { studentId: 'st1', action: 'promote', targetAcademicYear: '2026-2027' },
      { studentId: 'inconnu', action: 'promote', targetAcademicYear: '2026-2027' },
    ]);

    assert.equal(ok, false, 'un lot partiellement traité ne s’annonce pas comme réussi');
    assert.equal(getOfflineQueue().length, 1, 'l’élève connu, lui, est bien en file');
  });

  it('en ligne, une écriture filtrée par la RLS (0 ligne) fait échouer la promotion', async () => {
    const s = station({ offline: false, students: [pupil()] });
    rowsResult = { data: [], error: null }; // PostgREST : 200, corps vide

    const ok = await s.students.batchPromoteStudents([
      { studentId: 'st1', action: 'promote', targetAcademicYear: '2026-2027' },
    ]);

    assert.equal(ok, false);
    assert.ok(s.events.some((e) => e.startsWith('err:updateStudent')), 'l’échec est annoncé');
    assert.equal(s.state.students[0].academicYear, '2025-2026', 'rien n’a changé sur l’écran');
    assert.deepEqual(getOfflineQueue(), [], 'une écriture refusée n’est pas mise en file');
  });

  it('en ligne, la promotion écrit une fois par élève et rend true', async () => {
    const s = station({ offline: false, students: [pupil(), pupil({ id: 'st2' })] });

    const ok = await s.students.batchPromoteStudents(PROMOTIONS);

    assert.equal(ok, true);
    const updates = calls.filter((c) => c.op === 'update' && c.table === 'students');
    assert.equal(updates.length, 2, 'une écriture par élève, avec le même row mapping que le formulaire');
    assert.equal(updates[0].payload?.academic_year, '2026-2027');
    assert.equal(updates[1].payload?.status, 'Graduated');
    assert.deepEqual(getOfflineQueue(), []);
  });
});
