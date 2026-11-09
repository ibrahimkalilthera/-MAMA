// ─── La PLAGE de scolarité d'une année, réglée par l'école ────────────────────
//
// L'application réclamait les frais de douze mois (septembre → août) à toutes
// les familles. Une année malienne va le plus souvent de septembre à juin,
// parfois d'octobre à juin, parfois jusqu'en juillet : ces cas vérifient que la
// plage VENUE DE LA BASE (`academic_years.start_month`/`end_month`) est celle que
// les reçus déroulent, et qu'une plage illisible retombe sur le défaut de la
// colonne — jamais sur une liste inventée.
//
// Le rejeu hors ligne est ici aussi : la file vit dans le `localStorage` du
// poste, donc un mois hors 1..12 doit être refusé SANS écrire, exactement comme
// le formulaire le refuse en ligne.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  DEFAULT_SCHOOL_MONTHS,
  academicYearMonths,
  academicYearMonthsOf,
  isSchoolMonth,
  yearMonthsSpan,
} from '../src/lib/paymentMonths';
import { replayYearMonths } from '../src/lib/offlineReplayAcademicYear';
import { makeFakeDb } from './fakes';

describe('academicYearMonths — la plage réglée par l’école', () => {
  it('septembre → juin par défaut : dix mois, et pas un de plus', () => {
    const months = academicYearMonths('2026-2027');
    assert.deepEqual(months, [
      '2026-09', '2026-10', '2026-11', '2026-12',
      '2027-01', '2027-02', '2027-03', '2027-04', '2027-05', '2027-06',
    ]);
    assert.equal(months.length, 10, 'septembre à juin inclus = dix mois');
    assert.equal(months.at(-1), '2027-06', 'la rentrée s’arrête en juin, pas en août');
  });

  it('octobre → juin : la rentrée qui glisse ne réclame pas septembre', () => {
    const months = academicYearMonths('2026-2027', { startMonth: 10, endMonth: 6 });
    assert.equal(months[0], '2026-10');
    assert.equal(months.at(-1), '2027-06');
    assert.equal(months.length, 9);
    assert.equal(months.includes('2026-09'), false, 'septembre n’appartient pas à cette année');
  });

  it('septembre → juillet : les compositions qui finissent tard', () => {
    const months = academicYearMonths('2026-2027', { startMonth: 9, endMonth: 7 });
    assert.equal(months.length, 11);
    assert.equal(months.at(-1), '2027-07');
    assert.equal(months.includes('2027-08'), false);
  });

  it('septembre → août reste possible : une école qui le dit l’obtient', () => {
    const months = academicYearMonths('2026-2027', { startMonth: 9, endMonth: 8 });
    assert.equal(months.length, 12);
    assert.equal(months.at(-1), '2027-08');
  });

  it('un même mois des deux côtés ne rend qu’un mois, jamais douze', () => {
    assert.deepEqual(academicYearMonths('2026-2027', { startMonth: 9, endMonth: 9 }), ['2026-09']);
  });

  it('une borne illisible retombe sur le défaut de la colonne, pas sur un mois inventé', () => {
    assert.deepEqual(
      academicYearMonths('2026-2027', { startMonth: 0, endMonth: 13 }),
      academicYearMonths('2026-2027'),
      'les bornes de la base et le repli du code ne peuvent pas diverger d’un mois',
    );
    assert.equal(DEFAULT_SCHOOL_MONTHS.startMonth, 9);
    assert.equal(DEFAULT_SCHOOL_MONTHS.endMonth, 6);
  });

  it('une année illisible reste une liste vide, quelle que soit la plage', () => {
    assert.deepEqual(academicYearMonths('nope', { startMonth: 10, endMonth: 6 }), []);
    assert.deepEqual(academicYearMonths(undefined, { startMonth: 10, endMonth: 6 }), []);
  });
});

