/**
 * Le signalement d'un poste bloqué par la porte — la moitié « journal d'audit ».
 *
 * Le journal local (`electron/update-journal.cjs`) inscrit un blocage sans
 * réseau ni session ; il est donc toujours écrit, mais il reste SUR le poste.
 * L'administrateur, lui, est ailleurs : sans cet envoi, il faudrait aller voir
 * chaque machine une par une pour découvrir qu'elle est bloquée — c'est-à-dire
 * ne rien découvrir du tout.
 *
 * Trois règles, et chacune évite un défaut précis :
 *   • **la composition du rapport est pure** (`blockedAuditEntry`) : ce qui
 *     part au journal d'audit est décidé et testé ici, pas recopié dans un
 *     composant ;
 *   • **un seul envoi par blocage** (`blockId`) : une vérification a lieu toutes
 *     les 30 minutes, donc un envoi par événement remplirait le journal d'audit
 *     de la même panne jusqu'à le rendre illisible — et un journal qu'on cesse
 *     de lire ne signalera plus rien ;
 *   • **un échec d'envoi n'est jamais silencieux** : l'appelant reçoit `sent`,
 *     et le journal local reste la preuve de ce qui s'est passé sur ce poste.
 */
import type { LogAuditParams } from './auditLogger';

/** Ce que le processus principal inscrit d'un poste bloqué. */
export interface BlockedUpdate {
  code: 'install' | 'manual' | 'download' | string;
  detail: string;
  station?: string | null;
  journal?: string | null;
  /** faux = le journal local n'a pas pu être écrit (disque, droits). */
  recorded?: boolean;
}

/** L'état de mise à jour reçu du pont, réduit à ce qui sert au signalement. */
export interface ReportableState {
  blocked?: BlockedUpdate | null;
  version?: string | null;
  currentVersion?: string | null;
}

export interface BlockedReport {
  action: string;
  targetType: string;
  targetId: string | null;
  details: string;
}

export interface ReportOutcome {
  sent: boolean;
  /** Le texte envoyé (ou qui aurait été envoyé) : affiché tel quel, jamais résumé. */
  detail: string;
}

/**
 * L'identité d'un blocage : même code ET même version cible ⇒ même panne.
 *
 * La version fait partie de l'identité parce qu'un blocage qui se répète sur une
 * version PLUS RÉCENTE est une information neuve (le poste a peut-être installé
 * quelque chose entre-temps), alors qu'un blocage qui se répète à l'identique
 * n'apprend rien de plus.
 *
 * @returns la clé, ou null s'il n'y a rien à signaler.
 */
export function blockId(state: ReportableState | null | undefined): string | null {
  if (!state || !state.blocked) return null;
  return `${state.blocked.code}|${state.version ?? ''}`;
}

/**
 * Le rapport envoyé au journal d'audit.
 *
 * Il nomme le POSTE, parce que c'est la première question de l'administrateur
 * (« lequel ? »), et il recopie le motif de la politique au lieu de le résumer :
 * un rapport qui perd le motif oblige à rappeler l'utilisateur pour savoir ce
 * qui se passe.
 *
 * @param state état reçu du processus principal
 * @param station nom du poste (le processus principal le fournit)
 * @returns l'entrée d'audit, ou null si le poste n'est pas bloqué.
 */
export function blockedAuditEntry(
  state: ReportableState | null | undefined,
  { station = null }: { station?: string | null } = {},
): BlockedReport | null {
  if (!state || !state.blocked) return null;
  const blocked = state.blocked;
  const where = blocked.station || station || 'poste inconnu';
  const parts = [
    `poste ${where}`,
    `version ${state.currentVersion ?? '?'} → ${state.version ?? '?'}`,
    `motif : ${blocked.detail}`,
  ];
  if (blocked.journal) parts.push(`journal local : ${blocked.journal}`);
  // Un journal local qui n'a PAS pu être écrit est dit : sinon l'administrateur
  // chercherait un fichier qui n'existe pas, et croirait le poste silencieux.
  if (blocked.recorded === false) parts.push('journal local non écrit (disque ou droits)');
  return {
    action: `poste bloqué — mise à jour obligatoire (${blocked.code})`,
    targetType: 'update',
    targetId: state.version ?? null,
    details: parts.join(' · '),
  };
}

/**
 * Envoyer le blocage au journal d'audit, si le poste a une session.
 *
 * L'import d'`auditLogger` est PARESSEUX et volontaire : ce module porte une
 * décision testable (`blockedAuditEntry`) et n'a aucune raison de charger un
 * client Supabase — donc de dépendre d'une configuration — pour être testé.
 *
 * @returns `sent` (le journal d'audit porte-t-il le rapport ?) et le texte
 *   envoyé, que l'interface affiche tel quel.
 */
export async function reportBlockedStation(
  state: ReportableState | null | undefined,
  options: { station?: string | null; user?: LogAuditParams['user'] } = {},
): Promise<ReportOutcome> {
  const entry = blockedAuditEntry(state, { station: options.station ?? null });
  if (!entry) return { sent: false, detail: '' };
  try {
    const { logAuditEvent } = await import('./auditLogger');
    const sent = await logAuditEvent({
      action: entry.action,
      targetType: entry.targetType,
      targetId: entry.targetId,
      details: entry.details,
      user: options.user,
    });
    return { sent, detail: entry.details };
  } catch {
    return { sent: false, detail: entry.details };
  }
}
