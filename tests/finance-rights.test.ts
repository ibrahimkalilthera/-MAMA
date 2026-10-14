/**
 * Suite for `src/lib/payrollRights.ts` — la part FINANCE : qui peut ajouter un
 * membre du personnel et écrire une dépense, tel que la BASE le décide, et tel
 * que l'écran le respecte.
 *
 * Le défaut, mesuré le 2026-10-13 sur la base de l'école (poste `econome`,
 * aggeediarra@mamathera.org), avait DEUX formes — l'une et l'autre invisibles
 * depuis l'écran :
 *   • « Pai/Salaires » → « Ajouter un employé », « Ajouter un membre de
 *     l'administration », « Ajouter un membre T et P » n'apparaissaient pas :
 *     la porte citait `is_finance_admin()`, qui exclut l'économe, et la base
 *     refusait son insertion (`staff` → 42501) ;
 *   • « Dépenses » → l'icône ✚ « Ajouter une dépense » n'apparaissait pas non
 *     plus, alors que la MÊME insertion réussissait en base (`expenses` → 1
 *     ligne) : là, c'est l'interface seule qui fermait.
 *
 * Trois choses sont verrouillées, et pas une de moins :
 *   1. la règle elle-même (qui écrit, qui n'écrit pas) ;
 *   2. la non-divergence avec la MIGRATION — les listes de rôles de
 *      `is_finance_writer()` et `is_finance_admin()` sont comparées dans les
 *      deux sens, ET les policies d'écriture doivent appeler la fonction
 *      comparée : un rôle ajouté d'un seul côté, ou une policy qui repasse à
 *      `is_admin()`, fait rougir ce test ;
 *   3. le rendu RÉEL : l'icône ✚ et les trois boutons de personnel sont mesurés
 *      sur le HTML produit pour un `econome`, et absents pour un `staff`.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { renderWithContext, makeProps } from './views-harness';
import { translations } from '../src/i18n/translations';
import { ExpensesView } from '../src/components/ExpensesView';
import { PayrollView } from '../src/components/PayrollView';
import { VendorExpenseModal } from '../src/components/VendorExpenseModal';
import {
  FINANCE_ADMIN_ROLES,
  FINANCE_WRITER_ROLES,
  VENDOR_EXPENSE_DELETER_ROLES,
  canDeleteVendorExpenses,
  canWriteFinance,
} from '../src/lib/payrollRights';
import type { MainViewsProps } from '../src/app/mainViewsProps';
import type { AppRole, AuthState } from '../src/lib/useAuth';
import type { Expense, Staff, VendorExpense } from '../src/lib/domainTypes';

const ROOT = join(import.meta.dirname, '..');
const WRITER_MIGRATION = join(ROOT, 'supabase', 'migrations', '20261014000000_finance_writer_staff_vendor.sql');
const FINANCE_MIGRATION = join(ROOT, 'supabase', 'migrations', '20260902000000_general_manager_role.sql');
const VENDOR_DELETE_MIGRATION = join(ROOT, 'supabase', 'migrations', '20260906000002_vendor_expense_gm_policies.sql');

/** Les rôles cités par `role IN (…)` dans la fonction `name` d'un fichier SQL. */
function rolesOf(sql: string, name: string): string[] {
  const fn = new RegExp(`FUNCTION public\\.${name}\\(\\)[\\s\\S]*?role IN \\(([^)]*)\\)`, 'i').exec(sql);
  assert.ok(fn, `la fonction public.${name}() est lisible dans la migration`);
  return fn![1]
    .split(',')
    .map((role) => role.trim().replace(/^'|'$/g, '').toLowerCase())
    .filter(Boolean)
    .sort();
}

// ─── La règle ────────────────────────────────────────────────────────────────

