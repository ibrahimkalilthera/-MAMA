/**
 * Les mois payés — ce que le caissier coche, et ce que le reçu en écrit.
 *
 * Le module est PUR : il ne connaît ni React, ni Supabase, ni pdf-lib. C'est
 * ici que le critère est verrouillé, pas dans la modale : la modale prouve le
 * câblage DOM, ce fichier prouve le calcul.
 *
 * Ce qui compte, et pourquoi :
 *   • la liste des mois part de SEPTEMBRE (l'année scolaire malienne va de
 *     septembre à août) : un `getMonth()` nu rangerait septembre 2026 en
 *     neuvième position d'une année civile qui n'existe pas ici ;
 *   • les mois sont stockés en `YYYY-MM`, jamais en libellés : « Septembre »
 *     gravé en base serait faux dans un reçu anglais ;
 *   • le tri traverse le passage à l'année civile (décembre 2026 → janvier 2027) :
 *     une année scolaire en contient un, et lui seul ;
 *   • le reçu écrit LE NOMBRE, puis une plage quand les mois se suivent, et la
 *     liste quand ils sont troués ; un seul mois se dit nu, sans « 1 mois ».
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  academicYearMonths,
  effectivePaymentMonths,
  formatPaidMonthLine,
  formatPaidMonthTerse,
  isPaymentMonth,
  monthKeyOf,
  monthsCoverage,
  monthsNotYetPaid,
  paymentMonthHistory,
  paymentMonthLabel,
  duplicateDeclarations,
  paidMonthsShape,
  formatPaidMonths,
  sortPaymentMonths,
  toggledPaymentMonths,
} from '../src/lib/paymentMonths';
import type { PaymentLike, PaymentMonthFact } from '../src/lib/paymentMonths';
import { paidReceiptEvidence } from '../src/lib/paymentMonths';
import { formatCurrency, formatDateLang } from '../src/lib/formatters';
import { translations } from '../src/i18n/translations';
import type { TranslationDict } from '../src/i18n/translations';

/** Les dépendances de langue, montées comme les deux appelants réels les montent. */
function deps(t: TranslationDict) {
  return {
    label: (ym: string) => paymentMonthLabel(ym, t),
    count: (n: number) => t.paidMonthsCount.replace('{count}', String(n)),
    rangeTo: t.paidMonthsRangeTo,
  };
}

describe('academicYearMonths — les douze mois d’une année scolaire', () => {
  it('part de septembre et finit en août, sur deux années civiles', () => {
    const months = academicYearMonths('2026-2027');
    assert.equal(months.length, 12, 'douze mois, pas onze');
    assert.equal(months[0], '2026-09', 'l’année scolaire commence en septembre');
    assert.equal(months[11], '2027-08', 'et finit en août de l’année suivante');
    assert.ok(months.includes('2027-01'), 'janvier porte l’année civile suivante');
    assert.equal(new Set(months).size, 12, 'aucun mois en double');
  });

  it('accepte un séparateur « / » comme `academicYearWindow`', () => {
    assert.deepEqual(academicYearMonths('2026/2027'), academicYearMonths('2026-2027'));
  });

  it('ne devine AUCUNE année : une valeur illisible rend une liste vide', () => {
    // Une liste inventée proposerait des mois qu'aucun élève ne fréquente ; le
    // formulaire cache alors le champ et le reçu retombe sur le mois de la date.
    assert.deepEqual(academicYearMonths(undefined), []);
    assert.deepEqual(academicYearMonths(''), []);
    assert.deepEqual(academicYearMonths('nope'), []);
    assert.deepEqual(academicYearMonths('2026'), [], 'une année seule ne dit pas de septembre à quand');
  });
});

describe('isPaymentMonth — la forme stockée', () => {
  it('accepte un YYYY-MM réel, refuse le reste', () => {
    assert.equal(isPaymentMonth('2026-09'), true);
    assert.equal(isPaymentMonth('2027-01'), true);
    assert.equal(isPaymentMonth('2026-12'), true);
    assert.equal(isPaymentMonth('2026-13'), false, 'aucun mois 13');
    assert.equal(isPaymentMonth('2026-00'), false, 'aucun mois 0');
    assert.equal(isPaymentMonth('2026-9'), false, 'le zéro de tête est la forme écrite');
    assert.equal(isPaymentMonth('Septembre'), false, 'un libellé n’est jamais stocké');
    assert.equal(isPaymentMonth(''), false);
  });
});

