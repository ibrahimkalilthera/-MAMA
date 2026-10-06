/**
 * Suite for `src/lib/paymentHistory.ts` — l'historique des paiements.
 *
 * Ce que ces cas verrouillent, et pourquoi chacun compte :
 *   • la vue LIT le journal : elle ne garde que les trois gestes de paiement, et
 *     l'élève vient de `target_id` pour un encaissement (le seul geste qui le met
 *     là) ou de l'instantané pour une annulation / une restauration ;
 *   • le montant CHIFFRÉ vient de l'instantané quand le geste en porte un, et
 *     SINON de la phrase `details` dont le gabarit est écrit par ce dépôt : les 3
 *     seuls gestes de paiement du journal de PRODUCTION n'avaient pas d'instantané,
 *     et la colonne MONTANT disait « voir le détail » partout (mesuré le
 *     2026-10-06) ;
 *   • une phrase HORS gabarit ne donne aucun montant : la ligne est comptée dans
 *     `withoutAmount`, jamais devinée — un total qui se tairait serait pire que
 *     pas de total.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  filterPaymentHistory,
  isPaymentHistoryAction,
  livePaymentOf,
  paymentFactsFromDetails,
  paymentHistoryRows,
  paymentHistorySummary,
} from '../src/lib/paymentHistory';
import { archivedPaymentFrom, paymentSnapshotMetadata } from '../src/lib/paymentUndo';
import type { AuditLogEntry } from '../src/lib/auditLogger';
import type { Payment, Student } from '../src/lib/domainTypes';

const student = (over: Partial<Student> & { id: string; name: string }): Student => ({
  parentName: '',
  parentEmail: '',
  parentPhone: '',
  totalDue: 0,
  amountPaid: 0,
  dueDate: '2026-10-01',
  payments: [],
  notes: '',
  ...over,
});

const STUDENTS: Student[] = [
  student({ id: 'st1', name: 'Ali Diallo', grade: '6B' }),
  student({ id: 'st2', name: 'Awa Traoré', grade: '9A' }),
];

const PAY: Payment = { id: 'pay1', date: '2026-10-01', amount: 4000, academicYear: '2026-2027', receiptNumber: 'REC-1' };
const snapshot = (studentId: string, name: string, payment: Payment) =>
  paymentSnapshotMetadata(archivedPaymentFrom(studentId, name, payment));

const entry = (over: Partial<AuditLogEntry> & { id: string; action: string }): AuditLogEntry => ({
  createdAt: '2026-10-05T10:00:00Z',
  ...over,
});

describe('paymentHistory — quelles entrées entrent dans l’historique', () => {
  it('ne garde que les gestes de paiement', () => {
    const logs = [
      entry({ id: 'l1', action: 'RECORD_PAYMENT', targetId: 'st1' }),
      entry({ id: 'l2', action: 'ADD_STUDENT' }),
      entry({ id: 'l3', action: 'DELETE_STUDENT' }),
      entry({ id: 'l4', action: 'RECORD_SALARY_PAYMENT' }),
      entry({ id: 'l5', action: 'DELETE_PAYMENT', targetId: 'pay1', metadata: snapshot('st1', 'Ali Diallo', PAY) }),
    ];
    const rows = paymentHistoryRows({ logs });
    assert.deepEqual(rows.map((row) => row.action).sort(), ['DELETE_PAYMENT', 'RECORD_PAYMENT']);
    assert.equal(isPaymentHistoryAction('RECORD_SALARY_PAYMENT'), false, 'un salaire SORT de la caisse : il n’est pas un encaissement');
    assert.equal(isPaymentHistoryAction('RECORD_PAYMENT'), true);
    assert.equal(isPaymentHistoryAction(null), false);
  });

  it('trie du plus récent au plus ancien', () => {
    const rows = paymentHistoryRows({
      logs: [
        entry({ id: 'a', action: 'RECORD_PAYMENT', targetId: 'st1', createdAt: '2026-10-01T08:00:00Z' }),
        entry({ id: 'b', action: 'RECORD_PAYMENT', targetId: 'st1', createdAt: '2026-10-05T08:00:00Z' }),
        entry({ id: 'c', action: 'RECORD_PAYMENT', targetId: 'st1', createdAt: '2026-10-03T08:00:00Z' }),
      ],
    });
    assert.deepEqual(rows.map((row) => row.id), ['b', 'c', 'a']);
  });
});

describe('paymentHistory — qui a encaissé, pour qui, combien', () => {
  it('un encaissement : l’utilisateur connecté, l’élève (par `target_id`) et son nom actuel', () => {
    const rows = paymentHistoryRows({
      students: STUDENTS,
      logs: [
        entry({
          id: 'l1',
          action: 'RECORD_PAYMENT',
          targetId: 'st1',
          userName: 'Aggee Diarra',
          userEmail: 'aggee@mama.test',
          userRole: 'econome',
          details: 'Paiement de 4000 FCFA (reçu REC-1)',
        }),
      ],
    });
    assert.equal(rows.length, 1);
    assert.equal(rows[0]!.actorName, 'Aggee Diarra', 'l’encaisseur vient du journal');
    assert.equal(rows[0]!.actorEmail, 'aggee@mama.test');
    assert.equal(rows[0]!.actorRole, 'econome');
    assert.equal(rows[0]!.studentId, 'st1');
    assert.equal(rows[0]!.studentName, 'Ali Diallo', 'le nom se lit sur l’annuaire, pas dans la phrase');
    assert.equal(rows[0]!.studentGrade, '6B');
    assert.equal(rows[0]!.amount, 4000, 'sans instantané, le montant se relit dans la phrase du journal');
    assert.equal(rows[0]!.receiptNumber, 'REC-1', 'et le reçu aussi');
    assert.equal(rows[0]!.paymentId, null, 'un encaissement ne nomme pas son paiement : son `target_id` est l’ÉLÈVE');
  });

  it('un encaissement AVEC instantané donne un montant chiffré et le reçu', () => {
    const rows = paymentHistoryRows({
      students: STUDENTS,
      logs: [
        entry({
          id: 'l1',
          action: 'RECORD_PAYMENT',
          targetId: 'st1',
          metadata: snapshot('st1', 'Ali Diallo', PAY),
          details: 'Paiement de 4000 FCFA (reçu REC-1)',
        }),
      ],
    });
    assert.equal(rows[0]!.amount, 4000);
    assert.equal(rows[0]!.receiptNumber, 'REC-1');
  });

  it('une annulation : l’élève et le montant viennent de l’instantané, pas de `target_id` (qui est le PAIEMENT)', () => {
    const rows = paymentHistoryRows({
      students: STUDENTS,
      logs: [
        entry({
          id: 'l1',
          action: 'DELETE_PAYMENT',
          targetType: 'payment',
          targetId: 'pay1',
          metadata: snapshot('st2', 'Awa Traoré', PAY),
          details: 'Paiement de 4000 FCFA (reçu REC-1) du 2026-10-01 supprimé — élève Awa Traoré',
        }),
      ],
    });
    assert.equal(rows[0]!.studentId, 'st2', '`target_id` est l’id du paiement : l’élève ne peut venir que de l’instantané');
    assert.equal(rows[0]!.studentName, 'Awa Traoré');
    assert.equal(rows[0]!.amount, 4000);
  });

  it('sans instantané ni `target_id` d’élève, rien n’est inventé', () => {
    const rows = paymentHistoryRows({
      students: STUDENTS,
      logs: [entry({ id: 'l1', action: 'RESTORE_PAYMENT', targetId: 'pay1', details: 'Paiement restauré' })],
    });
    assert.equal(rows[0]!.studentId, null);
    assert.equal(rows[0]!.studentName, null);
    assert.equal(rows[0]!.studentGrade, null);
    assert.equal(rows[0]!.amount, null);
  });

  it('un élève supprimé de l’annuaire garde son nom d’instantané (le journal ne se réécrit pas)', () => {
    const rows = paymentHistoryRows({
      students: [],
      logs: [
        entry({
          id: 'l1',
          action: 'RECORD_PAYMENT',
          targetId: 'st-disparu',
          metadata: snapshot('st-disparu', 'Élève Parti', PAY),
        }),
      ],
    });
    assert.equal(rows[0]!.studentName, 'Élève Parti');
    assert.equal(rows[0]!.studentGrade, null, 'sa classe n’existe plus : on ne la devine pas');
  });

  it('l’entrée d’origine reste portée par la ligne (une seule définition du « hors ligne »)', () => {
    const log = entry({ id: 'l1', action: 'RECORD_PAYMENT', targetId: 'st1', recordedOffline: true, syncedAt: '2026-10-06T07:00:00Z' });
    const rows = paymentHistoryRows({ logs: [log] });
    assert.equal(rows[0]!.log, log, 'la marque hors ligne se lit dans auditOffline, pas ici');
  });
});

describe('paymentHistory — filtres et résumé', () => {
  const rows = paymentHistoryRows({
    students: STUDENTS,
    logs: [
      entry({
        id: 'record-1',
        action: 'RECORD_PAYMENT',
        targetId: 'st1',
        createdAt: '2026-10-02T09:00:00Z',
        userName: 'Aggee Diarra',
        metadata: snapshot('st1', 'Ali Diallo', PAY),
      }),
      entry({
        id: 'record-2',
        action: 'RECORD_PAYMENT',
        targetId: 'st2',
        createdAt: '2026-10-04T09:00:00Z',
        userName: 'Moussa Keïta',
        metadata: snapshot('st2', 'Awa Traoré', { ...PAY, id: 'pay2', amount: 6000, receiptNumber: 'REC-2' }),
      }),
      entry({
        id: 'cancel-1',
        action: 'DELETE_PAYMENT',
        targetId: 'pay2',
        createdAt: '2026-10-05T09:00:00Z',
        userName: 'Aggee Diarra',
        metadata: snapshot('st2', 'Awa Traoré', { ...PAY, id: 'pay2', amount: 6000, receiptNumber: 'REC-2' }),
      }),
      entry({
        id: 'legacy-1',
        action: 'RECORD_PAYMENT',
        targetId: 'st1',
        createdAt: '2026-09-20T09:00:00Z',
        userName: 'Aggee Diarra',
        details: 'Paiement de 4000 FCFA (reçu REC-0)',
      }),
    ],
  });

  it('filtre par geste', () => {
    assert.deepEqual(filterPaymentHistory(rows, { action: 'DELETE_PAYMENT' }).map((r) => r.id), ['cancel-1']);
    assert.equal(filterPaymentHistory(rows, { action: 'all' }).length, 4);
  });

  it('filtre par période, bornes INCLUSES', () => {
    assert.deepEqual(
      filterPaymentHistory(rows, { from: '2026-10-02', to: '2026-10-04' }).map((r) => r.id),
      ['record-2', 'record-1'],
    );
    assert.deepEqual(filterPaymentHistory(rows, { from: '2026-10-01' }).map((r) => r.id), ['cancel-1', 'record-2', 'record-1']);
  });

  it('cherche sur l’élève, le reçu et le caissier', () => {
    assert.deepEqual(filterPaymentHistory(rows, { search: 'awa' }).map((r) => r.id), ['cancel-1', 'record-2']);
    assert.deepEqual(filterPaymentHistory(rows, { search: 'REC-2' }).map((r) => r.id), ['cancel-1', 'record-2']);
    assert.deepEqual(filterPaymentHistory(rows, { search: 'moussa' }).map((r) => r.id), ['record-2']);
    assert.equal(filterPaymentHistory(rows, { search: 'personne' }).length, 0);
  });

  it('le résumé additionne seulement ce qui est chiffré, et DIT ce qu’il laisse de côté', () => {
    const summary = paymentHistorySummary(rows);
    assert.deepEqual(summary, { count: 4, collected: 14000, cancelled: 6000, net: 8000, withoutAmount: 0 });
    // La ligne sans instantané (REC-0, 6000 FCFA) est COMPTÉE : sa phrase porte le
    // gabarit du dépôt, donc le net porte sur les quatre gestes affichés.
    // `withoutAmount` ne compte plus que les phrases vraiment illisibles.
    assert.equal(summary.collected - summary.cancelled, summary.net);
  });

  it('un résumé vide est un zéro honnête, pas un `undefined`', () => {
    assert.deepEqual(paymentHistorySummary([]), { count: 0, collected: 0, cancelled: 0, net: 0, withoutAmount: 0 });
  });
});

describe('paymentFactsFromDetails — la phrase du journal, quand l’instantané manque', () => {
  it('lit le gabarit d’aujourd’hui, le reçu, et l’élève quand la phrase le nomme', () => {
    assert.deepEqual(paymentFactsFromDetails('Paiement de 4000 FCFA (reçu REC-549205)'), {
      amount: 4000,
      receiptNumber: 'REC-549205',
      studentName: null,
    });
    // Une suppression nomme l'élève — c'est aussi ce qui rend la ligne lisible
    // quand l'ancien geste n'a pas d'instantané.
    assert.deepEqual(
      paymentFactsFromDetails('Paiement de 4000 FCFA (reçu REC-1) du 2026-10-05 supprimé — élève Djenebou DIALLO'),
      { amount: 4000, receiptNumber: 'REC-1', studentName: 'Djenebou DIALLO' },
    );
    // Le rejeu hors ligne ajoute sa marque à la fin : elle ne fait pas partie du fait.
    assert.equal(paymentFactsFromDetails('Paiement de 7777 FCFA (reçu REC-8) [replay]').amount, 7777);
  });

  it('lit aussi le gabarit ANGLAIS d’avant le 2026-09-13 (le journal ne se réécrit pas)', () => {
    assert.deepEqual(paymentFactsFromDetails('Payment of 80000 FCFA recorded (Receipt: REC-690078)'), {
      amount: 80000,
      receiptNumber: 'REC-690078',
      studentName: null,
    });
  });

  it('lit les milliers écrits par l’école, et un reçu resté à « N/A »', () => {
    assert.equal(paymentFactsFromDetails('Paiement de 1 500 000 FCFA (reçu REC-2)').amount, 1500000);
    assert.equal(paymentFactsFromDetails('Paiement de 1.500.000 FCFA (reçu REC-2)').amount, 1500000);
    assert.equal(paymentFactsFromDetails('Paiement de 4000 FCFA (reçu N/A)').receiptNumber, null, '« N/A » n’est pas un reçu');
  });

  it('ne lit RIEN hors gabarit — un total ne doit pas additionner autre chose', () => {
    assert.deepEqual(paymentFactsFromDetails('Paiement restauré'), { amount: null, receiptNumber: null, studentName: null });
    // Un nombre qui n'est pas suivi de `FCFA` n'est pas un montant, et la phrase
    // est ANCRÉE au début : aucun de ces deux-là ne se lit.
    assert.equal(paymentFactsFromDetails('Élève modifié — total dû 35998 → 36000').amount, null);
    assert.equal(paymentFactsFromDetails('Paiement de 4000 (reçu REC-1)').amount, null, 'sans le mot FCFA, pas de montant');
    assert.deepEqual(paymentFactsFromDetails(null), { amount: null, receiptNumber: null, studentName: null });
  });

  it('la ligne d’un encaissement d’avant l’instantané porte le montant ET le reçu du journal', () => {
    const rows = paymentHistoryRows({
      students: STUDENTS,
      logs: [entry({ id: 'l1', action: 'RECORD_PAYMENT', targetId: 'st1', details: 'Paiement de 6000 FCFA (reçu REC-0)' })],
    });
    assert.equal(rows[0]!.amount, 6000);
    assert.equal(rows[0]!.receiptNumber, 'REC-0');
  });
});

describe('livePaymentOf — le paiement ENCORE VIVANT qu’une ligne désigne', () => {
  const withPayments = (payments: Payment[]) => [student({ id: 'st1', name: 'Ali Diallo', grade: '6B', payments })];

  it('résout par l’ID du paiement (l’instantané, ou le `target_id` d’une suppression)', () => {
    const students = withPayments([PAY]);
    const rows = paymentHistoryRows({
      students,
      logs: [entry({ id: 'l1', action: 'DELETE_PAYMENT', targetId: 'pay1', metadata: snapshot('st1', 'Ali Diallo', PAY) })],
    });
    const live = livePaymentOf(rows[0]!, students);
    assert.equal(live?.payment.id, 'pay1', 'le paiement vivant est retrouvé par son id');
    assert.equal(live?.student.id, 'st1');
  });

  it('résout par le REÇU quand l’encaissement n’a pas d’instantané — le cas des 3 gestes de production', () => {
    const students = withPayments([{ ...PAY, receiptNumber: 'REC-549205' }]);
    const rows = paymentHistoryRows({
      students,
      logs: [entry({ id: 'l1', action: 'RECORD_PAYMENT', targetId: 'st1', details: 'Paiement de 4000 FCFA (reçu REC-549205)' })],
    });
    assert.equal(livePaymentOf(rows[0]!, students)?.payment.id, 'pay1');
  });

  it('ne devine pas : un reçu porté par DEUX paiements ne désigne rien', () => {
    const students = withPayments([
      { ...PAY, id: 'pay1', receiptNumber: 'REC-9' },
      { ...PAY, id: 'pay2', receiptNumber: 'REC-9' },
    ]);
    const rows = paymentHistoryRows({
      students,
      logs: [entry({ id: 'l1', action: 'RECORD_PAYMENT', targetId: 'st1', details: 'Paiement de 4000 FCFA (reçu REC-9)' })],
    });
    assert.equal(livePaymentOf(rows[0]!, students), null, 'un reçu ambigu n’est pas un identifiant');
  });

  it('un paiement ANNULÉ n’est plus vivant : il n’y a plus de reçu à montrer', () => {
    const students = withPayments([]);
    const rows = paymentHistoryRows({
      students,
      logs: [entry({ id: 'l1', action: 'DELETE_PAYMENT', targetId: 'pay1', metadata: snapshot('st1', 'Ali Diallo', PAY) })],
    });
    assert.equal(livePaymentOf(rows[0]!, students), null);
  });
});
