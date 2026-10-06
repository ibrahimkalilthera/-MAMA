/**
 * `mergeStudents` — le geste de l'outil de comparaison, verrouillé sur le CHEMIN
 * D'ÉCRITURE (le seul endroit qui peut faire mal).
 *
 * Ce qui se joue ici n'est pas une forme de données, c'est un ORDRE et une
 * HONNÊTETÉ :
 *
 *   • les reçus changent de fiche AVANT que l'ancienne soit supprimée — l'ordre
 *     inverse laisserait la cascade `ON DELETE CASCADE` détruire des reçus que
 *     l'école a remis à une famille ;
 *   • un déplacement qui ne touche pas TOUTES les lignes attendues (RLS « Admin
 *     update payments », ou reçus modifiés entre-temps) ARRÊTE le geste au lieu
 *     d'enchaîner sur la suppression ;
 *   • une suppression refusée REMET tout en place : reçus sur leur fiche, fiche
 *     gardée à ses valeurs d'avant. Un demi-geste qui survivrait à l'écran serait
 *     pire qu'un refus ;
 *   • hors ligne, la fusion est REFUSÉE (elle bouge plusieurs lignes ; un rejeu
 *     partiel laisserait des reçus orphelins) — même règle que `restorePayment` ;
 *   • le journal reçoit UNE entrée `MERGE_STUDENT` avec l'instantané des deux
 *     fiches, et une suppression écrit désormais ce qui DISTINGUE la fiche (deux
 *     homonymes produisaient deux entrées identiques).
 *
 * Le client Supabase est simulé AVANT l'import (le vrai ne se charge pas sous le
 * runner : pas d'import.meta.env) et scripté par `table.op`, dans l'ordre — c'est
 * ce qui permet de faire répondre « une seule ligne sur deux » à un déplacement.
 */
import { beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mockModule } from './module-mock';
import type { Payment, Student } from '../src/lib/domainTypes';

interface Call {
  op: 'insert' | 'update' | 'delete';
  table: string;
  payload?: Record<string, unknown>;
  eqColumn?: string;
  eqValue?: unknown;
  inColumn?: string;
  inValues?: unknown;
}

interface Result {
  data: unknown;
  error: unknown;
}

let calls: Call[] = [];
/** Les réponses scriptées, par `table.op`, consommées dans l'ordre. */
let script: Map<string, Result[]>;
const scripted = (key: string, result: Result) => script.set(key, [...(script.get(key) ?? []), result]);

interface Chain extends PromiseLike<Result> {
  eq: (column: string, value: unknown) => Chain;
  in: (column: string, values: unknown) => Chain;
  select: (columns?: string) => Chain;
}

function chain(key: string): Chain {
  const api = {
    eq: (column: string, value: unknown) => {
      const last = calls.at(-1);
      if (last) {
        last.eqColumn = column;
        last.eqValue = value;
      }
      return api;
    },
    in: (column: string, values: unknown) => {
      const last = calls.at(-1);
      if (last) {
        last.inColumn = column;
        last.inValues = values;
      }
      return api;
    },
    select: () => api,
    then: (onFulfilled?: (value: Result) => unknown, onRejected?: (reason: unknown) => unknown) =>
      Promise.resolve(script.get(key)?.shift() ?? { data: null, error: null }).then(onFulfilled, onRejected),
  } as unknown as Chain;
  return api;
}

const fakeSupabase = {
  auth: { getUser: async () => ({ data: { user: null } }) },
  from: (table: string) => ({
    update: (payload: Record<string, unknown>) => {
      calls.push({ op: 'update', table, payload });
      return chain(`${table}.update`);
    },
    delete: () => {
      calls.push({ op: 'delete', table });
      return chain(`${table}.delete`);
    },
    insert: (payload: Record<string, unknown>) => {
      calls.push({ op: 'insert', table, payload });
      return chain(`${table}.insert`);
    },
  }),
};

mockModule('../src/lib/supabaseClient', { supabase: fakeSupabase });