describe('sortPaymentMonths — l’ordre du calendrier scolaire', () => {
  it('trie, dédoublonne et écarte ce qui n’est pas un mois', () => {
    assert.deepEqual(
      sortPaymentMonths(['2027-01', '2026-12', '2026-12', 'bogus', '2026-09']),
      ['2026-09', '2026-12', '2027-01'],
      'le passage décembre 2026 → janvier 2027 se trie dans le bon sens',
    );
  });

  it('rend une liste vide pour une entrée vide ou entièrement invalide', () => {
    assert.deepEqual(sortPaymentMonths([]), []);
    assert.deepEqual(sortPaymentMonths(['10/2026']), []);
  });
});

describe('paidMonthsShape — la forme du choix', () => {
  it('dit « aucun » quand rien n’est coché', () => {
    assert.deepEqual(paidMonthsShape([]), { kind: 'none' });
  });

  it('dit « un seul » pour un mois unique', () => {
    assert.deepEqual(paidMonthsShape(['2026-10']), { kind: 'single', from: '2026-10', to: '2026-10' });
  });

  it('dit « plage » quand les mois se suivent — y compris à cheval sur janvier', () => {
    assert.deepEqual(
      paidMonthsShape(['2026-11', '2026-09', '2026-10']),
      { kind: 'range', count: 3, from: '2026-09', to: '2026-11' },
      'l’ordre d’arrivée ne change rien : la forme est calculée',
    );
    assert.deepEqual(
      paidMonthsShape(['2027-01', '2026-12']),
      { kind: 'range', count: 2, from: '2026-12', to: '2027-01' },
    );
  });

  it('dit « liste » dès qu’un mois manque au milieu', () => {
    assert.deepEqual(
      paidMonthsShape(['2026-12', '2026-09', '2026-11']),
      { kind: 'list', count: 3, months: ['2026-09', '2026-11', '2026-12'] },
    );
    assert.deepEqual(
      paidMonthsShape(['2026-09', '2026-10', '2026-12']),
      { kind: 'list', count: 3, months: ['2026-09', '2026-10', '2026-12'] },
      'deux mois qui se suivent n’absorbent pas le trou qui suit',
    );
  });
});

describe('formatPaidMonths — ce que la ligne « Mois » du reçu porte', () => {
  it('n’écrit rien sans mois (le reçu garde alors le mois de la date)', () => {
    assert.equal(formatPaidMonths([], deps(translations.fr)), '');
  });

  it('écrit un mois nu, sans « 1 mois »', () => {
    assert.equal(formatPaidMonths(['2026-10'], deps(translations.fr)), 'Octobre');
    assert.equal(formatPaidMonths(['2026-10'], deps(translations.en)), 'October');
  });

  it('écrit LE NOMBRE puis une plage continue', () => {
    assert.equal(
      formatPaidMonths(['2026-09', '2026-10', '2026-11'], deps(translations.fr)),
      '3 mois : Septembre à Novembre',
    );
    assert.equal(
      formatPaidMonths(['2026-09', '2026-10', '2026-11'], deps(translations.en)),
      '3 months : September to November',
    );
  });

  it('écrit le nombre puis les noms quand les mois sont troués', () => {
    assert.equal(
      formatPaidMonths(['2026-12', '2026-09', '2026-11'], deps(translations.fr)),
      '3 mois : Septembre, Novembre, Décembre',
    );
  });

  it('suit la langue du reçu, jamais celle du stockage', () => {
    const months = ['2026-09', '2026-10'];
    assert.equal(formatPaidMonths(months, deps(translations.fr)), '2 mois : Septembre à Octobre');
    assert.equal(formatPaidMonths(months, deps(translations.en)), '2 months : September to October');
  });
});

