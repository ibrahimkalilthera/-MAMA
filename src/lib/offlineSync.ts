/**
 * Offline queue drain — one full sync pass.
 *
 * Extracted from `useSupabaseData`'s `syncOfflineQueue` (same pattern as
 * offlineReplay.ts) so the complete behaviour — reading the queue via
 * getOfflineQueue, replaying each mutation, removing each synced item via
 * removeOfflineAction, keeping failed items for retry and stopping on a
 * thrown error — can be unit tested without a real Supabase connection,
 * React rendering, or a DOM. The hook drives this with the real client.
 */
import type { ReplayDb } from './offlineReplay';
import { replayOfflineItem } from './offlineReplay';
import { getOfflineQueue, removeOfflineAction } from './offlineQueue';

/**
 * Replay every queued mutation against `supabase` and remove each
 * successfully synced item from the queue
 * (getOfflineQueue → replayOfflineItem → removeOfflineAction).
 *
 * An item whose replay reports an error STAYS queued — it will be retried on
 * the next sync pass. A replay that THROWS stops the whole drain so later
 * mutations keep their relative order. Returns the number of synced items.
 */
export async function drainOfflineQueue(supabase: ReplayDb): Promise<number> {
  const queue = getOfflineQueue();
  if (queue.length === 0) return 0;

  let syncedCount = 0;

  for (const item of queue) {
    try {
      const success = await replayOfflineItem(supabase, item);

      if (success) {
        removeOfflineAction(item.id);
        syncedCount++;
      }
    } catch (err) {
      console.error('Offline sync failed for item:', item, err);
      break;
    }
  }

  return syncedCount;
}
