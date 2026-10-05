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
import { offlineAuditInfo, replayOfflineItemDetailed } from './offlineReplay';
import { getOfflineQueue, markOfflineFailure, removeOfflineAction } from './offlineQueue';
import type { LogAuditParams } from './auditLogger';

/**
 * Replay every queued mutation against `supabase` and remove each
 * successfully synced item from the queue
 * (getOfflineQueue → replayOfflineItem → removeOfflineAction).
 *
 * An item whose replay reports an error STAYS queued — it will be retried on
 * the next sync pass — and the failed attempt is COUNTED (markOfflineFailure)
 * WITH ITS REASON, so the screen can distinguish « waiting to be sent » from
 * « refused, and it will not go through on its own », and can NAME why. A
 * replay that THROWS stops the whole drain so later mutations keep their
 * relative order. Returns the number of synced items.
 *
 * `audit` is optional (unit tests call the drain without it): when provided,
 * every successfully replayed critical action is audited — the queue drain is
 * where an offline mutation materializes in the DB, so it must leave a trail.
 *
 * Le second argument passé à `audit` est l'instant où le GESTE a été fait
 * (`item.createdAt`), et pas celui du rejeu : le drain est précisément le moment
 * où cette distinction se perdrait, et c'est elle qui décide de la semaine
 * d'archive et de la ligne rouge du PDF.
 */
/**
 * Un drainage est-il déjà en cours ?
 *
 * `syncOfflineQueue` (le crochet) est appelé par TROIS chemins : l'événement
 * « online », le démarrage (getSession puis SIGNED_IN) et la fin d'une session
 * hors ligne. Rien ne les empêchait de se CHEVAUCHER : deux appels concurrents
 * lisaient la MÊME file et rejouaient donc chaque item une seconde fois.
 *
 * Mesuré le 2026-10-05 sur la base partagée : des élèves créés deux fois à
 * 1 milliseconde d'écart (« Mamadou SIDIBE ») et six fois en quinze secondes
 * (« Mahamadou DJIRE »). Une seule exclusion mutuelle suffit à l'empêcher — et
 * elle vit ICI, dans le module pur, pour être prouvée par un test.
 */
let drainInFlight = false;

export async function drainOfflineQueue(
  supabase: ReplayDb,
  audit?: (info: Omit<LogAuditParams, 'user'> | null, capturedAt: string) => void
): Promise<number> {
  // Un drainage à la fois : un second appel qui se chevauche ne rejoue RIEN.
  // (Il rend 0 — pas une erreur : la file n'est pas perdue, elle est en cours.)
  if (drainInFlight) return 0;
  drainInFlight = true;
  try {
    const queue = getOfflineQueue();
    if (queue.length === 0) return 0;

    let syncedCount = 0;

    for (const item of queue) {
      try {
        const { ok, reason } = await replayOfflineItemDetailed(supabase, item);

        if (ok) {
          if (audit) audit(offlineAuditInfo(item), item.createdAt);
          removeOfflineAction(item.id);
          syncedCount++;
        } else {
          // Rien n'est perdu : l'action reste en file et repartira au prochain
          // passage — mais elle est marquée comme ayant déjà été refusée, ET avec
          // la raison du refus, pour que la bannière puisse la nommer.
          markOfflineFailure(item.id, reason);
        }
      } catch (err) {
        console.error('Offline sync failed for item:', item, err);
        break;
      }
    }

    return syncedCount;
  } finally {
    // Libéré même si un rejeu JETTE : sans ce `finally`, une exception laisserait
    // le drapeau levé et plus AUCUN drainage ne passerait — la file se figerait.
    drainInFlight = false;
  }
}