describe('effectivePaymentMonths / toggledPaymentMonths — la règle du guichet', () => {
  const options = academicYearMonths('2026-2027');

  it('propose le mois de la DATE tant que le caissier n’a rien coché', () => {
    assert.deepEqual(effectivePaymentMonths([], false, '2026-10', options), ['2026-10']);
    // Le caissier corrige la date : le mois proposé la suit, sinon le reçu
    // porterait « Octobre » en face d’une date de novembre.
    assert.deepEqual(effectivePaymentMonths([], false, '2026-11', options), ['2026-11']);
  });

  it('n’invente aucun mois quand la date sort de l’année offerte', () => {
    assert.deepEqual(effectivePaymentMonths([], false, '2028-03', options), []);
  });

  it('respecte le choix dès qu’un mois a été coché, même si la date change', () => {
    assert.deepEqual(effectivePaymentMonths(['2026-12'], true, '2026-10', options), ['2026-12']);
  });

  it('AJOUTE le mois cliqué au mois de la date, sans le remplacer', () => {
    assert.deepEqual(
      toggledPaymentMonths([], false, '2026-10', options, '2026-11'),
      ['2026-10', '2026-11'],
      'une famille qui règle aussi novembre ne perd pas octobre',
    );
  });

  it('décoche un mois déjà coché, et trie le résultat', () => {
    assert.deepEqual(toggledPaymentMonths(['2026-10', '2026-11'], true, '2026-10', options, '2026-10'), ['2026-11']);
    assert.deepEqual(
      toggledPaymentMonths(['2026-12'], true, '2026-10', options, '2026-09'),
      ['2026-09', '2026-12'],
      'l’ordre des clics ne se voit pas sur le reçu',
    );
  });

  it('décocher le dernier mois rend une liste VIDE — le guichet peut exiger un mois', () => {
    assert.deepEqual(toggledPaymentMonths(['2026-10'], true, '2026-10', options, '2026-10'), []);
  });
});

describe('monthKeyOf / paymentMonthLabel — le libellé vient du dictionnaire', () => {
  it('relie un YYYY-MM à sa clé i18n, en tenant compte de l’année civile', () => {
    assert.equal(monthKeyOf('2026-09'), 'sep');
    assert.equal(monthKeyOf('2027-01'), 'jan');
    assert.equal(monthKeyOf('nope'), null);
  });

  it('rend le libellé traduit, et rien pour un mois illisible', () => {
    assert.equal(paymentMonthLabel('2026-10', translations.fr), 'Octobre');
    assert.equal(paymentMonthLabel('2027-01', translations.en), 'January');
    assert.equal(paymentMonthLabel('', translations.fr), '');
  });
});

describe('monthsCoverage — ce qu’une fiche peut AFFIRMER des mois d’un élève', () => {
  const year = academicYearMonths('2026-2027'); // 2026-09 … 2027-08

  it('sépare les mois déclarés des mois qui restent, dans l’ordre du calendrier', () => {
    const c = monthsCoverage([['2026-12', '2026-09', '2026-11']], year);
    assert.deepEqual(c.covered, ['2026-09', '2026-11', '2026-12'], 'l’ordre des clics ne se voit pas sur la fiche');
    assert.equal(c.missing.length, 9, 'douze mois moins les trois réglés');
    assert.ok(c.missing.includes('2026-10'), 'le mois absent du geste est bien celui qui reste');
    assert.equal(c.missing[0], '2026-10', 'et les restants gardent aussi l’ordre de l’année');
    assert.equal(c.missing[c.missing.length - 1], '2027-08', 'la liste va jusqu’à août');
    assert.equal(c.undeclared, 0);
  });

  it('additionne les paiements, et dédoublonne un mois réglé deux fois', () => {
    const c = monthsCoverage([['2026-09'], ['2026-09', '2026-10']], year);
    assert.deepEqual(c.covered, ['2026-09', '2026-10']);
  });

  it('ne laisse pas un mois d’une AUTRE année scolaire déteindre sur celle-ci', () => {
    // Le mois porte son année civile : « 2025-09 » n’est pas « 2026-09 ».
    const c = monthsCoverage([['2025-09', '2026-09'], ['2027-09']], year);
    assert.deepEqual(c.covered, ['2026-09']);
  });

  it('compte les paiements MUETS, et ne leur attribue aucun mois', () => {
    // Avant la colonne `payments.months`, ou envoyé sans cocher : la couverture
    // est INCONNUE. La fiche doit pouvoir le dire — c’est ce compte qui le lui
    // permet — et surtout ne pas ranger ces mois dans « réglés ».
    const c = monthsCoverage([['2026-10'], undefined, []], year);
    assert.deepEqual(c.covered, ['2026-10']);
    assert.equal(c.undeclared, 2, 'un `undefined` et une liste vide comptent tous deux');
  });

  it('dit « rien de couvert » sans année lisible, sans rien inventer', () => {
    const c = monthsCoverage([['2026-10']], academicYearMonths(undefined));
    assert.deepEqual(c.covered, []);
    assert.deepEqual(c.missing, []);
    assert.equal(c.undeclared, 0, 'un paiement qui déclare ses mois n’est pas muet, même sans année');
  });

  it('rend une année ENTIÈREMENT couverte quand les douze mois sont déclarés', () => {
    const c = monthsCoverage([year, ['2026-10']], year);
    assert.deepEqual(c.covered, year);
    assert.deepEqual(c.missing, []);
  });
});

