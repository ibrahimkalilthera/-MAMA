/**
 * Suite for `src/lib/deleteRights.ts` — le droit de supprimer, tel que la BASE
 * le décide, et tel que l'écran le respecte.
 *
 * Le défaut, mesuré le 2026-09-14 sur la base partagée : `public.is_admin()`
 * réserve la suppression de huit tables aux rôles `admin` et `dev`. Un compte
 * `staff` voyait malgré tout le bouton « Supprimer », le pressait, et PostgREST
 * répondait **200 avec un corps vide** — rien n'était supprimé, et l'écran
 * l'annonçait. La couche d'écriture dit désormais l'échec (`tests/
 * dataops-write-honesty.test.ts`) ; ce module fait l'autre moitié : l'action
 * n'est pas AFFICHÉE là où le serveur refuse, donc l'échec est empêché.
 *
 * Trois choses sont verrouillées ici, et pas une de moins :
 *   1. la règle elle-même (qui peut, qui ne peut pas) ;
 *   2. la non-divergence avec la MIGRATION — les deux listes sont comparées
 *      dans les deux sens, donc un rôle ou une table ajoutés d'un seul côté
 *      font rougir ce test au lieu de rouvrir un bouton qui ne peut pas aboutir ;
 *   3. le rendu RÉEL des vues : le bouton est là pour un administrateur, absent
 *      pour les autres — mesuré sur le HTML produit, pas déduit du code.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createElement } from 'react';
import { renderWithContext } from './views-harness';
import { translations } from '../src/i18n/translations';
import { StudentsView } from '../src/components/StudentsView';
import { ParentsView } from '../src/components/ParentsView';
import { PayrollView } from '../src/components/PayrollView';
import {
  ADMIN_ONLY_DELETE_TABLES,
  ADMIN_ROLES,
  canDeleteRecords,
  isAdminRole,
} from '../src/lib/deleteRights';
import type { Parent, Staff, Student } from '../src/lib/domainTypes';

const ROOT = join(import.meta.dirname, '..');
const RLS_MIGRATION = join(ROOT, 'supabase', 'migrations', '20260809000000_auth_and_rls.sql');

// ─── La règle ────────────────────────────────────────────────────────────────

describe('deleteRights — qui la base accepte', () => {
  it('accepte les deux rôles de public.is_admin(), refuse les trois autres', () => {
    for (const role of ADMIN_ROLES) assert.equal(canDeleteRecords(role), true, `${role} peut supprimer`);
    for (const role of ['staff', 'general_manager', 'econome']) {
      assert.equal(canDeleteRecords(role), false, `${role} ne peut pas supprimer`);
    }
  });

  it('refuse ce qu’il ne connaît pas — un rôle absent n’est jamais un droit', () => {
    for (const role of [null, undefined, '', '  ', 'root', 'Adminstrateur']) {
      assert.equal(canDeleteRecords(role), false, `« ${String(role)} » n’a pas le droit`);
    }
  });

  it('lit le rôle sans se laisser piéger par la casse ou les espaces', () => {
    // Le rôle vient d'une colonne Postgres (`user_profiles.role`) : il n'y a pas
    // de raison de refuser « ADMIN » si la base, elle, le lit comme admin.
    assert.equal(isAdminRole(' ADMIN '), true);
    assert.equal(canDeleteRecords('Dev'), true);
  });

  it('les huit tables de la règle sont celles des policies admin — et elles sont nommées', () => {
    assert.deepEqual(
      [...ADMIN_ONLY_DELETE_TABLES].sort(),
      ['expenses', 'parents', 'payments', 'salary_payments', 'staff', 'students', 'user_profiles', 'vendor_expenses'],
    );
  });
});

// ─── La non-divergence avec la migration ─────────────────────────────────────

describe('la règle de l’app et les policies de la base ne peuvent pas diverger', () => {
  const sql = readFileSync(RLS_MIGRATION, 'utf8');

  /** Les rôles cités par `public.is_admin()` dans la migration. */
  const rolesInSql = (() => {
    const fn = /FUNCTION public\.is_admin\(\)[\s\S]*?RETURN EXISTS \(([\s\S]*?)\);/.exec(sql);
    assert.ok(fn, 'la fonction public.is_admin() est lisible dans la migration');
    const list = /role IN \(([^)]*)\)/i.exec(fn[1]);
    assert.ok(list, 'la liste de rôles de is_admin() est lisible');
    return list[1]
      .split(',')
      .map((r) => r.trim().replace(/^'|'$/g, '').toLowerCase())
      .filter(Boolean)
      .sort();
  })();

  /** Les tables dont la policy de SUPPRESSION appelle `public.is_admin()`. */
  const tablesInSql = (() => {
    const lines = sql.split(/\r?\n/);
    const tables = [];
    for (let i = 0; i < lines.length; i += 1) {
      if (!/FOR DELETE USING \(public\.is_admin\(\)\)/.test(lines[i])) continue;
      for (let j = i; j >= 0; j -= 1) {
        const created = /CREATE POLICY\s+"[^"]*"\s+ON\s+(?:public\.)?([a-z_]+)/i.exec(lines[j]);
        if (created) {
          tables.push(created[1].toLowerCase());
          break;
        }
      }
    }
    return tables.sort();
  })();

  it('les rôles sont les mêmes, dans les deux sens', () => {
    assert.deepEqual(
      [...ADMIN_ROLES].sort(),
      rolesInSql,
      'un rôle ajouté d’un seul côté rouvrirait (ou fermerait) un bouton que la base ne suit pas',
    );
  });

  it('les tables sont les mêmes, dans les deux sens', () => {
    assert.deepEqual(
      [...ADMIN_ONLY_DELETE_TABLES].sort(),
      tablesInSql,
      'une policy resserrée sans l’app laisserait un bouton qui ne peut pas aboutir',
    );
  });

  it('la migration est bien lue — un contrôle vide ne prouve rien', () => {
    assert.ok(rolesInSql.length >= 2, `rôles lus dans la migration : ${rolesInSql.join(', ')}`);
    assert.ok(tablesInSql.length >= 8, `tables lues dans la migration : ${tablesInSql.length}`);
  });
});

