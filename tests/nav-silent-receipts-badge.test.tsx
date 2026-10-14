// LA PASTILLE DES REÇUS MUETS, SUR LES DEUX NAVIGATIONS.
//
// L'onglet « Reçus muets » n'annonçait RIEN : il fallait l'ouvrir pour savoir
// combien de reçus attendent, alors que le travail du comptoir se voit depuis
// n'importe quelle page — c'est justement l'onglet qu'on ouvre quand on a un
// moment. Le retard de la Paie porte une pastille depuis toujours ; celle-ci
// reprend sa forme, avec un NOMBRE.
//
// Ce que cette suite tient, et qui peut casser en silence :
//
//   • **le NOMBRE, pas un point** — un point dit « il y a quelque chose » ; ici la
//     question posée est « combien ». Le chiffre est donc rendu, et il vaut celui
//     que la brique pure de l'école calcule (`silentReceiptsRows` →
//     `silentReceiptsCatchUp().receipts`) — pas un compte parallèle ;
//   • **un nom ACCESSIBLE qui dit ce qui est compté** — « 4 » à côté d'un onglet
//     se lirait comme quatre élèves, quatre parents ou quatre messages. Le nom
//     (`aria-label`) est la phrase traduite, et c'est elle que porte le rail
//     comme la barre du bas ;
//   • **le zéro est MUET** — un onglet qui n'a rien à annoncer ne se décore pas
//     d'un « 0 » : ni sur le rail, ni sur le mobile, ni à défaut de valeur ;
//   • **les DEUX surfaces la portent** — rater le rail, c'est rater les postes de
//     bureau ; rater la barre du bas, c'est rater le terrain.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { act, createElement } from 'react';
import type { ReactElement } from 'react';
import { createRoot } from 'react-dom/client';

import { translations } from '../src/i18n/translations';
import { Sidebar } from '../src/components/Sidebar';
import { MobileNav } from '../src/components/MobileNav';
import type { CurrentTheme, PayrollWindowStatus } from '../src/app/mainViewsProps';
import type { Payment, Student } from '../src/lib/domainTypes';
import { silentReceiptRows, silentReceiptsCatchUp } from '../src/lib/silentReceipts';
import { installDomGlobals } from './harness';

const t = translations.fr;
const YEAR = '2026-2027';
const TODAY = '2026-10-20';