describe('monthsNotYetPaid — les mois que le guichet ne peut plus proposer', () => {
  it('écarte un mois déjà couvert, et garde le reste dans l’ordre du calendrier scolaire', () => {
    assert.deepEqual(
      monthsNotYetPaid(['2026-11', '2026-09', '2026-10'], ['2026-10']),
      ['2026-09', '2026-11'],
      'le mois réglé disparaît des propositions, sans toucher à l’ordre des autres',
    );
  });

  it('ne retire rien sans mois réglé, et ne propose plus rien quand l’année est entièrement réglée', () => {
    const year = academicYearMonths('2026-2027');
    assert.deepEqual(monthsNotYetPaid(year, []), year, 'sans reçu qui déclare un mois, tout reste proposé');
    assert.deepEqual(monthsNotYetPaid(year, year), [], 'une année entièrement réglée ne propose plus aucun mois');
  });

  it('écarte aussi le mois proposé d’avance quand c’est lui qui est déjà réglé', () => {
    // La chaîne réelle du guichet : la couverture venue des reçus est d'abord
    // restreinte à l'année proposée, puis retirée des propositions. Un octobre
    // 2025 ne doit donc pas retirer octobre 2026 — le mois porte son année
    // civile — et l'octobre 2026 déclaré, lui, retire bien le mois de la date.
    const year = academicYearMonths('2026-2027');
    const autreAnnee = monthsCoverage([['2025-10', '2027-09']], year).covered;
    assert.deepEqual(monthsNotYetPaid(year, autreAnnee), year, 'aucun de ces deux mois n’appartient à l’année proposée');

    const memeAnnee = monthsCoverage([['2026-10']], year).covered;
    assert.deepEqual(monthsNotYetPaid(['2026-10'], memeAnnee), [], 'le mois de la date, déjà réglé, n’est plus proposé');
  });
});

