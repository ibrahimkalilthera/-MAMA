// Pure replay-core suite: no DOM/React (see tests/harness.ts "When NOT to
// use it") — replayOfflineItem is exercised against a plain fake ReplayDb.
//
// Depuis le 2026-10-13, UNE action passe par une FONCTION de la base et non par
// un UPDATE de table : `updatePaymentMonths` appelle
// `public.set_payment_months`
// (supabase/migrations/20261013000000_econome_payment_months.sql), l'écriture
// BORNÉE à la colonne `months` — une policy RLS borne des LIGNES, donc l'ouvrir à
// l'économe lui aurait ouvert le MONTANT avec. Ces cas le vérifient par le NOM de
// la fonction ET par l'absence de tout UPDATE de table.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describeReplayError, offlineAuditInfo, replayOfflineItem, replayOfflineItemDetailed, rowIdColumn } from '../src/lib/offlineReplay';
import type { ReplayDb } from '../src/lib/offlineReplay';
import { createRowId, isUuid } from '../src/lib/rowMappers';
import type { OfflineActionType, OfflinePayload, QueueItem } from '../src/lib/offlineQueue';
import { makeFakeDb } from './fakes';

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Build a typed QueueItem whose `type` and `payload` are correlated. */
function itemOf<T extends OfflineActionType>(
  type: T,
  payload: Extract<OfflinePayload, { type: T }>['payload'],
): QueueItem {
  // Same single-boundary assertion as enqueueOfflineAction: TS cannot verify the
  // correlation between the generic `type` and `payload` at this narrow spot.
  return { id: `q_${type}`, createdAt: '2026-01-01T00:00:00.000Z', attempts: 0, type, payload } as QueueItem;
}

/**
 * Un ReplayDb minimal qui REND des lignes — ce que `makeFakeDb` ne sait pas faire
 * (il répond toujours `[{id:'fake-row'}]`, suffisant pour vérifier la TABLE
 * visée, pas son CONTENU). Ici la réconciliation relit un solde précis, donc il
 * faut pouvoir choisir ce que `select(...)` renvoie. Les `update()` sont
 * capturés pour comparer la ligne écrite.
 */
function reconcilingDb(
  rows: Record<string, Array<Record<string, unknown>>>,
  opts: { insertError?: { message: string; code?: string }; monthsWritten?: number } = {},
): {
  db: ReplayDb;
  updates: { table: string; row: Record<string, unknown> }[];
  rpcs: { fn: string; args: Record<string, unknown> }[];
} {
  const updates: { table: string; row: Record<string, unknown> }[] = [];
  const rpcs: { fn: string; args: Record<string, unknown> }[] = [];
  const make = (table: string, result: { data: unknown; error: unknown }) => {
    const builder = Object.assign(Promise.resolve(result), {
      select: () => builder,
      eq: () => builder,
      neq: () => builder,
      single: () => builder,
      delete: () => builder,
      insert: () => (table === 'payments' && opts.insertError ? make(table, { data: null, error: opts.insertError }) : builder),
      update: (row?: Record<string, unknown>) => {
        if (row) updates.push({ table, row });
        return builder;
      },
    });
    return builder;
  };
  const from = (table: string) => make(table, { data: rows[table] ?? [{ id: 'fake-row' }], error: null });
  /** L'écriture bornée : la fonction rend un NOMBRE de lignes écrites. */
  const rpc = (fn: string, args?: Record<string, unknown>) => {
    rpcs.push({ fn, args: (args ?? {}) as Record<string, unknown> });
    return Promise.resolve({ data: opts.monthsWritten ?? 1, error: null });
  };
  return { db: { from, rpc } as unknown as ReplayDb, updates, rpcs };
}



