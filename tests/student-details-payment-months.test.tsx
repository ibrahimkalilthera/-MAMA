// RENSEIGNER LES MOIS d'un reçu muet, depuis la fiche de l'élève.
//
// Le cas mesuré est celui qui existe en base depuis le 2026-10-11 : un reçu
// saisi AVANT la colonne `payments.months` a pris `{}`. Sa couverture est
// inconnue, sa réimpression ne nomme que le mois de sa DATE, et la fiche le
// compte parmi les paiements « sans mois déclaré ». Ces tests tiennent le geste
// qui répare ça — et ses quatre refus :
//
//   • pas de droit (`admin`/`dev` seulement, la policy UPDATE) → pas de bouton ;
//   • un reçu qui déclare DÉJÀ ses mois → pas de bouton (il n'y a rien à
//     renseigner, et l'écraser serait un autre geste, pas celui-ci) ;
//   • aucun mois coché → le bouton d'enregistrement reste FERMÉ ;
//   • un refus de la base → l'éditeur reste OUVERT avec le choix intact.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { StudentDetailsModal } from '../src/components/StudentDetailsModal';
import { translations } from '../src/i18n/translations';
import { formatPaidMonths, paymentMonthLabel } from '../src/lib/paymentMonths';
import type { Student, Payment } from '../src/lib/useSupabaseData';
import type { CurrentTheme } from '../src/app/mainViewsProps';
import { installDomGlobals } from './harness';

const t = translations.fr;

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

/** Le reçu ANTÉRIEUR à la colonne `months` : sa couverture est inconnue. */
const MUTE: Payment = { id: 'pay0', date: '2026-01-10', amount: 10000, receiptNumber: 'REC-0' };
/** Un reçu qui déclare DÉJÀ ce qu'il couvre : rien à renseigner. */
const TICKED: Payment = { id: 'pay1', date: '2026-10-04', amount: 30000, receiptNumber: 'REC-1', months: ['2026-09'] };

const STUDENT: Student = {
  id: 'st1', name: 'Ali Diallo', grade: '1A', studentId: 'MT-2026-101',
  totalDue: 150000, amountPaid: 40000, parentName: 'Papa Diallo', parentEmail: '',
  parentPhone: '', dueDate: '2026-12-31', notes: '', payments: [MUTE, TICKED],
  academicYear: '2026-2027',
};

function mount(opts: { canEditPaymentMonths?: boolean; result?: boolean; onCall?: (months: string[]) => void }) {
  installDomGlobals();
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  const calls: { studentId: string; paymentId: string; months: string[] }[] = [];
  act(() => root.render(createElement(StudentDetailsModal, {
    student: STUDENT,
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
    selectedYear: '2026-2027',
    overlayRef: () => {},
    onClose: () => {},
    onEdit: () => {},
    onPrint: () => {},
    onDeleteRequest: () => {},
    canDelete: true,
    canDeletePayment: true,
    onDeletePayment: async () => true,
    canEditPaymentMonths: opts.canEditPaymentMonths ?? true,
    onUpdatePaymentMonths: async (studentId: string, payment: Payment, months: string[]) => {
      calls.push({ studentId, paymentId: payment.id ?? '', months });
      opts.onCall?.(months);
      return opts.result ?? true;
    },
  })));

  const buttons = () => Array.from(container.querySelectorAll('button'));
  const buttonWithText = (label: string) =>
    buttons().find((b) => (b.textContent ?? '').trim() === label) ?? null;
  const click = (el: Element) => act(() => { (el as HTMLElement).click(); });

  return {
    container,
    calls,
    click,
    /**
     * Le bouton « renseigner les mois » DU CARNET — repéré par son marqueur, et
     * non par son `title`.
     *
     * Les deux portes vers le même éditeur (la ligne du carnet et le parcours de
     * rattrapage, `data-slot="payment-months-backfill-fill"`) portent le même
     * libellé accessible : un sélecteur par titre les compterait toutes les deux
     * et ne dirait plus laquelle de ces suites mesure. Ce que ces cas-ci
     * tiennent, c'est le geste direct sur la ligne.
     */
    triggers: () => Array.from(container.querySelectorAll('[data-slot="payment-months-fill"]')),
    /** Les pastilles de l'éditeur : ce sont les seuls boutons `aria-pressed`. */
    chips: () => Array.from(container.querySelectorAll('button[aria-pressed]')),
    /** Une pastille, par le MOT qu'elle affiche (« Septembre »). */
    chip: (label: string) => buttons().find((b) => b.getAttribute('aria-pressed') !== null && (b.textContent ?? '').trim() === label) ?? null,
    save: () => buttonWithText(t.paymentMonthsSave) as HTMLButtonElement | null,
    cancel: () => buttonWithText(t.cancel),
    text: () => container.textContent ?? '',
    cleanup: () => { act(() => root.unmount()); container.remove(); },
  };
}