describe('paymentMonthHistory — la PREUVE qui accompagne un mois déjà réglé', () => {
  const year = academicYearMonths('2026-2027'); // 2026-09 … 2027-08

  it('attache à chaque mois couvert le reçu qui le déclare — numéro, date, montant', () => {
    const h = paymentMonthHistory([
      { id: 'p1', date: '2026-10-05', amount: 25000, receiptNumber: 'REC-123456', months: ['2026-10'] },
      { id: 'p2', date: '2026-11-04', amount: 30000, receiptNumber: 'REC-123457', months: ['2026-11', '2026-12'] },
    ], year);
    assert.deepEqual(h.facts, [
      { month: '2026-10', receipts: [{ id: 'p1', date: '2026-10-05', amount: 25000, receiptNumber: 'REC-123456' }] },
      { month: '2026-11', receipts: [{ id: 'p2', date: '2026-11-04', amount: 30000, receiptNumber: 'REC-123457' }] },
      { month: '2026-12', receipts: [{ id: 'p2', date: '2026-11-04', amount: 30000, receiptNumber: 'REC-123457' }] },
    ], 'un reçu qui couvre deux mois les couvre tous les deux, avec la même preuve');
    assert.equal(h.undeclared, 0);
  });

  it('porte TOUS les reçus d’un mois déclaré deux fois — du plus ancien au plus récent', () => {
    // Le doublon enregistré avant cette règle existe peut-être déjà : n'en montrer
    // qu'un le rendrait invisible, donc intact — l'école ne pourrait plus le
    // rattraper. Chaque reçu est donc nommé, et c'est l'écran qui laisse retirer
    // celui qui est en trop (l'application ne peut pas savoir lequel).
    const h = paymentMonthHistory([
      { id: 'p2', date: '2026-11-02', amount: 30000, receiptNumber: 'REC-200000', months: ['2026-10'] },
      { id: 'p1', date: '2026-10-05', amount: 25000, receiptNumber: 'REC-123456', months: ['2026-10'] },
    ], year);
    assert.equal(h.facts.length, 1, 'toujours UN fait par mois : le mois reste une seule chose');
    assert.deepEqual(
      h.facts[0].receipts.map((r) => r.receiptNumber),
      ['REC-123456', 'REC-200000'],
      'les DEUX reçus sont nommés, le plus ancien d’abord — et chacun porte son id, sans quoi rien ne se retire',
    );
    assert.deepEqual(h.facts[0].receipts.map((r) => r.id), ['p1', 'p2']);
  });

  it('n’invente aucune preuve pour un reçu MUET, mais le compte', () => {
    const h = paymentMonthHistory([
      { id: 'p1', date: '2026-10-05', amount: 25000, months: ['2026-10'] },
      { date: '2026-10-06', amount: 10000 },
      { date: '2026-10-07', amount: 10000, months: [] },
    ], year);
    assert.deepEqual(h.facts, [
      { month: '2026-10', receipts: [{ id: 'p1', date: '2026-10-05', amount: 25000, receiptNumber: undefined }] },
    ], 'le muet n’apparaît dans aucun fait : sa couverture est inconnue, pas nulle');
    assert.equal(h.undeclared, 2, 'un `undefined` et une liste vide se comptent tous deux');
  });

  it('écarte un mois d’une AUTRE année scolaire, sans toucher à la même date', () => {
    const h = paymentMonthHistory([
      { date: '2025-10-05', amount: 25000, receiptNumber: 'REC-000001', months: ['2025-10'] },
    ], year);
    assert.deepEqual(h.facts, [], 'octobre 2025 n’est pas octobre 2026');
  });
});

describe('duplicateDeclarations — quel reçu déclare un mois déjà déclaré', () => {
  const year = academicYearMonths('2026-2027');
  const older: PaymentLike = { id: 'p1', date: '2026-10-05', amount: 25000, receiptNumber: 'REC-123456', months: ['2026-10'] };
  const newer: PaymentLike = { id: 'p2', date: '2026-10-20', amount: 25000, receiptNumber: 'REC-999999', months: ['2026-10'] };

  it('désigne le reçu SURVENU EN SECOND, avec le mois et le reçu antérieur', () => {
    // Le premier reçu d'un mois n'est en trop pour personne : c'est la référence.
    assert.deepEqual(duplicateDeclarations([older, newer], year), [{
      receiptId: 'p2',
      month: '2026-10',
      earlier: [{ id: 'p1', date: '2026-10-05', amount: 25000, receiptNumber: 'REC-123456' }],
    }]);
    // L'ordre de la liste de l'élève ne change rien : c'est la DATE qui fait le
    // premier, et le carnet affiche les lignes du plus récent au plus ancien.
    assert.deepEqual(duplicateDeclarations([newer, older], year), [{
      receiptId: 'p2',
      month: '2026-10',
      earlier: [{ id: 'p1', date: '2026-10-05', amount: 25000, receiptNumber: 'REC-123456' }],
    }]);
  });

  it('ne dit rien d’un mois déclaré une seule fois, ni d’un reçu muet', () => {
    assert.deepEqual(duplicateDeclarations([older], year), []);
    assert.deepEqual(duplicateDeclarations([older, { id: 'p3', date: '2026-10-06', amount: 10000 }], year), [],
      'un muet ne déclare rien : il ne peut pas déclarer deux fois');
  });

  it('porte TOUS les reçus antérieurs quand le mois est déclaré trois fois', () => {
    const third: PaymentLike = { id: 'p4', date: '2026-11-02', amount: 25000, receiptNumber: 'REC-777777', months: ['2026-10'] };
    assert.deepEqual(
      duplicateDeclarations([older, newer, third], year).map((d) => [d.receiptId, d.earlier.map((r) => r.id)]),
      [['p2', ['p1']], ['p4', ['p1', 'p2']]],
      'chaque reçu en trop nomme ce qui le précède, pour que le caissier voie l’ordre des papiers',
    );
  });

  it('écarte un reçu sans id — il ne pourrait pas être retiré, donc rien ne serait proposé', () => {
    assert.deepEqual(duplicateDeclarations([older, { ...newer, id: undefined }], year), []);
  });
});