const theme: CurrentTheme = {
  bg: 'bg-slate-100', card: 'bg-white', text: 'text-slate-900', muted: 'text-slate-500',
  border: 'border-slate-200', header: '#0F172A', sidebar: 'bg-slate-800',
  accent: 'text-blue-600', accentBg: 'accent-surface', accentText: 'accent-surface-text',
  accentHover: 'accent-surface-hover', accentGroupHover: 'accent-group-hover', accentShadow: 'accent-shadow',
  accentSoft: 'accent-soft-surface', accentSoftText: 'accent-soft-text', accentSoftHover: 'accent-soft-hover',
  accentSoftTextHover: 'accent-soft-text-hover',
  accentHex: '#2563EB', accentHexDeep: '#1D4ED8', accentRing: 'accent-ring', inkStrong: 'text-slate-800',
  accentBorder: 'accent-border', accentBorderHover: 'accent-border-hover', surfaceInset: 'bg-slate-50',
  accentSoftDark: 'accent-soft-surface', accentSoftDarkHover: 'accent-soft-hover',
  accentSoftDarkText: 'accent-on-dark-text',
  tableHeader: 'bg-slate-50', rowHover: 'hover:bg-slate-50', input: 'bg-white', isDark: false,
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

const windowStatus = (): PayrollWindowStatus => ({
  currentDay: 5,
  currentCalendarYear: 2026,
  currentCalendarMonth: 8,
  totalPaidCurrentMonth: 0,
  isOverdue: false,
  isOpen: true,
});

const silent = (id: string, date: string, amount: number): Payment => ({ id, date, amount });
const declared = (id: string, date: string, amount: number, months: string[]): Payment =>
  ({ id, date, amount, months });

const student = (id: string, payments: Payment[]): Student => ({
  id,
  name: `Élève ${id}`,
  parentName: `Parent ${id}`,
  parentEmail: '',
  parentPhone: '',
  totalDue: 150000,
  amountPaid: payments.reduce((sum, p) => sum + p.amount, 0),
  dueDate: '2027-06-30',
  notes: '',
  payments,
  grade: '3A',
  academicYear: YEAR,
});

/**
 * Trois reçus muets chez deux élèves, plus un reçu qui déclare ses mois — donc
 * le travail de l'école vaut 3, pas 4, et pas 2 non plus (deux élèves portent,
 * mais trois reçus attendent).
 */
const STUDENTS: Student[] = [
  student('st-1', [silent('p1', '2026-09-15', 10000), silent('p2', '2026-10-12', 30000)]),
  student('st-2', [silent('p3', '2026-09-20', 25000), declared('p4', '2026-11-04', 60000, ['2026-10'])]),
];

const badgeLabel = (count: number) => t.silentReceiptsBadge.replace('{count}', String(count));

describe('La pastille des reçus muets — le nombre de reçus qui attendent', () => {
  const win = installDomGlobals();

  const mount = async (element: ReactElement) => {
    const container = win.document.createElement('div');
    win.document.body.appendChild(container);
    const root = createRoot(container as unknown as Element);
    await act(async () => { root.render(element); });
    return {
      container: container as unknown as Element,
      /** La pastille, par son NOM accessible — jamais par le chiffre rendu. */
      badge: (label: string) => (container as unknown as Element).querySelector(`[aria-label="${label}"]`),
      unmount: async () => { await act(async () => root.unmount()); container.remove(); },
    };
  };

  const renderSidebar = (count?: number) => createElement(Sidebar, {
    t,
    schoolLogo: null,
    currentTheme: theme,
    activeTab: 'dashboard',
    setActiveTab: () => {},
    payrollWindowStatus: windowStatus(),
    currentUser: { username: 'ibrahim', role: 'staff' },
    fetchAuditLogs: () => {},
    showTodoSidebar: false,
    setShowTodoSidebar: () => {},
    onSignOut: () => {},
    onToggleLanguage: () => {},
    onAddStudent: () => {},
    onAddCr: () => {},
    onRecordPayment: () => {},
    ...(count === undefined ? {} : { silentReceiptsCount: count }),
  });

  const renderMobile = (count?: number) => createElement(MobileNav, {
    t,
    activeTab: 'dashboard',
    setActiveTab: () => {},
    payrollWindowStatus: windowStatus(),
    onToggleLanguage: () => {},
    currentUser: { role: 'staff' },
    ...(count === undefined ? {} : { silentReceiptsCount: count }),
  });

  it('porte le CHIFFRE de l’école, et le dit en mots, sur le rail comme sur la barre du bas', async () => {
    // Le chiffre attendu n'est pas écrit ici : il est CALCULÉ par la brique pure
    // de l'écran École, donc la pastille ne peut pas annoncer un compte que la
    // liste contredirait.
    const count = silentReceiptsCatchUp(silentReceiptRows(STUDENTS, YEAR), TODAY).receipts;
    assert.equal(count, 3, 'les données du cas portent bien trois reçus muets (et un reçu déjà déclaré)');

    for (const [surface, element] of [['rail', renderSidebar(count)], ['barre du bas', renderMobile(count)]] as const) {
      const h = await mount(element);
      try {
        const badge = h.badge(badgeLabel(count));
        assert.ok(badge, `${surface} : la pastille est rendue`);
        assert.equal(badge?.textContent?.trim(), String(count),
          `${surface} : elle porte le NOMBRE, pas seulement un point`);
        assert.equal(badge?.className.includes('animate-badge-pulse'), true,
          `${surface} : elle pulse comme la pastille de retard de la Paie`);
      } finally {
        await h.unmount();
      }
    }
  });

  it('ne s’affiche PAS quand il ne reste rien — ni à zéro, ni sans valeur', async () => {
    // Le silence est la bonne forme : une pastille « 0 » annoncerait un travail
    // qui n'existe plus, et un onglet décoré en permanence ne se lit plus.
    for (const surface of ['rail', 'barre du bas'] as const) {
      const render = surface === 'rail' ? renderSidebar : renderMobile;
      for (const count of [0, undefined]) {
        const h = await mount(render(count as number | undefined));
        try {
          assert.equal(h.badge(badgeLabel(0)), null,
            `${surface} : aucune pastille pour ${String(count)}`);
          assert.equal(h.container.querySelectorAll('[aria-label*="rattraper"]').length, 0,
            `${surface} : aucune pastille du tout — le nom accessible est absent aussi`);
        } finally {
          await h.unmount();
        }
      }
    }
  });

  it('l’onglet garde son libellé et reste cliquable — la pastille ne remplace rien', async () => {
    // Le rail aligne ses lignes sur leur libellé (`pl-4`, `py-2.5`, libellé
    // `font-semibold text-sm`) : une pastille qui prendrait la place du texte, ou
    // qui ferait grandir la ligne, casserait la colonne du rail.
    const h = await mount(renderSidebar(3));
    try {
      const label = h.badge(badgeLabel(3))?.parentElement?.querySelector('span.font-semibold.text-sm');
      assert.ok(label, 'le libellé de l’onglet est toujours là');
      assert.equal(label?.textContent, t.navSilentReceipts, 'et c’est bien « Reçus muets »');
      const line = h.badge(badgeLabel(3))?.parentElement;
      assert.equal(line?.tagName, 'BUTTON', 'la pastille vit DANS la ligne de l’onglet');
      assert.equal(line?.className.includes('pl-4'), true, 'et la ligne garde sa mise en page du rail');
    } finally {
      await h.unmount();
    }
  });
});
