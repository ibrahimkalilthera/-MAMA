/**
 * Le journal d'audit HORS LIGNE — lisible, et complet.
 *
 * Deux moitiés, et les deux sont nécessaires pour que le journal reste le
 * journal :
 *
 *   • le CACHE des 100 dernières entrées réellement reçues de la base, par
 *     compte (un poste partagé ne doit pas montrer le journal du compte
 *     précédent) — sans lui, ouvrir le journal sans réseau afficherait un écran
 *     vide, c'est-à-dire « l'école n'a rien fait » ;
 *   • les entrées EN ATTENTE, dérivées de la file hors ligne par
 *     `offlineAuditInfo` — la MÊME fonction pure qui produira l'entrée au rejeu,
 *     donc l'écran ne peut pas montrer autre chose que ce qui sera écrit. Elles
 *     sont marquées, pour qu'une entrée pas encore dans la base ne se lise jamais
 *     comme une entrée en base.
 */
import type { AuditLogEntry, LogAuditParams } from './auditLogger';
import { getOfflineQueue, type QueueItem } from './offlineQueue';
import { offlineAuditInfo } from './offlineReplay';

/** Suffixe des entrées que la file porte et qui ne sont pas encore en base. */
export const PENDING_AUDIT_TAG = ' [en attente]';

export function auditJournalCacheKey(userId: string): string {
  return `mama_thera_audit_journal_v1:${userId}`;
}

/** Les entrées du cache, ou `[]` (absent, corrompu, autre compte). */
export function readAuditJournalCache(userId: string): AuditLogEntry[] {
  if (!userId || typeof localStorage === 'undefined') return [];
  try {
    const raw = localStorage.getItem(auditJournalCacheKey(userId));
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as AuditLogEntry[]) : [];
  } catch {
    return [];
  }
}

/**
 * Conserve ce que la base a répondu — jamais les entrées en attente : elles
 * seraient alors comptées deux fois (une fois depuis le cache, une fois depuis la
 * file) dès le retour de la ligne, et une fois de trop quand la file se vide.
 */
export function writeAuditJournalCache(userId: string, entries: AuditLogEntry[]): void {
  if (!userId || typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(auditJournalCacheKey(userId), JSON.stringify(entries));
  } catch {
    /* quota, mode privé : le journal reste consultable en ligne */
  }
}

export function clearAuditJournalCache(userId: string): void {
  if (!userId || typeof localStorage === 'undefined') return;
  try {
    localStorage.removeItem(auditJournalCacheKey(userId));
  } catch {
    /* rien à nettoyer */
  }
}

/**
 * Les entrées que la file porte encore, les plus récentes d'abord.
 *
 * `actor` est l'utilisateur de la station : il est le seul que l'on puisse
 * écrire ici (le rejeu, lui, résout l'acteur comme le chemin en ligne). Une
 * entrée de type `addAuditLog` porte déjà le sien, figé au moment du geste.
 */
export function pendingAuditEntries(
  actor?: LogAuditParams['user'] | null,
  queue: QueueItem[] = getOfflineQueue(),
): AuditLogEntry[] {
  const entries: AuditLogEntry[] = [];
  for (const item of queue) {
    if (item.type === 'addAuditLog') {
      const p = item.payload;
      entries.push({
        id: `pending:${item.id}`,
        userId: p.userId ?? '',
        userEmail: p.userEmail ?? '',
        userName: p.userName ?? '',
        userRole: p.userRole ?? '',
        action: p.action,
        targetType: p.targetType ?? '',
        targetId: p.targetId ?? '',
        details: `${p.details ?? ''}${PENDING_AUDIT_TAG}`,
        createdAt: item.createdAt,
      });
      continue;
    }
    const info = offlineAuditInfo(item);
    if (!info) continue;
    entries.push({
      id: `pending:${item.id}`,
      userId: actor?.id ?? '',
      userEmail: actor?.email ?? '',
      userName: actor?.full_name ?? '',
      userRole: actor?.role ?? '',
      action: info.action,
      targetType: info.targetType ?? '',
      targetId: info.targetId ?? '',
      details: `${info.details ?? ''}${PENDING_AUDIT_TAG}`,
      createdAt: item.createdAt,
    });
  }
  return entries.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}