/** The player with the full typed payloads, and the table each one should hit. */
const CASES: { type: OfflineActionType; build: () => QueueItem; table?: string; rpc?: string }[] = [
  { type: 'addPayment', build: () => itemOf('addPayment', { studentId: 's1', payment: { date: '2026-01-01', amount: 500, receiptNumber: 'R1' } }), table: 'payments' },
  { type: 'deletePayment', build: () => itemOf('deletePayment', { studentId: 's1', paymentId: 'pay1', amount: 500, receiptNumber: 'R1', date: '2026-01-01' }), table: 'payments' },
  // Les mois d'un reçu : une FONCTION, jamais un UPDATE de table (voir l'en-tête).
  { type: 'updatePaymentMonths', build: () => itemOf('updatePaymentMonths', { studentId: 's1', paymentId: 'pay1', months: ['2026-09', '2026-11'], amount: 500, receiptNumber: 'R1', date: '2026-01-01' }), rpc: 'set_payment_months' },
  { type: 'addExpense', build: () => itemOf('addExpense', { category: 'stationery', description: 'desk', amount: 10, date: '2026-01-01' }), table: 'expenses' },
  { type: 'updateExpense', build: () => itemOf('updateExpense', { id: 'e1', updates: { amount: 12 } }), table: 'expenses' },
  { type: 'deleteExpense', build: () => itemOf('deleteExpense', { id: 'e1' }), table: 'expenses' },
  { type: 'addVendorExpense', build: () => itemOf('addVendorExpense', { vendorName: 'Vendor', category: 'electricity', amount: 50, dueDate: '2026-02-01', paymentStatus: 'paid', amountPaid: 50 }), table: 'vendor_expenses' },
  { type: 'updateVendorExpense', build: () => itemOf('updateVendorExpense', { id: 'v1', updates: { amount: 60 } }), table: 'vendor_expenses' },
  { type: 'deleteVendorExpense', build: () => itemOf('deleteVendorExpense', { id: 'v1' }), table: 'vendor_expenses' },
  { type: 'addStudent', build: () => itemOf('addStudent', { name: 'Ada', parentName: 'Parent', parentEmail: 'p@x.com', parentPhone: '123', totalDue: 100, amountPaid: 0, dueDate: '2026-09-01', notes: '' }), table: 'students' },
  { type: 'updateStudent', build: () => itemOf('updateStudent', { id: 's1', updates: { name: 'Ada B.' } }), table: 'students' },
  { type: 'deleteStudent', build: () => itemOf('deleteStudent', { id: 's1' }), table: 'students' },
  { type: 'addStaff', build: () => itemOf('addStaff', { name: 'T', position: 'teacher', salary: 150000, email: '', phone: '111', bankDetails: '', emergencyContact: '' }), table: 'staff' },
  { type: 'updateStaff', build: () => itemOf('updateStaff', { id: 't1', updates: { salary: 160000 } }), table: 'staff' },
  { type: 'deleteStaff', build: () => itemOf('deleteStaff', { id: 't1' }), table: 'staff' },
  { type: 'addSalaryPayment', build: () => itemOf('addSalaryPayment', { staffId: 't1', amount: 150000, date: '2026-01-31' }), table: 'salary_payments' },
  { type: 'addParent', build: () => itemOf('addParent', { fullName: 'Mme X', phones: ['123'], address: 'A', occupation: 'O', relationship: 'Mother' }), table: 'parents' },
  { type: 'updateParent', build: () => itemOf('updateParent', { id: 'p1', updates: { address: 'B' } }), table: 'parents' },
  { type: 'deleteParent', build: () => itemOf('deleteParent', { id: 'p1' }), table: 'parents' },
  { type: 'addTodo', build: () => itemOf('addTodo', { text: 'Call parent', completed: false }), table: 'todos' },
  { type: 'updateTodo', build: () => itemOf('updateTodo', { id: 't1', updates: { completed: true } }), table: 'todos' },
  { type: 'deleteTodo', build: () => itemOf('deleteTodo', { id: 't1' }), table: 'todos' },
  { type: 'addClass', build: () => itemOf('addClass', { code: '2D', cycle: 'other', year: '', section: '', nameFr: '2D', nameEn: '2D' }), table: 'custom_classes' },
  { type: 'updateClass', build: () => itemOf('updateClass', { id: 'c1', updates: { code: '2E', cycle: 'other', year: '', section: '', nameFr: '2E', nameEn: '2E' } }), table: 'custom_classes' },
  { type: 'deleteClass', build: () => itemOf('deleteClass', { id: 'c1' }), table: 'custom_classes' },
  { type: 'addNote', build: () => itemOf('addNote', { date: '2026-09-03', text: 'Paiement Mme Diallo' }), table: 'calendar_notes' },
  { type: 'deleteNote', build: () => itemOf('deleteNote', { id: 'n1' }), table: 'calendar_notes' },
  { type: 'setCurrentYear', build: () => itemOf('setCurrentYear', { year: '2026-2027' }), table: 'academic_years' },
  { type: 'updateUserRole', build: () => itemOf('updateUserRole', { id: 'u2', role: 'admin' }), table: 'user_profiles' },
  { type: 'addAuditLog', build: () => itemOf('addAuditLog', { userId: 'u1', userEmail: 'a@b.c', userName: 'Ada', userRole: 'admin', action: 'UPDATE_SETTINGS', targetType: 'settings', targetId: null, details: 'thème' }), table: 'audit_logs' },
  // Un réglage d'affichage (thème, densité, verre, langue) changé sans réseau :
  // la ligne d'`app_settings` que la sauvegarde emporte.
  { type: 'setDisplayPreference', build: () => itemOf('setDisplayPreference', { name: 'theme', value: 'midnight' }), table: 'app_settings' },
];

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('offline queue replay (replayOfflineItem)', () => {
  it('covers every OfflineActionType (guard against a newly added action)', () => {
    // Keep this list in sync with OfflineActionType so an added action forces a
    // deliberate test-case here instead of silently replaying into `false`.
    const all: OfflineActionType[] = [
      'addPayment', 'deletePayment', 'updatePaymentMonths', 'addExpense', 'updateExpense', 'deleteExpense',
      'addVendorExpense', 'updateVendorExpense', 'deleteVendorExpense',
      'addStudent', 'updateStudent', 'deleteStudent',
      'addStaff', 'updateStaff', 'deleteStaff', 'addSalaryPayment',
      'addParent', 'updateParent', 'deleteParent',
      'addTodo', 'updateTodo', 'deleteTodo',
      'addClass', 'updateClass', 'deleteClass',
      'addNote', 'deleteNote', 'setCurrentYear', 'addAuditLog',
      'updateUserRole', 'setDisplayPreference',
    ];
    assert.equal(CASES.length, all.length, 'expected one test case per action type');
    assert.deepEqual(
      CASES.map((c) => c.type).sort(),
      all.slice().sort(),
    );

    // La liste ci-dessus est écrite à la main, donc elle peut oublier un type
    // ajouté au module — c'était le cas de `updateExpense` à sa création. La
    // VRAIE union est relue dans la source, qui est la seule autorité : un type
    // ajouté sans cas de test fait échouer ici, pas dans six mois.
    const source = readFileSync('src/lib/offlineQueue.ts', 'utf8');
    const union = source.match(/export type OfflineActionType =([\s\S]*?);/)?.[1] ?? '';
    const declared = [...union.matchAll(/'([A-Za-z]+)'/g)].map((m) => m[1]).sort();
    assert.ok(declared.length > 0, 'l’union doit être lisible dans la source');
    assert.deepEqual(declared, all.slice().sort(), 'un type déclaré sans cas de test doit échouer');
  });

  for (const { type, build, table, rpc } of CASES) {
    it(
      `replays '${type}' without error and reaches ${rpc ? `the function '${rpc}'` : `the table '${table}'`}`,
      async () => {
        const fake = makeFakeDb();
        const ok = await replayOfflineItem(fake.db, build());
        assert.equal(ok, true, `${type} should report success on a healthy db`);
        if (rpc) {
          // L'écriture bornée : la FONCTION nommée, et AUCUN UPDATE de table.
          // C'est la différence qui empêche un rôle de réécrire le MONTANT d'un
          // reçu en passant par le chemin des mois.
          assert.deepEqual(fake.rpcs.map((call) => call.fn), [rpc], `${type} doit appeler la fonction '${rpc}'`);
          assert.deepEqual(fake.queries, [], `${type} ne doit toucher aucune table (got ${fake.queries.join(', ')})`);
          return;
        }
        assert.ok(fake.queries.includes(table!), `${type} should hit table '${table}' (got ${fake.queries.join(', ')})`);
      },
    );
  }

  it('reports failure (success=false) when the db returns an error', async () => {
    const { db } = makeFakeDb({ allFail: true });
    const ok = await replayOfflineItem(db, itemOf('addExpense', { category: 'stationery', description: 'd', amount: 5, date: '2026-01-01' }));
    assert.equal(ok, false, 'an errored insert must not count as synced');
  });
});

