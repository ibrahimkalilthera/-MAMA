/**
 * Suite for `src/lib/paymentRights.ts` — qui peut SUPPRIMER un paiement d'élève,
 * tel que la BASE le décide, et tel que la fiche élève le respecte.
 *
 * Le défaut, mesuré le 2026-10-05 : le bouton « supprimer un paiement » était
 * réservé à `public.is_admin()` (admin, dev). L'économe — qui tient la caisse et
 * saisit les reçus — ne pouvait donc pas corriger un montant tapé deux fois : le
 * bouton lui était caché. La décision du propriétaire ouvre cette seule policy à
 * l'économe (`public.is_payment_deleter()`).
 *
 * Trois choses sont verrouillées, et pas une de moins :
 *   1. la règle elle-même (qui peut, qui ne peut pas) ;
 *   2. la non-divergence avec la MIGRATION — la liste de rôles de
 *      `is_payment_deleter()` est comparée dans les deux sens ;
 *   3. le rendu RÉEL de la fiche : l'économe voit la corbeille du PAIEMENT mais
 *      PAS le bouton « supprimer l'élève » — deux portes distinctes, mesurées sur
 *      le HTML monté, pas déduites du code.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { StudentDetailsModal } from '../src/components/StudentDetailsModal';
import { translations } from '../src/i18n/translations';
import { PAYMENT_DELETER_ROLES, PAYMENT_MONTH_EDITOR_ROLES, canDeletePayments, canUpdatePaymentMonths } from '../src/lib/paymentRights';
import { canDeleteRecords } from '../src/lib/deleteRights';
import type { Payment, Student } from '../src/lib/useSupabaseData';
import type { CurrentTheme } from '../src/app/mainViewsProps';
import { installDomGlobals } from './harness';

const t = translations.fr;

const ROOT = join(import.meta.dirname, '..');
const PAYMENTS_MIGRATION = join(ROOT, 'supabase', 'migrations', '20261005000003_econome_delete_payments.sql');
const RLS_MIGRATION = join(ROOT, 'supabase', 'migrations', '20260809000000_auth_and_rls.sql');

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

describe('paymentRights — qui la base laisse supprimer un paiement', () => {
  it('l’économe supprime un paiement (la décision du 2026-10-05), comme admin et dev', () => {
    for (const role of ['admin', 'dev', 'econome']) {
      assert.equal(canDeletePayments(role), true, `${role} peut supprimer un paiement`);
    }
  });

  it('ni `staff`, ni `general_manager`, ni un rôle inconnu ne suppriment un paiement', () => {
    for (const role of ['staff', 'general_manager', null, undefined, '', '  ', 'root']) {
      assert.equal(canDeletePayments(role), false, `« ${String(role)} » ne supprime pas un paiement`);
    }
    assert.equal(canDeletePayments(' Econome '), true, 'la casse et les espaces sont absorbés, comme Postgres les lit');
  });

  it('le droit reste plus LARGE que la suppression admin : l’économe n’a que les paiements', () => {
    // L'économe supprime un paiement mais AUCUNE table réservée aux admins.
    assert.equal(canDeletePayments('econome'), true);
    assert.equal(canDeleteRecords('econome'), false, 'les tables admin restent hors de portée de l’économe');
    assert.equal(canDeleteRecords('dev'), true);
    assert.equal(canDeletePayments('dev'), true);
  });
});

// ─── La non-divergence avec la migration ─────────────────────────────────────

describe('la règle de l’app et la fonction de la base ne peuvent pas diverger', () => {
  const sql = readFileSync(PAYMENTS_MIGRATION, 'utf8');

  it('les rôles sont les mêmes, dans les deux sens', () => {
    assert.deepEqual(
      [...PAYMENT_DELETER_ROLES].sort(),
      rolesOf(sql, 'is_payment_deleter'),
      'un rôle ajouté d’un seul côté rouvrirait (ou fermerait) un bouton que la base ne suit pas',
    );
  });

  it('la policy de suppression de payments s’appuie bien sur ce helper', () => {
    assert.match(sql, /CREATE POLICY "[^"]*" ON public\.payments\s+FOR DELETE USING \(public\.is_payment_deleter\(\)\)/);
  });
});

// ─── Renseigner les MOIS : un autre droit, une autre policy ──────────────────

describe('paymentRights — qui la base laisse renseigner les mois d’un reçu', () => {
  it('admin et dev le peuvent : c’est `public.is_admin()` qui décide, pas l’écran', () => {
    for (const role of ['admin', 'dev']) {
      assert.equal(canUpdatePaymentMonths(role), true, `${role} renseigne les mois d’un reçu`);
    }
  });

  it('l’économe, lui, NON — il supprime un paiement sans réécrire ses mois', () => {
    // La limite dite du module : `is_payment_deleter()` couvre la SUPPRESSION,
    // pas l'UPDATE. Si cette assertion tombe, c'est qu'une migration a ouvert
    // l'UPDATE à l'économe : il faudra le dire dans `paymentRights.ts` ET
    // montrer le bouton — pas seulement changer la liste ici.
    assert.equal(canDeletePayments('econome'), true, 'il supprime un reçu fautif');
    assert.equal(canUpdatePaymentMonths('econome'), false, 'sans pouvoir en réécrire les mois');
    for (const role of ['staff', 'general_manager', null, undefined, '', '  ', 'root']) {
      assert.equal(canUpdatePaymentMonths(role), false, `« ${String(role)} » non plus`);
    }
    assert.equal(canUpdatePaymentMonths(' ADMIN '), true, 'la casse et les espaces sont absorbés');
  });
});

describe('le droit de renseigner les mois ne diverge pas de la policy UPDATE', () => {
  const sql = readFileSync(RLS_MIGRATION, 'utf8');

  it('les rôles sont ceux de `public.is_admin()`, dans les deux sens', () => {
    assert.deepEqual(
      [...PAYMENT_MONTH_EDITOR_ROLES].sort(),
      rolesOf(sql, 'is_admin'),
      'un rôle ajouté d’un seul côté afficherait un bouton que la base refuse (200, zéro ligne)',
    );
  });

  it('la policy UPDATE de payments s’appuie bien sur ce helper', () => {
    assert.match(
      sql,
      /CREATE POLICY "Admin update payments" ON public\.payments\s+FOR UPDATE USING \(public\.is_admin\(\)\)/,
      'la policy qui autorise l’écriture de `months` est celle que le module reflète',
    );
  });
});

// ─── Le rendu réel ───────────────────────────────────────────────────────────

const theme: CurrentTheme = {
  bg: 'bg-slate-100', card: 'bg-white', text: 'text-slate-900', muted: 'text-slate-500',
  border: 'border-slate-200', header: '#0F172A', sidebar: 'bg-slate-800',
  accent: 'text-emerald-600', accentBg: 'bg-emerald-50', accentText: 'text-white',
  accentHover: 'hover:bg-emerald-100', accentGroupHover: 'accent-group-hover',
  accentShadow: 'shadow-emerald-200', accentSoft: 'bg-emerald-50', accentSoftText: 'text-emerald-600',
  accentSoftHover: 'hover:bg-emerald-100', accentSoftTextHover: 'hover:text-emerald-700',
  accentHex: '#059669', accentHexDeep: '#047857', accentRing: 'focus:ring-emerald-500/20',
  accentBorder: 'border-slate-300', accentBorderHover: 'hover:border-slate-400',
  surfaceInset: 'bg-slate-50', inkStrong: 'text-slate-800',
  accentSoftDark: 'bg-blue-500/15', accentSoftDarkHover: 'hover:bg-blue-500/25', accentSoftDarkText: 'text-blue-300',
  tableHeader: 'bg-slate-100', rowHover: 'hover:bg-slate-50', input: 'bg-white', isDark: false,
};

const PAY: Payment = { id: 'pay1', date: '2026-10-01', amount: 25000, receiptNumber: 'REC-1' };
const STUDENT: Student = {
  id: 'st1', name: 'Ali Diallo', grade: '1A', totalDue: 150000, amountPaid: 25000,
  parentName: 'Papa Diallo', parentEmail: '', parentPhone: '', dueDate: '2026-12-31',
  notes: '', payments: [PAY],
};

function mount(opts: { canDelete: boolean; canDeletePayment: boolean; canEditPaymentMonths: boolean }) {
  installDomGlobals();
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => root.render(createElement(StudentDetailsModal, {
    student: STUDENT, t, lang: 'fr', currentTheme: theme,
    formatDate: (d: string) => d, formatCurrency: (n: number) => `${n} FCFA`,
    getGradeDisplay: (g: string | undefined) => g ?? '', generatePaymentReceiptPdf: async () => {},
    currentUser: { name: 'Admin', role: 'admin' }, copyToClipboard: () => {}, handleSaveNote: async () => {},
    studentDetailTab: 'general', setStudentDetailTab: () => {}, selectedYear: '2026-2027', overlayRef: () => {},
    onClose: () => {}, onEdit: () => {}, onPrint: () => {}, onDeleteRequest: () => {},
    canDelete: opts.canDelete, canDeletePayment: opts.canDeletePayment,
    onDeletePayment: async () => true,
    canEditPaymentMonths: opts.canEditPaymentMonths,
    onUpdatePaymentMonths: async () => true,
  })));
  return {
    container,
    /** La corbeille d'un PAIEMENT : repérée par son `title`. */
    paymentTrash: () => container.querySelector(`button[title="${t.deletePayment}"]`),
    /** Le bouton « renseigner les mois » : repéré par son `title`. */
    monthsEdit: () => container.querySelector(`button[title="${t.paymentMonthsEdit}"]`),
    /** Le bouton « supprimer l'élève » : repéré par son texte (pas de `title`). */
    studentDelete: () => Array.from(container.querySelectorAll('button'))
      .find((b) => b.textContent?.trim() === t.deleteStudent) ?? null,
    cleanup: () => { act(() => root.unmount()); container.remove(); },
  };
}

