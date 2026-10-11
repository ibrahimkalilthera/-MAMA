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
  isPaymentMonth,
  monthKeyOf,
  paymentMonthLabel,
  paidMonthsShape,
  formatPaidMonths,
  sortPaymentMonths,
  toggledPaymentMonths,
} from '../src/lib/paymentMonths';
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
