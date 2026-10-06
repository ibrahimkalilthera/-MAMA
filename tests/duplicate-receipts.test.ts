// Suite for scripts/lib/duplicate-receipts.mjs — le contrôle de reçus en double,
// sans base.
//
// Ce qui se joue ici n'est pas cosmétique : la feuille CSV est ce que l'école lit
// pour décider de retirer un paiement. Une ligne manquante laisse un doublon en
// place ; une ligne inventée ferait supprimer un versement réel. Les deux se
// paient sans bruit, donc chacun est verrouillé.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  CONTROL_DUPLICATE,
  CONTROL_RECEIPT,
  CRITERIA,
  CSV_COLUMNS,
  DUPLICATE_GROUP_SQL,
  REUSED_RECEIPT_SQL,
  TOTAL_PAYMENTS_SQL,
  closedWeekBounds,
  csvCell,
  flaggedRows,
  isoWeekKey,
  summarizeReport,
  toCsv,
} from '../scripts/lib/duplicate-receipts.mjs';

// ─── Une ligne de paiement, telle que la base la rend ────────────────────────
// `amount` est une CHAÎNE (Postgres NUMERIC → node-postgres) : le test le garde
// tel quel, sinon il validerait un type que la base ne produit jamais.
const payment = (over: Record<string, unknown> = {}) => ({
  id: 'p0',
  student_id: 's1',
  student_name: 'Ali Diallo',
  student_grade: '5A',
  date: '2026-10-05',
  amount: '4000',
  receipt_number: 'REC-1',
  academic_year: '2026-2027',
  created_at: '2026-10-05T06:11:00.000Z',
  occurrences: 1,
  ...over,
});

describe('la mise en lignes d’un contrôle', () => {
  it('ne garde que les lignes des groupes de plus d’un paiement', () => {
    const rows = flaggedRows({
      duplicateRows: [
        payment({ id: 'a', occurrences: 2 }),
        payment({ id: 'b', occurrences: 2 }),
        payment({ id: 'seul', occurrences: 1 }),
      ],
    });
    assert.deepEqual(rows.map((r) => r.paiementId), ['a', 'b'], 'une ligne seule n’est pas suspecte');
    assert.ok(rows.every((r) => r.controle === CONTROL_DUPLICATE));
  });

  it('rend une ligne PAR PAIEMENT concerné, pas un groupe agrégé', () => {
    const rows = flaggedRows({
      duplicateRows: [payment({ id: 'a', occurrences: 3 }), payment({ id: 'b', occurrences: 3 }), payment({ id: 'c', occurrences: 3 })],
    });
    assert.equal(rows.length, 3, 'trois paiements → trois lignes à vérifier');
    assert.deepEqual(new Set(rows.map((r) => r.occurrences)), new Set([3]));
  });

  it('un paiement qui viole les DEUX contrôles apparaît une fois par contrôle', () => {
    const rows = flaggedRows({
      duplicateRows: [payment({ id: 'a', occurrences: 2 })],
      receiptRows: [payment({ id: 'a', occurrences: 2 })],
    });
    assert.equal(rows.length, 2);
    assert.deepEqual(rows.map((r) => r.controle).sort(), [CONTROL_DUPLICATE, CONTROL_RECEIPT]);
    assert.ok(rows.every((r) => r.paiementId === 'a'));
  });

  it('trie par date, puis élève, puis contrôle, puis id (un fichier stable)', () => {
    const rows = flaggedRows({
      duplicateRows: [
        payment({ id: 'z', date: '2026-10-02', student_name: 'Zola', occurrences: 2 }),
        payment({ id: 'y', date: '2026-10-02', student_name: 'Ali', occurrences: 2 }),
        payment({ id: 'x', date: '2026-10-01', student_name: 'Ali', occurrences: 2 }),
      ],
      receiptRows: [payment({ id: 'z', date: '2026-10-02', student_name: 'Zola', occurrences: 2 })],
    });
    assert.deepEqual(rows.map((r) => `${r.date}|${r.eleve}|${r.controle}|${r.paiementId}`), [
      '2026-10-01|Ali|meme_eleve_meme_date_meme_montant|x',
      '2026-10-02|Ali|meme_eleve_meme_date_meme_montant|y',
      '2026-10-02|Zola|meme_eleve_meme_date_meme_montant|z',
      '2026-10-02|Zola|numero_recu_reutilise|z',
    ]);
  });

  it('lit une date et un horodatage de la base comme du texte court et stable', () => {
    const [row] = flaggedRows({
      duplicateRows: [payment({
        occurrences: 2,
        date: new Date('2026-10-05T00:00:00.000Z'),
        created_at: new Date('2026-10-05T06:11:00.000Z'),
      })],
    });
    assert.equal(row.date, '2026-10-05');
    assert.equal(row.saisiLe, '2026-10-05 06:11');
  });

  it('un compte illisible devient 0, jamais NaN', () => {
    const rows = flaggedRows({ duplicateRows: [payment({ occurrences: null, id: 'a' })] });
    assert.deepEqual(rows, [], 'un compte illisible ne fabrique pas une ligne suspecte');
  });
});

