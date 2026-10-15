/**
 * Suite for `src/lib/correctionHistory.ts` — les gestes de CORRECTION, tels que
 * l'Historique des paiements les montre à côté de la caisse.
 *
 * C'est la pièce qui répond à « qu'est-ce qui a été retiré du registre, et par
 * qui ? » sans jamais toucher au net encaissé. Trois propriétés sont verrouillées
 * ici, et chacune se paie en silence :
 *
 *   • SEULS les gestes de correction entrent dans ce bloc — un encaissement, une
 *     saisie de dépense ou un salaire enregistré n'en corrigent aucun ;
 *   • aucun montant n'est DEVINÉ : il vient de l'instantané (`salaryUndo.ts`) ou
 *     la ligne reste sans chiffre, même quand une phrase `details` en contient un ;
 *   • le résumé additionne les retraits et les rétablissements SÉPARÉMENT, et ne
 *     verse jamais un montant de dépense dans « retiré » — le bloc dit ce qu'il
 *     dit, il n'est pas un net.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  CORRECTION_HISTORY_ACTIONS,
  correctionHistoryRows,
  correctionHistorySummary,
  isCorrectionHistoryAction,
} from '../src/lib/correctionHistory';
import { archivedSalaryFrom, salarySnapshotMetadata } from '../src/lib/salaryUndo';
import { archivedPaymentFrom, paymentSnapshotMetadata } from '../src/lib/paymentUndo';
import type { CorrectionHistoryRow } from '../src/lib/correctionHistory';
import type { AuditLogEntry } from '../src/lib/auditLogger';
import type { SalaryPayment, Staff } from '../src/lib/domainTypes';

const PAY: SalaryPayment = {
  id: 'sp1',
  staffId: 't1',
  amount: 150000,
  date: '2026-10-01',
  academicYear: '2026-2027',
};

/** L'instantané d'une paie retirée, tel que `deleteSalaryPayment` l'écrit. */
const SALARY_META = salarySnapshotMetadata(archivedSalaryFrom('t1', 'Alice Traoré', PAY));

/** L'instantané d'un REÇU — l'autre famille, qui ne doit produire ni montant ni sujet ici. */
const RECEIPT_META = paymentSnapshotMetadata(archivedPaymentFrom('st1', 'Ali Diallo', {
  id: 'pay1', date: '2026-10-01', amount: 25000,
}));

const log = (over: Partial<AuditLogEntry>): AuditLogEntry => ({
  id: 'l1',
  action: 'DELETE_SALARY_PAYMENT',
  createdAt: '2026-10-05T10:00:00Z',
  userName: 'Ada Admin',
  userEmail: 'ada@ecole.ml',
  userRole: 'admin',
  ...over,
});

const STAFF: Staff[] = [
  { id: 't1', name: 'Alice Traoré', position: 'teacher', salary: 150000, email: '', phone: '', bankDetails: '', emergencyContact: '' },
];

describe('correctionHistory — quels gestes entrent dans le bloc', () => {
  it('les quatre actions de correction sont reconnues, et rien d’autre', () => {
    assert.deepEqual(
      [...CORRECTION_HISTORY_ACTIONS].sort(),
      ['DELETE_EXPENSE', 'DELETE_SALARY_PAYMENT', 'DELETE_VENDOR_EXPENSE', 'RESTORE_SALARY_PAYMENT'],
    );
    for (const action of CORRECTION_HISTORY_ACTIONS) {
      assert.equal(isCorrectionHistoryAction(action), true, `${action} est un geste de correction`);
    }
    // Ce qui ENREGISTRE ne corrige rien : le mêler au bloc rendrait illisible la
    // seule question qu'il pose (« qu'est-ce qui a été retiré ? »).
    for (const action of ['RECORD_SALARY_PAYMENT', 'ADD_EXPENSE', 'ADD_VENDOR_EXPENSE', 'UPDATE_EXPENSE', 'RECORD_PAYMENT', 'RESTORE_PAYMENT']) {
      assert.equal(isCorrectionHistoryAction(action), false, `${action} n’est pas une correction`);
    }
    assert.equal(isCorrectionHistoryAction(null), false);
    assert.equal(isCorrectionHistoryAction(undefined), false);
  });

  it('les enregistrements du journal ne deviennent jamais des lignes du bloc', () => {
    const rows = correctionHistoryRows({
      logs: [
        log({ id: 'l1', action: 'RECORD_SALARY_PAYMENT', metadata: SALARY_META }),
        log({ id: 'l2', action: 'ADD_EXPENSE' }),
        log({ id: 'l3', action: 'ADD_VENDOR_EXPENSE' }),
        log({ id: 'l4', action: 'DELETE_EXPENSE' }),
      ],
    });
    assert.deepEqual(rows.map((row) => row.id), ['l4']);
  });

  it('les plus récents d’abord, quel que soit l’ordre du journal', () => {
    const rows = correctionHistoryRows({
      logs: [
        log({ id: 'vieux', createdAt: '2026-10-01T08:00:00Z' }),
        log({ id: 'neuf', createdAt: '2026-10-07T08:00:00Z' }),
        log({ id: 'milieu', createdAt: '2026-10-04T08:00:00Z' }),
      ],
    });
    assert.deepEqual(rows.map((row) => row.id), ['neuf', 'milieu', 'vieux']);
    assert.deepEqual(rows.map((row) => row.at), ['2026-10-07T08:00:00Z', '2026-10-04T08:00:00Z', '2026-10-01T08:00:00Z']);
  });

  it('chaque ligne garde l’entrée d’origine (seule lecture de `details`)', () => {
    // L'écran relit `row.log.details` (traduit) et l'origine hors ligne : une
    // ligne qui ne garderait pas l'entrée ne pourrait dire ni l'un ni l'autre.
    const entry = log({ id: 'l9', details: 'suppression dépense' });
    const [row] = correctionHistoryRows({ logs: [entry] });
    assert.equal(row?.log, entry);
  });
});

