// ─────────────────────────────────────────────────────────────────────────────
// tests/record-salary-month-year.test.tsx — le solde « ce mois-ci » d'un salarié
// compare le mois ET l'année, tous deux INJECTÉS.
//
// Le défaut visé : `currentMonth` arrivait par les props, mais l'année était lue
// à l'horloge murale (`new Date().getFullYear()`). Un paiement daté du même mois
// d'une AUTRE année était alors compté comme « payé ce mois-ci », ce qui
// sous-estimait le solde affiché dans le select et le résumé.
//
// La preuve est ici : on rend le composant avec une horloge figée par les props
// (`currentMonth` + `currentYear`) et un paiement du même mois mais d'une année
// antérieure. Le solde doit rester PLEIN. Le cas symétrique (même mois, même
// année) doit, lui, déduire le paiement — sinon le test passerait pour la
// mauvaise raison.
// ─────────────────────────────────────────────────────────────────────────────
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { translations } from '../src/i18n/translations';
import { RecordSalaryModal } from '../src/components/RecordSalaryModal';
import type { SalaryForm, CurrentTheme } from '../src/app/mainViewsProps';
import type { Staff, SalaryPayment } from '../src/lib/useSupabaseData';

const t = translations.fr;

const theme: CurrentTheme = {
  bg: 'bg-slate-100',
  card: 'bg-white',
  text: 'text-slate-900',
  muted: 'text-slate-500',
  border: 'border-slate-200',
  header: '#0F172A',
  sidebar: 'bg-slate-800',
  accent: 'text-emerald-600',
  accentBg: 'bg-emerald-50',
  accentText: 'text-white',
  accentHover: 'hover:bg-emerald-100',
  accentGroupHover: 'accent-group-hover',
  accentShadow: 'shadow-emerald-200',
  accentSoft: 'bg-emerald-50',
  accentSoftText: 'text-emerald-600',
  accentSoftHover: 'hover:bg-emerald-100',
  accentSoftTextHover: 'hover:text-emerald-700',
  accentHex: '#059669',
  accentHexDeep: '#047857',
  accentRing: 'focus:ring-emerald-500/20',
  accentBorder: 'border-slate-300',
  accentBorderHover: 'hover:border-slate-400',
  surfaceInset: 'bg-slate-50',
  inkStrong: 'text-slate-800',
  accentSoftDark: 'bg-blue-500/15',
  accentSoftDarkHover: 'hover:bg-blue-500/25',
  accentSoftDarkText: 'text-blue-300',
  tableHeader: 'bg-slate-100',
  rowHover: 'hover:bg-slate-50',
  input: 'bg-white',
  isDark: false,
};

// L'année INJECTÉE est décalée d'un an par rapport à l'horloge de la machine :
// l'ancien code lisait `new Date().getFullYear()`, donc un cas dont l'année
// injectée vaudrait l'année réelle passerait par COÏNCIDENCE. Le décalage rend la
// fuite de l'horloge détectable quel que soit le jour d'exécution.
const WALL_YEAR = new Date().getFullYear();
const INJECTED_YEAR = WALL_YEAR + 1;

const SALARY = 100000;
const staff: Staff[] = [
  {
    id: 's1', name: 'Alice', position: 'teacher', salary: SALARY,
    email: '', phone: '', bankDetails: '', emergencyContact: '',
  },
];

const salaryForm: SalaryForm = { staffId: '', amount: '', date: '2026-09-02' };

function renderSalaryModal(currentYear: number, payments: SalaryPayment[]): string {
  return renderToString(
    createElement(RecordSalaryModal, {
      t,
      currentTheme: theme,
      staff,
      salaryPayments: payments,
      currentMonth: 8, // septembre
      currentYear,
      salaryForm,
      setSalaryForm: () => {},
      formatCurrency: (n: number) => `${n} XOF`,
      generateInstallmentMemo: () => {},
      handleSalarySubmit: async () => {},
      overlayRef: () => {},
      onClose: () => {},
    }),
  );
}

describe('RecordSalaryModal — solde du mois : année injectée, pas l’horloge', () => {
  it('ne lit PAS l’année de l’horloge : un paiement du même mois de l’année machine ne compte pas', () => {
    // Même mois (septembre) que l'année RÉELLE de la machine — exactement ce que
    // l'ancien `new Date().getFullYear()` aurait compté à tort.
    const html = renderSalaryModal(INJECTED_YEAR, [
      { id: 'p1', staffId: 's1', amount: 40000, date: `${WALL_YEAR}-09-10` },
    ]);
    assert.ok(
      html.includes(`${SALARY} XOF`),
      'un paiement de l’année de l’horloge ne doit pas compter pour l’année injectée : solde plein attendu',
    );
    assert.ok(
      !html.includes(`${SALARY - 40000} XOF`),
      'le paiement de l’année de la machine ne doit pas avoir été déduit',
    );
  });

  it('déduit un paiement du même mois de l’année injectée', () => {
    const html = renderSalaryModal(INJECTED_YEAR, [
      { id: 'p2', staffId: 's1', amount: 40000, date: `${INJECTED_YEAR}-09-10` },
    ]);
    assert.ok(
      html.includes(`${SALARY - 40000} XOF`),
      'un paiement de septembre de l’année injectée doit réduire le solde du même mois',
    );
  });

  it('ne déduit PAS un paiement d’un autre mois de la même année', () => {
    const html = renderSalaryModal(INJECTED_YEAR, [
      { id: 'p3', staffId: 's1', amount: 40000, date: `${INJECTED_YEAR}-08-31` },
    ]);
    assert.ok(
      html.includes(`${SALARY} XOF`),
      'août ne doit pas compter dans le solde de septembre de la même année',
    );
  });
});