describe('formatPaidMonthLine / formatPaidMonthTerse — la preuve, dite', () => {
  const receipt = { id: 'p1', date: '2026-10-05', amount: 25000, receiptNumber: 'REC-123456' };
  const fact: PaymentMonthFact = { month: '2026-10', receipts: [receipt] };
  /** Le même mois, déclaré par DEUX reçus : ce que l'écran doit nommer.
   *
   *  Le second a été écrit APRÈS le premier — l'expérience d'un dépôt double, ou
   *  d'une saisie faite deux fois — et il porte son propre numéro : c'est lui
   *  qu'un caissier reconnaîtra comme « le reçu en trop ».
   */
  const double: PaymentMonthFact = {
    month: '2026-10',
    receipts: [receipt, { id: 'p2', date: '2026-10-05', amount: 25000, receiptNumber: 'REC-999999' }],
  };
  it('écrit le mois, le numéro, la date et le montant — dans la langue de l’écran', () => {
    assert.equal(
      formatPaidMonthLine(fact, translations.fr, 'fr'),
      'Octobre — déjà payé : reçu REC-123456 du 05/10/2026, 25\u00a0000\u00a0FCFA',
    );
    assert.equal(
      formatPaidMonthLine(fact, translations.en, 'en'),
      `October — already paid: receipt REC-123456 of ${formatDateLang(receipt.date, 'en')}, ${formatCurrency(receipt.amount)}`,
    );
  });

  it('nomme le paiement sans numéro de reçu, sans laisser de trou', () => {
    const sansNumero: PaymentMonthFact = {
      month: '2026-10', receipts: [{ ...receipt, receiptNumber: undefined }],
    };
    assert.equal(
      formatPaidMonthLine(sansNumero, translations.fr, 'fr'),
      'Octobre — déjà payé : paiement du 05/10/2026, 25\u00a0000\u00a0FCFA',
      'une ligne écrite avant la colonne se nomme par sa date et son montant',
    );
  });

  it('dit quand plusieurs reçus déclarent le même mois, et laisse l’écran les nommer un par un', () => {
    assert.equal(
      formatPaidMonthLine(double, translations.fr, 'fr'),
      'Octobre — déjà payé : 2 reçus déclarent ce mois',
    );
    // La ligne d'UN reçu : c'est celle que l'écran écrit sous la phrase du mois,
    // une fois par reçu, avec sur chacune de quoi retirer celui qui est en trop.
    assert.equal(
      paidReceiptEvidence(double.receipts[1], translations.fr, 'fr'),
      'reçu REC-999999 du 05/10/2026, 25\u00a0000\u00a0FCFA',
    );
  });

  it('rend la forme COURTE du même fait, pour une phrase qui porte déjà son verbe', () => {
    assert.equal(
      formatPaidMonthTerse(fact, translations.fr, 'fr'),
      'Octobre (reçu REC-123456 du 05/10/2026, 25\u00a0000\u00a0FCFA)',
    );
    assert.equal(
      formatPaidMonthTerse(fact, translations.en, 'en'),
      `October (receipt REC-123456 of ${formatDateLang(receipt.date, 'en')}, ${formatCurrency(receipt.amount)})`,
    );
    assert.equal(
      formatPaidMonthTerse(double, translations.fr, 'fr'),
      'Octobre (reçu REC-123456 du 05/10/2026, 25\u00a0000\u00a0FCFA — 2 reçus déclarent ce mois)',
      'un refus ne déroule pas une liste : il dit qu’il y en a plusieurs',
    );
  });
});