// ─── Les préférences d’affichage : la copie qui voyage ───────────────────────
// Un poste hors ligne doit pouvoir régler son thème, sa densité, son verre et sa
// langue sans perdre le réglage : le geste part dans la file et le rejeu écrit la
// MÊME ligne d'`app_settings` que le chemin en ligne — c'est cette ligne que la
// sauvegarde emporte, donc celle qu'un poste réinstallé adoptera.

describe('un réglage d’affichage changé hors ligne', () => {
  it('écrit la ligne du contrat : clé `display.*`, valeur, et pas d’`updated_by`', async () => {
    const fake = makeFakeDb();
    const ok = await replayOfflineItem(fake.db, itemOf('setDisplayPreference', { name: 'iconGlass', value: 'crisp' }));
    assert.equal(ok, true);
    assert.deepEqual(fake.queries, ['app_settings']);
    const written = fake.rows.find((row) => row.table === 'app_settings');
    assert.ok(written, 'la préférence doit être écrite, pas seulement visée');
    assert.equal(written.row.key, 'display.icon_glass');
    assert.equal(written.row.value, 'crisp');
    // Les comptes `auth.users` ne voyagent pas : un `updated_by` renseigné
    // rendrait la ligne NON restaurable dans une cible fraîche.
    assert.equal('updated_by' in written.row, false);
    assert.match(String(written.row.updated_at), /^\d{4}-\d{2}-\d{2}T/);
  });

  it('une écriture retirée par une politique (200 sans ligne) n’est PAS un succès', async () => {
    const { db } = makeFakeDb({ emptyWrites: ['app_settings'] });
    assert.equal(
      await replayOfflineItem(db, itemOf('setDisplayPreference', { name: 'language', value: 'en' })),
      false,
      'compter cette écriture comme envoyée retirerait de la file un réglage jamais arrivé',
    );
  });

  it('une valeur hors contrat est refusée SANS écrire', async () => {
    const fake = makeFakeDb();
    const ok = await replayOfflineItem(fake.db, itemOf('setDisplayPreference', { name: 'theme', value: 'gothic' }));
    assert.equal(ok, false);
    // La file vit dans le `localStorage` du poste, donc elle est modifiable à la
    // main : un rejeu plus permissif que le chemin en ligne publierait un thème
    // qui n'existe pas, et TOUS les postes neufs l'adopteraient.
    assert.deepEqual(fake.queries, [], 'aucune écriture ne doit partir');
  });

  it('l’audit du rejeu est celui du chemin en ligne (UPDATE_SETTING sur la clé publiée)', () => {
    const info = offlineAuditInfo(itemOf('setDisplayPreference', { name: 'density', value: 'compact' }));
    assert.equal(info?.action, 'UPDATE_SETTING');
    assert.equal(info?.targetType, 'app_settings');
    assert.equal(info?.targetId, 'display.density');
    assert.match(String(info?.details), /display\.density = compact/);
  });
});

// ─── La RAISON d’un refus de rejeu ───────────────────────────────────────────
// Un élément refusé reste en file, mais « refusée » sans cause ne dit pas quoi
// faire. La raison est lue du message serveur (court, sûr) et posée sur l'entrée
// par le drainage (voir offlineSync) — ces cas verrouillent la lecture.

describe('raison d’un refus de rejeu', () => {
  it('describeReplayError nomme le message et le code, sans jamais lever', () => {
    assert.equal(describeReplayError({ message: 'permission denied', code: '42501' }), 'permission denied [42501]');
    assert.equal(describeReplayError({ code: '23503' }), 'refus sans message [23503]');
    assert.equal(describeReplayError(null), 'écriture refusée par la base (aucune ligne touchée)');
    assert.doesNotThrow(() => describeReplayError({ toString: undefined }));
  });

  it('replayOfflineItemDetailed rend la raison d’un vrai refus', async () => {
    const { db } = makeFakeDb({ failTables: ['expenses'] });
    const outcome = await replayOfflineItemDetailed(db, itemOf('addExpense', { category: 'c', description: 'd', amount: 1, date: '2026-01-01' }));
    assert.equal(outcome.ok, false);
    assert.equal(outcome.reason, 'boom');
  });

  it('replayOfflineItemDetailed ne rend AUCUNE raison sur un succès', async () => {
    const { db } = makeFakeDb();
    const outcome = await replayOfflineItemDetailed(db, itemOf('addExpense', { category: 'c', description: 'd', amount: 1, date: '2026-01-01' }));
    assert.equal(outcome.ok, true);
    assert.equal(outcome.reason, null);
  });

  it('un refus SANS erreur serveur (écriture retirée par la policy) donne une raison nommée', async () => {
    // updateClass/deleteNote/updateUserRole : 200 avec un corps vide n'est PAS
    // un `error`, donc le rejeu rend false sans message — la raison ne doit pas
    // être nulle pour autant, sinon la bannière resterait muette.
    const { db } = makeFakeDb({ emptyWrites: ['custom_classes'] });
    const outcome = await replayOfflineItemDetailed(db, itemOf('deleteClass', { id: 'c1' }));
    assert.equal(outcome.ok, false);
    assert.match(outcome.reason ?? '', /aucune ligne touchée/);
  });
});

// ─── Ce que le cas « par type » ne dit pas encore ────────────────────────────
// Le bloc ci-dessus garantit UN cas par type, mais un cas qui répond « true et
// touche la bonne table » ne prouve pas le COMPORTEMENT du rejeu. Quatre
// propriétés restaient non assertées, et chacune se paie en silence :
//   • un paiement rejoué écrit AUSSI la date du dernier paiement sur l'élève —
//     et ne doit PAS y toucher si la base a refusé le paiement ;
//   • la déclaration d'année sur une année DÉJÀ présente (23505) doit quand même
//     déplacer le drapeau, sinon le poste reste sur l'ancienne année en silence.
// (L'id des lignes nées hors ligne est traité plus bas, `CREATING`.)

