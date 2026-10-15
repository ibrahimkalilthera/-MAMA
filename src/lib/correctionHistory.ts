/**
 * ─── LES GESTES DE CORRECTION : ce que l'Historique des paiements montre À CÔTÉ
 *
 * L'historique des paiements lit le journal pour dire ce que la CAISSE a fait :
 * « qui a encaissé, combien, pour quel élève ». Un salaire et une dépense n'y
 * entrent pas — un salaire SORT de la caisse, une dépense aussi — et leur
 * injection dans `paymentHistoryRows` aurait fait dire au net « encaissé » un
 * chiffre qui n'a rien d'un encaissement. La décision est donc celle-ci, et elle
 * est explicite :
 *
 *   • `paymentHistoryRows` ne bouge pas (reçus, annulations, restaurations) ;
 *   • ce module lit le journal pour la SECONDE famille de gestes — ceux qui
 *     RETIRENT une écriture d'argent (une dépense, un salaire) ou qui la
 *     rétablissent —, et l'écran les montre dans leur propre bloc, à part ;
 *   • le net encaissé, les exports de reçus et le rapport de caisse ne les
 *     comptent jamais : ils restent exactement ce qu'ils disent être.
 *
 * Pourquoi cette famille existe : une école corrige des erreurs, et une
 * correction non tracée est indistinguable d'une disparition. Avant, retirer un
 * salaire fautif voulait dire supprimer le MEMBRE — dont la clé étrangère est
 * `ON DELETE CASCADE` —, et le journal ne disait plus quel montant, ni pour qui.
 *
 * Ce que le module NE fait pas : il ne devine aucun montant. Un geste en porte un
 * quand son instantané en porte un (les salaires, depuis `salaryUndo.ts`) ; sinon
 * la colonne reste vide et la PHRASE de l'entrée dit le fait, telle quelle. Il ne
 * remonte pas non plus à la ligne supprimée : elle n'existe plus, et prétendre le
 * contraire serait une invention.
 *
 * Pur : ni horloge, ni DOM, ni réseau.
 */
import type { AuditLogEntry } from './auditLogger';
import type { Staff } from './domainTypes';
import { salarySnapshotOf } from './salaryUndo';

/**
 * Les gestes qui CORRIGENT une écriture d'argent — et eux seuls.
 *
 * Les enregistrements (`RECORD_SALARY_PAYMENT`, `ADD_EXPENSE`,
 * `ADD_VENDOR_EXPENSE`) n'en font pas partie : ils ne corrigent rien, et les
 * mêler aux corrections rendrait le bloc illisible (« qu'est-ce qui a été
 * retiré ? »). Une restauration, elle, en fait partie : c'est la réparation d'une
 * correction, et l'école doit voir les deux gestes dans l'ordre.
 */
export const CORRECTION_HISTORY_ACTIONS = [
  'DELETE_SALARY_PAYMENT',
  'RESTORE_SALARY_PAYMENT',
  'DELETE_EXPENSE',
  'DELETE_VENDOR_EXPENSE',
] as const;

export type CorrectionHistoryAction = (typeof CORRECTION_HISTORY_ACTIONS)[number];

const ACTION_SET: ReadonlySet<string> = new Set(CORRECTION_HISTORY_ACTIONS);

/** Cette entrée de journal est-elle un geste de correction ? */
export function isCorrectionHistoryAction(action: string | null | undefined): action is CorrectionHistoryAction {
  return typeof action === 'string' && ACTION_SET.has(action);
}

/** Une ligne du bloc des corrections — ce que l'écran affiche, colonne par colonne. */
export interface CorrectionHistoryRow {
  /** L'id de l'entrée de journal (une ligne de journal, une ligne d'écran). */
  id: string;
  /** L'instant du geste (ISO) : celui du poste s'il a été saisi hors ligne. */
  at: string;
  action: CorrectionHistoryAction;
  /** L'utilisateur CONNECTÉ au moment du geste (le journal le fige). */
  actorName: string;
  actorEmail: string;
  actorRole: string;
  /**
   * Sur QUI / QUOI le geste porte, quand le journal le nomme : le MEMBRE pour un
   * salaire (`staff_name` de l'instantané, sinon l'annuaire). Vide pour une
   * dépense — sa phrase `details` nomme déjà la dépense, et la recopier ici en
   * ferait une seconde formulation du même fait.
   */
  subject: string;
  /**
   * Le montant RETIRÉ (ou rétabli), en chiffres — de l'instantané uniquement.
   * `null` quand le geste n'en porte pas : on ne lit pas un nombre dans une
   * phrase libre, et une ligne sans montant le dit au lieu d'afficher un zéro
   * qui aurait l'air d'un montant.
   */
  amount: number | null;
  /** L'entrée d'origine — `localizeAuditDetails` en est la seule lecture. */
  log: AuditLogEntry;
}

/**
 * Les lignes du bloc des corrections, les plus récentes d'abord.
 *
 * @param logs les entrées du journal (toutes actions confondues : le tri se fait ici)
 * @param staff l'annuaire du personnel, pour retrouver le nom d'un membre quand
 *   l'instantané d'une vieille entrée n'en portait pas — jamais pour deviner :
 *   un membre absent de l'annuaire laisse le sujet vide.
 */
export function correctionHistoryRows({
  logs,
  staff = [],
}: {
  logs: AuditLogEntry[];
  staff?: Staff[];
}): CorrectionHistoryRow[] {
  const rows: CorrectionHistoryRow[] = [];

  for (const log of logs) {
    if (!isCorrectionHistoryAction(log.action)) continue;
    // L'instantané est la SEULE source d'un montant : celui d'un salaire est
    // écrit par les deux chemins (en ligne et rejeu), avec le même genre.
    const snapshot = salarySnapshotOf(log);
    const subject = snapshot?.staffName?.trim()
      || (snapshot?.staffId ? staff.find((s) => s.id === snapshot.staffId)?.name?.trim() : '')
      || '';
    rows.push({
      id: log.id,
      at: log.createdAt,
      action: log.action,
      actorName: log.userName?.trim() || '',
      actorEmail: log.userEmail?.trim() || '',
      actorRole: log.userRole?.trim() || '',
      subject,
      amount: snapshot ? snapshot.amount : null,
      log,
    });
  }

  return rows.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
}

/** Ce que le bloc des corrections dit de la journée, sans jamais toucher au net. */
export interface CorrectionHistorySummary {
  /** Le nombre de gestes de correction affichés. */
  count: number;
  /** Combien d'entre eux portent un montant CHIFFRÉ (les autres se lisent en phrase). */
  withAmount: number;
  /** La somme des montants chiffrés des SEULES suppressions — les sorties retirées. */
  removed: number;
  /** La somme des montants chiffrés des restaurations — les sorties remises. */
  restored: number;
}

/**
 * Le résumé du bloc.
 *
 * Il n'est PAS un « net » : ces gestes ne touchent pas la caisse, et la seule
 * chose qu'un lecteur doit pouvoir vérifier est ce qui a été retiré puis remis.
 * Les gestes sans montant restent comptés (`count`), et le bloc dit combien.
 */
export function correctionHistorySummary(rows: CorrectionHistoryRow[]): CorrectionHistorySummary {
  let removed = 0;
  let restored = 0;
  let withAmount = 0;
  for (const row of rows) {
    if (row.amount === null) continue;
    withAmount += 1;
    if (row.action === 'RESTORE_SALARY_PAYMENT') restored += row.amount;
    else if (row.action === 'DELETE_SALARY_PAYMENT') removed += row.amount;
  }
  return { count: rows.length, withAmount, removed, restored };
}
