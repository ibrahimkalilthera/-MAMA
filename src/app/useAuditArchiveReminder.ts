/**
 * ─── « La semaine précédente n'est pas encore archivée » : le rappel ────────
 *
 * Ce crochet fabrique UN rappel, et rien d'autre : il demande au journal d'audit
 * ce que la semaine précédente est devenue, et rend une notification de cloche
 * tant qu'elle attend son PDF. Les règles de lecture — quelle semaine, qu'est-ce
 * qui prouve une archive, quand n'y a-t-il rien à dire — vivent dans le module
 * PUR `src/lib/auditArchive.ts` ; ici, il n'y a que le moment où l'on demande et
 * où l'on oublie.
 *
 * Trois décisions qui tiennent au terrain :
 *
 * **1. Le rappel n'existe que pour qui peut archiver.** La carte d'archive vit
 * dans les Réglages, réservés à `auth.isAdmin` (admin ET dev — voir
 * `deleteRights.ts`). Avertir un enseignant d'une tâche qu'il ne peut pas faire
 * serait un faux rappel : le crochet est donc éteint (`enabled: false`) pour les
 * autres rôles, sans même une requête.
 *
 * **2. La fenêtre interrogée va de la semaine précédente à MAINTENANT.** Une
 * archive se pose souvent le lundi pour la semaine qui vient de finir : elle vit
 * donc APRÈS la fin de sa semaine. Ne lire que la fenêtre de la semaine raterait
 * cette archive-là, et reprocherait un classement déjà fait.
 *
 * **3. Le rappel s'éteint de lui-même.** L'archive est relue pendant la session
 * (même cadence que le rafraîchissement de fond de `App.tsx` : une minute, onglet
 * visible, ligne présente) : archiver depuis les Réglages retire le badge sans
 * redémarrage, au lieu de laisser croire que le geste n'a pas compté. Hors ligne,
 * la lecture retombe sur le journal local et les gestes en file (c'est le
 * porteur de données qui décide, pas ce crochet).
 */
import { useEffect, useState } from 'react';
import type { AuditWeek } from '../lib/auditWeek';
import { archiveReminderDate, previousAuditWeek, unarchivedPreviousWeek } from '../lib/auditArchive';
import type { AuditLogEntry } from '../lib/auditLogger';
import type { DashboardNotification } from './useDashboard';
import type { TranslationDict } from '../i18n/translations';

/** La cadence de relecture : celle du rafraîchissement de fond de l'application. */
const RECHECK_MS = 60_000;

export interface AuditArchiveReminderDeps {
  /** Seuls admin et dev atteignent les Réglages, donc le rappel ne s'adresse qu'à eux. */
  enabled: boolean;
  /** La lecture BORNÉE du journal — celle du PDF, pas les cent dernières entrées. */
  fetchAuditJournalRange: (fromIso: string, toIso: string) => Promise<AuditLogEntry[]>;
  t: TranslationDict;
}

export function useAuditArchiveReminder({
  enabled,
  fetchAuditJournalRange,
  t,
}: AuditArchiveReminderDeps): DashboardNotification | null {
  const [week, setWeek] = useState<AuditWeek | null>(null);

  useEffect(() => {
    if (!enabled) {
      // Un rôle qui n'archive pas ne garde pas en mémoire le rappel d'un autre.
      setWeek(null);
      return;
    }
    let alive = true;
    const load = async (): Promise<void> => {
      const now = new Date();
      const previous = previousAuditWeek(now);
      try {
        const entries = await fetchAuditJournalRange(previous.startIso, now.toISOString());
        if (alive) setWeek(unarchivedPreviousWeek(now, entries));
      } catch {
        // Une lecture impossible ne doit pas INVENTER un rappel : on garde l'état
        // précédent (le plus souvent « rien ») plutôt que d'accuser la semaine.
      }
    };
    void load();
    const poll = setInterval(() => {
      if (document.visibilityState === 'visible' && navigator.onLine) void load();
    }, RECHECK_MS);
    return () => {
      alive = false;
      clearInterval(poll);
    };
  }, [enabled, fetchAuditJournalRange]);

  if (!enabled || !week) return null;
  return {
    // La clé ISO dans l'identifiant : le rappel d'une semaine NEUVE est un
    // rappel neuf, donc la cloche sonne de nouveau (le parent élague les
    // identifiants qui n'ont plus de rappel vivant — voir useNotificationDismissal).
    id: `audit-archive-${week.key}`,
    type: 'archive',
    message: t.auditArchiveReminder.replace('{week}', week.key),
    date: archiveReminderDate(week),
  };
}
