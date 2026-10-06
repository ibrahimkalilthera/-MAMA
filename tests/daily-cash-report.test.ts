/**
 * LE RAPPORT DE CAISSE D'UNE JOURNÉE — le module pur.
 *
 * La demande : « regroupe les encaissements par caissier avec le total encaissé et
 * les annulations du jour ». Trois choses pouvaient mal tourner, et chacune est
 * mesurée ici :
 *
 *   1. **la journée** — un rapport qui prendrait la journée d'UTC rangerait un
 *      encaissement du soir dans le lendemain sur tout poste à l'est de
 *      Greenwich ; `localDayIso` lit les accesseurs LOCAUX, et le rapport ne
 *      retient que les gestes de cette journée-là ;
 *   2. **le regroupement** — deux « Awa » ne doivent pas fusionner leurs caisses
 *      (la clé est le COMPTE, quand il existe), et un geste sans caissier
 *      identifiable doit former son propre groupe plutôt que de disparaître d'un
 *      total : le total du jour est la somme de ses caissiers, toujours ;
 *   3. **l'honnêteté des montants** — un geste sans montant chiffré (entrée
 *      d'avant l'instantané `metadata`) ne s'additionne pas : il est COMPTÉ à part,
 *      par caissier et pour le jour.
 *
 * Et un verrou qui vaut mieux que tous les autres : les totaux du rapport doivent
 * être EXACTEMENT ceux de `paymentHistorySummary` — la fonction qui signe la ligne
 * de résumé de l'historique au-dessus. Deux additions écrites à la main auraient
 * fini par diverger, et c'est l'écart qu'une caisse ne pardonne pas.
 *
 * Pur : aucune horloge (la journée est passée), aucun DOM, aucun réseau.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { translations } from '../src/i18n/translations';
import type { TranslationDict } from '../src/i18n/translations';
import type { AuditLogEntry } from '../src/lib/auditLogger';
import { dailyCashReport, localDayIso } from '../src/lib/dailyCashReport';
import { filterPaymentHistory, paymentHistoryRows, paymentHistorySummary } from '../src/lib/paymentHistory';
import type { PaymentHistoryRow } from '../src/lib/paymentHistory';
import { archivedPaymentFrom, paymentSnapshotMetadata } from '../src/lib/paymentUndo';
import type { Payment, Student } from '../src/lib/domainTypes';

const DAY = '2026-10-06';
const OTHER_DAY = '2026-10-05';

const alice: Student = {
  id: 'st1', name: 'Alice Traoré', grade: '6B', parentName: '', parentEmail: '', parentPhone: '',
  totalDue: 0, amountPaid: 0, dueDate: '2026-10-01', payments: [], notes: '',
};
const bob: Student = {
  id: 'st2', name: 'Bob Keïta', grade: '5A', parentName: '', parentEmail: '', parentPhone: '',
  totalDue: 0, amountPaid: 0, dueDate: '2026-10-01', payments: [], notes: '',
};

const pay = (id: string, amount: number, receiptNumber: string): Payment => ({
  id, date: '2026-10-06', amount, academicYear: '2026-2027', receiptNumber,
});

/** Un encaissement réussi, avec son instantané (donc son montant CHIFFRÉ). */
function collected(
  id: string,
  at: string,
  actor: { name?: string; email?: string; role?: string },
  student: Student,
  amount: number,
  receiptNumber: string,
): AuditLogEntry {
  return {
    id,
    action: 'RECORD_PAYMENT',
    targetType: 'payment',
    targetId: student.id,
    userName: actor.name,
    userEmail: actor.email,
    userRole: actor.role,
    createdAt: at,
    details: `Paiement de ${amount} FCFA (reçu ${receiptNumber})`,
    metadata: paymentSnapshotMetadata(archivedPaymentFrom(student.id, student.name, pay(id, amount, receiptNumber))),
  };
}

