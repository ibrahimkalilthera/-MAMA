/**
 * L'ÉTAT DE RAPPROCHEMENT — la fenêtre, le PAPIER, et le geste qui l'ouvre.
 *
 * Trois choses sont mesurées ici, et chacune a coûté cher ailleurs dans ce
 * dépôt :
 *
 *   1. **Les deux faces disent la MÊME chose.** L'aperçu à l'écran et le jumeau
 *      imprimé (`hidden print:block`) sont rendus par un seul bloc de JSX
 *      (`ReconciliationSheet`) ; le cas le vérifie par le HTML réel (SSR), en
 *      comptant DEUX occurrences des faits — comme le ticket de retard, dont
 *      les deux copies sont mesurées de la même façon.
 *   2. **La réserve des reçus muets sort sur le papier.** Un avis de relance qui
 *      annoncerait « encore dus » à une famille dont les reçus n'ont pas été
 *      renseignés est le pire papier qu'une école puisse envoyer : la phrase
 *      porte sa réserve, à l'écran comme sur le papier.
 *   3. **Le papier ne s'imprime que seul.** Il porte son propre marqueur
 *      (`hidden print:block` + `print-reconciliation-container`), et la coquille
 *      reçoit `no-print-sheet` à l'impression (voir `AppShell`) : c'est ce
 *      couple — la classe sur la coquille, le papier hors d'elle — que mesure
 *      `tests/appshell-overlays.test.tsx`, qui monte le shell entier. Ici, on
 *      mesure la moitié qui appartient au papier.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { ReconciliationModal, ReconciliationPrint } from '../src/components/ReconciliationModal';
import { StudentDetailsModal } from '../src/components/StudentDetailsModal';
import { translations } from '../src/i18n/translations';
import type { Payment, Student } from '../src/lib/useSupabaseData';
import type { CurrentTheme } from '../src/app/mainViewsProps';
import { installDomGlobals } from './harness';

const t = translations.fr;
const theme: CurrentTheme = {
  bg: 'bg-slate-100', card: 'bg-white', text: 'text-slate-900', muted: 'text-slate-500',
  border: 'border-slate-200', header: '#0F172A', sidebar: 'bg-slate-800', accent: 'text-emerald-600',
  accentBg: 'bg-emerald-50', accentText: 'text-white', accentHover: 'hover:bg-emerald-100',
  accentGroupHover: 'accent-group-hover', accentShadow: 'shadow-emerald-200', accentSoft: 'bg-emerald-50',
  accentSoftText: 'text-emerald-600', accentSoftHover: 'hover:bg-emerald-100', accentSoftTextHover: 'hover:text-emerald-700',
  accentHex: '#059669', accentHexDeep: '#047857', accentRing: 'focus:ring-emerald-500/20',
  accentBorder: 'border-slate-300', accentBorderHover: 'hover:border-slate-400', surfaceInset: 'bg-slate-50',
  inkStrong: 'text-slate-800', accentSoftDark: 'bg-blue-500/15', accentSoftDarkHover: 'hover:bg-blue-500/25',
  accentSoftDarkText: 'text-blue-300', tableHeader: 'bg-slate-100', rowHover: 'hover:bg-slate-50',
  hoverSurface: 'state-hover', hoverSurfaceSolid: 'state-hover-solid', hoverSurfaceStrong: 'state-hover-strong',
  hoverSurfaceDark: 'state-hover-dark', hoverSurfaceClear: 'state-hover-clear', hoverAccent: 'state-accent-hover',
  hoverAccentGroupInk: 'state-accent-group-ink', hoverAlert: 'state-alert-hover', hoverAlertTint: 'state-alert-tint',
  hoverAlertSolid: 'state-alert-solid', hoverAlertDark: 'state-alert-dark', hoverAlertPlate: 'state-alert-plate',
  input: 'bg-white', isDark: false,
};

/** Septembre et novembre réglés, l'autre reçu MUET : sa couverture est inconnue. */
const PAID: Payment = { id: 'p1', date: '2026-09-04', amount: 50000, receiptNumber: 'REC-111111', months: ['2026-09', '2026-11'] };
const MUTE: Payment = { id: 'p2', date: '2026-09-06', amount: 25000, receiptNumber: 'REC-222222' };