describe('le résumé du contrôle', () => {
  it('compte les GROUPES distincts, pas les lignes', () => {
    const rows = [
      payment({ id: 'a', student_id: 's1', date: '2026-10-05', amount: '4000', occurrences: 3 }),
      payment({ id: 'b', student_id: 's1', date: '2026-10-05', amount: '4000', occurrences: 3 }),
      payment({ id: 'c', student_id: 's1', date: '2026-10-05', amount: '4000', occurrences: 3 }),
      payment({ id: 'd', student_id: 's2', date: '2026-10-04', amount: '1000', occurrences: 2 }),
    ];
    const summary = summarizeReport({ duplicateRows: rows, totalPayments: 10 });
    assert.equal(summary.duplicateGroups, 2, 'un groupe reste UN problème à regarder');
    assert.equal(summary.flaggedLines, 4);
    assert.equal(summary.totalPayments, 10);
  });

  it('compte les numéros de reçu RÉUTILISÉS une fois chacun', () => {
    const rows = [
      payment({ id: 'a', receipt_number: 'REC-7', occurrences: 3 }),
      payment({ id: 'b', receipt_number: 'REC-7', occurrences: 3 }),
      payment({ id: 'c', receipt_number: 'REC-7', occurrences: 3 }),
    ];
    const summary = summarizeReport({ receiptRows: rows });
    assert.equal(summary.reusedReceipts, 1);
    assert.equal(summary.flaggedLines, 3);
  });

  it('est vide et sans erreur quand rien n’est suspect', () => {
    const summary = summarizeReport({ duplicateRows: [payment()], receiptRows: [payment()], totalPayments: 1 });
    assert.deepEqual(summary, { totalPayments: 1, duplicateGroups: 0, reusedReceipts: 0, flaggedLines: 0 });
  });
});

describe('la sérialisation CSV', () => {
  it('entoure chaque cellule de guillemets et double les guillemets internes', () => {
    assert.equal(csvCell('Ali'), '"Ali"');
    assert.equal(csvCell('Diallo "Le Grand"'), '"Diallo ""Le Grand"""');
    assert.equal(csvCell(null), '""');
    assert.equal(csvCell(undefined), '""');
  });

  it('écrit un en-tête, une ligne par paiement, un BOM et des fins CRLF', () => {
    const csv = toCsv(flaggedRows({ duplicateRows: [payment({ id: 'a', occurrences: 2 })] }));
    assert.ok(csv.startsWith('\ufeff'), 'le BOM fait lire les accents par Excel');
    const lines = csv.split('\r\n');
    assert.equal(lines[0].replace('\ufeff', ''), CSV_COLUMNS.map((c) => `"${c.header}"`).join(','));
    assert.match(lines[1], /"meme_eleve_meme_date_meme_montant","Ali Diallo","5A","2026-10-05","4000","REC-1","2026-2027","2","2026-10-05 06:11","a"/);
    assert.equal(lines[2], '', 'le fichier se termine par un saut de ligne');
  });

  it('un CSV sans ligne signalée reste un en-tête valide', () => {
    const csv = toCsv([]);
    assert.equal(csv, `\ufeff${CSV_COLUMNS.map((c) => `"${c.header}"`).join(',')}\r\n`);
  });

  it('laisse choisir BOM et fin de ligne (comparaison déterministe)', () => {
    assert.equal(toCsv([], { bom: false, eol: '\n' }), `${CSV_COLUMNS.map((c) => `"${c.header}"`).join(',')}\n`);
  });
});