describe('correctionHistory — le sujet et le montant ne sont jamais devinés', () => {
  it('le nom de l’instantané fait foi ; l’annuaire ne sert que de recours', () => {
    const [fromSnapshot] = correctionHistoryRows({
      logs: [log({ metadata: salarySnapshotMetadata(archivedSalaryFrom('t1', 'Nom du journal', PAY)) })],
      staff: STAFF,
    });
    assert.equal(fromSnapshot?.subject, 'Nom du journal', 'le nom figé par le geste passe avant l’annuaire');
    assert.equal(fromSnapshot?.amount, 150000);
  });

  it('sans nom dans l’instantané, l’annuaire du personnel peut nommer le membre', () => {
    // Les premières entrées de `DELETE_SALARY_PAYMENT` peuvent n’avoir qu’un
    // `staff_id` : le membre est alors retrouvé dans l’annuaire, jamais inventé.
    const [row] = correctionHistoryRows({
      logs: [log({ metadata: salarySnapshotMetadata(archivedSalaryFrom('t1', undefined, PAY)) })],
      staff: STAFF,
    });
    assert.equal(row?.subject, 'Alice Traoré');
  });

  it('un membre absent de l’annuaire laisse le sujet VIDE, et garde le montant', () => {
    const [row] = correctionHistoryRows({
      logs: [log({ metadata: salarySnapshotMetadata(archivedSalaryFrom('t9', undefined, PAY)) })],
      staff: STAFF,
    });
    assert.equal(row?.subject, '');
    assert.equal(row?.amount, 150000, 'le montant vient de l’instantané, pas de l’annuaire');
  });

  it('le nom est rogné, et un nom vide ne devient pas un nom', () => {
    const [row] = correctionHistoryRows({
      logs: [log({ metadata: salarySnapshotMetadata(archivedSalaryFrom('t1', '   ', PAY)) })],
      staff: [{ ...STAFF[0]!, name: '  Alice Traoré  ' }],
    });
    assert.equal(row?.subject, 'Alice Traoré');
  });

  it('une dépense retirée n’a AUCUN montant chiffré, même si sa phrase en contient un', () => {
    // Le module ne lit pas un nombre dans une phrase libre : la colonne reste
    // vide, et l'écran affiche un tiret plutôt qu'un zéro qui aurait l'air d'un
    // montant — c'est la règle qui empêche une somme de dépenses de se présenter
    // comme un chiffre de caisse.
    const [row] = correctionHistoryRows({
      logs: [log({
        action: 'DELETE_EXPENSE',
        details: 'fournitures — 12500 FCFA supprimée',
        metadata: null,
      })],
    });
    assert.equal(row?.amount, null);
    assert.equal(row?.subject, '', 'une dépense ne nomme pas de membre');
    assert.equal(row?.action, 'DELETE_EXPENSE');
  });

  it('un instantané de REÇU sur une entrée de salaire ne produit ni montant ni sujet', () => {
    // Les deux familles ne se confondent pas : le lecteur de salaires refuse un
    // `kind` de reçu, donc la ligne reste sans chiffre au lieu d’afficher le
    // montant d’un encaissement dans le bloc des corrections.
    const [row] = correctionHistoryRows({
      logs: [log({ action: 'DELETE_SALARY_PAYMENT', metadata: RECEIPT_META })],
      staff: STAFF,
    });
    assert.equal(row?.amount, null);
    assert.equal(row?.subject, '');
  });

  it('le rétablissement d’un salaire garde son montant (c’est la réparation du geste)', () => {
    const [row] = correctionHistoryRows({
      logs: [log({ action: 'RESTORE_SALARY_PAYMENT', targetId: 'sp1', metadata: SALARY_META })],
    });
    assert.equal(row?.action, 'RESTORE_SALARY_PAYMENT');
    assert.equal(row?.amount, 150000);
    assert.equal(row?.subject, 'Alice Traoré');
  });

  it('l’auteur du geste est celui figé par le journal, vide plutôt que deviné', () => {
    const [nomme, anonyme] = correctionHistoryRows({
      logs: [
        log({ id: 'l1', userName: '  Ada Admin  ', userEmail: '  ada@ecole.ml  ', userRole: ' admin ' }),
        // Instant plus ancien : l'ordre du bloc est le plus récent d'abord, donc
        // c'est bien l2 que le tri place en second.
        log({ id: 'l2', createdAt: '2026-10-05T09:00:00Z', userName: undefined, userEmail: undefined, userRole: undefined }),
      ],
    });
    assert.equal(nomme?.actorName, 'Ada Admin');
    assert.equal(nomme?.actorEmail, 'ada@ecole.ml');
    assert.equal(nomme?.actorRole, 'admin');
    assert.equal(anonyme?.actorName, '');
    assert.equal(anonyme?.actorEmail, '');
    assert.equal(anonyme?.actorRole, '');
  });

  it('sans annuaire fourni, rien ne lève et le sujet reste vide', () => {
    const [row] = correctionHistoryRows({
      logs: [log({ metadata: salarySnapshotMetadata(archivedSalaryFrom('t1', undefined, PAY)) })],
    });
    assert.equal(row?.subject, '');
  });
});