describe('comportements propres à chaque action rejouée', () => {
  const payItem = () => itemOf('addPayment', { studentId: 's1', payment: { date: '2026-09-05', amount: 100, receiptNumber: 'R1' } });

  it('un paiement rejoué pose la date du dernier paiement sur l’élève', async () => {
    const { db, updates } = makeFakeDb();
    const ok = await replayOfflineItem(db, payItem());
    assert.equal(ok, true);
    const studentUpdate = updates.find((u) => u.table === 'students');
    assert.ok(studentUpdate, 'l’élève doit porter la nouvelle date');
    assert.equal(studentUpdate.row.last_payment_date, '2026-09-05');
  });

  it('un paiement REFUSÉ ne touche PAS l’élève', async () => {
    const { db, queries } = makeFakeDb({ failTables: ['payments'] });
    const ok = await replayOfflineItem(db, payItem());
    assert.equal(ok, false);
    assert.ok(!queries.includes('students'), 'pas de mise à jour de l’élève quand le paiement n’est pas passé');
  });

  it('un paiement DÉJÀ en base (23505) est quand même réconcilié — le solde ne reste pas en arrière', async () => {
    // Le seul chemin qui mène à un 23505 est une première tentative qui a inséré
    // la ligne puis n’a pas fini la mise à jour du solde : refuser de réconcilier
    // ici laisserait le solde dériver pour toujours.
    const db = reconcilingDb(
      { students: [{ amount_paid: 1000, last_payment_date: '2026-08-31' }] },
      { insertError: { message: 'duplicate key', code: '23505' } },
    );
    const ok = await replayOfflineItem(db.db, payItem());
    assert.equal(ok, true);
    const studentUpdate = db.updates.find((u) => u.table === 'students');
    assert.equal(studentUpdate?.row.amount_paid, 1100, 'le montant déjà en base est compté une fois');
  });

  it('la déclaration d’année déjà présente déplace quand même le drapeau (23505)', async () => {
    const duplicateYear = {
      from: () => ({
        insert: async () => ({ data: null, error: { message: 'duplicate key', code: '23505' } }),
        update: () => ({ neq: async () => ({ error: null }), eq: async () => ({ error: null }) }),
      }),
    } as unknown as ReplayDb;
    assert.equal(await replayOfflineItem(duplicateYear, itemOf('setCurrentYear', { year: '2026-2027' })), true);
  });
});

// ─── Le SOLDE de l’élève après un drainage ───────────────────────────────────
// Le défaut réparé : un paiement en file était écrit dans `payments` et sa DATE
// posée sur l’élève, mais son MONTANT n’était jamais ajouté à `amount_paid` (et
// une suppression en file ne le retirait jamais). Le solde de l’école dérivait
// donc jusqu’au prochain rechargement. Ces cas verrouillent la réconciliation.

describe('le solde de l’élève se réconcilie au rejeu', () => {
  const payItem = () => itemOf('addPayment', { studentId: 's1', payment: { date: '2026-09-05', amount: 100, receiptNumber: 'R1' } });
  const delItem = () => itemOf('deletePayment', { studentId: 's1', paymentId: 'pay1', amount: 400, receiptNumber: 'R1', date: '2026-09-05' });

  it('un paiement rejoué AJOUTE son montant au solde et pose la date', async () => {
    const db = reconcilingDb({ students: [{ amount_paid: 1000, last_payment_date: '2026-08-31' }] });
    const ok = await replayOfflineItem(db.db, payItem());
    assert.equal(ok, true);
    const written = db.updates.find((u) => u.table === 'students');
    assert.ok(written, 'le solde doit être écrit sur l’élève');
    assert.equal(written.row.amount_paid, 1100, 'le solde avance du montant rejoué');
    assert.equal(written.row.last_payment_date, '2026-09-05');
  });

  it('un paiement rejoué plus ANCIEN ne fait pas reculer la dernière date', async () => {
    const db = reconcilingDb({ students: [{ amount_paid: 1000, last_payment_date: '2026-10-01' }] });
    await replayOfflineItem(db.db, payItem()); // date 2026-09-05
    const written = db.updates.find((u) => u.table === 'students');
    assert.equal(written?.row.amount_paid, 1100);
    assert.equal(written?.row.last_payment_date, '2026-10-01', 'la date la plus récente gagne');
  });

  it('un paiement SUPPRIMÉ rejoué retire son montant et recale la dernière date', async () => {
    const db = reconcilingDb({
      students: [{ amount_paid: 1000, last_payment_date: '2026-09-05' }],
      payments: [{ date: '2026-08-31' }, { date: '2026-09-01' }],
    });
    const ok = await replayOfflineItem(db.db, delItem());
    assert.equal(ok, true);
    const written = db.updates.find((u) => u.table === 'students');
    assert.equal(written?.row.amount_paid, 600, 'le montant retiré redescend du solde');
    assert.equal(written?.row.last_payment_date, '2026-09-01', 'la date suit le paiement QUI RESTE');
  });

  it('sans paiement restant, la date repart à vide', async () => {
    const db = reconcilingDb({ students: [{ amount_paid: 400, last_payment_date: '2026-09-05' }], payments: [] });
    await replayOfflineItem(db.db, delItem());
    const written = db.updates.find((u) => u.table === 'students');
    assert.equal(written?.row.amount_paid, 0);
    assert.equal(written?.row.last_payment_date, null);
  });

  it('le solde ne descend jamais sous zéro', async () => {
    const db = reconcilingDb({ students: [{ amount_paid: 100 }], payments: [] });
    await replayOfflineItem(db.db, delItem()); // retire 400 d’un solde de 100
    const written = db.updates.find((u) => u.table === 'students');
    assert.equal(written?.row.amount_paid, 0, 'jamais de dette inventée');
  });

  it('une réconciliation refusée laisse l’item en file (le montant ne sera pas perdu)', async () => {
    // La lecture du solde échoue : le paiement est en base mais le solde n’est pas
    // écrit, donc l’item DOIT rester en file — un prochain passage le réconciliera.
    const failing = {
      from: (table: string) => {
        const builder = Object.assign(Promise.resolve(table === 'students'
          ? { data: null, error: { message: 'lecture refusée' } }
          : { data: [{ id: 'fake-row' }], error: null }), {
          select: () => builder,
          eq: () => builder,
          neq: () => builder,
          single: () => builder,
          delete: () => builder,
          insert: () => builder,
          update: () => builder,
        });
        return builder;
      },
    } as unknown as ReplayDb;
    assert.equal(await replayOfflineItem(failing, payItem()), false);
  });
});