function student(payments: Payment[]): Student {
  return {
    id: 'st1', name: 'Ali Diallo', grade: '9A', studentId: 'MT-2026-101',
    totalDue: 150000, amountPaid: payments.reduce((sum, p) => sum + p.amount, 0),
    parentName: 'Papa Diallo', parentEmail: '', parentPhone: '', dueDate: '2026-12-31',
    notes: '', payments, academicYear: '2026-2027',
  };
}

const sheetProps = (target: Student) => ({
  t, lang: 'fr' as const, currentTheme: theme, student: target, selectedYear: '2026-2027',
  getGradeDisplay: (g: string | undefined) => g ?? '',
  formatDate: (d: string) => d,
  formatCurrency: (n: number) => `${n} FCFA`,
});

/**
 * Le HTML tel qu'il se LIT : le rendu serveur échappe les apostrophes
 * (`&#x27;`), donc une phrase du dictionnaire ne se retrouve jamais telle quelle
 * dans le balisage. Sans ce décodage, un test échouerait sur « L'année »… et
 * passerait en cherchant la mauvaise chaîne.
 */
const readable = (html: string) => html
  .replace(/&#x27;/g, "'")
  .replace(/&quot;/g, '"')
  .replace(/&amp;/g, '&');

const occurrences = (html: string, needle: string) => html.split(needle).length - 1;

describe('état de rapprochement — la fenêtre et le papier disent la même chose', () => {
  it('écrit les mois réglés AVEC leur reçu, les mois dus ET la réserve sur les DEUX faces', () => {
    const target = student([PAID, MUTE]);
    const html = renderToStaticMarkup(createElement(ReconciliationModal, {
      ...sheetProps(target), overlayRef: () => {}, onClose: () => {},
    }));
    const paper = renderToStaticMarkup(createElement(ReconciliationPrint, sheetProps(target)));

    // Ce qui est imprimé doit être ce qui a été relu : chaque face porte les
    // mêmes faits — les noms et les montants se mesurent sans détour (aucune
    // apostrophe), le reçu REC-111111 règle DEUX mois, donc il est nommé sous
    // chacun d'eux, et chaque mois réglé l'est une fois.
    for (const document of [html, paper]) {
      assert.equal(occurrences(document, 'REC-111111'), 2, 'le reçu est nommé sous chaque mois qu’il déclare');
      assert.equal(occurrences(document, 'Septembre'), 1, 'le mois réglé est nommé');
      assert.equal(occurrences(document, 'Novembre'), 1);
      assert.ok(document.includes('MT-2026-101'), 'le matricule identifie la famille');
      assert.ok(document.includes('150000 FCFA'), 'le dû');
      assert.ok(document.includes('75000 FCFA'), 'le versé');
      assert.ok(document.includes('75000 FCFA'), 'et le reste (150 000 − 75 000)');
    }

    // La réserve : la phrase des mois dus la porte, des deux côtés, une fois.
    const reserve = t.reconciliationDueReserved
      .replace('{months}', 'Octobre, Décembre, Janvier, Février, Mars, Avril, Mai, Juin, Juillet, Août')
      .replace('{count}', '1');
    for (const document of [html, paper]) {
      assert.equal(occurrences(document, reserve), 1, 'la phrase des mois dus porte sa réserve');
      assert.equal(
        document.includes(t.reconciliationDueLine.replace('{months}', 'Octobre')),
        false,
        'jamais la formule sèche « Encore dus » quand un reçu est muet',
      );
    }
  });

  it('ne réserve rien quand chaque reçu déclare ses mois', () => {
    const target = student([{ ...PAID, months: ['2026-09', '2026-10', '2026-11', '2026-12'] }]);
    const html = renderToStaticMarkup(createElement(ReconciliationPrint, sheetProps(target)));
    assert.ok(readable(html).includes(t.reconciliationDueLine.replace('{months}', 'Janvier, Février, Mars, Avril, Mai, Juin, Juillet, Août')), html);
    assert.equal(html.includes('sous réserve'), false);
  });

  it('dit qu’aucun reçu n’existe plutôt que d’accuser les douze mois', () => {
    const html = renderToStaticMarkup(createElement(ReconciliationPrint, sheetProps(student([]))));
    assert.ok(readable(html).includes(t.reconciliationNoReceipts), html);
  });

  it('ne nomme aucun mois quand l’année est illisible, et le dit', () => {
    const html = renderToStaticMarkup(createElement(ReconciliationPrint, sheetProps({ ...student([PAID]), academicYear: 'nope' })));
    assert.ok(readable(html).includes(t.reconciliationNoYear), html);
    assert.equal(html.includes('Septembre'), false, 'pas de mois inventé');
  });

  it('le papier seul s’imprime hors coquille, la fenêtre ne s’imprime pas', () => {
    const target = student([PAID]);
    const html = renderToStaticMarkup(createElement(ReconciliationModal, {
      ...sheetProps(target), overlayRef: () => {}, onClose: () => {},
    }));
    const paper = renderToStaticMarkup(createElement(ReconciliationPrint, sheetProps(target)));
    assert.match(html, /no-print/, 'la fenêtre se retire de l’impression');
    assert.match(paper, /hidden print:block/, 'le papier est le seul bloc imprimé');
    assert.match(paper, /print-reconciliation-container/);
    assert.doesNotMatch(paper, /role="dialog"/, 'le papier n’est pas une fenêtre');
  });
});

describe('état de rapprochement — le geste depuis la fiche élève', () => {
  function mountDetails(onReconcile?: () => void) {
    installDomGlobals();
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    act(() => root.render(createElement(StudentDetailsModal, {
      student: student([PAID]), t, lang: 'fr' as const, currentTheme: theme,
      formatDate: (d: string) => d, formatCurrency: (n: number) => `${n} FCFA`,
      getGradeDisplay: (g: string | undefined) => g ?? '', generatePaymentReceiptPdf: async () => {},
      currentUser: { name: 'Admin', role: 'admin' }, copyToClipboard: () => {}, handleSaveNote: async () => {},
      studentDetailTab: 'general' as const, setStudentDetailTab: () => {}, selectedYear: '2026-2027',
      overlayRef: () => {}, onClose: () => {}, onEdit: () => {}, onPrint: () => {}, onDeleteRequest: () => {},
      canDelete: false, canDeletePayment: false, onDeletePayment: async () => true,
      canEditPaymentMonths: false, onUpdatePaymentMonths: async () => true,
      onReconcile,
    })));
    return {
      container,
      button: () => container.querySelector<HTMLButtonElement>('[data-slot="student-reconciliation-open"]'),
      cleanup: () => { act(() => root.unmount()); container.remove(); },
    };
  }

  it('offre l’état de rapprochement, étiqueté, à côté de l’impression de la fiche', () => {
    let calls = 0;
    const h = mountDetails(() => { calls += 1; });
    try {
      const button = h.button();
      assert.ok(button, 'le bouton doit exister quand la fiche sait où ouvrir l’état');
      assert.equal(button.textContent, t.reconciliationOpen, 'le libellé est celui du dictionnaire');
      assert.ok(h.container.textContent?.includes(t.printStudentFile), 'l’impression de la fiche reste offerte');
      act(() => button.click());
      assert.equal(calls, 1, 'le clic ouvre l’état');
    } finally { h.cleanup(); }
  });

  it('n’offre rien quand la fiche est montée sans ce geste', () => {
    const h = mountDetails();
    try {
      assert.equal(h.button(), null, 'une fiche sans destinataire n’affiche pas un bouton qui ne mène nulle part');
    } finally { h.cleanup(); }
  });
});