describe('canWriteFinance — qui la base accepte à l’écriture', () => {
  it('l’économe écrit le personnel et les dépenses, comme les finance admins', () => {
    for (const role of ['admin', 'dev', 'general_manager', 'econome']) {
      assert.equal(canWriteFinance(role), true, `${role} écrit`);
    }
  });

  it('ni `staff` ni un rôle inconnu n’écrivent', () => {
    for (const role of ['staff', null, undefined, '', '  ', 'root']) {
      assert.equal(canWriteFinance(role), false, `« ${String(role)} » n’écrit pas`);
    }
    assert.equal(canWriteFinance(' Econome '), true, 'la casse et les espaces sont absorbés, comme Postgres les lit');
  });

  it('la SUPPRESSION reste un autre droit : l’économe n’y figure pas', () => {
    // `is_finance_admin()` garde encore la suppression d'un membre du personnel
    // et d'une dépense fournisseur. Écrire et détruire ne sont pas le même droit —
    // et l'écran ne montre pas de corbeille à l'économe (`canDelete`,
    // `canDeleteVendorExpenses`).
    assert.deepEqual(
      (FINANCE_ADMIN_ROLES as readonly string[]).includes('econome'),
      false,
      'l’économe écrit le personnel sans pouvoir le supprimer',
    );
  });
});

// ─── La destruction d’une dépense fournisseur ────────────────────────────────

describe('canDeleteVendorExpenses — la corbeille fournisseur, telle que la base la décide', () => {
  it('le Gestionnaire Principal la partage avec admin/dev — c’est la migration de septembre', () => {
    for (const role of ['admin', 'dev', 'general_manager']) {
      assert.equal(canDeleteVendorExpenses(role), true, `${role} supprime une dépense fournisseur`);
    }
    assert.equal(canDeleteVendorExpenses(' General_Manager '), true, 'la casse et les espaces sont absorbés, comme Postgres les lit');
  });

  it('l’économe SAISIT la dépense sans pouvoir la détruire — le droit est plus ÉTROIT que l’écriture', () => {
    assert.equal(canWriteFinance('econome'), true, 'il écrit la dépense fournisseur');
    assert.equal(
      canDeleteVendorExpenses('econome'),
      false,
      'et il ne la détruit pas : deux noms pour la même règle serait exactement le défaut réparé ici',
    );
  });

  it('ni `staff` ni un rôle inconnu ne la suppriment', () => {
    for (const role of ['staff', null, undefined, '', '  ', 'root', 'Adminstrateur']) {
      assert.equal(canDeleteVendorExpenses(role), false, `« ${String(role)} » n’a pas le droit`);
    }
  });

  it('la liste est celle de public.is_finance_admin(), dans les deux sens', () => {
    assert.deepEqual(
      [...VENDOR_EXPENSE_DELETER_ROLES].sort(),
      rolesOf(readFileSync(FINANCE_MIGRATION, 'utf8'), 'is_finance_admin'),
      'un rôle ajouté d’un seul côté rouvrirait (ou fermerait) une corbeille que la base ne suit pas',
    );
  });
});

// ─── La non-divergence avec les migrations ───────────────────────────────────