// ─── Les updaters transmettent-ils TOUS leurs champs ? ───────────────────────
// Le cas « par type » ne vérifie que la table visée. Un champ oublié dans la
// correspondance (`updates.x → row.y`) disparaîtrait de la file sans un mot :
// l'écran l'aurait montré, la base ne l'aurait jamais reçu. Chaque updater est
// donc envoyé avec TOUS ses champs, et la ligne écrite est comparée EN ENTIER.

describe('les mises à jour en file transmettent tous leurs champs', () => {
  const UPDATERS: { type: OfflineActionType; build: () => QueueItem; table: string; expected: Record<string, unknown> }[] = [
    {
      type: 'updateExpense',
      build: () => itemOf('updateExpense', { id: 'e1', updates: { category: 'c', description: 'd', amount: 12, date: '2026-01-01', academicYear: '2026-2027' } }),
      table: 'expenses',
      expected: { category: 'c', description: 'd', amount: 12, date: '2026-01-01', academic_year: '2026-2027' },
    },
    {
      type: 'updateVendorExpense',
      build: () => itemOf('updateVendorExpense', { id: 'v1', updates: { vendorName: 'V', category: 'c', amount: 60, dueDate: '2026-02-01', paymentStatus: 'paid', amountPaid: 60, description: 'd', aidType: 'aide_urgence', beneficiaryStudentName: 'Ada', beneficiaryStudentGrade: '9A' } }),
      table: 'vendor_expenses',
      expected: { vendor_name: 'V', category: 'c', amount: 60, due_date: '2026-02-01', payment_status: 'paid', amount_paid: 60, description: 'd', aid_type: 'aide_urgence', beneficiary_student_name: 'Ada', beneficiary_student_grade: '9A' },
    },
    {
      type: 'updateStaff',
      build: () => itemOf('updateStaff', { id: 't1', updates: { name: 'T', position: 'teacher', salary: 160000, email: '', phone: '111', bankDetails: 'BOA', emergencyContact: 'Awa' } }),
      table: 'staff',
      expected: { name: 'T', position: 'teacher', salary: 160000, email: null, phone: '111', bank_details: 'BOA', emergency_contact: 'Awa' },
    },
    {
      type: 'updateParent',
      build: () => itemOf('updateParent', { id: 'p1', updates: { fullName: 'Mme X', phones: ['1'], email: '', address: 'A', occupation: 'O', relationship: 'Mother', notes: 'n' } }),
      table: 'parents',
      expected: { full_name: 'Mme X', phones: ['1'], email: null, address: 'A', occupation: 'O', relationship: 'Mother', notes: 'n' },
    },
    {
      type: 'updateTodo',
      build: () => itemOf('updateTodo', { id: 't1', updates: { text: 'Call', completed: true, date: '2026-09-10' } }),
      table: 'todos',
      expected: { text: 'Call', completed: true, due_date: '2026-09-10' },
    },
    {
      type: 'updateClass',
      build: () => itemOf('updateClass', { id: 'c1', updates: { code: '2E', cycle: 'other', year: '2026-2027', section: 'A', nameFr: '2E', nameEn: '2E' } }),
      table: 'custom_classes',
      expected: { code: '2E', cycle: 'other', year: '2026-2027', section: 'A', name_fr: '2E', name_en: '2E' },
    },
  ];

  for (const { type, build, table, expected } of UPDATERS) {
    it(`'${type}' envoie tous ses champs (aucun champ perdu)`, async () => {
      const { db, updates } = makeFakeDb();
      const ok = await replayOfflineItem(db, build());
      assert.equal(ok, true);
      const written = updates.filter((u) => u.table === table);
      assert.equal(written.length, 1, `${type} doit écrire exactement une mise à jour`);
      assert.deepEqual(written[0].row, expected, `${type} : un champ oublié disparaîtrait de la base`);
    });
  }
});

// ─── Les id des lignes nées HORS LIGNE ───────────────────────────────────────
// Ce qui se joue ici n'est pas cosmétique : un élève inscrit sans réseau a déjà
// un reçu imprimé et un paiement en file. Si la ligne arrivait en base avec un id
// généré par le serveur, ce paiement pointerait vers un id inexistant et serait
// refusé à chaque passage, pour toujours.

