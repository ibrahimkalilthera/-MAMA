// LE PARCOURS DE RATTRAPAGE des reçus muets, depuis la fiche de l'élève.
//
// La fiche savait déjà COMPTER les reçus muets (la phrase ambre) et en renseigner
// UN (le bouton par ligne du carnet). Ce que ces tests tiennent, c'est ce qui
// manquait : la LISTE, l'ORDRE, et l'ENCHAÎNEMENT. Quatre choses y sont
// vérifiées, et chacune a une façon de casser en silence :
//
//   • la liste ne contient QUE les reçus qui ne déclarent aucun mois — un reçu
//     qui déclare déjà les siens n'a rien à y faire (l'écraser serait un autre
//     geste, pas celui-ci), et il est rangé du PLUS ANCIEN au plus récent : un
//     rattrapage se fait dans l'ordre du calendrier, pas dans celui des clics ;
//   • le COMPTEUR suit le reçu ouvert (« reçu 1 sur 2 »), parce que c'est ce qui
//     dit à l'école où elle en est ;
//   • un enregistrement RÉUSSI ouvre le SUIVANT, et le dernier referme le
//     parcours : c'est « un par un », la demande même ;
//   • un enregistrement REFUSÉ ne fait rien avancer — l'éditeur reste OUVERT sur
//     le même reçu, le mois coché reste coché (le toast a dit pourquoi) ;
//
// et une garde de forme, parce que c'est le défaut qui guette dès qu'on ajoute
// une seconde porte vers le même éditeur : **un seul éditeur à la fois**. Le
// parcours et le carnet ouvrent le MÊME composant ; deux hôtes afficheraient
// vingt-quatre pastilles au lieu de douze, et le pixel-check E2E
// (`scripts/verify-pdf-download.mjs`, mode `recu-muet`) ne saurait plus quel
// éditeur il juge.
//
// Le harnais REND la mise à jour que l'application fait vraiment : depuis
// `updatePaymentMonths` (src/lib/dataOps/payments.ts), un succès met à jour
// l'état local (`{ ...p, months }`), donc le reçu quitte la liste des muets.
// Un test qui garderait la fiche figée sur ses props d'origine ne verrait jamais
// le parcours se vider, et se féliciterait d'un enchaînement qui n'enchaîne rien.
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
};

// Les trois reçus vivent dans l'année scolaire affichée (« 2026-2027 » : de
// septembre 2026 à août 2027), donc les mois cochés sur les pastilles
// (`t.sep` → `2026-09`, `t.oct` → `2026-10`) sont bien ceux de l'éditeur.
/** Le reçu muet le PLUS ANCIEN — c'est lui qu'on rattrape en premier. */
const MUTE_OLD: Payment = { id: 'pay-old', date: '2026-09-15', amount: 10000, receiptNumber: 'REC-OLD' };
/** Le reçu muet le plus récent. */
const MUTE_NEW: Payment = { id: 'pay-new', date: '2026-10-10', amount: 20000, receiptNumber: 'REC-NEW' };
/** Un reçu qui déclare DÉJÀ ses mois : il n'a rien à faire dans le parcours. */
const TICKED: Payment = { id: 'pay-ok', date: '2026-11-04', amount: 30000, receiptNumber: 'REC-OK', months: ['2026-09'] };

/**
 * Les paiements sont donnés dans le DÉSORDRE (un reçu déjà renseigné au milieu,
 * et le plus récent avant le plus ancien) : la liste du parcours doit sortir
 * rangée par date, et sans le reçu qui déclare ses mois.
 */
const BASE: Student = {
  id: 'st1', name: 'Ali Diallo', grade: '1A', studentId: 'MT-2026-101',
  totalDue: 150000, amountPaid: 60000, parentName: 'Papa Diallo', parentEmail: '',
  parentPhone: '', dueDate: '2026-12-31', notes: '',
  payments: [TICKED, MUTE_NEW, MUTE_OLD],
  academicYear: '2026-2027',
};

/** Un élève dont AUCUN reçu n'est muet : le parcours n'a rien à faire. */
const ALL_TICKED: Student = { ...BASE, payments: [TICKED] };

