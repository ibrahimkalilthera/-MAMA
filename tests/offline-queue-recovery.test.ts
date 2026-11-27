// Le constat d'une file hors-ligne, et la réécriture de ses références d'élève.
//
// WHY THIS EXISTS
// ---------------
// Le 2026-11-27, le poste de l'école portait 38 gestes refusés en `23503` sur
// `payments` : leur élève n'avait jamais été créé. La seule façon de récupérer
// ces reçus sans les effacer est de savoir, geste par geste, ce que la base en
// fera — et de réécrire la référence seulement quand la fiche existe ailleurs.
//
// Ces tests verrouillent les décisions qui coûtent de l'argent si elles se
// trompent :
//   • un paiement dont l'élève est créé par la file n'est PAS orphelin ;
//   • un paiement dont l'élève est introuvable est nommé, avec son reçu, sa date
//     et son montant — de quoi reconnaître le papier ;
//   • une fiche déjà en base sous la même clé métier (nom + téléphone + classe
//     + année, l'index `students_business_key_unique`) donne une correspondance,
//     et son `addStudent` est retiré de la file corrigée en le disant ;
//   • un reçu déjà en base n'est pas un geste perdu — c'est un geste déjà écrit ;
//   • un reçu porté par un AUTRE paiement est un blocage, pas un succès ;
//   • la réécriture ne touche à rien d'autre (ni montant, ni date, ni reçu).
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  QUEUE_STORAGE_KEY,
  VERDICT,
  auditOfflineQueue,
  businessKeyOf,
  normalizeQueue,
  rewriteQueue,
} from '../scripts/lib/offline-queue-audit.mjs';

const STUDENT_LOCAL = '00000000-0000-4000-8000-00000000aa01';
const STUDENT_OTHER = '00000000-0000-4000-8000-00000000aa02';
const STUDENT_REAL = '00000000-0000-4000-8000-00000000bb01';
const PAYMENT_LOCAL = '00000000-0000-4000-8000-00000000cc01';

function addStudent(localId: string, overrides: Record<string, unknown> = {}) {
  return {
    id: `off_1_${localId.slice(-4)}`,
    type: 'addStudent',
    localId,
    createdAt: '2026-11-27T07:40:00.000Z',
    attempts: 3,
    lastError: 'duplicate key value violates unique constraint "students_student_id_key" [23505]',
    payload: {
      name: 'Amadou BOLLY',
      parentName: 'Amadoun BOLLY',
      parentPhone: '+223 70 00 00 01',
      grade: '9ème Année B (9B)',
      academicYear: '2026-2027',
      totalDue: 150000,
      status: 'Active',
      ...overrides,
    },
  };
}

function addPayment(studentId: string, localId: string | undefined, receiptNumber: string, amount: number, date: string) {
  return {
    id: `off_2_${receiptNumber}`,
    type: 'addPayment',
    localId,
    createdAt: '2026-11-27T07:41:00.000Z',
    attempts: 2,
    lastError: 'insert or update on table "payments" violates foreign key constraint [23503]',
    payload: {
      studentId,
      payment: { amount, date, receiptNumber, academicYear: '2026-2027', months: [] },
    },
  };
}

const studentRow = {
  id: STUDENT_REAL,
  name: 'Amadou BOLLY',
  parent_phone: '+223 70 00 00 01',
  grade: '9ème Année B (9B)',
  academic_year: '2026-2027',
};

