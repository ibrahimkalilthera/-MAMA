/**
 * Suite for `src/lib/paymentInstallments.ts` — les versements partiels.
 *
 * Trois promesses, et chacune se mesure :
 *
 *   • un versement PARTIEL n'efface pas la dette : le reste dû se calcule sur
 *     les frais des mois qu'il déclare, et le mois reste OUVERT (`settled` ne
 *     le voit pas) — sans quoi le complément serait refusé le jour où la
 *     famille revient ;
 *   • le reçu DIT ce qu'il fait : « versement partiel — reste à payer X », puis
 *     « solde — total réglé Y » quand le complément arrive ;
 *   • un paiement d'AVANT la colonne (`dueAmount` absent) ne change pas d'un
 *     caractère : ni mention, ni mois rouvert. C'est le contrat de `months` et
 *     `motif` avant lui.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  installmentReceiptNote,
  installmentTarget,
  isPartialPayment,
  monthlyFee,
  settledMonthDeclarations,
} from '../src/lib/paymentInstallments';
import { translations } from '../src/i18n/translations';

const fr = translations.fr;
const fmt = (amount: number) => `${amount} FCFA`;

// Frais annuels 120 000 FCFA, pas de bourse → 10 000 FCFA par mois.
const student = { totalDue: 120000, scholarshipDiscount: 0, payments: [] };

describe('paymentInstallments — les frais d’un mois', () => {
  it('divise les frais annuels nets de bourse par douze', () => {
    assert.equal(monthlyFee({ totalDue: 120000 }), 10000);
    assert.equal(monthlyFee({ totalDue: 120000, scholarshipDiscount: 25 }), 7500);
  });

  it('rend zéro, et non une erreur, pour un élève sans frais déclarés', () => {
    // Un élève importé sans `total_due` ne doit pas produire des versements
    // partiels imaginaires : zéro par mois, donc `due` à zéro, donc aucune
    // mention sur le reçu.
    assert.equal(monthlyFee({ totalDue: 0 }), 0);
    assert.equal(monthlyFee({ totalDue: Number.NaN }), 0);
  });
});

describe('paymentInstallments — le reste dû des mois choisis', () => {
  it('vaut les frais des mois, quand rien n’a encore été versé', () => {
    const target = installmentTarget(student, ['2026-09', '2026-10']);
    assert.deepEqual(target, {
      months: ['2026-09', '2026-10'],
      due: 20000,
      partialPaid: 0,
      remaining: 20000,
    });
  });

  it('retire les versements PARTIELS déjà reçus sur ces mois', () => {
    const target = installmentTarget(
      {
        ...student,
        payments: [
          { amount: 4000, dueAmount: 10000, months: ['2026-09'] },
        ],
      },
      ['2026-09'],
    );
    assert.equal(target.due, 10000);
    assert.equal(target.partialPaid, 4000);
    assert.equal(target.remaining, 6000, 'la famille revient avec le complément');
  });

  it('ignore un paiement SOLDÉ : ce qui est payé n’est plus dû', () => {
    const target = installmentTarget(
      {
        ...student,
        payments: [{ amount: 10000, dueAmount: 10000, months: ['2026-09'] }],
      },
      ['2026-09'],
    );
    assert.equal(target.partialPaid, 0);
    assert.equal(target.remaining, 10000, 'le mois est fermé, pas soldé une seconde fois');
  });

  it('ignore un versement partiel sur d’AUTRES mois', () => {
    const target = installmentTarget(
      {
        ...student,
        payments: [{ amount: 3000, dueAmount: 10000, months: ['2026-11'] }],
      },
      ['2026-09'],
    );
    assert.equal(target.remaining, 10000, 'la dette d’un mois ne se paie pas sur un autre');
  });

  it('ne descend jamais sous zéro, même trop versé', () => {
    const target = installmentTarget(
      {
        ...student,
        payments: [{ amount: 15000, dueAmount: 20000, months: ['2026-09'] }],
      },
      ['2026-09'],
    );
    assert.equal(target.remaining, 0);
  });
});

describe('paymentInstallments — ce qui est partiel, et ce qui ferme un mois', () => {
  it('compare en francs entiers, pas au bit près', () => {
    assert.equal(isPartialPayment({ amount: 9999.4, dueAmount: 10000 }), true);
    assert.equal(
      isPartialPayment({ amount: 9999.9999999, dueAmount: 10000 }),
      false,
      'la monnaie n’a pas de centimes : un arrondi de 10⁻⁷ ne fait pas un versement partiel',
    );
    assert.equal(isPartialPayment({ amount: 12000, dueAmount: 10000 }), false, 'un trop-perçu est soldé');
    assert.equal(isPartialPayment({ amount: 10000, dueAmount: 10000 }), false);
  });

  it('un paiement sans montant attendu n’est jamais partiel', () => {
    // Ligne d'avant la colonne, import, inscription : « non déclaré ».
    assert.equal(isPartialPayment({ amount: 1 }), false);
  });

  it('seuls les reçus SOLDÉS déclarent un mois fermé', () => {
    const declarations = settledMonthDeclarations([
      { amount: 4000, dueAmount: 10000, months: ['2026-09'] },
      { amount: 10000, dueAmount: 10000, months: ['2026-09'] },
      { amount: 10000, dueAmount: 10000, months: ['2026-10'] },
    ]);
    assert.deepEqual(declarations, [['2026-09'], ['2026-10']], 'le versement partiel ne ferme pas septembre');
  });
});

describe('paymentInstallments — ce que le reçu écrit', () => {
  it('un reçu ordinaire ne gagne aucune mention', () => {
    assert.equal(
      installmentReceiptNote({ amount: 10000, months: ['2026-09'] }, [], fr, fmt),
      '',
      'sans montant attendu, le papier reste celui d’avant',
    );
    assert.equal(
      installmentReceiptNote({ amount: 10000, dueAmount: 10000, months: ['2026-09'] }, [], fr, fmt),
      '',
      'soldé du premier coup : rien à dire',
    );
  });

  it('un versement partiel dit ce qu’il reste à payer', () => {
    const note = installmentReceiptNote(
      { amount: 4000, dueAmount: 10000, months: ['2026-09'] },
      [],
      fr,
      fmt,
    );
    assert.equal(note, 'versement partiel — reste à payer 6000 FCFA');
  });

  it('le reçu qui solde dit le total réglé, versements partiels compris', () => {
    // Le montant attendu d'un geste, c'est ce qui RESTAIT à régler ce jour-là
    // (`usePayments` écrit `installment.remaining`) : le complément de 6 000
    // attend 6 000, donc il est SOLDÉ — et c'est bien lui qui clôt les mois.
    const earlier = { amount: 4000, dueAmount: 10000, months: ['2026-09'] };
    const settling = { amount: 6000, dueAmount: 6000, months: ['2026-09'] };
    assert.equal(
      installmentReceiptNote(settling, [earlier, settling], fr, fmt),
      'solde — total réglé 10000 FCFA',
    );
  });

  it('un soldé sans versement partiel antérieur reste muet', () => {
    const settling = { amount: 10000, dueAmount: 10000, months: ['2026-09'] };
    assert.equal(
      installmentReceiptNote(settling, [{ amount: 5000, dueAmount: 5000, months: ['2026-10'] }], fr, fmt),
      '',
      'un mois réglé ailleurs ne fait pas de ce reçu un solde',
    );
  });

  it('la mention se dit aussi en anglais', () => {
    assert.equal(
      installmentReceiptNote({ amount: 4000, dueAmount: 10000 }, [], translations.en, fmt),
      'partial payment — 6000 FCFA still owed',
    );
  });
});