function mount(opts: {
  canEditPaymentMonths?: boolean;
  student?: Student;
  result?: boolean;
  /** Le reçu qu'un AUTRE écran (l'écran École des reçus muets) demande d'ouvrir. */
  focusPaymentId?: string | null;
}) {
  installDomGlobals();
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  const calls: { studentId: string; paymentId: string; months: string[] }[] = [];
  let student = opts.student ?? BASE;

  // La fiche est rendue à partir de CETTE variable : un succès la met à jour
  // comme le fait `updatePaymentMonths` (l'état local, pas le disque), puis la
  // modale est re-rendue. Sans ça, le reçu renseigné resterait dans la liste et
  // l'enchaînement ne serait jamais observé.
  const render = () => root.render(createElement(StudentDetailsModal, {
    student,
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
    focusPaymentId: opts.focusPaymentId ?? null,
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
      const ok = opts.result ?? true;
      if (ok) {
        student = {
          ...student,
          payments: student.payments.map((p) => (p.id === payment.id ? { ...p, months: [...months] } : p)),
        };
        act(() => render());
      }
      return ok;
    },
  }));

  act(() => render());

  const buttons = () => Array.from(container.querySelectorAll('button'));
  const buttonWithText = (label: string) =>
    buttons().find((b) => (b.textContent ?? '').trim() === label) ?? null;
  const click = (el: Element) => act(() => { (el as HTMLElement).click(); });
  const slot = (name: string) => container.querySelector(`[data-slot="${name}"]`);
  const slots = (name: string) => Array.from(container.querySelectorAll(`[data-slot="${name}"]`));
  const text = (el: Element | null) => (el?.textContent ?? '').trim();

  return {
    container,
    calls,
    click,
    /** La racine du parcours — absente quand il n'y a rien à rattraper. */
    panel: () => slot('payment-months-backfill'),
    /** La ligne de progression, lue par son marqueur (jamais par ses mots). */
    progress: () => text(slot('payment-months-backfill-progress')),
    /** Les lignes du parcours, avec le reçu qu'elles portent (`data-receipt`). */
    rows: () => Array.from(container.querySelectorAll('[data-slot="payment-months-backfill"] [data-receipt]'))
      .map((el) => ({ id: el.getAttribute('data-receipt') ?? '', text: text(el) })),
    /** Les actions « Renseigner » DU PARCOURS. */
    fills: () => slots('payment-months-backfill-fill') as HTMLButtonElement[],
    /** Les actions « Renseigner les mois » DU CARNET, distinctes des précédentes. */
    ledgerFills: () => slots('payment-months-fill') as HTMLButtonElement[],
    /** Le nombre d'ÉDITEURS rendus — doit valoir 1, jamais 2. */
    editors: () => slots('payment-months-editor').length,
    /** Les pastilles de l'éditeur : les seuls boutons `aria-pressed`. */
    chips: () => Array.from(container.querySelectorAll('button[aria-pressed]')),
    chip: (label: string) => buttons().find((b) => b.getAttribute('aria-pressed') !== null && text(b) === label) ?? null,
    save: () => buttonWithText(t.paymentMonthsSave) as HTMLButtonElement | null,
    cancel: () => buttonWithText(t.cancel),
    text: () => container.textContent ?? '',
    note: () => slot('student-months-undeclared'),
    cleanup: () => { act(() => root.unmount()); container.remove(); },
  };
}