describe('la règle de l’app et les fonctions de la base ne peuvent pas diverger', () => {
  const writerSql = readFileSync(WRITER_MIGRATION, 'utf8');
  const financeSql = readFileSync(FINANCE_MIGRATION, 'utf8');

  it('is_finance_writer() : les rôles sont les mêmes, dans les deux sens', () => {
    assert.deepEqual(
      [...FINANCE_WRITER_ROLES].sort(),
      rolesOf(writerSql, 'is_finance_writer'),
      'un rôle ajouté d’un seul côté rouvrirait (ou fermerait) une action que la base ne suit pas',
    );
  });

  it('is_finance_admin() : la liste de la suppression est la même, dans les deux sens', () => {
    assert.deepEqual([...FINANCE_ADMIN_ROLES].sort(), rolesOf(financeSql, 'is_finance_admin'));
  });

  it('la policy de SUPPRESSION des dépenses fournisseur appelle bien is_finance_admin()', () => {
    // La liste ci-dessus ne sert à rien si la politique a repris `is_admin()` :
    // c'est la fonction CITÉE par la policy qui décide, pas la liste du code.
    const deleteSql = readFileSync(VENDOR_DELETE_MIGRATION, 'utf8');
    assert.match(
      deleteSql,
      /CREATE POLICY "Finance admins delete vendor_expenses" ON public\.vendor_expenses\s+FOR DELETE TO authenticated\s+USING \(public\.is_finance_admin\(\)\)/,
      'la suppression d’une dépense fournisseur passe par la fonction comparée ci-dessus',
    );
  });

  it('les policies d’écriture appellent bien is_finance_writer()', () => {
    for (const [table, cmd] of [
      ['staff', 'INSERT'],
      ['staff', 'UPDATE'],
      ['vendor_expenses', 'INSERT'],
    ] as const) {
      assert.match(
        writerSql,
        new RegExp(
          `CREATE POLICY "[^"]*" ON public\\.${table}\\s+FOR ${cmd}\\s+(WITH CHECK|USING) \\(public\\.is_finance_writer\\(\\)\\)`,
          'i',
        ),
        `l’écriture (${cmd}) de ${table} passe par la fonction comparée ci-dessus`,
      );
    }
  });

  it('les policies trop étroites sont RETIRÉES : sans le DROP, elles resteraient actives', () => {
    // Les policies permissives se cumulent par OR, donc une doublure ne change
    // pas le RÉSULTAT — mais elle laisserait croire que `is_admin()` ou
    // `is_finance_admin()` gouverne encore l'écriture du personnel.
    for (const [name, table] of [
      ['Admin can insert staff', 'staff'],
      ['Finance admins insert staff', 'staff'],
      ['Admin can update staff', 'staff'],
      ['Finance admins update staff', 'staff'],
      ['Promoter insert vendor_expenses', 'vendor_expenses'],
    ] as const) {
      assert.ok(
        writerSql.includes(`DROP POLICY IF EXISTS "${name}" ON public.${table};`),
        `« ${name} » doit être retirée avant d’être remplacée`,
      );
    }
  });

  it('la migration est REJOUABLE — elle retire aussi les noms qu’elle crée', () => {
    for (const [name, table] of [
      ['Finance writers insert staff', 'staff'],
      ['Finance writers update staff', 'staff'],
      ['Finance writers insert vendor_expenses', 'vendor_expenses'],
    ] as const) {
      assert.ok(
        writerSql.includes(`DROP POLICY IF EXISTS "${name}" ON public.${table};`),
        `« ${name} » doit être retirée avant d’être recréée (sinon « policy already exists » annule tout le bloc)`,
      );
    }
  });

  it('la migration ne RETIRE aucun droit : `expenses` n’y est pas touchée', () => {
    // La policy d'écriture de `expenses` accepte déjà l'économe (et tout compte
    // authentifié — la saisie quotidienne des dépenses fait partie du rôle
    // `staff`, décision de 20260902000000). La resserrer retirerait un droit que
    // des comptes exercent déjà ; l'écran, lui, peut être plus étroit que la base.
    assert.equal(
      /ON public\.expenses/i.test(writerSql),
      false,
      'cette migration OUVRE ce qui est fermé ; elle ne referme rien',
    );
  });

  it('les migrations sont bien lues — un contrôle vide ne prouve rien', () => {
    assert.ok(rolesOf(writerSql, 'is_finance_writer').length >= 4, 'au moins quatre rôles d’écriture');
    assert.ok(rolesOf(financeSql, 'is_finance_admin').length >= 3, 'au moins trois rôles de suppression');
  });
});

// ─── Le rendu réel ───────────────────────────────────────────────────────────

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

/** Le poste connecté, réduit au rôle : c'est la seule chose que les vues lisent. */
function authWithRole(role: AppRole): AuthState {
  return {
    user: null,
    profile: { id: 'u1', email: `${role}@mamathera.org`, fullName: 'Poste de test', role },
    loading: false,
    error: null,
    isAdmin: role === 'admin' || role === 'dev',
    isOfflineSession: false,
    reauthFailed: false,
    signIn: async () => ({ success: true }),
    signOut: async () => {},
    fetchAllProfiles: async () => [],
    updateUserRole: async () => true,
    createStaffUser: async () => ({ success: true }),
    sendPasswordReset: async () => ({ success: true }),
    setUserPassword: async () => ({ success: true }),
  };
}

