/**
 * L'entrée « Ajouter CR » doit être LÀ OÙ l'école enrôle un enfant : dans la
 * barre d'actions de l'onglet Élèves, à côté de « Ajouter un Élève », et pas
 * ailleurs (un bouton offert sur un onglet où il n'écrit rien est un bouton qui
 * ment). Ces cas mesurent la barre rendue : présence, voisinage, cible du clic,
 * et le fait que le filtre de classes sait désormais filtrer les classes CR.
 *
 * Même environnement que notifications-panel.test.tsx : le ticker WAAPI de
 * happy-dom n'avance jamais, donc les animations sont résolues instantanément
 * (le panneau de notifications est monté par l'en-tête).
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
win.requestAnimationFrame = ((cb: FrameRequestCallback): number =>
  setTimeout(() => cb(performance.now()), 16) as unknown as number) as unknown as typeof win.requestAnimationFrame;
win.cancelAnimationFrame = ((id: number): void => clearTimeout(id)) as unknown as typeof win.cancelAnimationFrame;
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
  bg: 'bg-slate-100',
  card: 'bg-white',
  input: 'bg-white',
  text: 'text-slate-800',
  muted: 'text-slate-500',
  border: 'border-slate-200',
  header: 'bg-slate-800',
  sidebar: 'bg-slate-900',
  accent: 'text-blue-600',
  accentBg: 'bg-blue-600',
  accentText: 'text-white',
  accentHover: 'hover:bg-blue-700',
  accentShadow: 'shadow-blue-500/20',
  tableHeader: 'bg-slate-50',
  isDark: false,
  rowHover: 'hover:bg-slate-50',
};

const admin: User = { username: 'ibrahim', role: 'admin' };
const noop = () => {};

function mount(
  activeTab: 'students' | 'dashboard',
  spies: string[],
): { container: HTMLElement; root: ReturnType<typeof createRoot> } {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(
      createElement(AppHeader, {
        t,
        lang: 'fr',
        currentTheme: theme,
        activeTab,
        currentUser: admin,
        selectedYear: '2026-2027',
        setSelectedYear: noop,
        academicYears: ['2026-2027'],
        availableClasses: DEFAULT_SCHOOL_CLASSES as ManagedClass[],
        searchTerm: '',
        setSearchTerm: noop,
        studentGradeFilter: 'all',
        setStudentGradeFilter: noop,
        onPromoteClass: noop,
        onImportExcel: noop,
        onOpenMonthlyDraft: noop,
        onAddStudent: () => spies.push('addStudent'),
        onAddCr: () => spies.push('addCr'),
        onPrintReport: noop,
        onExportLate: noop,
        onFinancialReportPdf: noop,
        notifications: [],
        onOpenStudent: noop,
        readNotificationIds: [],
        deletedNotificationIds: [],
        onMarkNotificationRead: noop,
        onMarkAllNotificationsRead: noop,
        onMarkNotificationUnread: noop,
        onDeleteNotification: noop,
        onClearAllNotifications: noop,
        onRestoreDeletedNotifications: noop,
        onOpenCalendarDate: noop,
        onOpenPayroll: noop,
      }),
    );
  });
  return { container, root };
}

function unmount(container: HTMLElement, root: ReturnType<typeof createRoot>) {
  act(() => root.unmount());
  document.body.removeChild(container);
}

const buttons = (container: HTMLElement): HTMLButtonElement[] =>
  Array.from(container.querySelectorAll('button'));

const byText = (container: HTMLElement, text: string): HTMLButtonElement => {
  const btn = buttons(container).find((b) => (b.textContent ?? '').trim() === text);
  assert.ok(btn, `bouton « ${text} » rendu`);
  return btn;
};

const click = (el: HTMLElement) => {
  act(() => {
    el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
};

describe('AppHeader — « Ajouter CR » à côté de « Ajouter un Élève »', () => {
  it('l’onglet Élèves porte les deux entrées, et chacune appelle SA cible', () => {
    const spies: string[] = [];
    const { container, root } = mount('students', spies);
    const addCr = byText(container, t.addCrStudent);
    const addStudent = byText(container, t.addStudent);
    assert.notEqual(addCr, addStudent, 'deux entrées distinctes');

    // Voisinage : les deux commandes vivent dans le même groupe d'actions.
    assert.equal(addCr.parentElement, addStudent.parentElement, 'les deux boutons sont côte à côte');

    click(addCr);
    click(addStudent);
    assert.deepEqual(spies, ['addCr', 'addStudent'], 'chaque bouton ouvre SON flux');
    unmount(container, root);
  });

  it('le filtre de classes propose un groupe CR avec Petit / Moyen / Grand', () => {
    const { container, root } = mount('students', []);
    const crGroup = Array.from(container.querySelectorAll('optgroup')).find((g) => g.label === t.crClasses);
    assert.ok(crGroup, 'le filtre sait isoler les classes CR');
    assert.deepEqual(
      Array.from(crGroup!.querySelectorAll('option')).map((o) => o.value),
      ['CR-PETIT', 'CR-MOYEN', 'CR-GRAND'],
    );
    unmount(container, root);
  });

  it('hors de l’onglet Élèves, aucune des deux entrées n’est offerte', () => {
    const { container, root } = mount('dashboard', []);
    const texts = buttons(container).map((b) => (b.textContent ?? '').trim());
    assert.ok(!texts.includes(t.addCrStudent), 'pas d’« Ajouter CR » sur le tableau de bord');
    assert.ok(!texts.includes(t.addStudent), 'ni d’« Ajouter un Élève »');
    unmount(container, root);
  });
});