describe('StudentDetailsModal — le parcours de rattrapage des reçus muets', () => {
  it('liste les muets du plus ancien au plus récent, et RIEN d’autre', () => {
    const h = mount({});
    try {
      assert.ok(h.panel(), 'le parcours est offert dès qu’un reçu ne déclare aucun mois');
      assert.deepEqual(h.rows().map((r) => r.id), ['pay-old', 'pay-new'],
        'les deux muets, rangés par date — le reçu déjà renseigné n’y est pas');
      assert.ok(h.rows()[0]!.text.includes('2026-09-15') && h.rows()[0]!.text.includes('REC-OLD'),
        'la ligne dit la date et le numéro du reçu');
      assert.ok(h.rows()[1]!.text.includes('2026-10-10'), 'la plus récente vient après');
      assert.equal(h.rows().filter((r) => r.id === 'pay-ok').length, 0,
        'un reçu qui déclare ses mois n’a rien à faire dans un rattrapage');
      assert.equal(h.fills().length, 2, 'chaque ligne du parcours offre son geste');
      assert.equal(h.ledgerFills().length, 2,
        'le geste direct du carnet reste en place : le parcours ne le remplace pas');
    } finally {
      h.cleanup();
    }
  });

  it('le compteur dit ce qui reste, puis où l’on en est', () => {
    const h = mount({});
    try {
      assert.equal(h.progress(), t.paymentMonthsBackfillRemaining.replace('{count}', '2'),
        'rien d’ouvert : le parcours dit combien il reste');
      h.click(h.fills()[0]!);
      assert.equal(h.progress(), t.paymentMonthsBackfillProgress.replace('{current}', '1').replace('{total}', '2'),
        'le premier reçu ouvert : « reçu 1 sur 2 »');
    } finally {
      h.cleanup();
    }
  });

  it('un seul éditeur à la fois — jamais vingt-quatre pastilles', () => {
    const h = mount({});
    try {
      h.click(h.fills()[0]!);
      assert.equal(h.editors(), 1, 'le parcours ouvre UN éditeur, pas un par hôte');
      assert.equal(h.chips().length, 12,
        'douze mois, pas vingt-quatre : le carnet a rendu sa ligne au parcours');
    } finally {
      h.cleanup();
    }
  });

  it('un succès ouvre le SUIVANT, et le dernier referme le parcours', async () => {
    const h = mount({ result: true });
    try {
      h.click(h.fills()[0]!);
      h.click(h.chip(t.sep)!);
      await act(async () => { h.save()!.click(); });

      assert.deepEqual(h.calls, [{ studentId: 'st1', paymentId: 'pay-old', months: ['2026-09'] }],
        'le reçu le PLUS ANCIEN part en premier, avec son mois coché');
      assert.equal(h.editors(), 1, 'l’éditeur est resté ouvert — sur le reçu suivant');
      assert.deepEqual(h.rows().map((r) => r.id), ['pay-new'],
        'le reçu renseigné a quitté la liste : il n’est plus muet');
      assert.equal(h.progress(), t.paymentMonthsBackfillProgress.replace('{current}', '1').replace('{total}', '1'),
        'le parcours compte ce qui RESTE, pas ce qui était');

      h.click(h.chip(t.oct)!);
      await act(async () => { h.save()!.click(); });

      assert.deepEqual(h.calls.map((c) => c.paymentId), ['pay-old', 'pay-new'],
        'le second reçu, et lui seul, est parti ensuite');
      assert.deepEqual(h.calls.map((c) => c.months), [['2026-09'], ['2026-10']],
        'et chacun avec le mois qui lui a été coché');
      assert.equal(h.panel(), null, 'plus aucun muet : le parcours a disparu');
      assert.equal(h.fills().length, 0, 'et son geste avec lui');
      assert.equal(h.note(), null, 'la fiche ne compte plus de reçu sans mois déclaré');
    } finally {
      h.cleanup();
    }
  });

  it('un refus laisse l’éditeur OUVERT sur le même reçu, sans avancer', async () => {
    const h = mount({ result: false });
    try {
      h.click(h.fills()[0]!);
      h.click(h.chip(t.sep)!);
      await act(async () => { h.save()!.click(); });

      assert.equal(h.calls.length, 1, 'le geste a bien été tenté');
      assert.ok(h.save(), 'l’éditeur reste ouvert : un échec ne referme rien');
      assert.equal(h.chip(t.sep)?.getAttribute('aria-pressed'), 'true', 'le mois coché est toujours coché');
      assert.equal(h.progress(), t.paymentMonthsBackfillProgress.replace('{current}', '1').replace('{total}', '2'),
        'le parcours n’a PAS avancé : il est toujours sur le premier');
      assert.deepEqual(h.rows().map((r) => r.id), ['pay-old', 'pay-new'],
        'et le reçu refusé reste dans la liste, à sa place');
    } finally {
      h.cleanup();
    }
  });

  it('annuler referme sans rien écrire et sans avancer', () => {
    const h = mount({});
    try {
      h.click(h.fills()[0]!);
      h.click(h.chip(t.sep)!);
      h.click(h.cancel()!);

      assert.equal(h.calls.length, 0, 'annuler n’écrit rien');
      assert.equal(h.editors(), 0, 'l’éditeur est refermé');
      assert.equal(h.progress(), t.paymentMonthsBackfillRemaining.replace('{count}', '2'),
        'rien n’a bougé : les deux reçus restent à faire');
    } finally {
      h.cleanup();
    }
  });

  it('sans droit d’écriture, pas de parcours — mais la fiche compte toujours', () => {
    const h = mount({ canEditPaymentMonths: false });
    try {
      assert.equal(h.panel(), null, 'aucun parcours : la policy UPDATE ne l’ouvre pas à ce rôle');
      assert.equal(h.fills().length, 0, 'ni ligne, ni geste');
      assert.equal(h.ledgerFills().length, 0, 'ni le geste direct du carnet');
      // La phrase ambre, elle, reste : elle ne promet aucun geste, elle dit ce
      // que la fiche sait de la couverture — et elle continue de le dire.
      assert.ok(h.note(), 'la fiche dit toujours quels reçus ne déclarent rien');
      assert.ok(h.text().includes(t.monthsUndeclaredNote.replace('{count}', '2')),
        'et elle les compte');
    } finally {
      h.cleanup();
    }
  });

  // ─── Le FOCUS venu d'un autre écran ────────────────────────────────────────
  // L'écran École des reçus muets n'a pas d'éditeur à lui : il ouvre la fiche SUR
  // un reçu (`focusPaymentId`), et c'est la fiche qui ouvre son éditeur. Trois
  // façons de rater ce geste, toutes mesurées ici : ouvrir le mauvais reçu,
  // ouvrir un reçu qui n'est pas muet, ou rouvrir un éditeur que l'école a fermé.

  it('le focus ouvre l’éditeur sur LE reçu demandé, pas sur le premier de la liste', async () => {
    const h = mount({ focusPaymentId: 'pay-new' });
    try {
      assert.equal(h.editors(), 1, 'l’éditeur s’ouvre sans clic : la fiche naît avec son focus');
      assert.equal(h.chips().length, 12, 'et c’est bien un éditeur de mois');
      assert.ok(
        !h.rows().find((r) => r.id === 'pay-new')!.text.includes('2026-10-10'),
        'la ligne du reçu demandé porte l’éditeur — sa date a laissé la place aux pastilles',
      );
      assert.ok(
        h.rows().find((r) => r.id === 'pay-old')!.text.includes('2026-09-15'),
        'et le reçu plus ANCIEN reste à sa place, intact',
      );

      // La preuve par l’écriture : c’est le reçu DEMANDÉ qui part, avec son mois.
      h.click(h.chip(t.oct)!);
      await act(async () => { h.save()!.click(); });
      assert.deepEqual(h.calls, [{ studentId: 'st1', paymentId: 'pay-new', months: ['2026-10'] }],
        'le geste porte sur le reçu demandé, et lui seul');
    } finally {
      h.cleanup();
    }
  });

  it('un focus périmé n’ouvre rien : ni un reçu déjà renseigné, ni celui d’un autre élève', () => {
    for (const focus of ['pay-ok', 'pay-inexistant']) {
      const h = mount({ focusPaymentId: focus });
      try {
        assert.equal(h.editors(), 0, `« ${focus} » n’est pas un muet de cet élève : aucun éditeur`);
        assert.deepEqual(h.rows().map((r) => r.id), ['pay-old', 'pay-new'],
          'et le parcours affiche toujours ses deux reçus, intacts');
      } finally {
        h.cleanup();
      }
    }
  });

  it('sans droit d’écrire les mois, le focus n’ouvre rien — la fiche s’affiche', () => {
    const h = mount({ focusPaymentId: 'pay-old', canEditPaymentMonths: false });
    try {
      assert.equal(h.editors(), 0, 'la base ne l’ouvre pas à ce rôle : l’éditeur ne s’ouvre pas non plus');
      assert.equal(h.panel(), null, 'ni le parcours');
    } finally {
      h.cleanup();
    }
  });

  it('le focus est consommé UNE fois : enregistrer n’ouvre pas un second éditeur', async () => {
    const h = mount({ focusPaymentId: 'pay-old' });
    try {
      h.click(h.chip(t.sep)!);
      await act(async () => { h.save()!.click(); });
      // Le reçu vient de quitter les muets ; l’éditeur doit être resté sur le
      // SUIVANT (l’enchaînement du parcours), et sur un seul — pas rouvert sur
      // celui qu’on vient d’écrire.
      assert.equal(h.editors(), 1, 'un seul éditeur, jamais deux');
      assert.deepEqual(h.rows().map((r) => r.id), ['pay-new'], 'le reçu écrit n’est plus muet');
    } finally {
      h.cleanup();
    }
  });

  it('aucun reçu muet : aucun parcours à offrir', () => {
    const h = mount({ student: ALL_TICKED });
    try {
      assert.equal(h.panel(), null, 'il n’y a rien à rattraper : pas de panneau vide');
      assert.equal(h.note(), null, 'et plus rien ne compte de reçus muets');
    } finally {
      h.cleanup();
    }
  });
});