const { createStudentOps } = await import('../src/lib/dataOps/students');

// ─── Le cas mesuré : deux « Safiatou COULIBALY » en 5A ───────────────────────

const receipt = (id: string, amount: number, date: string): Payment => ({
  id,
  amount,
  date,
  receiptNumber: `REC-${id}`,
  academicYear: '2026-2027',
});

/** La fiche que l'école GARDE : aucun reçu, solde 0, la note des comptes. */
const KEPT: Student = {
  id: 'saf-1',
  name: 'Safiatou COULIBALY',
  studentId: 'MT-2026-252',
  grade: '5A',
  academicYear: '2026-2027',
  parentName: 'Tuteur',
  parentEmail: '',
  parentPhone: '76313228',
  totalDue: 36000,
  amountPaid: 0,
  dueDate: '2026-12-31',
  status: 'Active',
  notes: 'Inscrite par la tante',
  payments: [],
};

/** Celle qui DISPARAÎT : deux reçus (un import tardif), donc un vrai déplacement. */
const MERGED: Student = {
  ...KEPT,
  id: 'saf-2',
  studentId: 'MT-2026-415',
  parentName: 'Fanta BAH',
  parentPhone: '71121470',
  amountPaid: 36000,
  notes: 'La mère est passée le 05/10',
  payments: [receipt('p1', 20000, '2026-09-24'), receipt('p2', 16000, '2026-10-05')],
};

let offline = false;

function studentOps(list: Student[] = [KEPT, MERGED]) {
  const events: string[] = [];
  let current = [...list];
  const ctx = {
    students: current,
    setStudents: (next: Student[] | ((prev: Student[]) => Student[])) => {
      current = typeof next === 'function' ? next(current) : next;
      ctx.students = current;
    },
    notifySuccess: (operation: string) => events.push(`ok:${operation}`),
    notifyError: (operation: string, message: string) => events.push(`err:${operation}:${message}`),
    isOffline: () => offline,
    enqueueOffline: () => events.push('queued'),
  };
  return {
    ops: createStudentOps(ctx as unknown as Parameters<typeof createStudentOps>[0]),
    events,
    state: () => current,
  };
}

/** Les écritures d'un geste, dans l'ordre où elles sont parties. */
const writes = () => calls.map((c) => `${c.op}:${c.table}`);

beforeEach(() => {
  calls = [];
  script = new Map();
  offline = false;
});