const AGGEE = { name: 'Aggee Diarra', email: 'aggee@mama.test', role: 'econome' };
const MOUSSA = { name: 'Moussa Keïta', email: 'Moussa.Keita@mama.test' };

const logs: AuditLogEntry[] = [
  collected('d1', `${DAY}T08:05:00Z`, AGGEE, alice, 4000, 'REC-1'),
  collected('d2', `${DAY}T08:40:00Z`, MOUSSA, bob, 6000, 'REC-2'),
  {
    // L'annulation du jour, par le même compte que d1.
    id: 'd3',
    action: 'DELETE_PAYMENT',
    targetId: 'd1',
    userName: AGGEE.name,
    userEmail: AGGEE.email,
    userRole: AGGEE.role,
    createdAt: `${DAY}T09:10:00Z`,
    details: 'Paiement de 4000 FCFA (reçu REC-1) du 2026-10-06 supprimé — élève Alice Traoré',
    metadata: paymentSnapshotMetadata(archivedPaymentFrom(alice.id, alice.name, pay('d1', 4000, 'REC-1'))),
  },
  {
    // Le MÊME compte, écrit en majuscules : il doit rejoindre le groupe d'Aggee —
    // la casse d'une adresse ne fait pas un second caissier.
    ...collected('d4', `${DAY}T10:00:00Z`, { ...AGGEE, email: 'AGGEE@MAMA.TEST' }, alice, 4000, 'REC-3'),
  },
  {
    // Une restauration remet de l'argent en caisse : elle compte AVEC les
    // encaissements, comme `paymentHistorySummary` la compte.
    id: 'd5',
    action: 'RESTORE_PAYMENT',
    targetId: 'd1',
    userName: MOUSSA.name,
    userEmail: MOUSSA.email,
    createdAt: `${DAY}T11:00:00Z`,
    details: 'Paiement de 4000 FCFA (reçu REC-1) restauré',
    metadata: paymentSnapshotMetadata(archivedPaymentFrom(alice.id, alice.name, pay('d1', 1500, 'REC-1'))),
  },
  {
    // Le geste d'AVANT l'instantané structuré : montant seulement dans la phrase.
    id: 'd6',
    action: 'RECORD_PAYMENT',
    targetId: alice.id,
    userName: AGGEE.name,
    userEmail: AGGEE.email,
    createdAt: `${DAY}T12:00:00Z`,
    details: 'Paiement de 2000 FCFA (reçu REC-4)',
  },
  {
    // Une ligne de journal SANS phrase du tout : le montant n'existe nulle part.
    // Elle est COMPTÉE, jamais devinée — c'est le seul geste qui reste sans
    // montant maintenant que le gabarit des phrases se relit.
    id: 'd9',
    action: 'RECORD_PAYMENT',
    targetId: alice.id,
    userName: AGGEE.name,
    userEmail: AGGEE.email,
    userRole: AGGEE.role,
    createdAt: `${DAY}T14:00:00Z`,
  },
  {
    // Aucun caissier identifiable : son geste doit rester dans le total du jour.
    id: 'd7',
    action: 'RECORD_PAYMENT',
    targetId: bob.id,
    createdAt: `${DAY}T13:00:00Z`,
    details: 'Paiement de 1000 FCFA (reçu REC-5)',
    metadata: paymentSnapshotMetadata(archivedPaymentFrom(bob.id, bob.name, pay('d7', 1000, 'REC-5'))),
  },
  // La veille — elle ne doit JAMAIS entrer dans le rapport du 6, ni par ses
  // encaissements, ni par ses annulations.
  collected('d8', `${OTHER_DAY}T23:50:00Z`, AGGEE, alice, 99999, 'REC-9'),
  {
    id: 'd0',
    action: 'DELETE_PAYMENT',
    targetId: 'd8',
    userName: MOUSSA.name,
    userEmail: MOUSSA.email,
    createdAt: `${OTHER_DAY}T23:55:00Z`,
    details: 'Paiement de 7777 FCFA (reçu REC-8) du 2026-10-05 supprimé — élève Alice Traoré',
    metadata: paymentSnapshotMetadata(archivedPaymentFrom(alice.id, alice.name, pay('d8', 7777, 'REC-8'))),
  },
];

