// Suite for scripts/lib/duplicate-students.mjs — le contrôle des fiches en
// double, sans base.
//
// Ce qui se joue ici n'est pas cosmétique : la feuille CSV est ce que le bureau
// lit pour décider de retirer une fiche. Une fiche manquante laisse un doublon en
// place ; une fiche inventée ferait supprimer un élève réel. Les deux se paient
// sans bruit, donc chacun est verrouillé.
//
// Et ce contrôle a une seconde faiblesse, propre au registre : il ne doit PAS
// prétendre trancher. Deux homonymes dans une même classe existent — le
// 2026-10-06, la base en portait exactement deux groupes sur 423 élèves — donc la
// feuille doit livrer de quoi décider (matricule, parent, téléphone, dates,
// montants) et jamais conclure à leur place : les sentinelles ci-dessous
// verrouillent les colonnes de discrimination autant que le critère.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { toCsv } from '../scripts/lib/duplicate-receipts.mjs';
import {
  CONTROL_STUDENT_NAME_GRADE,
  CRITERIA_STUDENTS,
  DUPLICATE_STUDENT_SQL,
  STUDENT_CSV_COLUMNS,
  TOTAL_STUDENTS_SQL,
  flaggedStudentRows,
  summarizeStudents,
} from '../scripts/lib/duplicate-students.mjs';

// ─── Une fiche d'élève, telle que la base la rend ────────────────────────────
// `total_due` et `amount_paid` sont des CHAÎNES (Postgres NUMERIC → node-postgres) :
// le test les garde telles quelles, sinon il validerait un type que la base ne
// produit jamais.
const student = (over: Record<string, unknown> = {}) => ({
  id: 'e0',
  name: 'Safiatou COULIBALY',
  grade: '5A',
  matricule: 'MT-2026-252',
  parent_name: 'Tuteur',
  parent_phone: '76313228',
  total_due: '36000',
  amount_paid: '0',
  status: 'Active',
  academic_year: '2026-2027',
  enrollment_date: '2026-09-24',
  created_at: '2026-09-24T09:34:02.000Z',
  occurrences: 1,
  ...over,
});

describe('la mise en lignes du registre', () => {
  it('ne garde que les fiches des groupes de plus d’une ligne', () => {
    const rows = flaggedStudentRows({
      studentRows: [
        student({ id: 'a', occurrences: 2 }),
        student({ id: 'b', matricule: 'MT-2026-415', occurrences: 2 }),
        student({ id: 'seul', occurrences: 1 }),
      ],
    });
    assert.deepEqual(rows.map((r) => r.eleveId), ['a', 'b'], 'une fiche seule n’est pas suspecte');
    assert.ok(rows.every((r) => r.controle === CONTROL_STUDENT_NAME_GRADE));
  });

  it('rend une ligne PAR FICHE concernée, pas un groupe agrégé', () => {
    const rows = flaggedStudentRows({
      studentRows: [
        student({ id: 'a', occurrences: 3 }),
        student({ id: 'b', occurrences: 3 }),
        student({ id: 'c', occurrences: 3 }),
      ],
    });
    assert.equal(rows.length, 3, 'trois fiches → trois lignes à vérifier');
    assert.deepEqual(new Set(rows.map((r) => r.occurrences)), new Set([3]));
  });

  it('porte les colonnes qui permettent de TRANCHER, pas seulement le nom', () => {
    const [row] = flaggedStudentRows({ studentRows: [student({ id: 'a', occurrences: 2 })] });
    assert.deepEqual(row, {
      controle: 'meme_nom_meme_classe',
      eleve: 'Safiatou COULIBALY',
      classe: '5A',
      matricule: 'MT-2026-252',
      parent: 'Tuteur',
      telephone: '76313228',
      totalDu: '36000',
      dejaPaye: '0',
      statut: 'Active',
      annee: '2026-2027',
      occurrences: 2,
      inscritLe: '2026-09-24',
      saisiLe: '2026-09-24 09:34',
      eleveId: 'a',
    });
  });

  it('un compte illisible devient 0, jamais NaN', () => {
    assert.deepEqual(flaggedStudentRows({ studentRows: [student({ id: 'a', occurrences: null })] }), []);
  });

  it('lit une date et un horodatage de la base comme du texte court et stable', () => {
    const [row] = flaggedStudentRows({
      studentRows: [student({
        occurrences: 2,
        enrollment_date: new Date('2026-10-05T00:00:00.000Z'),
        created_at: new Date('2026-10-05T17:26:29.000Z'),
      })],
    });
    assert.equal(row.inscritLe, '2026-10-05');
    assert.equal(row.saisiLe, '2026-10-05 17:26');
  });
});

