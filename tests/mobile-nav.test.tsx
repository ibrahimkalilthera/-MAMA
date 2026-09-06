// Mobile bottom navigation tests: every main tab renders (dashboard, students,
// parents, payroll, expenses, calendar, notes, archives), the audit & settings
// tabs appear only for admin/dev roles, the active tab is marked, the payroll
// window badge appears when overdue, clicking audit refreshes the audit log,
// and the language pill fires onToggleLanguage.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { translations } from '../src/i18n/translations';
import { MobileNav } from '../src/components/MobileNav';
import type { PayrollWindowStatus } from '../src/app/mainViewsProps';
import { installDomGlobals } from './harness';

const t = translations.fr;

const windowStatus = (overrides: Partial<PayrollWindowStatus> = {}): PayrollWindowStatus => ({
  currentDay: 5,
  currentCalendarYear: 2026,
  currentCalendarMonth: 8,
  totalPaidCurrentMonth: 0,
  isOverdue: false,
  isOpen: true,
  ...overrides,
});

function findButton(container: Element, text: string): HTMLButtonElement {
  const buttons = [...container.querySelectorAll('button')];
  const btn = buttons.find((b) => b.textContent?.includes(text));
  assert.ok(btn, `bouton introuvable : « ${text} »`);
  return btn as HTMLButtonElement;
}

describe('MobileNav', () => {
  const win = installDomGlobals();

  it('affiche les 8 onglets principaux + la pilule de langue (non-admin sans Audit/Réglages)', async () => {
    const container = win.document.createElement('div');
    win.document.body.appendChild(container);
    const root = createRoot(container as unknown as Element);

    await act(async () => {
      root.render(createElement(MobileNav, {
        t,
        activeTab: 'dashboard',
        setActiveTab: () => {},
        payrollWindowStatus: windowStatus(),
        onToggleLanguage: () => {},
        currentUser: { role: 'staff' },
      }));
    });

    for (const label of [t.navDashboard, t.navStudents, t.navParents, t.payroll, t.expenses, t.navCalendar, t.notes, t.navArchives]) {
      assert.ok(container.textContent?.includes(label), `onglet « ${label} » présent`);
    }
    assert.ok(container.textContent?.includes(t.langToggle), `pilule de langue « ${t.langToggle} » présente`);
    assert.ok(!container.textContent?.includes(t.auditTrail), 'Audit masqué pour un compte staff');
    assert.ok(!container.textContent?.includes(t.navSettings), 'Réglages masqués pour un compte staff');

    await act(async () => root.unmount());
    container.remove();
  });

  it('affiche Audit + Réglages pour un admin/dev', async () => {
    const container = win.document.createElement('div');
    win.document.body.appendChild(container);
    const root = createRoot(container as unknown as Element);

    await act(async () => {
      root.render(createElement(MobileNav, {
        t,
        activeTab: 'dashboard',
        setActiveTab: () => {},
        payrollWindowStatus: windowStatus(),
        onToggleLanguage: () => {},
        currentUser: { role: 'dev' },
      }));
    });

    assert.ok(container.textContent?.includes(t.auditTrail), 'Audit visible pour dev');
    assert.ok(container.textContent?.includes(t.navSettings), 'Réglages visibles pour dev');

    await act(async () => root.unmount());
    container.remove();
  });

  it('cliquer un onglet navigue (y compris Calendrier), cliquer Audit rafraîchit le journal, la pilule bascule la langue', async () => {
    const container = win.document.createElement('div');
    win.document.body.appendChild(container);
    const root = createRoot(container as unknown as Element);
    const navigated: string[] = [];
    let toggled = 0;
    let audits = 0;

    await act(async () => {
      root.render(createElement(MobileNav, {
        t,
        activeTab: 'dashboard',
        setActiveTab: (tab) => navigated.push(tab),
        payrollWindowStatus: windowStatus(),
        onToggleLanguage: () => { toggled += 1; },
        currentUser: { role: 'admin' },
        fetchAuditLogs: () => { audits += 1; },
      }));
    });

    await act(async () => {
      findButton(container as unknown as Element, t.navStudents).click();
    });
    assert.deepEqual(navigated, ['students'], 'le clic sur Élèves navigue vers students');

    await act(async () => {
      findButton(container as unknown as Element, t.navCalendar).click();
    });
    assert.deepEqual(navigated.slice(-1), ['calendar'], 'le clic sur Calendrier navigue vers calendar');

    await act(async () => {
      findButton(container as unknown as Element, t.auditTrail).click();
    });
    assert.equal(audits, 1, 'ouvrir Audit rafraîchit le journal');
    assert.deepEqual(navigated.slice(-1), ['audit'], 'le clic sur Audit navigue vers audit');

    await act(async () => {
      findButton(container as unknown as Element, t.langToggle).click();
    });
    assert.equal(toggled, 1, 'le clic sur la pilule bascule la langue');

    await act(async () => root.unmount());
    container.remove();
  });

  it('marque l’onglet actif et affiche le point de retard sur Paie quand la fenêtre est en retard', async () => {
    const container = win.document.createElement('div');
    win.document.body.appendChild(container);
    const root = createRoot(container as unknown as Element);

    await act(async () => {
      root.render(createElement(MobileNav, {
        t,
        activeTab: 'payroll',
        setActiveTab: () => {},
        payrollWindowStatus: windowStatus({ isOverdue: true }),
        onToggleLanguage: () => {},
        currentUser: { role: 'staff' },
      }));
    });

    const active = container.querySelector('[aria-current="page"]');
    assert.ok(active, 'un onglet porte aria-current="page"');
    assert.ok(active?.textContent?.includes(t.payroll), "l'onglet actif est Paie");
    assert.ok(
      container.querySelector('[aria-label="' + t.overdue + '"]'),
      'le point de retard est rendu quand isOverdue est vrai',
    );

    await act(async () => root.unmount());
    container.remove();
  });
});