// ─── Le rendu réel ───────────────────────────────────────────────────────────

const PUPIL: Student = {
  id: 'st1',
  name: 'Awa Kanté',
  studentId: 'MTH-001',
  grade: '9ème',
  academicYear: '2026-2027',
  parentName: 'Moussa Kanté',
  parentEmail: 'moussa@mamathera.org',
  parentPhone: '70 00 00 00',
  totalDue: 300000,
  amountPaid: 100000,
  dueDate: '2026-12-31',
  notes: '',
  status: 'Active',
  payments: [],
};

const GUARDIAN: Parent = {
  id: 'pa1',
  fullName: 'Moussa Kanté',
  phones: ['70 00 00 00'],
  email: 'moussa@mamathera.org',
  address: '',
  occupation: '',
  relationship: 'Père',
  notes: '',
};

const MEMBER: Staff = {
  id: 's1',
  name: 'Mariam Coulibaly',
  position: 'Proviseur',
  salary: 250000,
  email: '',
  phone: '',
  bankDetails: '',
  emergencyContact: '',
};

/** Les trois vues qui portent une suppression réservée aux administrateurs. */
const SURFACES = [
  {
    what: 'élèves',
    render: (canDelete: boolean) =>
      // `StudentsView` lit `filteredStudents` (la vue ne filtre pas elle-même) :
      // peupler `students` ne montrerait aucune ligne, donc ne mesurerait rien.
      renderWithContext(createElement(StudentsView), { filteredStudents: [PUPIL], canDelete }),
    title: translations.en.deleteStudent,
    showsRow: 'Awa Kanté',
  },
  {
    what: 'parents',
    render: (canDelete: boolean) =>
      renderWithContext(createElement(ParentsView), { parents: [GUARDIAN], canDelete }),
    title: translations.en.deleteParent,
    showsRow: 'Moussa Kanté',
  },
  {
    what: 'personnel',
    render: (canDelete: boolean) =>
      renderWithContext(createElement(PayrollView), {
        staff: [MEMBER],
        filteredStaff: [MEMBER],
        canDelete,
      }),
    title: translations.en.deleteStaffMember,
    showsRow: 'Mariam Coulibaly',
  },
];

describe('l’action de suppression n’existe pas pour un rôle que la base refuse', () => {
  for (const surface of SURFACES) {
    it(`${surface.what} : là quand le rôle le permet, absente sinon`, () => {
      const allowed = surface.render(true);
      const refused = surface.render(false);

      assert.ok(allowed.includes(surface.showsRow), 'la ligne est bien rendue (sinon rien n’est mesuré)');
      assert.ok(
        allowed.includes(`title="${surface.title}"`),
        `l’administrateur doit voir l’action de suppression (${surface.title})`,
      );
      assert.ok(refused.includes(surface.showsRow), 'la ligne reste rendue pour les autres rôles');
      assert.equal(
        refused.includes(`title="${surface.title}"`),
        false,
        `un rôle refusé par la base ne doit plus voir l’action (${surface.title})`,
      );
    });
  }
});