describe('correctionHistory — le résumé n’est pas un net', () => {
  const rowOf = (over: Partial<CorrectionHistoryRow>): CorrectionHistoryRow => ({
    id: 'x',
    at: '2026-10-05T10:00:00Z',
    action: 'DELETE_SALARY_PAYMENT',
    actorName: '',
    actorEmail: '',
    actorRole: '',
    subject: '',
    amount: null,
    log: log({}),
    ...over,
  });

  it('compte TOUS les gestes, mais n’additionne que ceux qui portent un montant', () => {
    const summary = correctionHistorySummary([
      rowOf({ amount: 150000 }),
      rowOf({ action: 'DELETE_EXPENSE', amount: null }),
      rowOf({ action: 'RESTORE_SALARY_PAYMENT', amount: 40000 }),
    ]);
    assert.deepEqual(summary, { count: 3, withAmount: 2, removed: 150000, restored: 40000 });
  });

  it('sépare ce qui a été retiré de ce qui a été remis', () => {
    const summary = correctionHistorySummary([
      rowOf({ id: 'a', amount: 150000 }),
      rowOf({ id: 'b', amount: 25000 }),
      rowOf({ id: 'c', action: 'RESTORE_SALARY_PAYMENT', amount: 25000 }),
    ]);
    assert.equal(summary.removed, 175000, 'les deux retraits de salaire');
    assert.equal(summary.restored, 25000, 'la seule remise');
  });

  it('un montant de DÉPENSE n’entre jamais dans « retiré »', () => {
    // Ces gestes ne touchent pas la caisse : ce bloc dit ce qui a été retiré puis
    // remis, et rien d'autre. Un montant de dépense y compterait comme une sortie
    // de caisse qu'aucune ligne d'encaissement ne connaît.
    const summary = correctionHistorySummary([
      rowOf({ action: 'DELETE_VENDOR_EXPENSE', amount: 12500 }),
      rowOf({ action: 'DELETE_EXPENSE', amount: 8000 }),
    ]);
    assert.equal(summary.removed, 0);
    assert.equal(summary.restored, 0);
    assert.equal(summary.withAmount, 2, 'ils portent bien un chiffre, mais ils ne sont pas des retraits de paie');
  });

  it('une liste vide rend un résumé vide, jamais `NaN`', () => {
    assert.deepEqual(correctionHistorySummary([]), { count: 0, withAmount: 0, removed: 0, restored: 0 });
  });

  it('le résumé décrit exactement les lignes du bloc', () => {
    // La cohérence entre les deux lectures est ce que l'écran affiche côte à
    // côte : un résumé calculé sur une autre liste que le tableau serait un
    // second chiffre à croire.
    const rows = correctionHistoryRows({
      logs: [
        log({ id: 'l1', metadata: SALARY_META }),
        log({ id: 'l2', action: 'DELETE_EXPENSE', createdAt: '2026-10-06T10:00:00Z', metadata: null }),
        log({ id: 'l3', action: 'ADD_EXPENSE', metadata: null }),
      ],
    });
    const summary = correctionHistorySummary(rows);
    assert.equal(summary.count, rows.length);
    assert.equal(summary.withAmount, 1);
    assert.equal(summary.removed, 150000);
  });
});
