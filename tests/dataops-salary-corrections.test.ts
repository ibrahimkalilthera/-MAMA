/**
 * Suite for the ONLINE correction path of `src/lib/dataOps/salaryCorrections.ts`
 * — `deleteSalaryPayment` / `restoreSalaryPayment`, the pair that lets the school
 * undo ONE faulty payroll line instead of deleting the member whose
 * `salary_payments` cascade away with it.
 *
 * Two rules are locked here, and neither is cosmetic:
 *
 *   • **la règle honnête d'écriture** : PostgREST répond 200 avec un corps VIDE
 *     quand la policy RLS (« Finance admins delete salary_payments ») écarte la
 *     ligne. Une suppression qui n'a rien supprimé ne doit PAS être annoncée
 *     comme réussie — et elle ne doit laisser AUCUNE trace dans le journal, sinon
 *     l'école lirait qu'un salaire a été retiré alors qu'il est toujours en base ;
 *   • **la trace réparable** : la suppression écrit `DELETE_SALARY_PAYMENT` avec
 *     l'instantané structuré (`src/lib/salaryUndo.ts`) et `target_id` = l'ID DU
 *     PAIEMENT (jamais celui du membre) — c'est ce couple qui rend le geste
 *     annulable, et la restauration réinsère la MÊME ligne (même id, mêmes
 *     champs) avant d'écrire `RESTORE_SALARY_PAYMENT`.
 *
 * `supabaseClient` est simulé AVANT l'import (comme
 * tests/staff-write-honesty.test.ts) : le vrai client ne se charge pas sous le
 * runner (pas d'import.meta.env).
 */
import { beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mockModule } from './module-mock';
import { archivedSalaryOf } from '../src/lib/salaryUndo';
import type { ArchivedSalaryPayment } from '../src/lib/salaryUndo';
import type { SupabaseDataCtx } from '../src/lib/dataOpsContext';
import type { SalaryPayment, Staff } from '../src/lib/domainTypes';

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
/** Ce que rendent `delete()` / `select()` / `update()` — donc l'issue de la ligne. */
let rowsResult: Result = { data: null, error: null };
/** Ce que rend l'insertion d'une ligne `salary_payments` (la restauration). */
let rowInsertResult: Result = { data: null, error: null };
// Toujours défini : le journal s'écrit par le même faux client, et un résultat
// `undefined` y imprimerait une trace de pile à chaque cas.
let journalResult: Result = { data: null, error: null };

interface Chain extends PromiseLike<Result> {
  eq: (column: string, value: unknown) => Chain;
  select: (columns?: string) => Chain;
}

