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
  hoverSurface: 'state-hover',
  hoverSurfaceSolid: 'state-hover-solid',
  hoverSurfaceStrong: 'state-hover-strong',
  hoverSurfaceDark: 'state-hover-dark',
  hoverSurfaceClear: 'state-hover-clear',
  hoverAccent: 'state-accent-hover',
  hoverAccentGroupInk: 'state-accent-group-ink',
  hoverAlert: 'state-alert-hover',
  hoverAlertTint: 'state-alert-tint',
  hoverAlertSolid: 'state-alert-solid',
  hoverAlertDark: 'state-alert-dark',
  hoverAlertPlate: 'state-alert-plate',
  input: 'bg-white',
  isDark: false,
};

const PAY: Payment = { id: 'pay1', date: '2026-10-01', amount: 25000, receiptNumber: 'REC-1' };
// `grade: '1A'` ET un matricule : c'est le cas qui a CHANGÉ le 2026-10-06 (le
// matricule n'appartient plus qu'aux 9e). Le garder ici fait tourner toutes les
// suites existantes sur une fiche qui en porte un, comme les vraies fiches.
const STUDENT: Student = {
  id: 'st1', name: 'Ali Diallo', grade: '1A', studentId: 'MT-2026-101', totalDue: 150000, amountPaid: 25000,
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
    selectedYear: '2026-2027',
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
    // Le reçu de cette fiche ne déclare aucun mois — donc le bouton
    // « renseigner les mois » serait offert si le rôle y avait droit. Ce n'est
    // pas le sujet de cette suite : on ferme ce droit pour que seules la
    // corbeille et sa confirmation soient mesurées ici.
    canEditPaymentMonths: false,
    onUpdatePaymentMonths: async () => true,
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

  it('la corbeille porte le LIBELLÉ de l’action, pas seulement l’icône', () => {
    // Une icône seule se lit comme un ornement : le libellé rend l’action
    // visible. L’icône reste là — c’est le couple icône + texte qui est voulu.
    const h = mount({ canDeletePayment: true, result: true });
    try {
      const trigger = h.trigger();
      assert.ok(trigger, 'la corbeille est offerte quand le rôle peut supprimer');
      assert.ok(
        (trigger.textContent ?? '').includes(t.deletePayment),
        'le libellé de l’action est écrit à côté de l’icône',
      );
      assert.ok(trigger.querySelector('svg'), 'l’icône corbeille reste présente');
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

describe('StudentDetailsModal — le matricule est visible pour TOUTE classe', () => {
  it('affiche le matricule d’un élève qui n’est PAS en 9e', async () => {
    // Le changement de politique du 2026-10-06, prouvé sur l'INTERFACE : ce
    // bandeau ne montrait le matricule que pour les 9e (donc jamais pour les
    // ~400 autres élèves de l'école). « Ali Diallo » est en 1A, et son matricule
    // est à l'écran — c'est le geste que la demande décrit.
    const h = mount({ canDeletePayment: true, result: true });
    try {
      const text = h.container.textContent ?? '';
      assert.match(text, /MT-2026-101/, 'le matricule de la fiche est rendu');
      assert.match(text, new RegExp(t.studentId), 'et il est étiqueté comme un matricule');
    } finally {
      h.cleanup();
    }
  });
});
