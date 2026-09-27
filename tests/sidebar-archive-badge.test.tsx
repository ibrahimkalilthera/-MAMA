// Suite for Sidebar — « la semaine attend son archive » doit se VOIR depuis
// n'importe quelle page.
//
// La carte d'archive vit dans les Réglages, au fond d'une page longue, et un
// rappel de cloche qu'on peut manquer n'est pas un rappel. Le menu latéral est
// le seul élément visible depuis TOUTES les pages : c'est donc lui qui porte le
// badge, et ces deux cas vérifient qu'il apparaît quand une semaine attend son
// PDF — et qu'il DISPARAÎT sinon (un repère qui reste allumé ne repère rien).
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';

import { translations } from '../src/i18n/translations';
import { Sidebar } from '../src/components/Sidebar';
import type { PayrollWindowStatus } from '../src/app/mainViewsProps';
import { installDomGlobals } from './harness';

const t = translations.fr;

const windowStatus = (): PayrollWindowStatus => ({
  currentDay: 5,
  currentCalendarYear: 2026,
  currentCalendarMonth: 8,
  totalPaidCurrentMonth: 0,
  isOverdue: false,
  isOpen: true,
});

describe('Sidebar — le badge d’archive sur Réglages', () => {
  const win = installDomGlobals();

  async function render(auditArchivePending: boolean): Promise<{ root: ReturnType<typeof createRoot>; container: Element }> {
    const container = win.document.createElement('div');
    win.document.body.appendChild(container);
    const root = createRoot(container as unknown as Element);
    await act(async () => {
      root.render(createElement(Sidebar, {
        t,
        schoolLogo: null,
        activeTab: 'dashboard',
        setActiveTab: () => {},
        payrollWindowStatus: windowStatus(),
        currentUser: { username: 'ibrahim', role: 'dev' },
        fetchAuditLogs: () => {},
        showTodoSidebar: false,
        setShowTodoSidebar: () => {},
        onSignOut: () => {},
        onToggleLanguage: () => {},
        onAddStudent: () => {},
        onAddCr: () => {},
        onRecordPayment: () => {},
        auditArchivePending,
      }));
    });
    return { root, container: container as unknown as Element };
  }

  it('affiche le badge quand une semaine attend son PDF, et le retire sinon', async () => {
    const pending = await render(true);
    try {
      assert.ok(
        pending.container.textContent?.includes(t.auditArchiveBadge),
        'le badge apparaît à côté de « Réglages » quand un rappel est vivant',
      );
    } finally {
      await act(async () => pending.root.unmount());
      pending.container.remove();
    }

    const clear = await render(false);
    try {
      assert.equal(
        clear.container.textContent?.includes(t.auditArchiveBadge),
        false,
        'sans rappel vivant, « Réglages » ne porte plus aucun badge',
      );
    } finally {
      await act(async () => clear.root.unmount());
      clear.container.remove();
    }
  });
});