describe('yearMonthsSpan / academicYearMonthsOf — lire la plage sur les lignes', () => {
  const rows = [
    { year_name: '2025-2026', start_month: 10, end_month: 6 },
    { year_name: '2026-2027', start_month: 9, end_month: 7 },
    // Ligne écrite par une version antérieure : les colonnes manquent.
    { year_name: '2027-2028' },
  ];

  it('rend la plage de l’année demandée', () => {
    assert.deepEqual(yearMonthsSpan(rows, '2025-2026'), { startMonth: 10, endMonth: 6 });
    assert.deepEqual(yearMonthsSpan(rows, '2026-2027'), { startMonth: 9, endMonth: 7 });
  });

  it('rend le défaut sur une ligne muette ou absente — sans rien deviner', () => {
    assert.deepEqual(yearMonthsSpan(rows, '2027-2028'), DEFAULT_SCHOOL_MONTHS);
    assert.deepEqual(yearMonthsSpan(rows, '2030-2031'), DEFAULT_SCHOOL_MONTHS);
    assert.deepEqual(yearMonthsSpan([], '2026-2027'), DEFAULT_SCHOOL_MONTHS);
  });

  it('déroule les mois de la ligne, pas ceux de l’écran', () => {
    assert.equal(academicYearMonthsOf(rows, '2025-2026').at(-1), '2026-06');
    assert.equal(academicYearMonthsOf(rows, '2026-2027').at(-1), '2027-07');
    assert.equal(academicYearMonthsOf(rows, '2027-2028').length, 10, 'ligne muette = défaut septembre → juin');
  });
});

describe('isSchoolMonth — le contrat de la colonne', () => {
  it('accepte 1..12 entier, refuse le reste', () => {
    assert.equal(isSchoolMonth(1), true);
    assert.equal(isSchoolMonth(12), true);
    assert.equal(isSchoolMonth(0), false);
    assert.equal(isSchoolMonth(13), false);
    assert.equal(isSchoolMonth(9.5), false);
    assert.equal(isSchoolMonth(undefined), false);
    assert.equal(isSchoolMonth('9'), true, 'la valeur d’un `<select>` arrive en texte');
  });
});

describe('replayYearMonths — le rejeu écrit la plage du chemin en ligne, ou rien', () => {
  it('écrit les DEUX colonnes sur la ligne de l’année', async () => {
    const { db, updates, queries } = makeFakeDb();

    assert.equal(await replayYearMonths(db, { year: '2026-2027', startMonth: 10, endMonth: 6 }), true);

    assert.deepEqual(queries, ['academic_years']);
    const written = updates.find((r) => r.table === 'academic_years')?.row;
    assert.ok(written, 'une ligne est écrite');
    assert.equal(written?.start_month, 10);
    assert.equal(written?.end_month, 6);
  });

  it('refuse un mois hors 1..12 SANS écrire — la file est modifiable à la main', async () => {
    const { db, queries } = makeFakeDb();

    assert.equal(await replayYearMonths(db, { year: '2026-2027', startMonth: 0, endMonth: 6 }), false);
    assert.equal(await replayYearMonths(db, { year: '2026-2027', startMonth: 9, endMonth: 13 }), false);
    assert.equal(await replayYearMonths(db, { year: '', startMonth: 9, endMonth: 6 }), false);
    assert.deepEqual(queries, [], 'un rejeu plus permissif que l’écran écrirait une plage que la base rejette');
  });

  it('une écriture retirée par une politique (200 au corps vide) n’est pas une réussite', async () => {
    const { db } = makeFakeDb({ emptyWrites: ['academic_years'] });
    assert.equal(
      await replayYearMonths(db, { year: '2026-2027', startMonth: 10, endMonth: 6 }),
      false,
      'compter ce rejeu comme parti retirerait de la file une plage que la base n’a jamais reçue',
    );
  });

  it('une base en échec laisse le geste en file', async () => {
    const { db } = makeFakeDb({ failTables: ['academic_years'] });
    assert.equal(await replayYearMonths(db, { year: '2026-2027', startMonth: 10, endMonth: 6 }), false);
  });
});