const addExpenseLabel = translations.en.addExpense;
const staffButtons = [translations.en.addStaff, translations.en.addTechMember, translations.en.addAdminMember];

describe('l’écriture n’est pas cachée là où la base l’accepte', () => {
  it('ExpensesView : l’économe voit l’icône ✚ « Ajouter une dépense »', () => {
    const html = renderWithContext(createElement(ExpensesView), {
      auth: authWithRole('econome'),
      vendorExpensesTab: 'general',
    });
    assert.ok(
      html.includes(addExpenseLabel),
      `l’économe doit voir « ${addExpenseLabel} » — la base accepte son insertion (mesuré : 1 ligne)`,
    );
  });

  it('ExpensesView : un compte `staff` ne la voit pas', () => {
    const html = renderWithContext(createElement(ExpensesView), {
      auth: authWithRole('staff'),
      vendorExpensesTab: 'general',
    });
    assert.equal(html.includes(addExpenseLabel), false, 'hors de la liste d’écriture : pas de bouton');
  });

  it('PayrollView : l’économe voit les TROIS boutons de personnel', () => {
    const html = renderWithContext(createElement(PayrollView), {
      auth: authWithRole('econome'),
      staff: [MEMBER],
      filteredStaff: [MEMBER],
    });
    assert.ok(html.includes('Mariam Coulibaly'), 'la fiche est rendue (sinon rien n’est mesuré)');
    for (const label of staffButtons) {
      assert.ok(html.includes(label), `l’économe doit voir « ${label} »`);
    }
  });

  it('PayrollView : un compte `staff` ne les voit pas — la base refuse (42501)', () => {
    const html = renderWithContext(createElement(PayrollView), {
      auth: authWithRole('staff'),
      staff: [MEMBER],
      filteredStaff: [MEMBER],
    });
    assert.ok(html.includes('Mariam Coulibaly'));
    for (const label of staffButtons) {
      assert.equal(html.includes(label), false, `« ${label} » ne s’affiche pas`);
    }
  });
});

describe('la modale de dépense fournisseur ouvre ses champs au même droit', () => {
  const base = makeProps();

  function renderModal(canWriteExpenses: boolean): string {
    return renderToString(
      createElement(VendorExpenseModal, {
        t: base.t,
        lang: 'en',
        currentTheme: base.currentTheme,
        editingVendorExpense: null,
        vendorExpenseForm: {
          vendorName: '',
          category: 'stationery',
          amount: '',
          dueDate: '2026-10-13',
          paymentStatus: 'unpaid',
          amountPaid: '',
          description: '',
          aidType: '',
          beneficiaryStudentName: '',
          beneficiaryStudentGrade: '',
        },
        setVendorExpenseForm: () => {},
        handleVendorExpenseSubmit: async () => {},
        isPromoter: false,
        canWriteExpenses,
        expenseCategoryList: base.expenseCategoryList,
        availableClasses: base.availableClasses,
        overlayRef: () => {},
        onClose: () => {},
      }),
    );
  }

  it('fournisseur et montant sont SAISISSABLES pour l’économe, à la création', () => {
    // Sinon il ouvrirait un formulaire dont les deux champs requis sont figés —
    // une écriture qui ne peut pas aboutir, c'est-à-dire le défaut d'origine.
    const html = renderModal(true);
    assert.ok(html.includes(translations.en.addVendorExpense), 'la modale est rendue (sinon rien n’est mesuré)');
    assert.equal(
      html.includes(translations.en.promoterOnly),
      false,
      'aucun champ marqué « promoteur uniquement » quand le rôle écrit',
    );
  });

  it('et FIGÉS pour un rôle qui n’écrit pas', () => {
    const html = renderModal(false);
    assert.ok(html.includes(translations.en.promoterOnly), 'le verrou se voit (mention « promoteur uniquement »)');
  });
});