describe('file hors-ligne — constat', () => {
  it('n’appelle pas « orphelin » un élève que la file elle-même crée', () => {
    const report = auditOfflineQueue({
      items: [addStudent(STUDENT_LOCAL), addPayment(STUDENT_LOCAL, PAYMENT_LOCAL, 'REC-1', 15000, '2026-11-27')],
      students: [],
      payments: [],
    });

    assert.equal(report.entries[0].verdict, VERDICT.PRET_A_PARTIR);
    assert.equal(report.entries[1].verdict, VERDICT.CREE_PAR_LA_FILE);
    assert.equal(report.blocking.length, 0);
    assert.equal(report.recoverable.length, 2);
  });

  it('nomme un élève introuvable avec le reçu, la date et le montant', () => {
    const report = auditOfflineQueue({
      items: [addPayment(STUDENT_OTHER, PAYMENT_LOCAL, 'REC-42', 15000, '2026-11-27')],
      students: [],
      payments: [],
    });

    const [entry] = report.entries;
    assert.equal(entry.verdict, VERDICT.ELEVE_A_RATTACHER);
    assert.equal(entry.receiptNumber, 'REC-42');
    assert.equal(entry.amount, 15000);
    assert.equal(entry.date, '2026-11-27');
    assert.equal(report.toAttach.length, 1);
  });

  it('reconnaît la fiche existante par la clé métier de la base, et propose son identifiant', () => {
    const report = auditOfflineQueue({
      items: [addStudent(STUDENT_LOCAL), addPayment(STUDENT_LOCAL, PAYMENT_LOCAL, 'REC-7', 15000, '2026-11-27')],
      students: [studentRow],
      payments: [],
    });

    assert.equal(report.entries[0].verdict, VERDICT.DOUBLON_METIER);
    assert.equal(report.mapping[STUDENT_LOCAL], STUDENT_REAL);
    assert.equal(report.entries[1].verdict, VERDICT.CREE_PAR_LA_FILE);
  });

  it('ne propose rien quand deux fiches portent la même clé métier', () => {
    const report = auditOfflineQueue({
      items: [addStudent(STUDENT_LOCAL)],
      students: [studentRow, { ...studentRow, id: '00000000-0000-4000-8000-00000000bb02' }],
      payments: [],
    });

    assert.equal(report.entries[0].verdict, VERDICT.DOUBLON_METIER);
    assert.equal(report.mapping[STUDENT_LOCAL], undefined);
    assert.match(report.entries[0].detail, /2 fiches/);
  });

  it('tient un reçu déjà en base pour récupéré, pas pour perdu', () => {
    const report = auditOfflineQueue({
      items: [addPayment(STUDENT_REAL, undefined, 'REC-9', 15000, '2026-11-27')],
      students: [studentRow],
      payments: [{ id: 'p1', student_id: STUDENT_REAL, receipt_number: 'REC-9', amount: '15000', date: '2026-11-27' }],
    });

    assert.equal(report.entries[0].verdict, VERDICT.DEJA_EN_BASE);
    assert.equal(report.blocking.length, 0);
  });

  it('bloque un numéro de reçu porté par un autre paiement', () => {
    const report = auditOfflineQueue({
      items: [addPayment(STUDENT_REAL, undefined, 'REC-9', 15000, '2026-11-27')],
      students: [studentRow],
      payments: [{ id: 'p1', student_id: STUDENT_REAL, receipt_number: 'REC-9', amount: '20000', date: '2026-11-20' }],
    });

    assert.equal(report.entries[0].verdict, VERDICT.RECU_DEJA_PRIS);
    assert.equal(report.blocking.length, 1);
  });

  it('signale une correction visant un paiement absent', () => {
    const report = auditOfflineQueue({
      items: [{
        id: 'off_3',
        type: 'deletePayment',
        createdAt: '2026-11-27T07:42:00.000Z',
        attempts: 1,
        payload: { studentId: STUDENT_REAL, paymentId: 'inconnu', amount: 0, date: '2026-11-27' },
      }],
      students: [studentRow],
      payments: [],
    });

    assert.equal(report.entries[0].verdict, VERDICT.CIBLE_ABSENTE);
  });

  it('lit la file telle que le poste l’exporte : liste, objet ou texte brut', () => {
    const items = [addStudent(STUDENT_LOCAL)];
    assert.deepEqual(normalizeQueue(items), items);
    assert.deepEqual(normalizeQueue({ queue: items }), items);
    assert.deepEqual(normalizeQueue(JSON.stringify(items)), items);
    assert.deepEqual(normalizeQueue({ [QUEUE_STORAGE_KEY]: JSON.stringify(items) }), items);
    assert.throws(() => normalizeQueue('pas du json'), /illisible/);
    assert.throws(() => normalizeQueue({ foo: 1 }), /liste de gestes/);
  });

  it('calcule la clé métier exactement comme l’index de la base', () => {
    assert.equal(
      businessKeyOf({ name: '  Amadou BOLLY ', parentPhone: '+223 70 00 00 01', grade: '9ÈME ANNÉE B (9B) ', academicYear: '2026-2027' }),
      businessKeyOf({ name: 'amadou bolly', parentPhone: '+223 70 00 00 01', grade: '9ème année b (9b)', academicYear: '2026-2027' }),
    );
    assert.notEqual(
      businessKeyOf({ name: 'Amadou BOLLY', parentPhone: '+223 70 00 00 01', grade: '9B', academicYear: '2026-2027' }),
      businessKeyOf({ name: 'Amadou BOLLY', parentPhone: '+223 70 00 00 01', grade: '9B', academicYear: '2025-2026' }),
    );
  });
});

describe('file hors-ligne — réécriture', () => {
  it('rattache les paiements à la fiche réelle et retire la création devenue inutile', () => {
    const items = [
      addStudent(STUDENT_LOCAL),
      addPayment(STUDENT_LOCAL, PAYMENT_LOCAL, 'REC-7', 15000, '2026-11-27'),
      {
        id: 'off_4',
        type: 'updateStudent',
        localId: undefined,
        createdAt: '2026-11-27T07:43:00.000Z',
        attempts: 0,
        payload: { id: STUDENT_LOCAL, updates: { notes: 'inscrit en 9B' } },
      },
    ];

    const { items: corrected, rewritten, removed } = rewriteQueue(items, { [STUDENT_LOCAL]: STUDENT_REAL });

    assert.equal(removed.length, 1);
    assert.equal(removed[0].type, 'addStudent');
    assert.equal(corrected.length, 2);
    assert.equal(corrected[0].payload.studentId, STUDENT_REAL);
    assert.equal(corrected[1].payload.id, STUDENT_REAL);
    assert.equal(rewritten.length, 2);
  });

  it('ne touche ni au montant, ni à la date, ni au reçu du geste réécrit', () => {
    const payment = addPayment(STUDENT_LOCAL, PAYMENT_LOCAL, 'REC-7', 15000, '2026-11-27');
    const { items: corrected } = rewriteQueue([payment], { [STUDENT_LOCAL]: STUDENT_REAL });

    assert.deepEqual(corrected[0].payload.payment, payment.payload.payment);
    assert.equal(corrected[0].localId, PAYMENT_LOCAL);
    assert.equal(corrected[0].lastError, payment.lastError);
    assert.equal(corrected[0].payload.studentId, STUDENT_REAL);
    // Le geste d'origine n'est pas muté : la file de départ reste la preuve.
    assert.equal(payment.payload.studentId, STUDENT_LOCAL);
  });

  it('laisse intacte une file sans correspondance', () => {
    const items = [addStudent(STUDENT_LOCAL), addPayment(STUDENT_LOCAL, PAYMENT_LOCAL, 'REC-7', 15000, '2026-11-27')];
    const { items: corrected, rewritten, removed } = rewriteQueue(items, {});

    assert.deepEqual(corrected, items);
    assert.equal(rewritten.length, 0);
    assert.equal(removed.length, 0);
  });
});