/** A thenable query builder: awaiting it resolves the scripted result. */
function chain(resolveWith: () => Result): Chain {
  const promise = Promise.resolve().then(resolveWith);
  const api = {
    eq: (column: string, value: unknown) => {
      // Une requête, une entrée : `.eq()` précise l'appel déjà consigné par le
      // verbe, il n'en ajoute pas un second.
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
      return chain(() => (table === 'audit_logs' ? journalResult : rowInsertResult));
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

const { createSalaryCorrectionOps } = await import('../src/lib/dataOps/salaryCorrections');

const MEMBER: Staff = {
  id: 't1',
  name: 'Alice Diarra',
  position: 'Enseignante',
  salary: 150000,
  email: '',
  phone: '',
  bankDetails: '',
  emergencyContact: '',
};

const SALARY: SalaryPayment = {
  id: 'sp1',
  staffId: 't1',
  amount: 150000,
  date: '2026-01-31',
  academicYear: '2026-2027',
};

/** L'instantané que l'Historique des paiements relit pour proposer « Rétablir ». */
const SNAPSHOT: ArchivedSalaryPayment = {
  salaryPaymentId: 'sp1',
  staffId: 't1',
  staffName: 'Alice Diarra',
  date: '2026-01-31',
  amount: 150000,
  academicYear: '2026-2027',
};

/**
 * Laisse s'écouler les microtâches d'un `void logAuditEvent(...)`.
 *
 * Le journal part SANS être attendu — une entrée qui ne peut pas s'écrire ne doit
 * pas faire échouer le geste qu'elle raconte. Un cas qui l'inspecterait tout de
 * suite ne verrait donc rien, et conclurait l'inverse de ce qu'il doit prouver.
 */
const flushJournal = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

/** Les entrées de journal réellement écrites (jamais celles d'une autre table). */
const journalEntries = (): Call[] => calls.filter((c) => c.op === 'insert' && c.table === 'audit_logs');

interface Ops {
  ops: ReturnType<typeof createSalaryCorrectionOps>;
  events: string[];
  queued: { type: string; payload: Record<string, unknown> }[];
  salaryState: () => SalaryPayment[];
  goOffline: () => void;
  breakQueue: () => void;
}

/** Contexte minimal : les deux gestes ne lisent que ces six entrées. */
function makeOps(list: SalaryPayment[] = [SALARY], staff: Staff[] = [MEMBER]): Ops {
  const events: string[] = [];
  const queued: { type: string; payload: Record<string, unknown> }[] = [];
  let current = [...list];
  let offline = false;
  let queueRefuses = false;
  const ctx = {
    staff,
    setSalaryPayments: (next: SalaryPayment[] | ((prev: SalaryPayment[]) => SalaryPayment[])) => {
      current = typeof next === 'function' ? next(current) : next;
    },
    notifySuccess: (operation: string) => events.push(`ok:${operation}`),
    notifyError: (operation: string, message: string) => events.push(`err:${operation}:${message}`),
    isOffline: () => offline,
    enqueueOffline: (type: string, payload: Record<string, unknown>) => {
      if (queueRefuses) throw new Error('stockage plein');
      queued.push({ type, payload });
    },
  } as unknown as SupabaseDataCtx;
  return {
    ops: createSalaryCorrectionOps(ctx),
    events,
    queued,
    salaryState: () => current,
    goOffline: () => { offline = true; },
    breakQueue: () => { queueRefuses = true; },
  };
}

beforeEach(() => {
  calls = [];
  selects = 0;
  rowsResult = { data: null, error: null };
  rowInsertResult = { data: null, error: null };
  journalResult = { data: null, error: null };
});

describe('deleteSalaryPayment — retirer la SEULE ligne fautive, et le dire', () => {
  it('supprime la ligne visée et écrit la trace réparable (instantané + id du paiement)', async () => {
    rowsResult = { data: [{ id: 'sp1' }], error: null };
    const { ops, events, salaryState } = makeOps();

    assert.equal(await ops.deleteSalaryPayment(SALARY), true);
    assert.deepEqual(salaryState(), [], 'la ligne quitte la liste locale');
    assert.deepEqual(events, ['ok:deleteSalaryPayment'], 'un seul succès, pas d’erreur');

    const deletion = calls.find((c) => c.op === 'delete');
    assert.ok(deletion, 'une requête DELETE est bien partie');
    assert.equal(deletion.table, 'salary_payments', 'on retire une PAIE, jamais le membre');
    assert.equal(deletion.eqColumn, 'id');
    assert.equal(deletion.eqValue, 'sp1');
    assert.ok(selects > 0, 'la requête demande CE QUI a été supprimé (.select)');
    // Le membre lui-même n'est jamais touché : c'est tout l'objet du geste —
    // `deleteStaff` emportait toute sa paie par `ON DELETE CASCADE`.
    assert.deepEqual(
      calls.filter((c) => c.op !== 'insert' || c.table !== 'audit_logs').map((c) => c.table),
      ['salary_payments'],
      'seule la table des salaires est écrite pour la ligne',
    );

    await flushJournal();
    const entry = journalEntries().at(-1);
    assert.ok(entry, 'le geste laisse une entrée de journal');
    assert.equal(entry.payload?.action, 'DELETE_SALARY_PAYMENT');
    assert.equal(entry.payload?.target_type, 'salary_payment');
    // `target_id` est l'ID DU PAIEMENT, jamais celui du membre : c'est lui qui
    // relie l'entrée à son instantané, donc à une éventuelle restauration.
    assert.equal(entry.payload?.target_id, 'sp1');
    assert.match(String(entry.payload?.details), /Alice Diarra/, 'la phrase nomme le membre concerné');
    assert.match(String(entry.payload?.details), /150000/, 'et le montant retiré');

    // Le VRAI contrat : la trace se relit. C'est cette relecture que la vue
    // « Historique des paiements » fait pour proposer « Rétablir ».
    const archived = archivedSalaryOf({
      action: String(entry.payload?.action),
      metadata: (entry.payload?.metadata ?? null) as Record<string, unknown> | null,
    });
    assert.deepEqual(archived, SNAPSHOT, 'l’instantané permet de réinsérer la ligne à l’identique');
  });

  it('ÉCHOUE quand la policy a filtré la cible (0 ligne, HTTP 200) — sans fausse trace', async () => {
    rowsResult = { data: [], error: null };
    const { ops, events, salaryState } = makeOps();

    assert.equal(await ops.deleteSalaryPayment(SALARY), false, 'pas de faux succès');
    assert.deepEqual(salaryState(), [SALARY], 'la ligne reste listée — elle est toujours en base');
    assert.equal(events.filter((e) => e.startsWith('ok:')).length, 0, 'aucun « salaire supprimé » mensonger');
    const failure = events.find((e) => e.startsWith('err:deleteSalaryPayment'));
    assert.ok(failure, 'l’échec est signalé');
    assert.ok(failure.length > 'err:deleteSalaryPayment:'.length, 'avec une raison lisible, pas un message vide');

    await flushJournal();
    assert.deepEqual(journalEntries(), [], 'un retrait qui n’a pas eu lieu ne s’écrit pas dans le journal');
  });

  it('une erreur PostgREST reste une erreur, sans trace non plus', async () => {
    rowsResult = { data: null, error: { message: 'permission denied' } };
    const { ops, events, salaryState } = makeOps();

    assert.equal(await ops.deleteSalaryPayment(SALARY), false);
    assert.deepEqual(salaryState(), [SALARY], 'rien ne disparaît de l’écran sur un refus');
    assert.ok(events.some((e) => e.includes('permission denied')), 'le message du serveur remonte');

    await flushJournal();
    assert.deepEqual(journalEntries(), [], 'et le journal ne raconte qu’un geste réel');
  });

  it('un paiement sans identifiant est refusé SANS toucher la base', async () => {
    const { ops, events, salaryState } = makeOps();
    const orphan = { ...SALARY, id: '' };

    assert.equal(await ops.deleteSalaryPayment(orphan), false);
    assert.deepEqual(calls, [], 'aucune requête ne part : on ne peut pas viser une ligne sans id');
    assert.deepEqual(salaryState(), [SALARY]);
    assert.ok(events.some((e) => e.startsWith('err:deleteSalaryPayment')));
  });

  it('hors ligne, le geste part en file avec TOUT ce qui écrit le même instantané', async () => {
    // Sans réseau, la suppression doit rester annulable : le rejeu ne peut plus
    // relire la ligne (elle n'existe plus), donc le membre, le montant, la date et
    // l'année voyagent avec le geste.
    const { ops, events, queued, salaryState, goOffline } = makeOps();
    goOffline();

    assert.equal(await ops.deleteSalaryPayment(SALARY), true);
    assert.deepEqual(calls, [], 'hors ligne, rien n’est TENTÉ : le geste est mis en file');
    assert.deepEqual(salaryState(), [], 'la liste locale suit le geste en attente');
    assert.deepEqual(events, ['ok:deleteSalaryPayment']);
    assert.equal(queued.length, 1);
    assert.equal(queued[0]!.type, 'deleteSalaryPayment');
    assert.deepEqual(queued[0]!.payload, {
      id: 'sp1',
      staffId: 't1',
      staffName: 'Alice Diarra',
      amount: 150000,
      date: '2026-01-31',
      academicYear: '2026-2027',
    });
  });

  it('une file qui REFUSE (stockage plein) n’est pas annoncée comme un succès', async () => {
    // Le refus de la file est DÉJÀ annoncé par `enqueueOffline` (le module de la
    // file), donc ce geste-ci n'ajoute pas de message : il rend `false` — et
    // surtout pas `ok:`, le seul mensonge possible à cet endroit.
    const { ops, events, queued, goOffline, breakQueue } = makeOps();
    goOffline();
    breakQueue();

    assert.equal(await ops.deleteSalaryPayment(SALARY), false, 'un geste non rangé n’est pas un geste réussi');
    assert.deepEqual(events.filter((e) => e.startsWith('ok:')), []);
    assert.deepEqual(queued, [], 'rien n’est rangé dans la file');
  });
});

describe('restoreSalaryPayment — réinsérer la MÊME ligne, puis écrire la réparation', () => {
  it('réinsère la ligne à l’identique et journalise RESTORE_SALARY_PAYMENT', async () => {
    const { ops, events, salaryState } = makeOps([]);

    assert.equal(await ops.restoreSalaryPayment(SNAPSHOT), true);
    assert.deepEqual(
      salaryState(),
      [{ id: 'sp1', staffId: 't1', amount: 150000, date: '2026-01-31', academicYear: '2026-2027' }],
      'la ligne retrouve son identité : même id, même membre, même montant, même date',
    );

    const insert = calls.find((c) => c.op === 'insert' && c.table === 'salary_payments');
    assert.ok(insert, 'la ligne est réinsérée en base, pas seulement à l’écran');
    assert.deepEqual(insert.payload, {
      id: 'sp1',
      staff_id: 't1',
      amount: 150000,
      date: '2026-01-31',
      academic_year: '2026-2027',
    }, 'l’id d’origine repart en base : une restauration rejouée retombe sur la même ligne');

    await flushJournal();
    const entry = journalEntries().at(-1);
    assert.ok(entry, 'la réparation laisse sa propre entrée');
    assert.equal(entry.payload?.action, 'RESTORE_SALARY_PAYMENT');
    assert.equal(entry.payload?.target_id, 'sp1');
    assert.match(String(entry.payload?.details), /Alice Diarra/);
    // Le journal garde les DEUX gestes, dans l'ordre : le retrait, puis la
    // réparation. Il ne se réécrit jamais.
    assert.deepEqual(calls.filter((c) => c.op === 'insert').map((c) => c.table), ['salary_payments', 'audit_logs']);
    const archived = archivedSalaryOf({
      action: 'DELETE_SALARY_PAYMENT',
      metadata: (entry.payload?.metadata ?? null) as Record<string, unknown> | null,
    });
    assert.deepEqual(archived, SNAPSHOT, 'l’instantané reste relisible après la restauration');
    assert.deepEqual(events, ['ok:restoreSalaryPayment']);
  });

  it('23505 (la ligne est DÉJÀ revenue) est un succès, sans doubler la ligne', async () => {
    // La seconde restauration — ou le rejeu d'un geste déjà appliqué — n'est pas
    // une erreur : la ligne que l'école voulait voir revenue EST revenue.
    rowInsertResult = { data: null, error: { message: 'duplicate key value violates unique constraint', code: '23505' } };
    const { ops, events, salaryState } = makeOps([SALARY]);

    assert.equal(await ops.restoreSalaryPayment(SNAPSHOT), true);
    assert.deepEqual(events, ['ok:restoreSalaryPayment'], 'on ne crie pas sur la ligne déjà revenue');
    assert.equal(salaryState().filter((p) => p.id === 'sp1').length, 1, 'une seule ligne, jamais deux');
    // La réussite laisse une entrée en vol : on la laisse s'écrire AVANT de rendre
    // la main, sinon elle atterrirait dans le `calls` du cas suivant (qui vérifie
    // justement qu'un refus n'écrit rien).
    await flushJournal();
  });

  it('un refus de la base n’écrit aucune trace et ne dit pas « c’est fait »', async () => {
    rowInsertResult = { data: null, error: { message: 'permission denied', code: '42501' } };
    const { ops, events, salaryState } = makeOps([]);

    assert.equal(await ops.restoreSalaryPayment(SNAPSHOT), false);
    assert.deepEqual(salaryState(), [], 'rien n’est ajouté à l’écran');
    assert.equal(events.filter((e) => e.startsWith('ok:')).length, 0);
    assert.ok(events.some((e) => e.includes('permission denied')));

    await flushJournal();
    assert.deepEqual(journalEntries(), [], 'une réparation qui n’a pas eu lieu ne s’écrit pas');
  });

  it('un instantané incomplet est refusé sans toucher la base', async () => {
    const { ops, events } = makeOps([]);

    assert.equal(await ops.restoreSalaryPayment({ ...SNAPSHOT, staffId: '' }), false);
    assert.deepEqual(calls, [], 'aucune ligne n’est réinsérée au hasard d’un instantané amputé');
    assert.ok(events.some((e) => e.startsWith('err:restoreSalaryPayment')));
  });

  it('hors ligne, la restauration est REFUSÉE au lieu d’être simulée', async () => {
    // L'instantané vit dans le journal de la BASE : hors ligne, on ne peut ni le
    // relire de source sûre ni garantir la réinsertion. On refuse donc, au lieu de
    // faire croire à une ligne qui n'existerait nulle part.
    const { ops, events, salaryState, goOffline } = makeOps([]);
    goOffline();

    assert.equal(await ops.restoreSalaryPayment(SNAPSHOT), false);
    assert.deepEqual(calls, [], 'aucune écriture n’est tentée');
    assert.deepEqual(salaryState(), []);
    const failure = events.find((e) => e.startsWith('err:restoreSalaryPayment'));
    assert.ok(failure && /réseau/.test(failure), 'le refus dit POURQUOI : l’instantané est relu dans la base');
  });
});
