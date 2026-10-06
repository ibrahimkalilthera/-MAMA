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
import { ExpensesView } from '../src/components/ExpensesView';
import {
  ADMIN_ONLY_DELETE_TABLES,
  ADMIN_ROLES,
  canDeleteRecords,
  isAdminRole,
} from '../src/lib/deleteRights';
import type { Expense, Parent, Staff, Student } from '../src/lib/domainTypes';

const ROOT = join(import.meta.dirname, '..');
const RLS_MIGRATION = join(ROOT, 'supabase', 'migrations', '20260809000000_auth_and_rls.sql');
const PAYMENTS_MIGRATION = join(ROOT, 'supabase', 'migrations', '20261005000003_econome_delete_payments.sql');

/**
 * Les tables que le fichier de base déclare encore `is_admin()` mais qu'une
 * migration PLUS RÉCENTE reprend — une migration ne se réécrit pas, donc le
 * fichier de base garde le texte d'origine. `payments` en fait partie depuis le
 * 2026-10-05 : sa suppression s'ouvre à l'économe
 * (`20261005000003_econome_delete_payments.sql`). Retirer une table ici n'est
 * honnête que si la migration dédiée la reprend VRAIMENT — c'est ce que vérifie
 * le cas « payments est bien reprise… », sans quoi l'exclusion masquerait un
 * abandon silencieux.
 */
const SUPERSEDED_IN_BASE = ['payments'];
const SUPERSEDED_TABLES = new Set(SUPERSEDED_IN_BASE);

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

  it('les sept tables de la règle sont celles des policies admin — et elles sont nommées', () => {
    assert.deepEqual(
      [...ADMIN_ONLY_DELETE_TABLES].sort(),
      ['expenses', 'parents', 'salary_payments', 'staff', 'students', 'user_profiles', 'vendor_expenses'],
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
    // `payments` est retirée ici : sa suppression appartient désormais à
    // `public.is_payment_deleter()` (migration dédiée), pas à `is_admin()`.
    return tables.filter((t) => !SUPERSEDED_TABLES.has(t)).sort();
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
    assert.ok(tablesInSql.length >= 7, `tables lues dans la migration : ${tablesInSql.length}`);
  });

  it('payments est bien reprise par sa migration dédiée (l’exclusion n’est pas un abandon)', () => {
    const paymentsSql = readFileSync(PAYMENTS_MIGRATION, 'utf8');
    assert.match(
      paymentsSql,
      /FOR DELETE USING \(public\.is_payment_deleter\(\)\)/,
      'la migration dédiée doit bien (re)définir la suppression de payments',
    );
    assert.ok(
      paymentsSql.includes('CREATE OR REPLACE FUNCTION public.is_payment_deleter()'),
      'et définir le helper qui la porte',
    );
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

/** Une dépense réelle, pour que la ligne — et sa pastille — soient rendues. */
const SPEND: Expense = {
  id: 'e1',
  category: 'Supplies',
  description: 'Fournitures',
  amount: 5000,
  date: '2026-09-15',
};

/** Ce qu’une surface doit prouver : le bouton là où la base accepte, absent sinon. */
type DeleteSurface = {
  what: string;
  render: (canDelete: boolean) => string;
  title: string;
  /** Le libellé écrit à côté de l’icône, quand la vue en porte un. */
  label?: string;
  showsRow: string;
};

/** Les vues qui portent une suppression réservée aux administrateurs. */
const SURFACES: DeleteSurface[] = [
  {
    what: 'élèves',
    render: (canDelete) =>
      // `StudentsView` lit `filteredStudents` (la vue ne filtre pas elle-même) :
      // peupler `students` ne montrerait aucune ligne, donc ne mesurerait rien.
      renderWithContext(createElement(StudentsView), { filteredStudents: [PUPIL], canDelete }),
    title: translations.en.deleteStudent,
    label: translations.en.deleteStudent,
    showsRow: 'Awa Kanté',
  },
  {
    what: 'dépenses',
    // Le tableau « général » n'apparaît que sur son ONGLET, et la ligne qu'avec le
    // filtre de catégorie ouvert (`''` n'est pas `'all'`, et masquerait la ligne).
    render: (canDelete) =>
      renderWithContext(createElement(ExpensesView), {
        expenses: [SPEND],
        canDelete,
        vendorExpensesTab: 'general',
        generalExpenseCategoryFilter: 'all',
      }),
    title: translations.en.deleteExpense,
    label: translations.en.deleteExpense,
    showsRow: 'Fournitures',
  },
  {
    what: 'parents',
    render: (canDelete) =>
      renderWithContext(createElement(ParentsView), { parents: [GUARDIAN], canDelete }),
    title: translations.en.deleteParent,
    label: translations.en.deleteParent,
    showsRow: 'Moussa Kanté',
  },
  {
    what: 'personnel',
    render: (canDelete) =>
      renderWithContext(createElement(PayrollView), {
        staff: [MEMBER],
        filteredStaff: [MEMBER],
        canDelete,
      }),
    title: translations.en.deleteStaffMember,
    label: translations.en.deleteStaffMember,
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
      if (surface.label) {
        // Le libellé doit être écrit EN TEXTE à côté de l’icône — pas seulement
        // dans l’attribut `title`, qui porte le même mot. Compter les occurrences
        // distingue les deux : l’attribut en donne une, le texte en ajoute une.
        const enTexte = allowed.split(surface.label).length - 1;
        const enTitre = allowed.split(`title="${surface.title}"`).length - 1;
        assert.ok(
          enTexte > enTitre,
          `le libellé « ${surface.label} » doit accompagner l’icône, pas une icône seule`,
        );
      }
      assert.ok(refused.includes(surface.showsRow), 'la ligne reste rendue pour les autres rôles');
      assert.equal(
        refused.includes(`title="${surface.title}"`),
        false,
        `un rôle refusé par la base ne doit plus voir l’action (${surface.title})`,
      );
    });
  }
});
