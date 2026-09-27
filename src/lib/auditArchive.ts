/**
 * ─── L'archive d'une semaine se prouve par le JOURNAL lui-même ──────────────
 *
 * La demande : « un rappel dans l'app qui prévient l'admin et le dev quand la
 * semaine précédente n'a pas encore été archivée en PDF ». Une phrase, et une
 * question qu'on ne peut pas laisser au hasard : **qu'est-ce qui prouve qu'une
 * semaine a été archivée ?**
 *
 * Le PDF n'est pas téléversé : il est écrit sur le poste qui le produit. Il
 * n'existe donc, hors de ce poste, aucune trace de l'archive — et un rappel qui
 * se fierait à une mémoire LOCALE préviendrait l'admin alors que le dev vient
 * d'archiver la même semaine sur une autre machine. L'application avait déjà
 * l'endroit juste : le **journal d'audit**. On y écrit donc l'archive
 * elle-même (`EXPORT_AUDIT_JOURNAL`), et la preuve qu'une semaine est archivée
 * devient une entrée de journal — partagée par tous les postes, rejouée hors
 * ligne comme les autres (voir `offlineQueue`), et relue par le même lecteur
 * borné que le PDF.
 *
 * Trois règles, chacune mesurable :
 *
 * **1. « La semaine précédente » est celle qui vient de se terminer**, pas les
 * sept derniers jours : c'est la semaine ISO complète d'avant (voir
 * `src/lib/auditWeek.ts`), celle qu'un administrateur qui ouvre l'application le
 * lundi matin cherche à classer.
 *
 * **2. Une semaine vide ne se signale pas.** Sans entrée, il n'y a rien à
 * archiver : un rappel à ce moment-là serait du bruit, et il hurlerait pour les
 * semaines d'avant l'installation du poste.
 *
 * **3. Le journal peut porter l'archive d'une AUTRE semaine** : on ne regarde
 * que l'entrée dont la cible est la clé de la semaine cherchée (`2026-S39`), pas
 * « une entrée qui ressemble ». Une archive faite la semaine suivante compte
 * évidemment, elle est simplement lue hors de la fenêtre de la semaine — c'est
 * pourquoi le lecteur interroge une plage qui va jusqu'à MAINTENANT.
 *
 * Le module est PUR : la date et les entrées sont toujours passées en paramètre,
 * donc chaque règle se teste deux fois de la même façon.
 */
import type { AuditLogEntry, LogAuditParams } from './auditLogger';
import type { AuditWeek } from './auditWeek';
import { auditWeekOf, entriesInWeek } from './auditWeek';

/** Le code d'action écrit quand une semaine part en PDF (Réglages → Sauvegarde). */
export const AUDIT_ARCHIVE_ACTION = 'EXPORT_AUDIT_JOURNAL';

/** Le type de cible d'une archive : la clé ISO de la semaine (`2026-S39`). */
export const AUDIT_ARCHIVE_TARGET = 'audit_week';

/**
 * La semaine qui vient de se TERMINER — celle qu'on archive.
 *
 * On recule de sept jours dans le calendrier civil puis on laisse
 * `auditWeekOf` faire son travail : reculer de sept jours depuis n'importe quel
 * jour d'une semaine tombe toujours dans la semaine précédente, y compris au
 * passage d'année, où la clé ISO peut changer d'année civile (`2025-S53` → la
 * semaine du 29 déc. 2025 est `2026-S1`).
 *
 * @param date le jour d'ancrage (heures ignorées)
 */
export function previousAuditWeek(date: Date): AuditWeek {
  return auditWeekOf(new Date(date.getFullYear(), date.getMonth(), date.getDate() - 7));
}

/**
 * La clé de la semaine qu'une entrée de journal déclare avoir archivée, ou
 * `null` si ce n'est pas une archive.
 *
 * Le repli sur `details` n'est PAS fait : deviner une clé dans un texte libre
 * rapprocherait deux semaines d'un même mot. Seule la cible compte — elle est
 * écrite exprès, et c'est écrit ici pour que personne n'ait à l'interpréter.
 */