describe('le résumé du registre', () => {
  it('compte les GROUPES (nom + classe) distincts, pas les fiches', () => {
    const rows = [
      student({ id: 'a', occurrences: 4 }),
      student({ id: 'b', matricule: 'MT-2026-415', occurrences: 4 }),
      student({ id: 'c', name: 'Fatoumata COULIBALY', grade: '8A', occurrences: 4 }),
      student({ id: 'd', name: 'Fatoumata COULIBALY', grade: '8A', occurrences: 4 }),
      student({ id: 'e', name: 'Ali Diallo', grade: '6B', occurrences: 1 }),
    ];
    const summary = summarizeStudents({ studentRows: rows, totalStudents: 423 });
    assert.equal(summary.duplicateGroups, 2, 'deux noms en double → deux cas à trancher');
    assert.equal(summary.flaggedLines, 4);
    assert.equal(summary.totalStudents, 423);
  });

  it('est vide et sans erreur quand rien n’est suspect', () => {
    assert.deepEqual(
      summarizeStudents({ studentRows: [student()], totalStudents: 1 }),
      { totalStudents: 1, duplicateGroups: 0, flaggedLines: 0 },
    );
  });

  it('ignore la casse et les espaces de bord dans la clé du groupe', () => {
    // Sinon « Ali Diallo » et « ali diallo  » formeraient deux groupes pour un
    // seul cas — et le compte annoncé serait faux, pas seulement laid.
    const summary = summarizeStudents({
      studentRows: [
        student({ id: 'a', name: '  Ali Diallo ', occurrences: 2 }),
        student({ id: 'b', name: 'ali diallo', occurrences: 2 }),
      ],
    });
    assert.equal(summary.duplicateGroups, 1);
  });
});

describe('la sérialisation CSV du registre', () => {
  it('reprend le sérialiseur des reçus — une seule définition', () => {
    const csv = toCsv(flaggedStudentRows({ studentRows: [student({ id: 'a', occurrences: 2 })] }), {
      columns: STUDENT_CSV_COLUMNS,
    });
    assert.ok(csv.startsWith('\ufeff'), 'le BOM fait lire les accents par Excel');
    const lines = csv.split('\r\n');
    assert.equal(lines[0].replace('\ufeff', ''), STUDENT_CSV_COLUMNS.map((c) => `"${c.header}"`).join(','));
    assert.match(
      lines[1],
      /"meme_nom_meme_classe","Safiatou COULIBALY","5A","MT-2026-252","Tuteur","76313228","36000","0","Active","2026-2027","2","2026-09-24","2026-09-24 09:34","a"/,
    );
    assert.equal(lines[2], '', 'le fichier se termine par un saut de ligne');
  });

  it('un CSV sans fiche signalée reste un en-tête valide', () => {
    assert.equal(
      toCsv([], { columns: STUDENT_CSV_COLUMNS }),
      `\ufeff${STUDENT_CSV_COLUMNS.map((c) => `"${c.header}"`).join(',')}\r\n`,
    );
  });
});

// ─── Le critère, verrouillé dans le TEXTE de la requête ──────────────────────
// Le contrôle ne vaut que par ce qu'il groupe. Un `partition by` élargi ou
// rétréci d'un champ changerait EN SILENCE ce qu'on appelle un doublon : ces
// sentinelles forcent à venir lire pourquoi avant de le modifier. Les colonnes de
// discrimination sont verrouillées pour la même raison : sans elles, la feuille
// dirait « ces fiches se ressemblent » et quelqu'un supprimerait la mauvaise.
describe('le critère et les colonnes sont écrits dans la requête', () => {
  it('groupe le nom (casse et espaces ignorés) ET la classe', () => {
    assert.match(DUPLICATE_STUDENT_SQL, /partition by lower\(trim\(p\.name\)\), coalesce\(p\.grade, ''\)/);
  });

  it('écarte les fiches sans nom — un nom vide n’est pas un doublon', () => {
    assert.match(DUPLICATE_STUDENT_SQL, /coalesce\(trim\(p\.name\), ''\) <> ''/);
    assert.match(TOTAL_STUDENTS_SQL, /coalesce\(trim\(p\.name\), ''\) <> ''/, 'le dénominateur compte les mêmes fiches que le contrôle');
  });

  it('ne prend AUCUNE borne de période : le registre est relu en entier', () => {
    // Une borne appliquée ici ferait disparaître un doublon non résolu dès la
    // semaine suivante — exactement ce qu'une liste de choses à trancher ne doit
    // pas faire. Le contrôle des reçus, lui, se borne ($1/$2) : la différence est
    // le sens de chacun.
    assert.doesNotMatch(DUPLICATE_STUDENT_SQL, /\$\d/);
    assert.doesNotMatch(TOTAL_STUDENTS_SQL, /\$\d/);
  });

  it('rend les colonnes qui discriminent deux fiches homonymes', () => {
    for (const column of ['student_id', 'parent_name', 'parent_phone', 'total_due', 'amount_paid', 'enrollment_date', 'created_at', 'status', 'academic_year']) {
      assert.match(DUPLICATE_STUDENT_SQL, new RegExp(column), `${column} dit de quoi trancher`);
    }
  });

  it('les critères imprimés nomment le contrôle', () => {
    assert.equal(CRITERIA_STUDENTS.length, 1);
    assert.match(CRITERIA_STUDENTS.join(' '), /meme_nom_meme_classe/);
  });
});