const rows: PaymentHistoryRow[] = paymentHistoryRows({ logs, students: [alice, bob] });
const report = (day: string) => dailyCashReport({ rows, day });

describe('journée locale — un rapport de caisse est celui du POSTE', () => {
  it('lit les accesseurs locaux, pas la journée d’UTC', () => {
    // Les composantes sont LOCALES : sur une machine en UTC, `toISOString()` et
    // cette lecture coïncident — c'est ailleurs qu'elles divergent, et c'est
    // précisément ce que ce cas protège (Bamako est en UTC+0, un poste itinérant
    // ou un serveur ne l'est pas).
    const local = new Date(2026, 9, 6, 23, 30, 0);
    assert.equal(localDayIso(local), '2026-10-06', 'la journée du geste est celle du poste');
    assert.equal(localDayIso(new Date(2026, 0, 1, 0, 5, 0)), '2026-01-01', 'les deux chiffres du mois et du jour sont complétés');
  });
});

describe('regroupement par caissier', () => {
  it('ne retient que les gestes de la journée demandée', () => {
    const day = report(DAY);
    assert.equal(day.day, DAY);
    assert.equal(day.count, 8, 'les huit gestes du 6 octobre, pas celui de la veille');
    assert.equal(day.rows.length, 8);
    const previous = report(OTHER_DAY);
    assert.equal(previous.count, 2, 'le rapport de la veille voit ses deux gestes, et rien du 6');
    assert.equal(previous.collected, 99999);
    assert.equal(previous.cancelled, 7777, 'son annulation lui appartient');
    const empty = report('2026-10-04');
    assert.deepEqual(empty.cashiers, [], 'une journée sans geste n’a aucun caissier');
    assert.equal(empty.collected, 0);
  });

  it('regroupe par COMPTE (casse ignorée), et laisse un groupe aux gestes sans caissier', () => {
    const day = report(DAY);
    assert.equal(day.cashiers.length, 3, 'trois caissiers : Aggee, Moussa, et les gestes sans compte');

    const aggee = day.cashiers.find((cashier) => cashier.key === 'aggee@mama.test');
    assert.ok(aggee, 'l’adresse écrite en majuscules a rejoint le compte d’Aggee');
    assert.equal(aggee!.count, 5, 'trois encaissements, une annulation, et un geste sans montant');
    assert.equal(aggee!.collected, 10000, 'les montants CHIFFRÉS s’additionnent — instantané ou phrase');
    assert.equal(aggee!.cancelled, 4000);
    assert.equal(aggee!.net, 6000);
    // Le geste d'avant l'instantané (d6, 2000 FCFA) est désormais CHIFFRÉ depuis sa
    // phrase — c'est la réparation : la colonne MONTANT disait « voir le détail »
    // sur toutes les lignes de production. Seul le geste sans phrase (d9) reste
    // COMPTÉ au lieu d'être additionné.
    assert.equal(aggee!.withoutAmount, 1, 'une ligne sans phrase est COMPTÉE, pas additionnée');

    const moussa = day.cashiers.find((cashier) => cashier.key === 'moussa.keita@mama.test');
    assert.ok(moussa, 'la clé d’un caissier sans rôle est quand même son compte');
    assert.equal(moussa!.collected, 7500, 'une restauration compte avec les encaissements');
    assert.equal(moussa!.cancelled, 0);
    assert.equal(moussa!.net, 7500);

    const anonymous = day.cashiers.find((cashier) => cashier.key === '');
    assert.ok(anonymous, 'un geste sans caissier forme son propre groupe — il ne disparaît pas');
    assert.equal(anonymous!.count, 1);
    assert.equal(anonymous!.withoutAmount, 0);
    assert.equal(anonymous!.collected, 1000);
  });

  it('range les caissiers par encaissé décroissant', () => {
    const keys = report(DAY).cashiers.map((cashier) => cashier.key);
    assert.deepEqual(keys, ['aggee@mama.test', 'moussa.keita@mama.test', ''], 'le premier est celui qui a le plus encaissé');
  });

  it('le total du jour est la somme de ses caissiers, jamais autre chose', () => {
    const day = report(DAY);
    const sum = (pick: (cashier: (typeof day.cashiers)[number]) => number) =>
      day.cashiers.reduce((total, cashier) => total + pick(cashier), 0);
    assert.equal(sum((c) => c.collected), day.collected);
    assert.equal(sum((c) => c.cancelled), day.cancelled);
    assert.equal(sum((c) => c.net), day.net);
    assert.equal(sum((c) => c.count), day.count);
    assert.equal(sum((c) => c.withoutAmount), day.withoutAmount);
  });

  it('ses totaux sont EXACTEMENT ceux de la ligne de résumé de l’historique', () => {
    // Le verrou : la carte est rendue juste au-dessus du tableau de l'historique,
    // dont le résumé vient de `paymentHistorySummary`. Les deux phrases doivent
    // être le même calcul — sinon l'écran se contredit lui-même.
    const day = report(DAY);
    const screen = paymentHistorySummary(filterPaymentHistory(rows, { from: DAY, to: DAY }));
    assert.deepEqual(
      { count: day.count, collected: day.collected, cancelled: day.cancelled, net: day.net, withoutAmount: day.withoutAmount },
      screen,
    );
  });
});