// ─── La période de caisse : la semaine ISO qui vient de se clore ─────────────
// Le déclencheur hebdomadaire s'appuie sur ces bornes : une semaine décalée d’un
// jour viderait le rapport (paiements hors fenêtre) ou le gonflerait (ceux de la
// semaine en cours). Les bords d’année sont verrouillés parce que c’est là qu’un
// calcul naïf se trompe d’année ou de numéro.

describe('la période de caisse (semaine ISO close)', () => {
  it('rend la semaine ISO PRÉCÉDENTE, du lundi au dimanche', () => {
    // Lundi 5 oct. 2026 : la semaine close est la 40 (28 sept. → 4 oct.).
    const week = closedWeekBounds(new Date('2026-10-05T06:00:00Z'));
    assert.deepEqual(week, { startIso: '2026-09-28', endIso: '2026-10-04', key: '2026-S40' });
  });

  it('ne dépend pas du jour d’exécution (mercredi et samedi → même fenêtre)', () => {
    const wednesday = closedWeekBounds(new Date('2026-10-07T12:00:00Z'));
    const saturday = closedWeekBounds(new Date('2026-10-10T23:30:00Z'));
    assert.deepEqual(wednesday, saturday, 'le jour du passage ne décale pas la fenêtre');
    assert.equal(wednesday.key, '2026-S40');
  });

  it('franchit le nouvel an : la semaine du 29 déc. 2025 est 2026-S1', () => {
    const week = closedWeekBounds(new Date('2026-01-05T06:00:00Z'));
    assert.deepEqual(week, { startIso: '2025-12-29', endIso: '2026-01-04', key: '2026-S1' });
  });

  it('isoWeekKey lit l’année ISO sur le JEUDI, pas sur le jour de la date', () => {
    assert.equal(isoWeekKey(new Date('2025-12-29T00:00:00Z')), '2026-S1', '29 déc. 2025 → semaine 1 de 2026');
    assert.equal(isoWeekKey(new Date('2027-01-03T00:00:00Z')), '2026-S53', '3 janv. 2027 → semaine 53 de 2026');
    assert.equal(isoWeekKey(new Date('2026-09-26T00:00:00Z')), '2026-S39');
  });
});

// ─── Les critères, verrouillés dans le TEXTE des requêtes ─────────────────────
// Le contrôle ne vaut que par ce qu'il groupe. Un `partition by` élargi ou
// rétréci d'un champ changerait EN SILENCE ce qu'on appelle un doublon : ces
// sentinelles forcent à venir lire pourquoi avant de le modifier.

describe('les critères sont écrits dans les requêtes', () => {
  it('le contrôle « même élève, même date, même montant » groupe ces trois champs', () => {
    assert.match(DUPLICATE_GROUP_SQL, /partition by p\.student_id, p\.date, p\.amount/);
  });

  it('le contrôle « numéro réutilisé » groupe le numéro et ignore les reçus vides', () => {
    assert.match(REUSED_RECEIPT_SQL, /partition by p\.receipt_number/);
    assert.match(REUSED_RECEIPT_SQL, /receipt_number, ''\) <> ''/, 'un reçu vide n’est pas un numéro réutilisé');
  });

  it('les trois requêtes bornent la période sur les DEUX côtés', () => {
    for (const sql of [DUPLICATE_GROUP_SQL, REUSED_RECEIPT_SQL, TOTAL_PAYMENTS_SQL]) {
      assert.match(sql, /\$1::date/);
      assert.match(sql, /\$2::date/);
    }
  });

  it('les critères imprimés nomment les deux contrôles', () => {
    assert.equal(CRITERIA.length, 2);
    assert.match(CRITERIA.join(' '), /meme_eleve_meme_date_meme_montant/);
    assert.match(CRITERIA.join(' '), /numero_recu_reutilise/);
  });
});
