/**
 * Suite for `src/lib/salaryUndo.ts` — l'instantané d'un SALAIRE, et la règle de
 * son rétablissement.
 *
 * C'est la pièce qui rend le retrait d'une paie fautive RÉVERSIBLE. Jusqu'ici le
 * seul recours était de supprimer le MEMBRE, dont la clé étrangère est
 * `ON DELETE CASCADE` : toute sa paie partait avec lui, et le journal ne disait
 * plus quel montant avait disparu. Ces cas verrouillent donc trois choses, et
 * chacune se paie en silence :
 *
 *   • l'aller-retour écriture→relecture, sur lequel s'appuie « Rétablir » ;
 *   • les refus qui empêchent d'inventer une ligne qu'on n'a pas gardée ;
 *   • la FRONTIÈRE entre les deux familles d'argent — un salaire n'est pas un
 *     reçu, et le genre (`kind`) est ce qui les sépare jusque dans le journal.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  SALARY_UNDO_KIND,
  archivedSalaryFrom,
  archivedSalaryOf,
  restorableSalary,
  restoredSalaryIds,
  salarySnapshotMetadata,
  salarySnapshotOf,
} from '../src/lib/salaryUndo';
import {
  PAYMENT_UNDO_KIND,
  archivedPaymentFrom,
  paymentSnapshotMetadata,
  paymentSnapshotOf,
} from '../src/lib/paymentUndo';
import type { AuditLogEntry } from '../src/lib/auditLogger';
import type { SalaryPayment } from '../src/lib/domainTypes';

const PAY: SalaryPayment = {
  id: 'sp1',
  staffId: 't1',
  amount: 150000,
  date: '2026-10-01',
  academicYear: '2026-2027',
};

const log = (over: Partial<AuditLogEntry>): AuditLogEntry => ({
  id: 'l1',
  action: 'DELETE_SALARY_PAYMENT',
  createdAt: '2026-10-05T10:00:00Z',
  ...over,
});

const META = salarySnapshotMetadata(archivedSalaryFrom('t1', 'Alice Traoré', PAY));

const RECEIPT_ARCHIVE = archivedPaymentFrom('st1', 'Ali Diallo', {
  id: 'pay1', date: '2026-10-01', amount: 25000, receiptNumber: 'REC-1',
});

describe('salaryUndo — l’instantané fait l’aller-retour', () => {
  it('un salaire retiré se relit tel qu’il a été écrit', () => {
    const archived = archivedSalaryFrom('t1', 'Alice Traoré', PAY);
    assert.deepEqual(archivedSalaryOf(log({ metadata: salarySnapshotMetadata(archived) })), {
      salaryPaymentId: 'sp1',
      staffId: 't1',
      staffName: 'Alice Traoré',
      date: '2026-10-01',
      amount: 150000,
      academicYear: '2026-2027',
    });
  });

  it('un salaire sans année scolaire se relit quand même', () => {
    // Une ligne peut n’avoir aucune année (saisie d’avant la colonne, ou exercice
    // non précisé) : la relecture doit rendre l’ABSENCE, jamais une année devinée
    // — réinsérer le salaire dans le mauvais exercice serait une seconde erreur
    // au moment de réparer la première.
    const archived = archivedSalaryFrom('t1', undefined, { id: 'sp9', staffId: 't1', amount: 40000, date: '2026-09-30' });
    const back = archivedSalaryOf(log({ metadata: salarySnapshotMetadata(archived) }));
    assert.equal(back?.salaryPaymentId, 'sp9');
    assert.equal(back?.amount, 40000);
    assert.equal(back?.academicYear, undefined);
    assert.equal(back?.staffName, undefined, 'sans nom, l’instantané n’en invente aucun');
  });

  it('une ligne sans id n’est PAS un instantané exploitable', () => {
    // `archivedSalaryFrom` rend `''` quand la ligne n’a pas d’id : rien ne peut
    // être réinséré sous cette clé, donc la relecture rend `null` plutôt qu’un
    // instantané qui créerait un doublon à la restauration.
    const archived = archivedSalaryFrom('t1', 'Alice', { id: '', staffId: 't1', amount: 1, date: '2026-10-01' });
    assert.equal(archived.salaryPaymentId, '');
    assert.equal(salarySnapshotOf({ metadata: salarySnapshotMetadata(archived) }), null);
  });

  it('n’invente rien : genre étranger, metadata absent, ou champs manquants → null', () => {
    assert.equal(salarySnapshotOf({ metadata: null }), null);
    assert.equal(salarySnapshotOf({ metadata: { kind: 'autre_chose' } }), null);
    assert.equal(salarySnapshotOf({ metadata: { ...META, salary_payment_id: '' } }), null, 'sans id, rien ne se réinsère');
    assert.equal(salarySnapshotOf({ metadata: { ...META, staff_id: '' } }), null, 'sans membre, la paie n’est attribuable à personne');
    assert.equal(salarySnapshotOf({ metadata: { ...META, date: '' } }), null, 'sans date, la ligne n’est pas datable');
    assert.equal(salarySnapshotOf({ metadata: { ...META, amount: 'pas un montant' } }), null, 'un montant illisible n’est pas un montant');
    assert.equal(salarySnapshotOf({ metadata: { kind: SALARY_UNDO_KIND, salary_payment_id: 'sp1' } }), null);
  });

  it('seule une SUPPRESSION rend un salaire rétablissable', () => {
    // Une entrée d’ENREGISTREMENT peut porter le même instantané sans qu’une
    // restauration ait de sens pour elle : c’est la règle de l’annulation, pas la
    // forme, qui décide — exactement comme pour un reçu.
    for (const action of ['RECORD_SALARY_PAYMENT', 'DELETE_SALARY_PAYMENT', 'RESTORE_SALARY_PAYMENT']) {
      assert.deepEqual(salarySnapshotOf({ metadata: META }), archivedSalaryFrom('t1', 'Alice Traoré', PAY), `le lecteur partagé accepte ${action}`);
      assert.equal(
        archivedSalaryOf({ action, metadata: META }) === null,
        action !== 'DELETE_SALARY_PAYMENT',
        `${action} : rétablissable seulement si c’est une suppression`,
      );
    }
  });
});

describe('salaryUndo — un salaire n’est pas un reçu', () => {
  it('les deux genres diffèrent, et aucun lecteur ne lit l’autre', () => {
    // Le même `metadata` nourrit deux lecteurs : si les genres se confondaient,
    // une suppression de salaire proposerait de restaurer un reçu — et la
    // réinsertion irait dans la mauvaise table.
    assert.notEqual(SALARY_UNDO_KIND, PAYMENT_UNDO_KIND, 'deux familles d’argent, deux marqueurs');
    assert.equal(
      salarySnapshotOf({ metadata: paymentSnapshotMetadata(RECEIPT_ARCHIVE) }),
      null,
      'un instantané de reçu ne devient jamais un salaire',
    );
    assert.equal(
      paymentSnapshotOf({ metadata: META }),
      null,
      'un instantané de salaire ne devient jamais un reçu',
    );
    assert.equal(paymentSnapshotOf({ metadata: null }), null);
    assert.equal(salarySnapshotOf({ metadata: null }), null);
  });

  it('la forme du reçu reste lisible par son PROPRE lecteur (le partage n’a rien cassé)', () => {
    assert.deepEqual(paymentSnapshotOf({ metadata: paymentSnapshotMetadata(RECEIPT_ARCHIVE) }), RECEIPT_ARCHIVE);
  });
});

describe('salaryUndo — ce qui est encore rétablissable', () => {
  it('une suppression sans restauration est rétablissable', () => {
    const logs = [log({ metadata: META })];
    assert.deepEqual(restorableSalary(logs[0]!, logs), {
      salaryPaymentId: 'sp1',
      staffId: 't1',
      staffName: 'Alice Traoré',
      date: '2026-10-01',
      amount: 150000,
      academicYear: '2026-2027',
    });
  });

  it('une fois rétabli, il ne l’est plus (une seconde restauration écraserait un geste réel)', () => {
    const logs = [
      log({ id: 'l2', action: 'RESTORE_SALARY_PAYMENT', targetId: 'sp1', createdAt: '2026-10-05T11:00:00Z' }),
      log({ metadata: META }),
    ];
    assert.equal(restorableSalary(logs[1]!, logs), null);
    assert.deepEqual([...restoredSalaryIds(logs)], ['sp1']);
  });

  it('le rétablissement d’un AUTRE salaire ne ferme pas celui-ci', () => {
    const logs = [log({ action: 'RESTORE_SALARY_PAYMENT', targetId: 'sp2' }), log({ metadata: META })];
    assert.ok(restorableSalary(logs[1]!, logs), 'l’instantané de sp1 reste rétablissable');
    assert.equal([...restoredSalaryIds(logs)].includes('sp1'), false);
  });

  it('une entrée qui n’est pas une suppression, ou sans instantané, ne propose rien', () => {
    // Une suppression d’AVANT cette colonne n’a pas d’instantané : la ligne du
    // journal reste visible, sans bouton — on n’invente pas la ligne qu’on n’a pas
    // gardée.
    assert.equal(restorableSalary(log({ action: 'RECORD_SALARY_PAYMENT', metadata: META }), []), null);
    assert.equal(restorableSalary(log({ metadata: null }), []), null);
    assert.equal(restorableSalary(log({ metadata: paymentSnapshotMetadata(RECEIPT_ARCHIVE) }), []), null);
  });

  it('une restauration sans cible ne ferme rien', () => {
    // `restoredSalaryIds` n’accepte qu’un id NOMMÉ : une entrée de restauration
    // sans cible ne doit pas faire disparaître le bouton d’un autre salaire.
    const logs = [log({ action: 'RESTORE_SALARY_PAYMENT', targetId: undefined }), log({ metadata: META })];
    assert.ok(restorableSalary(logs[1]!, logs));
    assert.equal(restoredSalaryIds(logs).size, 0);
  });
});
