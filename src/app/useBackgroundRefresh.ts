/**
 * Silent background refresh — a light poll so reminders can appear mid-session
 * (another staff member's changes) without a manual reload.
 *
 * Extracted from src/App.tsx (split campaign, no behaviour change): the poll is
 * explicitly QUIET — `fetchAll({ silent: true })` shows no loading flash and no
 * error banner — and it is skipped when the tab is hidden or the device is
 * offline, so a backgrounded or disconnected device does not hammer the network.
 * Disabled (no session) until the caller says the user is present.
 */
import { useEffect } from 'react';

export function useBackgroundRefresh(
  enabled: boolean,
  fetchAll: (opts?: { silent?: boolean }) => Promise<void>,
): void {
  useEffect(() => {
    if (!enabled) return;
    const poll = setInterval(() => {
      if (document.visibilityState === 'visible' && navigator.onLine) {
        void fetchAll({ silent: true });
      }
    }, 60000);
    return () => clearInterval(poll);
  }, [enabled, fetchAll]);
}
