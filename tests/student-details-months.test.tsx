// Les MOIS DE SCOLARITÉ sur la fiche d'un élève : ce que la fiche AFFIRME, et
// ce qu'elle refuse d'affirmer.
//
// Le contrat tenu ici est celui de l'écran : un mois déclaré réglé porte
// « réglé », les autres portent « à régler », le compte annonce les deux
// nombres, la ligne des restants nomme les mois DANS L'ORDRE de l'année — et
// quand un paiement ne déclare rien, la fiche le DIT au lieu de ranger ses mois
// dans « à régler ». C'est le cas qui compte : un mois marqué impayé alors
// qu'il a été payé est un papier d'école qui accuse une famille.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { StudentDetailsModal } from '../src/components/StudentDetailsModal';
import { translations } from '../src/i18n/translations';
import type { Student, Payment } from '../src/lib/useSupabaseData';
import type { CurrentTheme } from '../src/app/mainViewsProps';
import { installDomGlobals } from './harness';

const t = translations.fr;
const YEAR = '2026-2027';

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
  accentSoftHover: 'hover:bg-emerald-100', accentSoftTextHover: 'hover:text-emerald-700',
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

/** Le geste du guichet : trois mois troués — octobre, le mois de la date, dehors. */
const TICKED: Payment = { id: 'pay1', date: '2026-10-04', amount: 30000, receiptNumber: 'REC-1', months: ['2026-09', '2026-11', '2026-12'] };
/** Un paiement d'AVANT la colonne `months` : sa couverture est inconnue. */
const MUTE: Payment = { id: 'pay0', date: '2026-01-10', amount: 10000, receiptNumber: 'REC-0' };

function student(payments: Payment[], academicYear?: string): Student {
  return {
    id: 'st1', name: 'Ali Diallo', grade: '9A', studentId: 'MT-2026-101',
    totalDue: 150000, amountPaid: payments.reduce((sum, p) => sum + p.amount, 0),
    parentName: 'Papa Diallo', parentEmail: '', parentPhone: '', dueDate: '2026-12-31',
    notes: '', payments, academicYear,
  };
}

function mount(target: Student, selectedYear = YEAR) {
  installDomGlobals();
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => root.render(createElement(StudentDetailsModal, {
    student: target,
    t,
    lang: 'fr' as const,
    currentTheme: theme,
    formatDate: (d: string) => d,
    formatCurrency: (n: number) => `${n} FCFA`,
    getGradeDisplay: (g: string | undefined) => g ?? '',
    generatePaymentReceiptPdf: async () => {},
    currentUser: { name: 'Admin', role: 'admin' },
    copyToClipboard: () => {},
    handleSaveNote: async () => {},
    studentDetailTab: 'general' as const,
    setStudentDetailTab: () => {},
    selectedYear,
    overlayRef: () => {},
    onClose: () => {},
    onEdit: () => {},
    onPrint: () => {},
    onDeleteRequest: () => {},
    canDelete: true,
    canDeletePayment: true,
    onDeletePayment: async () => true,
    // Le droit de RENSEIGNER les mois : ouvert ici, parce que cette fiche
    // monte justement un reçu muet (`MUTE`) — l'éditeur doit exister à côté de
    // la bande que ces tests mesurent.
    canEditPaymentMonths: true,
    onUpdatePaymentMonths: async () => true,
  })));
  const chips = () => Array.from(container.querySelectorAll('[data-slot="student-months"] [data-month]'));
  return {
    container,
    chips,
    /** L'état porté par une pastille, lu par sa CLÉ (`2026-09`), jamais son libellé. */
    state: (month: string) => container.querySelector(`[data-month="${month}"]`)?.getAttribute('data-state') ?? null,
    text: () => container.querySelector('[data-slot="student-months"]')?.textContent ?? '',
    cleanup: () => { act(() => root.unmount()); container.remove(); },
  };
}

