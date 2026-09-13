// Suite de scripts/check-backup-roundtrip.mjs — le jugement PUR.
//
// Ce contrôle existe parce qu'une sauvegarde jamais remise est une hypothèse. Sa
// matière première n'est donc pas un fichier mais un ÉCART : ce que la sauvegarde
// déclare, ce que la cible contient. Les cas ci-dessous sont ceux qui feraient
// passer un aller-retour raté pour un vert — c'est-à-dire exactement les deux
// familles que ce dépôt a déjà payées : la ligne non restaurable comptée à tort
// (un compte auth absent transforme une restauration partielle en échec), et la
// ligne MANQUANTE rattrapée par le total (une table qui perd 300 lignes quand une
// autre en gagne 300 passe tous les contrôles de volume).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

import { judgeRoundtrip } from '../scripts/check-backup-roundtrip.mjs';
import { BACKUP_TABLES, restorableRows } from '../scripts/lib/db-tables.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel: string) => readFileSync(join(root, rel), 'utf8');

const SHARED = 'rpcjdohfxwukbqngbprw';
const manifestWith = (tables: Array<{ name: string; rows: unknown[] }>) => ({
  format: 1,
  project: `https://${SHARED}.supabase.co`,
  takenAt: '2026-09-13T00:00:00.000Z',
  encrypted: false,
  payloadSha256: null,
  tables: tables.map((t) => ({ name: t.name, pk: 'id', rows: t.rows.length, sha256: 'x' })),
  totalRows: tables.reduce((n, t) => n + t.rows.length, 0),
});

const judge = (
  backup: Record<string, object[]>,
  target: Record<string, number>,
  authIds: string[] = [],
) =>
  judgeRoundtrip({
    manifest: manifestWith(Object.entries(backup).map(([name, rows]) => ({ name, rows }))),
    backup,
    target,
    authIds: new Set(authIds),
  });

describe('un aller-retour est jugé sur un ÉCART, pas sur un total', () => {
  it('accepte une restauration complète : chaque table a ce qu’elle déclarait', () => {
    const verdict = judge({ students: [{ id: 's1' }, { id: 's2' }], parents: [{ id: 'p1' }] }, { students: 2, parents: 1 });
    assert.deepEqual(verdict.problems, []);
    assert.equal(verdict.declared, 3);
    assert.equal(verdict.restored, 3);
    assert.ok(verdict.rows.every((r) => r.ok));
  });

  it('refuse une table qui a PERDU des lignes, même si le volume global y est', () => {
    // 300 lignes en moins d'un côté, 300 en plus de l'autre : un contrôle de
    // total serait vert. Le jugement table par table est rouge, et il nomme.
    const verdict = judge({ students: [{ id: 's1' }], audit_logs: [{ id: 'a1' }] }, { students: 1, audit_logs: 4 });
    assert.equal(verdict.problems.length, 1);
    assert.match(verdict.problems[0], /« audit_logs » : 4 ligne\(s\) dans la cible, 1 attendue\(s\)/);
  });

  it('refuse une table déclarée par le manifeste mais absente du contenu', () => {
    const verdict = judgeRoundtrip({
      manifest: manifestWith([{ name: 'students', rows: [{ id: 's1' }] }, { name: 'payments', rows: [{ id: 'pay1' }] }]),
      backup: { students: [{ id: 's1' }] },
      target: { students: 1 },
      sharedRef: SHARED,
    });
    assert.ok(verdict.problems.some((p) => /« payments » est déclarée par le manifeste mais absente du contenu/.test(p)));
  });

  it('refuse une table du contenu que l’inventaire ne connaît pas : rien ne la compterait', () => {
    const verdict = judge({ table_inconnue: [{ id: 'x' }] }, { table_inconnue: 1 });
    assert.ok(verdict.problems.some((p) => /absente de l’inventaire/.test(p)));
  });
});

describe('les lignes non restaurables sont calculées, pas tolérées', () => {
  // Les comptes auth.users ne voyagent pas par l'API REST : les lignes qui les
  // référencent ne peuvent pas revenir dans une cible fraîche. Les compter comme
  // manquantes rendrait la preuve rouge sur un aller-retour correct.
  const backup = { user_profiles: [{ id: 'u1' }, { id: 'u2' }] };

  it('accepte l’absence des lignes dont le compte n’existe pas dans la cible, et la compte', () => {
    const verdict = judge(backup, { user_profiles: 1 }, ['u1']);
    assert.deepEqual(verdict.problems, []);
    assert.equal(verdict.rows[0].skipped, 1);
    assert.equal(verdict.rows[0].restorable, 1);
    assert.equal(verdict.restored, 1);
  });

  it('refuse quand une ligne RESTAURABLE manque, même si le compte du total tombe juste', () => {
    // Deux comptes existent, une seule ligne est revenue : la ligne perdue est
    // restaurable, donc son absence est un vrai trou.
    const verdict = judge(backup, { user_profiles: 1 }, ['u1', 'u2']);
    assert.equal(verdict.problems.length, 1);
    assert.match(verdict.problems[0], /1 ligne\(s\) dans la cible, 2 attendue\(s\)/);
  });

  it('ne compte pas comme non restaurable une ligne dont la référence est NULLE', () => {
    const verdict = judge({ app_settings: [{ key: 'k', updated_by: null }] }, { app_settings: 1 }, []);
    assert.deepEqual(verdict.problems, []);
    assert.equal(verdict.rows[0].skipped, 0);
  });
});