function archivedKeyOf(entry: AuditLogEntry | null | undefined): string | null {
  if (!entry || entry.action !== AUDIT_ARCHIVE_ACTION) return null;
  const key = String(entry.targetId ?? '').trim();
  return key || null;
}

/** Les semaines que ce journal de bord déclare déjà archivées. */
export function archivedWeekKeys(entries: AuditLogEntry[] | null | undefined): Set<string> {
  const keys = new Set<string>();
  for (const entry of Array.isArray(entries) ? entries : []) {
    const key = archivedKeyOf(entry);
    if (key) keys.add(key);
  }
  return keys;
}

/** Cette semaine précise a-t-elle déjà son archive ? */
export function isWeekArchived(entries: AuditLogEntry[] | null | undefined, weekKey: string): boolean {
  return archivedWeekKeys(entries).has(String(weekKey ?? '').trim());
}

/**
 * La semaine précédente SI elle attend encore son archive, sinon `null`.
 *
 * Rend `null` — et donc aucun rappel — dans les deux cas où il n'y a rien à
 * signaler : la semaine n'a rien produit (rien à classer), ou son archive est
 * déjà écrite (quelqu'un l'a faite, et ce n'est plus une affaire en cours).
 *
 * Les entrées passées doivent couvrir TOUT l'intervalle jusqu'à maintenant : une
 * archive posée après la fin de sa semaine (le cas courant) vit dans les jours
 * qui suivent, donc hors de la fenêtre de la semaine — la chercher seulement
 * DANS la semaine raterait l'archive et reprocherait à jamais un classement fait.
 */
export function unarchivedPreviousWeek(
  date: Date,
  entries: AuditLogEntry[] | null | undefined,
): AuditWeek | null {
  const week = previousAuditWeek(date);
  if (isWeekArchived(entries, week.key)) return null;
  return entriesInWeek(entries, week).length > 0 ? week : null;
}

/**
 * Inscrit dans le journal l'archive d'une semaine — la preuve que le rappel lit.
 *
 * Écrite par ce module, et non par la carte, pour que le CODE et la LECTURE
 * (`archivedWeekKeys`) ne puissent pas diverger : le même fichier produit
 * l'entrée et la relit.
 *
 * L'import du journal est DIFFÉRÉ au geste : `auditLogger` tire le client de
 * base, dont une carte de Réglages n'a pas besoin pour s'afficher. Hors ligne,
 * `logAuditEvent` met l'entrée en file au lieu de la perdre — c'est la même
 * promesse que pour n'importe quel autre geste, et c'est ce qui fait qu'une
 * semaine archivée sans réseau n'est pas re-signalée le lendemain.
 *
 * @param week la semaine archivée (sa clé est la cible de l'entrée)
 * @param filename le nom du fichier écrit — le détail lisible de la trace
 * @param actor l'acteur déclaré par la session, ou `null` (le journal le résout)
 */
export async function recordWeekArchive(
  week: AuditWeek,
  filename: string,
  actor?: LogAuditParams['user'],
): Promise<boolean> {
  const { logAuditEvent } = await import('./auditLogger');
  return logAuditEvent({
    action: AUDIT_ARCHIVE_ACTION,
    targetType: AUDIT_ARCHIVE_TARGET,
    targetId: week.key,
    details: filename,
    user: actor ?? null,
  });
}

/**
 * La date d'ancrage d'un rappel d'archive : le DIMANCHE de la semaine, en jour
 * civil local (`AAAA-MM-JJ`).
 *
 * C'est le format des autres rappels de la cloche, et ce n'est pas cosmétique :
 * le panneau ouvre le calendrier en découpant cette chaîne sur les tirets, donc
 * un instant ISO complet (`…T23:59:59.999Z`) y produirait une date invalide — et
 * un clic ne mènerait nulle part. On rend le jour, pas l'instant.
 */
export function archiveReminderDate(week: AuditWeek): string {
  const end = week.end;
  const month = String(end.getMonth() + 1).padStart(2, '0');
  const day = String(end.getDate()).padStart(2, '0');
  return `${end.getFullYear()}-${month}-${day}`;
}
