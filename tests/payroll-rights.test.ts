/**
 * Suite for `src/lib/payrollRights.ts` — qui a le droit d'ÉCRIRE la paie et le
 * personnel, tel que la BASE le décide, et tel que l'écran le respecte.
 *
 * Le défaut, mesuré le 2026-10-05 sur le compte `econome`
 * (aggeediarra@mamathera.org) : l'écran Payroll offrait « Enregistrer Salaire »
 * à tous les rôles, mais la base réserve `salary_payments` à
 * `public.is_finance_admin()` (admin, dev, general_manager). Enregistrée hors
 * ligne, la paie était rejouée à chaque reconnexion et **refusée** —
 * « new row violates row-level security policy for table \"salary_payments\"
 * [42501] » — puis recomptée « refusée » sans jamais partir. L'écran proposait
 * une écriture que la base refusait : c'est ce que ce module empêche.
 *
 * Trois choses sont verrouillées, et pas une de moins :
 *   1. la règle elle-même (qui peut, qui ne peut pas) ;
 *   2. la non-divergence avec la MIGRATION — la liste de rôles de
 *      `is_payroll_writer()` est comparée dans les deux sens, donc un rôle ajouté
 *      d'un seul côté fait rougir ce test au lieu de rouvrir un bouton qui ne
 *      peut pas aboutir. Le personnel et les dépenses fournisseur suivent la
 *      leur (`public.is_finance_writer()`) : c'est `tests/finance-rights.test.ts` ;
 *   3. le rendu RÉEL de la vue : le bouton de paie est là pour l'`econome`,
 *      absent pour `staff` — mesuré sur le HTML produit, pas déduit du code.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createElement } from 'react';
import { renderWithContext } from './views-harness';
import { translations } from '../src/i18n/translations';
import { PayrollView } from '../src/components/PayrollView';
import { PAYROLL_WRITER_ROLES, canWritePayroll } from '../src/lib/payrollRights';
import type { AppRole, AuthState } from '../src/lib/useAuth';
import type { Staff } from '../src/lib/domainTypes';

const ROOT = join(import.meta.dirname, '..');
const PAYROLL_MIGRATION = join(ROOT, 'supabase', 'migrations', '20261005000000_econome_payroll_writes.sql');

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

describe('payrollRights — qui la base accepte', () => {
  it('l’econome enregistre la paie (la décision du 2026-10-05), comme les finance admins', () => {
    for (const role of ['admin', 'dev', 'general_manager', 'econome']) {
      assert.equal(canWritePayroll(role), true, `${role} peut enregistrer un paiement de salaire`);
    }
  });

  it('ni `staff` ni un rôle inconnu n’écrivent la paie', () => {
    for (const role of ['staff', null, undefined, '', '  ', 'root']) {
      assert.equal(canWritePayroll(role), false, `« ${String(role)} » n’écrit pas la paie`);
    }
    assert.equal(canWritePayroll('Econome '), true, 'la casse et les espaces sont absorbés, comme Postgres les lit');
  });

  it('l’écriture du PERSONNEL a son propre droit, et il ne vit plus ici', () => {
    // Jusqu'au 2026-10-13, le personnel était gardé par `is_finance_admin()` et
    // cette suite comparait `STAFF_WRITER_ROLES` à cette fonction. La décision du
    // propriétaire a déplacé la règle : l'économe ajoute un employé, un membre de
    // l'administration et un membre T et P — c'est `public.is_finance_writer()`
    // (`20261014000000_finance_writer_staff_vendor.sql`), comparé à
    // `FINANCE_WRITER_ROLES` dans `tests/finance-rights.test.ts`, avec le rendu
    // de l'écran. Ce qui reste ici est la PAIE, et elle seule.
    assert.equal((PAYROLL_WRITER_ROLES as readonly string[]).includes('econome'), true);
  });
});

// ─── La non-divergence avec les migrations ───────────────────────────────────

describe('la règle de l’app et les fonctions de la base ne peuvent pas diverger', () => {
  const payrollSql = readFileSync(PAYROLL_MIGRATION, 'utf8');

  it('is_payroll_writer() : les rôles sont les mêmes, dans les deux sens', () => {
    assert.deepEqual(
      [...PAYROLL_WRITER_ROLES].sort(),
      rolesOf(payrollSql, 'is_payroll_writer'),
      'un rôle ajouté d’un seul côté rouvrirait (ou fermerait) un bouton que la base ne suit pas',
    );
  });

  it('les policies d’ÉCRITURE de salary_payments appellent bien is_payroll_writer()', () => {
    assert.match(
      payrollSql,
      /CREATE POLICY "[^"]*" ON public\.salary_payments\s+FOR INSERT WITH CHECK \(public\.is_payroll_writer\(\)\)/i,
      'l’insertion d’un paiement de salaire passe par la fonction comparée ci-dessus',
    );
    assert.match(
      payrollSql,
      /CREATE POLICY "[^"]*" ON public\.salary_payments\s+FOR UPDATE USING \(public\.is_payroll_writer\(\)\)/i,
      'la correction d’un paiement de salaire aussi',
    );
  });

  it('la migration est REJOUABLE — elle retire aussi les noms qu’elle crée', () => {
    // Mesuré : appliquée deux fois, le second passage échouait sur
    // « policy already exists » et annulait tout le bloc (transaction).
    for (const name of ['Payroll writers insert salary_payments', 'Payroll writers update salary_payments']) {
      assert.ok(
        payrollSql.includes(`DROP POLICY IF EXISTS "${name}" ON public.salary_payments;`),
        `« ${name} » doit être retirée avant d’être recréée`,
      );
    }
  });

  it('les policies d’insertion héritées sont retirées (DROP avant CREATE)', () => {
    assert.match(
      payrollSql,
      /DROP POLICY IF EXISTS "Finance admins insert salary_payments"/,
      'sans le DROP, la policy is_finance_admin resterait active et l’econome serait encore refusé',
    );
    // Deux noms se sont succédé sur la même table : les policies permissives se
    // cumulent par OR, donc en laisser une ne change pas le RÉSULTAT — mais elle
    // ferait croire que `is_admin()` est encore la règle de la paie.
    assert.match(
      payrollSql,
      /DROP POLICY IF EXISTS "Admin can insert salary_payments"/,
      'la policy héritée is_admin — plus restrictive que is_payroll_writer() — doit partir aussi',
    );
  });

  it('les migrations sont bien lues — un contrôle vide ne prouve rien', () => {
    assert.ok(rolesOf(payrollSql, 'is_payroll_writer').length >= 4, 'au moins quatre rôles de paie');
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

/** Le poste connecté, réduit au rôle : c'est la seule chose que la vue lit. */
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

function render(role: AppRole): string {
  return renderWithContext(createElement(PayrollView), {
    auth: authWithRole(role),
    staff: [MEMBER],
    filteredStaff: [MEMBER],
    salaryPayments: [],
  });
}

describe('l’écriture n’est pas offerte là où la base refuse', () => {
  const salaryLabel = translations.en.recordSalary;

  it('econome : le bouton de salaire est là — la base l’accepte', () => {
    const html = render('econome');
    assert.ok(html.includes('Mariam Coulibaly'), 'la fiche est rendue (sinon rien n’est mesuré)');
    assert.ok(html.includes(salaryLabel), `l’econome doit voir « ${salaryLabel} »`);
  });

  it('staff : aucun bouton de paie — la base refuse', () => {
    const html = render('staff');
    assert.ok(html.includes('Mariam Coulibaly'));
    assert.equal(html.includes(salaryLabel), false, 'aucun bouton de paie pour un compte staff');
  });

  it('admin : le bouton de paie est là, comme la base l’accepte', () => {
    const html = render('admin');
    assert.ok(html.includes(salaryLabel));
  });
});