describe('la règle « ce qu’une cible peut accueillir » a UN SEUL exemplaire', () => {
  const spec = (name: string) => BACKUP_TABLES.find((t) => t.name === name) as { name: string; pk: string; authRef?: string };

  it('écarte une ligne dont le compte est absent, garde une référence nulle', () => {
    assert.deepEqual(restorableRows(spec('user_profiles'), [{ id: 'u1' }, { id: 'u2' }], ['u1']), [{ id: 'u1' }]);
    assert.equal(restorableRows(spec('app_settings'), [{ key: 'k', updated_by: null }], []).length, 1);
    // Une table sans référence à auth est intégralement restaurable.
    assert.equal(restorableRows(spec('students'), [{ id: 's1' }, { id: 's2' }], []).length, 2);
  });

  it('les deux lecteurs importent la règle au lieu d’en écrire une seconde', () => {
    // La divergence entre l'écriture et son propre recomptage a produit un faux
    // rouge le 2026-09-13 (`user_profiles: 0 < 4`). Deux écritures d'une même
    // règle finissent par diverger : ce cas refuse le retour d'une copie locale.
    for (const file of ['scripts/restore-db.mjs', 'scripts/check-backup-roundtrip.mjs']) {
      const source = read(file);
      assert.match(source, /import \{[^}]*restorableRows[^}]*\} from '\.\/lib\/db-tables\.mjs'/, `${file} doit importer la règle`);
      assert.doesNotMatch(source, /const restorableRows\s*=/, `${file} ne doit pas en écrire une seconde`);
    }
  });
});

describe('le sujet est la base PARTAGÉE', () => {
  it('refuse une sauvegarde venue d’une autre base : un aller-retour réussi n’y prouverait rien', () => {
    const verdict = judgeRoundtrip({
      manifest: { ...manifestWith([{ name: 'students', rows: [] }]), project: 'https://vulbmmzhcmnzswcvswfk.supabase.co' },
      backup: { students: [] },
      target: { students: 0 },
      sharedRef: SHARED,
    });
    assert.equal(verdict.problems.length, 1);
    assert.match(verdict.problems[0], /base PARTAGÉE est rpcjdohfxwukbqngbprw/);
  });
});

describe('le vide est NOMMÉ, sinon un vert se lit comme une promesse', () => {
  it('nomme les tables métier vides des deux côtés', () => {
    const verdict = judge({ students: [], parents: [], user_profiles: [{ id: 'u1' }] }, { students: 0, parents: 0, user_profiles: 1 }, ['u1']);
    assert.deepEqual(verdict.problems, []);
    // L'ordre suit l'inventaire (parents avant students : la dépendance), pas
    // l'ordre des clés du contenu.
    assert.deepEqual([...verdict.emptyBusiness].sort(), ['parents', 'students']);
  });

  it('ne nomme pas une table métier qui porte des données', () => {
    const verdict = judge({ students: [{ id: 's1' }] }, { students: 1 });
    assert.deepEqual(verdict.emptyBusiness, []);
  });

  it('ne confond pas une table ABSENTE du contenu avec une table vide', () => {
    // Vide = une case à zéro que le contenu AFFIRME ; absente = un trou, déjà
    // refusé plus haut. Nommer l'absence « vide » ferait passer une omission
    // pour une mesure.
    const present = judge({ students: [], audit_logs: [{ id: 'a1' }] }, { students: 0, audit_logs: 1 });
    const missing = judge({ audit_logs: [{ id: 'a1' }] }, { audit_logs: 1 });
    assert.deepEqual([...present.emptyBusiness].sort(), ['students']);
    assert.deepEqual(missing.emptyBusiness, []);
  });
});

describe('un aller-retour indécis n’est jamais vert', () => {
  it('refuse de juger sans manifeste ou sans contenu', () => {
    assert.ok(judgeRoundtrip({ backup: {}, target: {} }).problems[0].includes('manifeste absent'));
    assert.ok(judgeRoundtrip({ manifest: manifestWith([]), backup: null }).problems[0].includes('contenu absent'));
  });
});