describe('mergeStudents — les reçus changent de fiche AVANT la suppression', () => {
  it('rattache les reçus, additionne le solde, supprime la fiche retirée et écrit UNE entrée de journal', async () => {
    scripted('payments.update', { data: [{ id: 'p1' }, { id: 'p2' }], error: null });
    scripted('students.update', { data: [{ id: 'saf-1' }], error: null });
    scripted('students.delete', { data: [{ id: 'saf-2' }], error: null });
    scripted('audit_logs.insert', { data: null, error: null });

    const { ops, events, state } = studentOps();
    assert.equal(await ops.mergeStudents('saf-1', ['saf-2']), true);
    assert.deepEqual(events, ['ok:mergeStudents'], 'succès annoncé, aucune erreur');

    // 1. Les reçus partent sur la fiche gardée, et le déplacement est VÉRIFIÉ.
    const move = calls.find((c) => c.op === 'update' && c.table === 'payments');
    assert.deepEqual(move?.payload, { student_id: 'saf-1' }, 'les reçus pointent la fiche gardée');
    assert.equal(move?.eqColumn, 'student_id', 'le filtre est la fiche RETIRÉE');
    assert.equal(move?.eqValue, 'saf-2');

    // 2. La fiche gardée reçoit le grand livre consolidé.
    const consolidated = calls.find((c) => c.op === 'update' && c.table === 'students');
    assert.equal(consolidated?.payload?.amount_paid, 36000, 'somme des montants ENREGISTRÉS sur les deux fiches');
    assert.equal(consolidated?.payload?.last_payment_date, '2026-10-05', 'la date la plus récente de toutes');
    assert.match(String(consolidated?.payload?.notes), /Inscrite par la tante/);
    assert.match(String(consolidated?.payload?.notes), /\[fusion \d{4}-\d{2}-\d{2} · MT-2026-415\]/, 'la note de l’autre fiche est recopiée, repère daté compris');
    assert.match(String(consolidated?.payload?.notes), /La mère est passée le 05\/10/);

    // 3. La suppression arrive APRÈS, en un seul geste, et elle ne vise que l'autre fiche.
    const removal = calls.find((c) => c.op === 'delete' && c.table === 'students');
    assert.ok(removal, 'la fiche fusionnée est supprimée');
    assert.equal(removal?.inColumn, 'id');
    assert.deepEqual(removal?.inValues, ['saf-2']);
    assert.deepEqual(
      writes(),
      ['update:payments', 'update:students', 'delete:students'],
      'l’ordre est le fond du geste : reçus, solde, puis suppression',
    );
    // Le journal part en « fire and forget » (comme tous les autres gestes du
    // dépôt) : sa ligne arrive après le retour de la fonction, pas avant.
    await new Promise((resolve) => setTimeout(resolve, 0));

    // 4. L'écran : une seule fiche, avec les deux reçus.
    const remaining = state();
    assert.equal(remaining.length, 1);
    assert.equal(remaining[0].id, 'saf-1');
    assert.deepEqual(remaining[0].payments.map((p) => p.id), ['p1', 'p2']);
    assert.equal(remaining[0].amountPaid, 36000);

    // 5. Le journal : UNE entrée, qui nomme les deux fiches et porte leurs instantanés.
    const logs = calls.filter((c) => c.op === 'insert' && c.table === 'audit_logs');
    assert.equal(logs.length, 1, 'une fusion = une entrée, pas une par fiche');
    assert.equal(logs[0].payload?.action, 'MERGE_STUDENT');
    assert.equal(logs[0].payload?.target_id, 'saf-1', 'la cible est la fiche GARDÉE');
    assert.match(String(logs[0].payload?.details), /MT-2026-415/, 'la phrase nomme la fiche retirée par son matricule');
    assert.match(String(logs[0].payload?.details), /MT-2026-252/, 'et la fiche gardée aussi');
    const metadata = logs[0].payload?.metadata as Record<string, unknown>;
    assert.equal(metadata.kind, 'student_merge');
    assert.deepEqual(metadata.moved_payment_ids, ['p1', 'p2']);
    assert.equal((metadata.kept as Record<string, unknown>).matricule, 'MT-2026-252');
    assert.equal((metadata.removed as Record<string, unknown>[]).length, 1);
  });

  it('hors ligne, refuse sans toucher à la base — la file ne sait pas déplacer des reçus', async () => {
    offline = true;
    const { ops, events, state } = studentOps();

    assert.equal(await ops.mergeStudents('saf-1', ['saf-2']), false);
    assert.deepEqual(calls, [], 'aucune requête ne part');
    assert.equal(state().length, 2, 'les deux fiches restent, intactes');
    assert.match(events.join(' '), /^err:mergeStudents:La fusion demande le réseau/);
    assert.ok(!events.includes('queued'), 'rien n’est mis en file : un rejeu partiel ferait des reçus orphelins');
  });
});