describe('StudentDetailsModal — les mois de scolarité de l’élève', () => {
  it('marque les mois déclarés réglés, les autres à régler, et porte les deux nombres', () => {
    const h = mount(student([TICKED]));
    try {
      assert.equal(h.chips().length, 12, 'les douze mois de l’année scolaire sont offerts');
      for (const month of ['2026-09', '2026-11', '2026-12']) {
        assert.equal(h.state(month), 'paid', `${month} est déclaré réglé par le paiement`);
      }
      assert.equal(h.state('2026-10'), 'due', 'le mois absent du geste reste à régler');
      assert.equal(h.state('2027-08'), 'due', 'les mois à venir de l’année aussi');
      assert.ok(h.text().includes('3 mois réglés sur 12'), `le compte est écrit (vu : « ${h.text()} »)`);
    } finally {
      h.cleanup();
    }
  });

  it('nomme les mois restants dans l’ordre de l’année, à partir du premier trou', () => {
    const h = mount(student([TICKED]));
    try {
      const line = h.container.querySelector('[data-slot="student-months"] p')?.textContent ?? '';
      assert.ok(line.startsWith(`${t.monthsRemainingLabel} : Octobre`), `la ligne commence par octobre (vu : « ${line} »)`);
      assert.ok(!line.includes('Septembre'), 'un mois réglé n’est pas répété dans les restants');
      assert.ok(line.includes('Août'), 'et la liste va jusqu’à la fin de l’année');
    } finally {
      h.cleanup();
    }
  });

  it('DIT qu’un paiement ne déclare aucun mois, au lieu de compter ses mois comme impayés', () => {
    const h = mount(student([MUTE, TICKED]));
    try {
      assert.ok(
        h.text().includes(t.monthsUndeclaredNote.replace('{count}', '1')),
        `la note nomme le paiement muet (vu : « ${h.text()} »)`,
      );
      assert.equal(h.state('2026-10'), 'due', 'le mois du paiement muet n’est PAS déclaré réglé pour autant');
      assert.equal(h.state('2026-09'), 'paid', 'et les mois déclarés restent réglés');
    } finally {
      h.cleanup();
    }
  });

  it('ne dit RIEN des paiements muets quand il n’y en a aucun', () => {
    const h = mount(student([TICKED]));
    try {
      assert.ok(!h.text().includes('sans mois déclaré'), 'aucune note sans paiement muet');
    } finally {
      h.cleanup();
    }
  });

  it('prend l’année de la FICHE, et retombe sur l’année active quand elle est vide', () => {
    // La fiche porte une autre année : c’est ELLE qui commande, et ses mois à
    // elle ne déteignent pas sur la bande affichée.
    const other = mount(student([{ ...TICKED, months: ['2025-09'] }], '2025-2026'));
    try {
      assert.equal(other.chips().length, 12);
      assert.equal(other.state('2025-09'), 'paid', 'l’année de la fiche est celle qui est jugée');
      assert.equal(other.state('2026-09'), null, 'un mois d’une AUTRE année n’est même pas offert ici');
      assert.equal(other.state('2026-08'), 'due', 'la bande va de septembre de l’année de la fiche à août suivant');
    } finally {
      other.cleanup();
    }

    // Sans année sur la fiche : l'année ACTIVE prend le relais, sinon la bande
    // resterait invisible pour les élèves enregistrés sans année.
    const fallback = mount(student([TICKED]), YEAR);
    try {
      assert.equal(fallback.chips().length, 12, 'l’année active de l’application est le recours');
      assert.equal(fallback.state('2026-09'), 'paid');
    } finally {
      fallback.cleanup();
    }
  });

  it('cache la bande — sans inventer de mois — quand aucune année n’est lisible', () => {
    const h = mount(student([TICKED]), 'nope');
    try {
      assert.equal(h.chips().length, 0, 'aucune année lisible : aucune pastille, plutôt que des mois inventés');
      assert.equal(h.text(), '');
    } finally {
      h.cleanup();
    }
  });
});
