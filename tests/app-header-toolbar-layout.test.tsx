/**
 * AppHeader — le titre et la barre d'actions ne partagent JAMAIS une ligne.
 *
 * Le défaut était mesuré, pas deviné : à `xl:flex-row` (1280 px, boîte de
 * contenu 928 px, rail 256 px + rembourrage 96 px), le bloc de titre était
 * comprimé à **113,4 px** — « Gestion / des / Élèves » sur **trois** lignes —,
 * la date venait buter contre le champ de recherche, et « Ajouter Crèches »
 * finissait seul sur une troisième rangée de la barre. Le passage côte à côte
 * n'était pas qu'un peu trop tôt : à 1536 px le titre ne tenait encore que
 * **145,6 px sur deux lignes**, alors que la barre seule réclame ~1300 px pour
 * ses huit commandes. Reculer le palier n'aurait donc rien réglé.
 *
 * Une suite happy-dom ne mesure pas de mise en page : ce qui se vérifie ici est
 * le CONTRAT que la mesure a validé dans le navigateur — deux blocs empilés
 * (jamais `flex-row`, à aucun palier), barre pleine largeur qui se replie sur
 * ses propres rangées, et l'intégralité des commandes de l'onglet dans la
 * barre (le repli ne peut donc jamais passer par-dessus le titre).
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';

import { translations } from '../src/i18n/translations';
import type { TranslationDict } from '../src/i18n/translations';
import type { CurrentTheme, ManagedClass } from '../src/app/mainViewsProps';
import type { User } from '../src/app/types';
import { DEFAULT_SCHOOL_CLASSES } from '../src/app/types';
import { AppHeader } from '../src/components/AppHeader';
import { installDomGlobals } from './harness';

const t = translations.fr as TranslationDict;

const win = installDomGlobals({
  extra: {
    requestAnimationFrame: (cb: FrameRequestCallback): number =>
      setTimeout(() => cb(performance.now()), 16) as unknown as number,
    cancelAnimationFrame: (id: number): void => clearTimeout(id),
  },
});
Object.defineProperty(globalThis, 'MouseEvent', { value: win.MouseEvent, configurable: true, writable: true });
// Le ticker WAAPI de happy-dom n'avance jamais : les animations de la cloche
// (montée par l'en-tête) sont donc résolues instantanément.
const finishedAnimation = {
  finished: Promise.resolve(),
  currentTime: 0,
  playState: 'finished',
  effect: null,
  onfinish: null,
  oncancel: null,
  play: () => {},
  pause: () => {},
  cancel: () => {},
  finish: () => {},
  reverse: () => {},
  commitStyles: () => {},
  addEventListener: () => {},
  removeEventListener: () => {},
};
win.Element.prototype.animate = (() => finishedAnimation) as unknown as typeof win.Element.prototype.animate;
win.Element.prototype.getAnimations = (() => []) as unknown as typeof win.Element.prototype.getAnimations;
(win.HTMLElement.prototype as { animate?: unknown }).animate = finishedAnimation;

const theme: CurrentTheme = {
  bg: 'bg-slate-100', card: 'bg-white', input: 'bg-white', text: 'text-slate-800',
  muted: 'text-slate-500', border: 'border-slate-200', header: 'bg-slate-800',
  sidebar: 'bg-slate-900', accent: 'text-blue-600', accentBg: 'bg-blue-600',
  accentText: 'text-white', accentHover: 'hover:bg-blue-700', accentGroupHover: 'accent-group-hover',
  accentShadow: 'shadow-blue-500/20', accentSoft: 'bg-blue-50', accentSoftText: 'text-blue-600',
  accentSoftHover: 'hover:bg-blue-100', accentSoftTextHover: 'hover:text-blue-700',
  accentHex: '#2563EB', accentHexDeep: '#1D4ED8', accentRing: 'focus:ring-blue-500/20',
  accentBorder: 'border-slate-300', accentBorderHover: 'hover:border-slate-400',
  surfaceInset: 'bg-slate-50', inkStrong: 'text-slate-800', accentSoftDark: 'bg-blue-500/15',
  accentSoftDarkHover: 'hover:bg-blue-500/25', accentSoftDarkText: 'text-blue-300',
  tableHeader: 'bg-slate-50', isDark: false, rowHover: 'hover:bg-slate-50',
  hoverSurface: 'state-hover', hoverSurfaceSolid: 'state-hover-solid',
  hoverSurfaceStrong: 'state-hover-strong', hoverSurfaceDark: 'state-hover-dark',
  hoverSurfaceClear: 'state-hover-clear', hoverAccent: 'state-accent-hover',
  hoverAccentGroupInk: 'state-accent-group-ink', hoverAlert: 'state-alert-hover',
  hoverAlertTint: 'state-alert-tint', hoverAlertSolid: 'state-alert-solid',
  hoverAlertDark: 'state-alert-dark', hoverAlertPlate: 'state-alert-plate',
};

const admin: User = { username: 'ibrahim', role: 'admin' };
const noop = () => {};

function mount(): { header: HTMLElement; titleBlock: HTMLElement; bar: HTMLElement; root: ReturnType<typeof createRoot>; container: HTMLElement } {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(
      createElement(AppHeader, {
        t, lang: 'fr', currentTheme: theme, activeTab: 'students', currentUser: admin,
        selectedYear: '2026-2027', setSelectedYear: noop, academicYears: ['2026-2027'],
        availableClasses: DEFAULT_SCHOOL_CLASSES as ManagedClass[],
        searchTerm: '', setSearchTerm: noop, studentGradeFilter: 'all', setStudentGradeFilter: noop,
        onPromoteClass: noop, onImportExcel: noop, onOpenMonthlyDraft: noop,
        onAddStudent: noop, onAddCr: noop, onPrintReport: noop, onExportLate: noop,
        onFinancialReportPdf: noop, notifications: [], onOpenStudent: noop,
        readNotificationIds: [], deletedNotificationIds: [],
        onMarkNotificationRead: noop, onMarkAllNotificationsRead: noop,
        onMarkNotificationUnread: noop, onDeleteNotification: noop,
        onClearAllNotifications: noop, onRestoreDeletedNotifications: noop,
        onOpenCalendarDate: noop, onOpenPayroll: noop, onOpenSettings: noop,
      }),
    );
  });
  const header = container.querySelector('[data-slot="app-header"]') as HTMLElement;
  assert.ok(header, 'l’en-tête est rendu sous son créneau de données');
  const [titleBlock, bar] = Array.from(header.children) as HTMLElement[];
  assert.ok(titleBlock && bar, 'l’en-tête porte exactement deux blocs : titre, puis actions');
  return { header, titleBlock, bar, root, container };
}

function unmount(m: { root: ReturnType<typeof createRoot>; container: HTMLElement }) {
  act(() => m.root.unmount());
  document.body.removeChild(m.container);
}

describe('AppHeader — le titre garde sa ligne, la barre se replie sur les siennes', () => {
  it('les deux blocs sont empilés : aucun palier ne les remet côte à côte', () => {
    const m = mount();
    const cls = m.header.className;

    assert.ok(cls.includes('flex-col'), 'l’en-tête empile ses deux blocs');
    assert.ok(
      !/(^|\s)[^\s]*:?flex-row(\s|$)/.test(cls),
      'aucune variante de palier ne rallume l’affichage côte à côte (`xl:flex-row` a écrasé le titre à 113 px)',
    );
    // `items-start` laissait chaque bloc se réduire à son contenu : le titre
    // n'avait alors plus la largeur de la ligne pour lui.
    assert.ok(!cls.includes('items-start'), 'les blocs s’étirent sur la ligne entière');
    assert.equal(m.header.children.length, 2, 'deux blocs, deux lignes possibles');
    unmount(m);
  });

  it('la barre est pleine largeur, compressible, et sait se replier', () => {
    const m = mount();

    assert.ok(m.bar.className.includes('w-full'), 'la barre occupe la largeur de l’en-tête');
    assert.ok(m.bar.className.includes('min-w-0'), 'la barre accepte de rétrécir au lieu de pousser le titre');
    assert.ok(m.bar.className.includes('flex-wrap'), 'les commandes se replient en rangées');
    assert.ok(!m.bar.className.includes('xl:w-auto'), 'la barre ne reprend plus la largeur « au contenu » au palier xl');

    const h2 = m.titleBlock.querySelector('h2');
    assert.ok(h2, 'le titre est dans le premier bloc');
    assert.ok(!h2!.className.includes('truncate'), 'le titre ne se coupe pas : il a la place de tenir');
    assert.ok(m.titleBlock.className.includes('min-w-0'), 'le bloc titre ne peut pas déborder la ligne');
    unmount(m);
  });

  it('les huit commandes de l’onglet Élèves vivent dans la barre, aucune dans le bloc titre', () => {
    const m = mount();

    const inBar = Array.from(m.bar.querySelectorAll<HTMLElement>('button, select, input'));
    const barTexts = inBar.map((el) => (el.textContent ?? '').trim());
    for (const label of [t.allYears, t.promoteClass, t.importExcel, t.printReport, t.addStudent, t.addCrStudent]) {
      assert.ok(barTexts.some((text) => text.includes(label)), `« ${label} » est une commande de la barre`);
    }
    assert.ok(m.bar.querySelector('input'), 'le champ de recherche est dans la barre');
    assert.equal(
      inBar.filter((el) => el.tagName === 'SELECT').length,
      2,
      'le sélecteur d’année et le filtre de classes sont dans la barre',
    );

    // Contre-épreuve : le bloc de titre ne porte QUE le titre, la date et la
    // cloche — sinon le repli de la barre pourrait encore passer par-dessus.
    const titleTexts = Array.from(m.titleBlock.querySelectorAll<HTMLElement>('button, select, input'))
      .map((el) => (el.textContent ?? '').trim());
    for (const label of [t.promoteClass, t.importExcel, t.printReport, t.addStudent, t.addCrStudent]) {
      assert.ok(!titleTexts.some((text) => text.includes(label)), `« ${label} » n’est pas dans le bloc titre`);
    }
    assert.equal(
      m.titleBlock.querySelectorAll('select, input').length,
      0,
      'aucun contrôle de saisie dans le bloc titre : la date et la cloche seules y vivent',
    );
    unmount(m);
  });
});
