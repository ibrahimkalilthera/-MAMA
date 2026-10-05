/**
 * Tests for the three units split out of src/App.tsx (split campaign).
 *
 * App.tsx is the composition root and is NOT rendered by any suite — the app
 * tests render <AppShell> directly. That is exactly why the extraction needs
 * its own coverage: the in-session notification chime/toast and the silent
 * background poll used to be effects inside App, where nothing measured them.
 * Here they are driven through the real hook host (renderHook) with a fake
 * toast and a fake clock, so the behaviour is measured, not assumed.
 *
 * `applyLanguage` is the DOM sweep that follows a language switch: it rewrites
 * every [data-i18n] node AFTER the render commits, and leaves an unknown key
 * untouched rather than blanking it.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { translations } from '../src/i18n/translations';
import { applyLanguage } from '../src/app/applyLanguage';
import { useNotificationAlerts } from '../src/app/useNotificationAlerts';
import { useBackgroundRefresh } from '../src/app/useBackgroundRefresh';
import type { DashboardNotification } from '../src/app/useDashboard';
import { installDomGlobals, renderHook } from './harness';

const t = translations.fr;

const notif = (id: string, message = id): DashboardNotification => ({
  id,
  type: 'due',
  message,
  date: '2026-10-04',
});

describe('applyLanguage — la bascule de langue réécrit le DOM, pas les clés inconnues', () => {
  it('remplit chaque nœud [data-i18n] traduit et laisse une clé absente intacte', async () => {
    installDomGlobals();
    const known = document.createElement('span');
    known.setAttribute('data-i18n', 'navDashboard');
    known.textContent = 'ancien';
    const unknown = document.createElement('span');
    unknown.setAttribute('data-i18n', 'pasUneCle');
    unknown.textContent = 'à garder';
    document.body.append(known, unknown);

    applyLanguage('fr');
    // Le sweep est posé dans un setTimeout(…, 0) pour courir APRÈS le commit.
    await new Promise((resolve) => setTimeout(resolve, 0));

    assert.equal(known.textContent, t.navDashboard);
    assert.equal(unknown.textContent, 'à garder', 'une clé sans traduction n’est pas effacée');
  });
});

describe('useNotificationAlerts — le carillon ne sonne que pour les rappels ARRIVÉS en session', () => {
  it('reste silencieux au premier rendu, puis alerte chaque nouvel id', () => {
    installDomGlobals();
    const warnings: string[] = [];
    const toast = { warning: (message: string): string => { warnings.push(message); return 'toast-id'; } };
    const useAlertsArgs = ({ notifications }: { notifications: DashboardNotification[] }) =>
      useNotificationAlerts(notifications, t, toast);

    const { rerender, unmount } = renderHook(useAlertsArgs, { notifications: [notif('a', 'A')] });
    assert.deepEqual(warnings, [], 'la première observation (début de session) ne sonne pas');

    rerender({ notifications: [notif('a', 'A'), notif('b', 'B')] });
    assert.deepEqual(warnings, ['B'], 'un nouveau rappel alerte avec son message');

    // Deux rappels d'un coup : le message passe au COMPTE, pas à un seul texte.
    rerender({ notifications: [notif('a', 'A'), notif('b', 'B'), notif('c', 'C'), notif('d', 'D')] });
    assert.equal(warnings.length, 2);
    assert.equal(warnings[1], t.newNotifications.replace('{n}', '2'));

    // Un re-rendu sans nouvel id ne re-sonne pas.
    rerender({ notifications: [notif('a', 'A'), notif('b', 'B'), notif('c', 'C'), notif('d', 'D')] });
    assert.equal(warnings.length, 2);

    unmount();
  });
});

describe('useBackgroundRefresh — la sonde silencieuse suit la session', () => {
  it('sonde toutes les 60 s en silence quand la session est là, et s’arrête sinon', () => {
    installDomGlobals();
    const calls: Array<{ silent?: boolean } | undefined> = [];
    const fetchAll = async (opts?: { silent?: boolean }): Promise<void> => {
      calls.push(opts);
    };
    const intervals: Array<{ fn: () => void; ms: number; cleared: boolean }> = [];
    const realSetInterval = globalThis.setInterval;
    const realClearInterval = globalThis.clearInterval;
    globalThis.setInterval = ((fn: () => void, ms?: number) => {
      intervals.push({ fn, ms: ms ?? 0, cleared: false });
      return intervals.length as unknown as ReturnType<typeof setInterval>;
    }) as unknown as typeof setInterval;
    globalThis.clearInterval = ((id: unknown) => {
      const record = intervals[(id as number) - 1];
      if (record) record.cleared = true;
    }) as unknown as typeof clearInterval;
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
    Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });

    try {
      const useRefreshArgs = ({ enabled }: { enabled: boolean }) => useBackgroundRefresh(enabled, fetchAll);
      const { rerender, unmount } = renderHook(useRefreshArgs, { enabled: true });

      assert.equal(intervals.length, 1, 'une sonde armée pour une session ouverte');
      assert.equal(intervals[0].ms, 60000);
      intervals[0].fn();
      assert.deepEqual(calls, [{ silent: true }], 'la sonde recharge en SILENCE (pas de bandeau)');

      rerender({ enabled: false });
      assert.equal(intervals[0].cleared, true, 'l’intervalle est nettoyé quand la session disparaît');
      assert.equal(intervals.length, 1, 'aucune nouvelle sonde sans session');

      unmount();
    } finally {
      globalThis.setInterval = realSetInterval;
      globalThis.clearInterval = realClearInterval;
    }
  });
});