// ─── Le rendu réel de la corbeille fournisseur ───────────────────────────────

/** Une dépense fournisseur, pour que la ligne — et SA corbeille — soient rendues. */
const VENDOR_BILL: VendorExpense = {
  id: 'v1',
  vendorName: 'Papeterie Ba',
  category: 'stationery',
  amount: 75000,
  dueDate: '2026-09-30',
  paymentStatus: 'unpaid',
  amountPaid: 0,
  description: 'Cahiers',
  academicYear: '2026-2027',
};

/** Une dépense GÉNÉRALE, qui suit l’autre règle (`public.is_admin()`). */
const GENERAL_BILL: Expense = {
  id: 'e1',
  category: 'Supplies',
  description: 'Fournitures',
  amount: 5000,
  date: '2026-09-15',
};

const trashLabel = translations.en.deleteExpense;

/**
 * L'onglet Fournisseurs, monté avec le rôle du poste et l'état d'écran que
 * `App.tsx` en dérive (`canDelete` = admin/dev). Les filtres de l'onglet sont
 * ouverts : `''` n'est pas `'all'`, et une ligne masquée ne mesurerait rien.
 */
function renderVendors(role: AppRole): string {
  return renderExpensesWithRole(role, {
    vendorExpensesTab: 'vendors',
    vendorExpenses: [VENDOR_BILL],
  });
}

function renderExpensesWithRole(
  role: AppRole,
  overrides: Partial<MainViewsProps>,
): string {
  return renderWithContext(createElement(ExpensesView), {
    auth: authWithRole(role),
    // Le harnais déclare `canDelete: true` (un poste admin) : le reposer ici sur
    // le RÔLE évite de mesurer une corbeille que ce poste n'aurait pas.
    canDelete: role === 'admin' || role === 'dev',
    selectedYear: '',
    vendorSearch: '',
    vendorCategoryFilter: 'all',
    vendorStatusFilter: 'all',
    ...overrides,
  });
}

describe('la corbeille d’une dépense fournisseur suit SON droit, pas celui des dépenses générales', () => {
  it('le Gestionnaire Principal la voit comme admin/dev, et l’économe non', () => {
    for (const role of ['admin', 'dev', 'general_manager'] as AppRole[]) {
      const html = renderVendors(role);
      assert.ok(html.includes(VENDOR_BILL.vendorName), `la dépense est rendue pour ${role} (sinon rien n’est mesuré)`);
      assert.ok(html.includes(`title="${trashLabel}"`), `${role} doit voir « ${trashLabel} »`);
    }

    const econome = renderVendors('econome');
    assert.ok(econome.includes(VENDOR_BILL.vendorName), 'la ligne reste rendue pour l’économe');
    assert.equal(
      econome.includes(`title="${trashLabel}"`),
      false,
      'il écrit la dépense sans pouvoir la détruire : pas de corbeille',
    );
  });

  it('et `staff` ne la voit pas non plus — la base la refuse', () => {
    const staff = renderVendors('staff');
    assert.ok(staff.includes(VENDOR_BILL.vendorName));
    assert.equal(staff.includes(`title="${trashLabel}"`), false);
  });

  it('la corbeille des dépenses GÉNÉRALES, elle, reste fermée au Gestionnaire Principal', () => {
    const html = renderExpensesWithRole('general_manager', {
      expenses: [GENERAL_BILL],
      vendorExpensesTab: 'general',
      generalExpenseCategoryFilter: 'all',
    });
    assert.ok(html.includes(GENERAL_BILL.description), 'la dépense générale est bien rendue');
    assert.equal(
      html.includes(`title="${trashLabel}"`),
      false,
      '`expenses` reste à `is_admin()` : le Gestionnaire Principal n’y a pas de corbeille',
    );
  });
});