describe('ids des lignes créées hors ligne', () => {
  it('createRowId produit un vrai UUID — la valeur que la colonne accepte', () => {
    const first = createRowId();
    const second = createRowId();
    assert.match(first, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    assert.notEqual(first, second);
    assert.equal(isUuid(first), true);
  });

  it("isUuid refuse tout ce qui n'en est pas un (dont l'ancien marqueur off_…)", () => {
    assert.equal(isUuid('off_student_m1_2_abc'), false);
    assert.equal(isUuid('s1'), false);
    assert.equal(isUuid(''), false);
    assert.equal(isUuid(undefined), false);
  });

  it('rowIdColumn ne remonte l’id que lorsqu’il est utilisable', () => {
    assert.deepEqual(rowIdColumn(undefined), {}, 'sans id : la base génère, comme avant');
    assert.deepEqual(rowIdColumn('off_todo_1'), {}, 'un marqueur local n’est pas un id de colonne');
    const uuid = createRowId();
    assert.deepEqual(rowIdColumn(uuid), { id: uuid });
  });

  const CREATING: { type: OfflineActionType; build: () => QueueItem; table: string }[] = [
    { type: 'addStudent', build: () => itemOf('addStudent', { name: 'Ada', parentName: 'P', parentEmail: 'p@x.com', parentPhone: '1', totalDue: 100, amountPaid: 0, dueDate: '2026-09-01', notes: '' }), table: 'students' },
    { type: 'addParent', build: () => itemOf('addParent', { fullName: 'Mme X', phones: ['1'], address: 'A', occupation: 'O', relationship: 'Mother' }), table: 'parents' },
    { type: 'addStaff', build: () => itemOf('addStaff', { name: 'T', position: 'teacher', salary: 1, email: '', phone: '1', bankDetails: '', emergencyContact: '' }), table: 'staff' },
    { type: 'addExpense', build: () => itemOf('addExpense', { category: 'stationery', description: 'd', amount: 5, date: '2026-01-01' }), table: 'expenses' },
    { type: 'addVendorExpense', build: () => itemOf('addVendorExpense', { vendorName: 'V', category: 'electricity', amount: 5, dueDate: '2026-01-01', paymentStatus: 'paid', amountPaid: 5 }), table: 'vendor_expenses' },
    { type: 'addSalaryPayment', build: () => itemOf('addSalaryPayment', { staffId: 't1', amount: 5, date: '2026-01-01' }), table: 'salary_payments' },
    { type: 'addTodo', build: () => itemOf('addTodo', { text: 'Call', completed: false }), table: 'todos' },
    { type: 'addClass', build: () => itemOf('addClass', { code: '2D', cycle: 'other', year: '', section: '', nameFr: '2D', nameEn: '2D' }), table: 'custom_classes' },
    // Le paiement rejoué garde aussi l'identité du geste : un drainage qui
    // repasserait sur le même item retombe sur la même clé (un seul reçu).
    { type: 'addPayment', build: () => itemOf('addPayment', { studentId: 's1', payment: { date: '2026-01-01', amount: 5 } }), table: 'payments' },
  ];

  for (const { type, build, table } of CREATING) {
    it(`envoie l’id choisi hors ligne pour '${type}' (la ligne garde son identité)`, async () => {
      const { db, rows } = makeFakeDb();
      const localId = createRowId();
      const ok = await replayOfflineItem(db, { ...build(), localId });

      assert.equal(ok, true);
      assert.equal(rows.length, 1);
      assert.equal(rows[0].table, table);
      assert.equal(rows[0].row.id, localId);
    });
  }

  it('n’envoie aucun id quand l’action n’en a pas (comportement d’avant, inchangé)', async () => {
    const { db, rows } = makeFakeDb();
    await replayOfflineItem(db, itemOf('addStudent', { name: 'Ada', parentName: 'P', parentEmail: 'p@x.com', parentPhone: '1', totalDue: 100, amountPaid: 0, dueDate: '2026-09-01', notes: '' }));

    assert.equal(rows.length, 1);
    assert.ok(!('id' in rows[0].row), 'la base génère l’id, exactement comme avant');
  });

  it('un paiement en file pour un élève inscrit hors ligne part avec le BON élève', async () => {
    // C'est le scénario réel : un enfant inscrit pendant la coupure, et le
    // règlement du parent encaissé dans la foulée.
    const { db, rows } = makeFakeDb();
    const studentId = createRowId();
    await replayOfflineItem(db, { ...itemOf('addStudent', { name: 'Ada', parentName: 'P', parentEmail: 'p@x.com', parentPhone: '1', totalDue: 100, amountPaid: 0, dueDate: '2026-09-01', notes: '' }), localId: studentId });
    await replayOfflineItem(db, itemOf('addPayment', { studentId, payment: { date: '2026-09-02', amount: 100, receiptNumber: 'R1' } }));

    const studentInsert = rows.find((r) => r.table === 'students');
    const paymentInsert = rows.find((r) => r.table === 'payments');
    assert.equal(studentInsert?.row.id, studentId);
    assert.equal(paymentInsert?.row.student_id, studentId, 'le paiement vise l’id que l’élève porte réellement');
  });

  it('un paiement en file garde ses MOIS au rejeu — et en écrit toujours la colonne', async () => {
    // Les mois choisis pendant la coupure doivent arriver en base avec le
    // paiement : un rejeu qui les perdrait rendrait un reçu qui ne dit plus ce
    // que la famille a payé. La colonne est NOT NULL : sans mois, c'est `[]`.
    const { db, rows } = makeFakeDb();
    await replayOfflineItem(db, itemOf('addPayment', {
      studentId: 's1',
      payment: { date: '2026-10-04', amount: 100, receiptNumber: 'R1', months: ['2026-09', '2026-10'] },
    }));
    await replayOfflineItem(db, itemOf('addPayment', {
      studentId: 's1',
      payment: { date: '2026-10-05', amount: 100, receiptNumber: 'R2' },
    }));

    const inserts = rows.filter((r) => r.table === 'payments');
    assert.deepEqual(inserts[0].row.months, ['2026-09', '2026-10'], 'les mois choisis voyagent avec le geste');
    assert.deepEqual(inserts[1].row.months, [], 'sans mois, la colonne reçoit un tableau vide');
  });

  it('un paiement en file garde son MOTIF au rejeu — et n’en invente aucun', async () => {
    // Le motif choisi au guichet pendant la coupure doit arriver en base avec le
    // geste : un rejeu qui le perdrait rendrait un reçu d'inscription en « frais
    // de scolarité », et la famille garderait ce papier-là.
    const { db, rows } = makeFakeDb();
    await replayOfflineItem(db, itemOf('addPayment', {
      studentId: 's1',
      payment: { date: '2026-10-04', amount: 100, receiptNumber: 'R1', motif: 'inscription' },
    }));
    await replayOfflineItem(db, itemOf('addPayment', {
      studentId: 's1',
      payment: { date: '2026-10-05', amount: 100, receiptNumber: 'R2' },
    }));

    const inserts = rows.filter((r) => r.table === 'payments');
    assert.equal(inserts[0].row.motif, 'inscription', 'le motif du geste arrive en base');
    assert.equal(inserts[1].row.motif, null, 'sans motif, la colonne reçoit NULL (on ne devine rien)');
  });

  it('renseigner les mois au rejeu appelle la FONCTION bornée, et sur le reçu visé', async () => {
    // Le geste en file est un CORRECTIF de reçu : il ne doit ni toucher au
    // montant, ni à la date, ni au solde de l'élève — et il doit viser LE reçu
    // dont l'école a parlé, pas un autre de la même fiche.
    //
    // Depuis le 2026-10-13, il ne passe plus par un UPDATE de `payments` mais par
    // `public.set_payment_months` : c'est la seule façon d'ouvrir cette correction
    // à l'économe sans lui ouvrir le MONTANT, une policy RLS ne sachant borner que
    // des lignes. Ce que la RPC reçoit est donc la preuve du périmètre : l'id du
    // reçu, et les mois. Rien d'autre ne voyage.
    const fake = reconcilingDb({ payments: [{ id: 'pay0' }] });
    const ok = await replayOfflineItem(fake.db, itemOf('updatePaymentMonths', {
      studentId: 's1', paymentId: 'pay0', months: ['2026-09', '2026-11'],
      amount: 10000, receiptNumber: 'REC-0', date: '2026-01-10', studentName: 'Ali Diallo',
    }));

    assert.equal(ok, true);
    assert.deepEqual(
      fake.rpcs,
      [{ fn: 'set_payment_months', args: { p_payment_id: 'pay0', p_months: ['2026-09', '2026-11'] } }],
      'la RPC porte le reçu visé et les seuls mois',
    );
    assert.deepEqual(fake.updates, [], 'aucun UPDATE de table : ni `payments`, ni le solde de l’élève');
  });

  it('un rejeu de mois devant un reçu ABSENT (0 ligne écrite) ne se déclare pas écrit', async () => {
    // La fonction de la base rend le NOMBRE de lignes écrites : zéro n'est pas un
    // succès (le reçu visé n'existe plus, ou n'est pas là). L'item reste en file et
    // le dira — un rejeu qui « avale » le geste le perdrait sans que personne ne le
    // sache.
    const refused = {
      rpc: async () => ({ data: 0, error: null }),
    } as unknown as ReplayDb;

    const ok = await replayOfflineItem(refused, itemOf('updatePaymentMonths', {
      studentId: 's1', paymentId: 'pay0', months: ['2026-09'],
      amount: 10000, receiptNumber: 'REC-0', date: '2026-01-10', studentName: 'Ali Diallo',
    }));

    assert.equal(ok, false, 'zéro ligne écrite n’est pas un succès');
  });

  it('un rejeu de mois REFUSÉ par la base (droits) reste en file, avec sa raison', async () => {
    // Le cas d'un rôle qui n'est PAS éditeur des mois (`staff`, un compte
    // inconnu) : la fonction lève 42501, l'item n'est pas retiré de la file, et la
    // bannière peut nommer le refus au lieu de le taire — c'est la raison qui
    // distingue « en attente d'envoi » de « refusé, il ne partira pas tout seul ».
    const denied = () => ({
      rpc: async () => ({
        data: null,
        error: { message: 'renseigner les mois d’un reçu demande le rôle admin, dev ou econome', code: '42501' },
      }),
    } as unknown as ReplayDb);
    const item = itemOf('updatePaymentMonths', {
      studentId: 's1', paymentId: 'pay0', months: ['2026-09'],
      amount: 10000, receiptNumber: 'REC-0', date: '2026-01-10', studentName: 'Ali Diallo',
    });

    assert.equal(await replayOfflineItem(denied(), item), false);
    const outcome = await replayOfflineItemDetailed(denied(), item);
    assert.equal(outcome.ok, false);
    assert.match(outcome.reason ?? '', /admin, dev ou econome/, 'la raison nomme le refus, elle ne le tait pas');
    assert.match(outcome.reason ?? '', /42501/, 'et le code de la base y est');
  });
});

describe('offline replay audit mapping (offlineAuditInfo)', () => {
  // Actions whose online equivalent is audited → must produce an entry.
  const AUDITED: OfflineActionType[] = [
    'addPayment', 'deletePayment', 'updatePaymentMonths', 'addExpense', 'updateExpense', 'deleteExpense',
    'addVendorExpense', 'updateVendorExpense', 'deleteVendorExpense',
    'addStudent', 'updateStudent', 'deleteStudent',
    'addStaff', 'updateStaff', 'deleteStaff', 'addSalaryPayment',
    'addParent', 'updateParent', 'deleteParent',
    // Un réglage d'affichage est audité EN LIGNE aussi (`UPDATE_SETTING`, voir
    // dataOps/settings.ts) : le rejeu doit s'y lire de la même façon.
    'setDisplayPreference',
  ];
  // Not audited online → replay stays silent: tâches, classes, notes, année.
  // `addAuditLog` en fait partie pour une autre raison : c'est l'entrée de
  // journal elle-même, l'auditer bouclerait à l'infini.
  const SILENT: OfflineActionType[] = [
    'addTodo', 'updateTodo', 'deleteTodo',
    'addClass', 'updateClass', 'deleteClass',
    'addNote', 'deleteNote', 'setCurrentYear', 'addAuditLog',
    'updateUserRole',
  ];

  it('chaque type d’action est dans une liste et une seule (audité ou silencieux)', () => {
    // Sans ce contrôle, un type ajouté aux CASES mais oublié dans les deux listes
    // ci-dessus passerait sans jamais dire s'il est audité.
    const covered = [...AUDITED, ...SILENT].slice().sort();
    assert.deepEqual(covered, CASES.map((c) => c.type).slice().sort());
  });

  it('le rejeu d’un ajout de classe déjà existante (code 23505) est un succès', async () => {
    // Un code unique déjà pris n'est pas un échec : la classe que l'école voulait
    // créer EXISTE. La garder en file pour toujours serait un mensonge de plus.
    const duplicate = {
      from: () => ({
        insert: async () => ({ data: null, error: { message: 'duplicate key', code: '23505' } }),
      }),
    } as unknown as ReplayDb;
    assert.equal(
      await replayOfflineItem(duplicate, itemOf('addClass', { code: '2D', cycle: 'other', year: '', section: '', nameFr: '2D', nameEn: '2D' })),
      true,
    );
  });

  it('une modification qui ne touche AUCUNE ligne reste un échec (RLS)', async () => {
    // 200 avec un corps vide : la policy a retiré la cible. Compter ça comme
    // envoyé ferait disparaître de la file une modification jamais écrite.
    const { db } = makeFakeDb({ emptyWrites: ['custom_classes', 'calendar_notes'] });
    assert.equal(await replayOfflineItem(db, itemOf('updateClass', { id: 'c1', updates: { code: '2E', cycle: 'other', year: '', section: '', nameFr: '2E', nameEn: '2E' } })), false);
    assert.equal(await replayOfflineItem(db, itemOf('deleteClass', { id: 'c1' })), false);
    assert.equal(await replayOfflineItem(db, itemOf('deleteNote', { id: 'n1' })), false);
  });

  it('un rôle qu’aucune ligne n’a accepté reste en file (policy admin)', async () => {
    // `user_profiles` est réservée aux admins : la modification d'un autre compte
    // revient en 200 sans ligne. La compter comme envoyée retirerait de la file
    // un changement de rôle que la base n'a jamais reçu.
    const { db } = makeFakeDb({ emptyWrites: ['user_profiles'] });
    assert.equal(await replayOfflineItem(db, itemOf('updateUserRole', { id: 'u2', role: 'admin' })), false);

    const healthy = makeFakeDb().db;
    assert.equal(await replayOfflineItem(healthy, itemOf('updateUserRole', { id: 'u2', role: 'admin' })), true);
  });

  it('une note ajoutée hors ligne part avec son identifiant choisi sur le poste', async () => {
    const { db, rows } = makeFakeDb();
    const localId = createRowId();
    const ok = await replayOfflineItem(db, { ...itemOf('addNote', { date: '2026-09-03', text: 'Paiement' }), localId });
    assert.equal(ok, true);
    assert.equal(rows[0].table, 'calendar_notes');
    assert.equal(rows[0].row.id, localId);
    assert.equal(rows[0].row.note_date, '2026-09-03');
  });

  it('la déclaration d’année déplace le drapeau ET le retire à l’ancienne', async () => {
    const { db, queries } = makeFakeDb();
    const ok = await replayOfflineItem(db, itemOf('setCurrentYear', { year: '2026-2027' }));
    assert.equal(ok, true);
    assert.equal(queries.filter((t) => t === 'academic_years').length, 3, 'insertion + 2 mises à jour du drapeau');
  });

  it('une entrée de journal en file part sous l’acteur FIGÉ au moment du geste', async () => {
    const { db, rows } = makeFakeDb();
    const ok = await replayOfflineItem(db, itemOf('addAuditLog', { userId: 'u1', userEmail: 'aggee@mamathera.org', userName: 'Aggee Diarra', userRole: 'staff', action: 'ADD_STUDENT', targetType: 'student', targetId: 's1', details: 'Sidi COULIBALY' }));
    assert.equal(ok, true);
    assert.equal(rows[0].table, 'audit_logs');
    assert.equal(rows[0].row.user_email, 'aggee@mamathera.org');
    assert.equal(rows[0].row.action, 'ADD_STUDENT');
  });

  for (const type of AUDITED) {
    it(`maps '${type}' to an audited entry tagged [replay]`, () => {
      const item = CASES.find((c) => c.type === type)!.build();
      const info = offlineAuditInfo(item);
      assert.ok(info, `${type} should produce an audit entry`);
      assert.ok(info.action, `${type} should carry an action`);
      assert.ok(info.details && info.details.endsWith(' [replay]'), `${type} details should carry the [replay] tag`);
    });
  }

  /**
   * Le MOTIF dans le journal REJOUÉ — la même forme que le chemin en ligne.
   *
   * Un fait ne doit pas se lire de deux façons selon qu'il a attendu la ligne :
   * l'encaissement d'une inscription dit son motif dans sa phrase (clé STOCKÉE,
   * le journal n'a pas de langue) et le porte dans l'instantané STRUCTURÉ ;
   * l'encaissement ordinaire garde la phrase d'avant, mot pour mot.
   */
  it('porte le motif d’une inscription, en clair et dans l’instantané — et laisse l’ordinaire intact', () => {
    const registration = offlineAuditInfo(itemOf('addPayment', {
      studentId: 's1',
      payment: { id: 'pay1', date: '2026-10-04', amount: 100, receiptNumber: 'R1', motif: 'inscription' },
    }));
    assert.ok(registration);
    assert.match(String(registration.details), /motif : inscription/, 'la phrase nomme l’inscription');
    assert.equal(
      (registration.metadata as Record<string, unknown>)?.motif,
      'inscription',
      'et l’instantané porte la même clé que le chemin en ligne',
    );

    const ordinary = offlineAuditInfo(itemOf('addPayment', {
      studentId: 's1',
      payment: { id: 'pay2', date: '2026-10-04', amount: 100, receiptNumber: 'R2', motif: 'scolarite' },
    }));
    assert.equal(
      ordinary?.details,
      'Paiement de 100 FCFA (reçu R2) [replay]',
      'le geste ordinaire garde exactement la phrase d’avant',
    );
    assert.equal((ordinary?.metadata as Record<string, unknown>)?.motif, 'scolarite');

    // La suppression mise en file : le motif voyage avec elle (il finit dans
    // l'instantané qui rend le geste annulable).
    const deletion = offlineAuditInfo(itemOf('deletePayment', {
      studentId: 's1', paymentId: 'pay1', amount: 100, receiptNumber: 'R1', date: '2026-10-04', motif: 'inscription',
    }));
    assert.equal((deletion?.metadata as Record<string, unknown>)?.motif, 'inscription');
  });

  for (const type of SILENT) {
    it(`keeps '${type}' silent (no audit entry)`, () => {
      const item = CASES.find((c) => c.type === type)!.build();
      assert.equal(offlineAuditInfo(item), null, `${type} should not be audited`);
    });
  }
});

// ─── L'ORIGINE d'une entrée de journal écrite hors ligne ───────────────────
// Le défaut mesuré : `created_at` a un défaut `now()`, donc un geste du dimanche
// 22 h 50 écrit le lundi 8 h 05 se lisait « fait le lundi » — et il changeait de
// semaine dans l'archive. Le rejeu doit donc envoyer l'instant du GESTE et dire
// qu'il vient d'un poste coupé, sans quoi ni l'écran ni le PDF ne peuvent le
// savoir (voir src/lib/auditOffline.ts).

describe('origine hors ligne de l’entrée de journal', () => {
  const offlineItem = (): QueueItem => ({
    ...itemOf('addAuditLog', {
      userId: 'u1',
      userEmail: 'a@b.c',
      userName: 'Ada',
      userRole: 'admin',
      action: 'UPDATE_SETTINGS',
      targetType: 'settings',
      targetId: null,
      details: 'thème',
    }),
    createdAt: '2026-09-27T22:50:00.000Z',
  });

  it('rejoue avec l’instant du GESTE et le drapeau hors ligne', async () => {
    const { db, rows } = makeFakeDb();
    const ok = await replayOfflineItem(db, offlineItem());

    assert.equal(ok, true);
    const insert = rows.find((r) => r.table === 'audit_logs');
    assert.ok(insert, 'l’entrée part vers audit_logs');
    assert.equal(insert.row.created_at, '2026-09-27T22:50:00.000Z', 'la date est celle du geste, pas celle du câble');
    assert.equal(insert.row.recorded_offline, true, 'le drapeau qui rend la ligne rouge');
  });
});