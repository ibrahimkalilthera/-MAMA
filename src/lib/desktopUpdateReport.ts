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
  return { sent: await sendAudit(entry, options.user), detail: entry.details };
}

// ─── La file d'attente du poste : remonter ce qui a été inscrit sans session ──
//
// Le signalement ci-dessus part quand le poste est bloqué ET qu'une session
// existe. Or le cas normal d'un poste d'école est l'inverse : il démarre bloqué
// devant personne. Le journal local garde la trace (`reportedAt` nul) — mais un
// journal qui reste sur la machine n'apprend rien à l'administrateur, qui est
// ailleurs. D'où la file : au PREMIER démarrage connecté, les blocages en
// attente partent, et ce qui est parti est marqué.

/** Ce que le processus principal rend pour une entrée en attente. */
export interface QueuedReport {
  /** L'identité de la panne : c'est elle qu'on marque, jamais un index. */
  key?: string;
  code?: string;
  detail?: string;
  station?: string | null;
  version?: string | null;
  currentVersion?: string | null;
  at?: string | null;
  /** Combien de fois la même panne s'est inscrite (la dédup en garde le compte). */
  occurrences?: number;
}

/** Ce que le pont rend : la file, et le nom du poste qui la tient. */
export interface JournalQueuePayload {
  path?: string;
  station?: string;
  entries?: QueuedReport[];
}

/** Le pont, réduit aux deux canaux qui servent à la file. */
export interface JournalQueueApi {
  pendingReports?: () => Promise<JournalQueuePayload | null>;
  markReported?: (keys: string[]) => Promise<{ marked?: number; written?: boolean } | null>;
}

export interface FlushOutcome {
  /** Ce que la file contenait au début de ce passage. */
  queued: number;
  sent: number;
  failed: number;
  /** Entrées réellement marquées par le processus principal. */
  marked: number;
  /** Les clés qui RESTENT en file (envoi raté, ou marquage raté). */
  stillQueued: string[];
}

/**
 * Envoyer un rapport au journal d'audit.
 *
 * Le client Supabase est chargé ICI et jamais à l'import du module : c'est ce
 * qui permet de tester toute la composition sans configuration, et d'importer ce
 * fichier depuis une suite sans effet de bord.
 */
async function sendAudit(entry: BlockedReport, user?: LogAuditParams['user']): Promise<boolean> {
  try {
    const { logAuditEvent } = await import('./auditLogger');
    return await logAuditEvent({
      action: entry.action,
      targetType: entry.targetType,
      targetId: entry.targetId,
      details: entry.details,
      user,
    });
  } catch {
    return false;
  }
}

/**
 * Le rapport d'un blocage REMONTÉ DEPUIS LA FILE.
 *
 * Il porte deux choses que le rapport en direct n'a pas, et sans lesquelles la
 * remontée tardive se lirait de travers : QUAND le poste a buté (`at`), et
 * COMBIEN de fois (`occurrences`) — c'est la seule information que la
 * déduplication de la file pourrait perdre, et « bloqué 40 fois » qui se lirait
 * « bloqué une fois » ferait passer une école entière pour un incident isolé.
 *
 * @param entry une entrée de la file
 * @param station le nom du poste, quand l'entrée ne le porte pas
 * @returns le rapport, ou null si l'entrée ne dit rien d'exploitable.
 */
export function journalAuditEntry(
  entry: QueuedReport | null | undefined,
  { station = null }: { station?: string | null } = {},
): BlockedReport | null {
  if (!entry || !entry.code) return null;
  const where = entry.station || station || 'poste inconnu';
  const parts = [
    `poste ${where}`,
    `version ${entry.currentVersion ?? '?'} → ${entry.version ?? '?'}`,
    `motif : ${entry.detail || 'non précisé'}`,
  ];
  if (entry.at) parts.push(`constaté le ${entry.at}`);
  const occurrences = Number(entry.occurrences ?? 1);
  if (Number.isFinite(occurrences) && occurrences > 1) parts.push(`bloqué ${occurrences} fois`);
  return {
    action: `poste bloqué — mise à jour obligatoire (${entry.code}) — remonté depuis le journal du poste`,
    targetType: 'update',
    targetId: entry.version ?? null,
    details: parts.join(' · '),
  };
}

/**
 * Remonter au journal d'audit ce que la file du poste contient.
 *
 * Appelé au démarrage CONNECTÉ, une fois par session. Trois règles :
 *   • **on ne marque que ce qui est PARTI** : un envoi raté reste en file, sinon
 *     la panne du poste serait effacée par la panne du réseau — l'inverse du
 *     sens utile ;
 *   • **l'ordre suit la file** (du plus récent au plus ancien) et le lot est
 *     borné, parce qu'un poste bloqué des semaines peut en avoir beaucoup ;
 *   • **rien n'est envoyé s'il n'y a rien**: pas de session, pas de pont, ou
 *     file vide rendent un bilan à zéro, sans erreur et sans écrire.
 *
 * Le journal local reste la référence : ce qui n'est pas marqué sera renvoyé au
 * démarrage suivant. Un doublon vaut mieux qu'un silence.
 *
 * @returns le bilan du passage, y compris les clés qui n'ont PAS pu partir.
 */
export async function flushJournalReports(
  options: {
    api?: JournalQueueApi | null;
    log?: (entry: BlockedReport) => Promise<boolean> | boolean;
    limit?: number;
  } = {},
): Promise<FlushOutcome> {
  const empty: FlushOutcome = { queued: 0, sent: 0, failed: 0, marked: 0, stillQueued: [] };
  const api = options.api ?? null;
  if (!api?.pendingReports || !api?.markReported) return empty;

  let payload: JournalQueuePayload | null = null;
  try {
    payload = await api.pendingReports();
  } catch {
    // Un pont muet n'est pas un échec à signaler : le journal du poste reste, et
    // le prochain démarrage connecté retentera.
    return empty;
  }

  const limit = Number.isInteger(options.limit) ? (options.limit as number) : 20;
  const entries = (payload?.entries ?? []).slice(0, Math.max(0, limit));
  if (!entries.length) return empty;

  const send = options.log ?? ((entry: BlockedReport) => sendAudit(entry));
  const sentKeys: string[] = [];
  const stillQueued: string[] = [];
  let failed = 0;
  for (const entry of entries) {
    const key = String(entry.key ?? '');
    const report = journalAuditEntry(entry, { station: payload?.station ?? null });
    if (!report || !key) {
      // Une entrée sans identité ne peut pas être marquée : l'envoyer ferait
      // diverger la file du journal, donc elle est comptée et LAISSÉE en place.
      failed += 1;
      if (key) stillQueued.push(key);
      continue;
    }
    let ok = false;
    try {
      ok = await send(report);
    } catch {
      ok = false;
    }
    if (ok) sentKeys.push(key);
    else {
      failed += 1;
      stillQueued.push(key);
    }
  }

  let marked = 0;
  if (sentKeys.length) {
    try {
      const result = await api.markReported(sentKeys);
      marked = Number(result?.marked ?? 0);
    } catch {
      marked = 0;
    }
  }
  return { queued: entries.length, sent: sentKeys.length, failed, marked, stillQueued };
}
