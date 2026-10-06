/**
 * Suite for `src/lib/paymentUndo.ts` — l'instantané d'un paiement, et la règle
 * de l'annulation.
 *
 * C'est la pièce qui rend une suppression ANNULABLE : le journal garde de quoi
 * réinsérer la ligne, mais seulement si la forme est EXACTE. Ces cas verrouillent
 * l'aller-retour écriture→relecture, et les trois refus qui évitent de restaurer
 * une ligne qu'on n'a pas (ou de restaurer deux fois).
 *
 * Le même instantané sert à l'Historique des paiements, qui le lit sur les TROIS
 * gestes : la lecture partagée (`paymentSnapshotOf`) accepte donc une entrée
 * d'encaissement, tandis que la règle d'annulation (`archivedPaymentOf`) la
 * refuse — c'est la distinction que les derniers cas mesurent.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  archivedPaymentFrom,
  archivedPaymentOf,
  paymentSnapshotMetadata,
  paymentSnapshotOf,
  restorablePayment,
  restoredPaymentIds,
} from '../src/lib/paymentUndo';
import type { AuditLogEntry } from '../src/lib/auditLogger';
import type { Payment } from '../src/lib/domainTypes';

const PAY: Payment = {
  id: 'pay1', date: '2026-10-01', amount: 25000, academicYear: '2026-2027', receiptNumber: 'REC-1',
};

const log = (over: Partial<AuditLogEntry>): AuditLogEntry => ({
  id: 'l1', action: 'DELETE_PAYMENT', createdAt: '2026-10-05T10:00:00Z', ...over,
});

describe('paymentUndo — l’instantané fait l’aller-retour', () => {
  it('un paiement supprimé se relit tel qu’il a été écrit', () => {
    const archived = archivedPaymentFrom('st1', 'Ali Diallo', PAY);
    const back = archivedPaymentOf(log({ metadata: paymentSnapshotMetadata(archived) }));
    assert.deepEqual(back, {
      paymentId: 'pay1', studentId: 'st1', studentName: 'Ali Diallo',
      date: '2026-10-01', amount: 25000, academicYear: '2026-2027', receiptNumber: 'REC-1',
    });
  });

  it('un paiement sans reçu ni année se relit quand même', () => {
    const archived = archivedPaymentFrom('st1', undefined, { id: 'pay9', date: '2026-09-01', amount: 4000 });
    const back = archivedPaymentOf(log({ metadata: paymentSnapshotMetadata(archived) }));
    assert.equal(back?.paymentId, 'pay9');
    assert.equal(back?.amount, 4000);
    assert.equal(back?.academicYear, undefined);
    assert.equal(back?.receiptNumber, undefined);
  });

  it('n’invente rien : mauvaise action, pas de metadata, ou forme étrangère → null', () => {
    const meta = paymentSnapshotMetadata(archivedPaymentFrom('st1', 'Ali', PAY));
    assert.equal(archivedPaymentOf(log({ action: 'RECORD_PAYMENT', metadata: meta })), null);
    assert.equal(archivedPaymentOf(log({ metadata: null })), null);
    assert.equal(archivedPaymentOf(log({ metadata: { kind: 'autre_chose' } })), null);
    assert.equal(archivedPaymentOf(log({ metadata: { kind: 'payment_row', payment_id: 'pay1' } })), null, 'sans élève ni date, ce n’est pas un instantané exploitable');
  });

  // ─── La même forme, lue par un AUTRE lecteur ──────────────────────────────
  // L'Historique des paiements lit l'instantané sur les trois gestes. Une entrée
  // d'ENCAISSEMENT en porte donc un depuis le 2026-10-06 — et elle doit rester
  // NON annulable : c'est la règle de l'annulation, pas la forme, qui décide.
  it('le lecteur partagé accepte les trois gestes, la règle d’annulation un seul', () => {
    const archived = archivedPaymentFrom('st1', 'Ali Diallo', PAY);
    const meta = paymentSnapshotMetadata(archived);
    for (const action of ['RECORD_PAYMENT', 'DELETE_PAYMENT', 'RESTORE_PAYMENT']) {
      assert.deepEqual(
        paymentSnapshotOf({ metadata: meta }),
        archived,
        `l’instantané se relit sur ${action}`,
      );
      assert.equal(
        archivedPaymentOf({ action, metadata: meta }) === null,
        action !== 'DELETE_PAYMENT',
        `${action} : annulable seulement si c’est une suppression`,
      );
    }
    assert.equal(paymentSnapshotOf({ metadata: null }), null, 'sans metadata, rien n’est deviné');
  });
});

describe('paymentUndo — ce qui est encore annulable', () => {
  const meta = paymentSnapshotMetadata(archivedPaymentFrom('st1', 'Ali Diallo', PAY));

  it('une suppression sans restauration est annulable', () => {
    const logs = [log({ metadata: meta })];
    assert.deepEqual(restorablePayment(logs[0]!, logs), {
      paymentId: 'pay1', studentId: 'st1', studentName: 'Ali Diallo',
      date: '2026-10-01', amount: 25000, academicYear: '2026-2027', receiptNumber: 'REC-1',
    });
  });

  it('une fois restaurée, elle ne l’est plus (une seconde restauration écraserait un geste réel)', () => {
    const logs = [
      log({ id: 'l2', action: 'RESTORE_PAYMENT', targetId: 'pay1', createdAt: '2026-10-05T11:00:00Z' }),
      log({ metadata: meta }),
    ];
    assert.equal(restorablePayment(logs[1]!, logs), null);
    assert.deepEqual([...restoredPaymentIds(logs)], ['pay1']);
  });

  it('la restauration d’un AUTRE paiement ne ferme pas celle-ci', () => {
    const logs = [log({ action: 'RESTORE_PAYMENT', targetId: 'pay2' }), log({ metadata: meta })];
    assert.ok(restorablePayment(logs[1]!, logs), 'l’instantané de pay1 reste annulable');
    assert.equal([...restoredPaymentIds(logs)].includes('pay1'), false);
  });
});