describe('les annulations du jour', () => {
  it('liste les annulations de la journée, et rien d’autre', () => {
    const day = report(DAY);
    assert.equal(day.cancellations.length, 1);
    assert.equal(day.cancellations[0]!.id, 'd3', 'l’annulation du 6 octobre');
    assert.equal(day.cancellations[0]!.amount, 4000, 'son montant chiffré, relu dans l’instantané');
    assert.equal(day.cancellations[0]!.receiptNumber, 'REC-1');
    assert.equal(day.cancellations[0]!.studentName, 'Alice Traoré');
    assert.equal(
      day.cancellations.some((row) => row.action !== 'DELETE_PAYMENT'),
      false,
      'une restauration n’est pas une annulation',
    );
    // Le point exact de la demande — « les annulations DU JOUR » : une annulation
    // de la veille ne doit pas apparaître ici, où elle ferait croire à une caisse
    // du jour moins pleine qu'elle ne l'est.
    assert.equal(
      day.cancellations.some((row) => row.id === 'd0'),
      false,
      'une annulation de la VEILLE ne rejoint pas le rapport du jour',
    );
    assert.deepEqual(
      report(OTHER_DAY).cancellations.map((row) => row.id),
      ['d0'],
      'et elle reste dans le rapport de son propre jour',
    );
  });

  it('nomme le caissier de chaque annulation — c’est lui qui répond de sa caisse', () => {
    const t = translations.fr as TranslationDict;
    const cancel = report(DAY).cancellations[0]!;
    assert.equal(cancel.actorName, 'Aggee Diarra');
    assert.equal(cancel.actorEmail, 'aggee@mama.test');
    assert.equal(cancel.actorRole, 'econome');
    // Le groupe (et son total d'annulations) porte le même auteur : le détail et la
    // synthèse ne peuvent pas désigner deux personnes pour un même geste.
    const group = report(DAY).cashiers.find((cashier) => cashier.key === 'aggee@mama.test');
    assert.equal(group!.name, cancel.actorName);
    assert.equal(group!.cancelled, cancel.amount);
    assert.ok(t.dailyCashReportCancellations.includes('{count}'), 'la phrase du titre attend son compte — la clé existe');
  });
});