describe('StudentDetailsModal — renseigner les mois d’un reçu qui n’en déclare aucun', () => {
  it('n’offre le geste que sur le reçu MUET, et seulement avec le droit', () => {
    const allowed = mount({});
    try {
      assert.equal(allowed.triggers().length, 1, 'un seul reçu est muet : un seul bouton');
      assert.ok(allowed.triggers()[0]?.textContent?.includes(t.paymentMonthsEdit), 'le libellé accompagne l’icône');
    } finally {
      allowed.cleanup();
    }

    const refused = mount({ canEditPaymentMonths: false });
    try {
      assert.equal(refused.triggers().length, 0, 'sans le droit de la policy UPDATE, aucun bouton');
    } finally {
      refused.cleanup();
    }
  });

  it('ouvre les douze mois de l’année, aucun coché, et garde « enregistrer » fermé', () => {
    const h = mount({});
    try {
      h.click(h.triggers()[0]!);
      assert.equal(h.chips().length, 12, 'les douze mois de l’année scolaire sont offerts');
      assert.equal(
        h.chips().filter((c) => c.getAttribute('aria-pressed') === 'true').length,
        0,
        'le reçu ne déclarait rien : rien n’est coché d’avance',
      );
      assert.ok(h.text().includes(t.paymentMonthsEditHint), 'la phrase dit pourquoi on demande');
      assert.equal(h.save()?.disabled, true, 'aucun mois coché : il n’y a rien à enregistrer');
    } finally {
      h.cleanup();
    }
  });

  it('montre la ligne EXACTE du reçu, puis envoie les mois triés et referme', async () => {
    const h = mount({ result: true });
    try {
      h.click(h.triggers()[0]!);
      // Ordre de clics volontairement à l'envers du calendrier : c'est l'ordre
      // de l'année scolaire qui doit partir, pas celui des doigts.
      h.click(h.chip(t.aug)!);
      h.click(h.chip(t.sep)!);

      const expectedLine = formatPaidMonths(['2026-09', '2027-08'], {
        label: (ym) => paymentMonthLabel(ym, t),
        count: (n) => t.paidMonthsCount.replace('{count}', String(n)),
        rangeTo: t.paidMonthsRangeTo,
      });
      assert.ok(h.text().includes(expectedLine), `la ligne du reçu est écrite (vu : « ${expectedLine} »)`);
      assert.ok(expectedLine.includes(t.sep) && expectedLine.includes(t.aug), 'elle NOMME les deux mois');
      assert.equal(h.save()?.disabled, false, 'deux mois cochés : l’enregistrement s’ouvre');

      await act(async () => { h.save()!.click(); });

      assert.deepEqual(h.calls, [{ studentId: 'st1', paymentId: 'pay0', months: ['2026-09', '2027-08'] }],
        'l’opération reçoit le reçu muet et ses mois, dans l’ordre du calendrier');
      assert.equal(h.save(), null, 'un succès referme l’éditeur');
    } finally {
      h.cleanup();
    }
  });

  it('un refus de la base laisse l’éditeur OUVERT, avec le choix intact', async () => {
    const h = mount({ result: false });
    try {
      h.click(h.triggers()[0]!);
      h.click(h.chip(t.sep)!);
      await act(async () => { h.save()!.click(); });

      assert.equal(h.calls.length, 1, 'le geste a bien été tenté');
      assert.ok(h.save(), 'l’éditeur reste ouvert : un échec ne referme rien');
      assert.equal(h.chip(t.sep)?.getAttribute('aria-pressed'), 'true', 'le mois coché est toujours coché');
      assert.equal(h.triggers().length, 0, 'la ligne du reçu n’est pas revenue sous l’éditeur');
    } finally {
      h.cleanup();
    }
  });

  it('annuler referme sans rien envoyer', () => {
    const h = mount({});
    try {
      h.click(h.triggers()[0]!);
      h.click(h.chip(t.sep)!);
      h.click(h.cancel()!);

      assert.equal(h.calls.length, 0, 'annuler n’écrit rien');
      assert.equal(h.save(), null, 'l’éditeur est refermé');
      assert.equal(h.triggers().length, 1, 'la ligne du reçu reprend sa place');
    } finally {
      h.cleanup();
    }
  });
});