describe('mergeStudents — un demi-geste ne survit pas', () => {
  it('un déplacement INCOMPLET arrête tout : rien n’est supprimé et les reçus reviennent', async () => {
    // « Admin update payments » filtre en RLS : la réponse dit 200 avec MOINS de
    // lignes que prévu. Croire « déplacé » ferait supprimer la fiche, et la
    // cascade emporterait les reçus restés derrière.
    scripted('payments.update', { data: [{ id: 'p1' }], error: null });
    scripted('payments.update', { data: [{ id: 'p1' }], error: null });
    scripted('payments.update', { data: [{ id: 'p2' }], error: null });

    const { ops, events, state } = studentOps();
    assert.equal(await ops.mergeStudents('saf-1', ['saf-2']), false);
    assert.match(events.join(' '), /err:mergeStudents:Reçus non rattachés/);

    assert.equal(
      calls.filter((c) => c.op === 'delete').length,
      0,
      'aucune suppression : c’est la seule façon de ne pas perdre les reçus',
    );
    const back = calls.filter((c) => c.op === 'update' && c.table === 'payments' && c.eqColumn === 'id');
    assert.deepEqual(back.map((c) => c.payload?.student_id), ['saf-2', 'saf-2'], 'chaque reçu remis sur sa fiche');
    assert.deepEqual(state().map((s) => s.id), ['saf-1', 'saf-2'], 'les deux fiches sont encore là');
  });

  it('une suppression refusée remet les reçus ET la fiche gardée dans leur état d’avant', async () => {
    scripted('payments.update', { data: [{ id: 'p1' }, { id: 'p2' }], error: null });
    scripted('students.update', { data: [{ id: 'saf-1' }], error: null });
    scripted('students.delete', { data: [], error: null });
    scripted('payments.update', { data: [{ id: 'p1' }], error: null });
    scripted('payments.update', { data: [{ id: 'p2' }], error: null });
    scripted('students.update', { data: [{ id: 'saf-1' }], error: null });

    const { ops, events, state } = studentOps();
    assert.equal(await ops.mergeStudents('saf-1', ['saf-2']), false);
    assert.match(events.join(' '), /err:mergeStudents:Fiches non supprimées/);

    const studentUpdates = calls.filter((c) => c.op === 'update' && c.table === 'students');
    assert.equal(studentUpdates.length, 2, 'la consolidation, puis le retour en arrière');
    assert.deepEqual(
      studentUpdates[1].payload,
      { amount_paid: 0, last_payment_date: null, notes: 'Inscrite par la tante' },
      'la fiche gardée retrouve exactement ses valeurs d’avant',
    );
    assert.equal(state().find((s) => s.id === 'saf-1')?.amountPaid, 0, 'et l’écran aussi');
    assert.equal(calls.filter((c) => c.op === 'insert' && c.table === 'audit_logs').length, 0, 'rien n’a été fusionné, donc rien n’est annoncé au journal');
  });

  it('refuse une fusion sans fiche à fusionner, ou vers une fiche inconnue', async () => {
    const { ops, events } = studentOps();

    assert.equal(await ops.mergeStudents('saf-1', []), false);
    assert.equal(await ops.mergeStudents('saf-1', ['saf-1']), false, 'une fiche ne se fusionne pas dans elle-même');
    assert.equal(await ops.mergeStudents('fantôme', ['saf-2']), false);
    assert.equal(calls.length, 0, 'aucune de ces demandes n’atteint la base');
    assert.equal(events.filter((e) => e.startsWith('err:')).length, 3);
  });
});

describe('deleteStudent — le journal dit LAQUELLE des deux homonymes', () => {
  it('nomme la fiche par son matricule, sa classe, son parent et ses reçus', async () => {
    scripted('students.delete', { data: [{ id: 'saf-2' }], error: null });
    scripted('audit_logs.insert', { data: null, error: null });

    const { ops } = studentOps();
    assert.equal(await ops.deleteStudent('saf-2'), true);

    const log = calls.find((c) => c.op === 'insert' && c.table === 'audit_logs');
    assert.equal(log?.payload?.action, 'DELETE_STUDENT');
    assert.match(String(log?.payload?.details), /MT-2026-415/);
    assert.match(String(log?.payload?.details), /5A/);
    assert.match(String(log?.payload?.details), /Fanta BAH/);
    assert.match(String(log?.payload?.details), /2 reçus/);
    const metadata = log?.payload?.metadata as Record<string, unknown>;
    assert.equal(metadata.kind, 'student_row', 'l’instantané de la fiche part avec l’entrée');
    assert.equal(metadata.matricule, 'MT-2026-415');
    assert.equal(metadata.amount_paid, 36000);
  });
});
