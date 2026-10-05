// Le bouton « supprimer un paiement » : monté sur le VRAI DOM, cliqué comme un
// doigt le ferait. Le contrat tenu ici est celui de l'INTERFACE — le bouton
// n'existe que pour les rôles qui peuvent supprimer, la confirmation EN LIGNE
// dit ce qui part (montant + reçu), l'appel reçoit l'élève ET le paiement, et
// un échec laisse la confirmation ouverte (le toast a déjà dit pourquoi).
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

const PAY: Payment = { id: 'pay1', date: '2026-10-01', amount: 25000, receiptNumber: 'REC-1' };
const STUDENT: Student = {
  id: 'st1', name: 'Ali Diallo', grade: '1A', totalDue: 150000, amountPaid: 25000,
  parentName: 'Papa Diallo', parentEmail: '', parentPhone: '', dueDate: '2026-12-31',
  notes: '', payments: [PAY],
};

function mount(opts: { canDeletePayment: boolean; result: boolean }) {
  installDomGlobals();
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  const calls: { studentId: string; payment: Payment }[] = [];
  const props = {
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
    overlayRef: () => {},
    onClose: () => {},
    onEdit: () => {},
    onPrint: () => {},
    onDeleteRequest: () => {},
    canDelete: true,
    canDeletePayment: opts.canDeletePayment,
    onDeletePayment: async (studentId: string, payment: Payment) => {
      calls.push({ studentId, payment });
      return opts.result;
    },
  };
  const render = () => act(() => root.render(createElement(StudentDetailsModal, props)));
  render();
  const click = (el: Element) => act(() => {
    // happy-dom's `.click()` dispatches a real bubbling click — React's root
    // listener picks it up exactly as it would a finger tap.
    (el as HTMLElement).click();
  });
  return {
    container, calls, click,
    /** Le bouton corbeille : repéré par son `title` (le libellé de l'action). */
    trigger: () => container.querySelector<HTMLButtonElement>(`button[title="${t.deletePayment}"]`),
    /** Le bouton de confirmation : porte le texte de l'action, pas le titre. */
    confirm: () => Array.from(container.querySelectorAll('button'))
      .find((b) => b.textContent?.trim() === t.deletePayment && !b.querySelector('svg')),
    cleanup: () => { act(() => root.unmount()); container.remove(); },
    render,
  };
}

describe('StudentDetailsModal — supprimer un paiement saisi par erreur', () => {
  it('canDeletePayment : la corbeille ouvre une confirmation en ligne, et confirmer appelle onDeletePayment', async () => {
    const h = mount({ canDeletePayment: true, result: true });
    try {
      const trigger = h.trigger();
      assert.ok(trigger, 'la corbeille est offerte quand le rôle peut supprimer');
      h.click(trigger);

      const message = h.container.textContent ?? '';
      assert.match(message, /REC-1/, 'la confirmation nomme le reçu concerné');
      assert.match(message, /25 000|25000/, 'la confirmation rappelle le montant');
      assert.ok(h.confirm(), 'une confirmation en ligne est proposée (pas un dialogue navigateur)');

      await act(async () => { h.click(h.confirm()!); });
      assert.equal(h.calls.length, 1, 'onDeletePayment est appelé une fois');
      assert.equal(h.calls[0]!.studentId, 'st1');
      assert.equal(h.calls[0]!.payment.id, 'pay1');

      // Succès : la confirmation se referme (la ligne est partie de la liste).
      assert.equal(h.confirm(), undefined, 'après succès, la confirmation est refermée');
    } finally {
      h.cleanup();
    }
  });

  it('sans droit de suppression : aucune corbeille, donc aucun appel possible', () => {
    const h = mount({ canDeletePayment: false, result: true });
    try {
      assert.equal(h.trigger(), null, 'pas de rôle, pas de bouton');
      assert.equal(h.calls.length, 0);
    } finally {
      h.cleanup();
    }
  });

  it('échec : la confirmation reste ouverte, et rien n’a été supprimé du listing local', async () => {
    const h = mount({ canDeletePayment: true, result: false });
    try {
      h.click(h.trigger()!);
      await act(async () => { h.click(h.confirm()!); });
      assert.equal(h.calls.length, 1);
      assert.ok(h.confirm(), 'l’échec laisse la confirmation en place');
    } finally {
      h.cleanup();
    }
  });
});