describe('la fiche élève ne propose chaque geste qu’au rôle que la base accepte', () => {
  it('économe : la corbeille du paiement est là, les deux autres gestes non', () => {
    // Le reçu de cette fiche ne déclare aucun mois : le bouton « renseigner les
    // mois » serait donc OFFERT si le droit suivait la suppression. Il ne la
    // suit pas — et c'est ce que la base dit aussi (`is_admin()`).
    const h = mount({ canDelete: false, canDeletePayment: true, canEditPaymentMonths: false });
    try {
      assert.ok(h.paymentTrash(), 'l’économe doit pouvoir corriger un paiement');
      assert.equal(h.studentDelete(), null, 'mais pas supprimer l’élève entier');
      assert.equal(h.monthsEdit(), null, 'ni réécrire les mois d’un reçu');
    } finally {
      h.cleanup();
    }
  });

  it('staff : aucune des actions', () => {
    const h = mount({ canDelete: false, canDeletePayment: false, canEditPaymentMonths: false });
    try {
      assert.equal(h.paymentTrash(), null);
      assert.equal(h.studentDelete(), null);
      assert.equal(h.monthsEdit(), null);
    } finally {
      h.cleanup();
    }
  });

  it('admin/dev : les trois actions', () => {
    const h = mount({ canDelete: true, canDeletePayment: true, canEditPaymentMonths: true });
    try {
      assert.ok(h.paymentTrash());
      assert.ok(h.studentDelete());
      assert.ok(h.monthsEdit(), 'le bouton des mois est offert là où la policy UPDATE l’autorise');
    } finally {
      h.cleanup();
    }
  });
});
