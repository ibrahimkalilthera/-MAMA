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
 *
 * ─── Ce que le poste sait de l'école, et d'où il le sait ─────────────────────
 * Deux remontées du même canal portent le nom de l'école À CÔTÉ de celui de la
 * machine (`école …` juste après `poste …`). Le nom est un fait de
 * l'ÉTABLISSEMENT (`src/lib/schoolName.ts`, clé `school.name` d'`app_settings`) :
 * il est lu par le RENDU — une session existe, donc `app_settings` est lisible —
 * et il est passé ici par l'appelant, exactement comme le nom du poste, qui vient
 * lui du processus principal. Le fichier local du poste (`electron/update-journal.cjs`)
 * ne le porte PAS, et ne peut pas le porter : le processus principal n'a ni
 * session ni lecture de `app_settings`, et lui inventer un nom d'école serait le
 * pire des deux mondes.
 *
 * Trois règles, et chacune évite un défaut précis :
 *   • **l'absence est SILENCIEUSE.** Aucune école déclarée, lecture ratée (réseau
 *     coupé) ou nom illisible : le champ n'est pas écrit du tout. « école
 *     inconnue » se lirait ailleurs comme un nom d'école parmi d'autres, et
 *     l'administrateur chercherait une école qui n'existe pas — c'est la règle de
 *     `schoolField`, appliquée ici.
 *   • **une remontée TARDIVE porte l'école où le poste est déclaré**, pas celle
 *     d'un autre poste : le journal local d'une machine ne quitte pas cette
 *     machine, et un poste ne change pas d'école entre le blocage et le
 *     démarrage connecté qui le remonte. Le champ dit donc quelque chose de
 *     vrai, même pour une entrée vieille de trois semaines.
 *   • **le champ est lu par les lecteurs existants, pas collé à la fin.** Il est
 *     posé juste après `poste …`, AVANT `version …` et `motif : …` :
 *     `src/lib/blockedIncidents.ts` cherche ces marqueurs par leur préfixe et
 *     borne le motif à leur rencontre — un champ ajouté au milieu ne décale donc
 *     rien, alors qu'un champ collé après le motif se lirait comme la suite du
 *     message d'erreur.
 *
 * ─── Le journal ne porte pas QUE des pannes ─────────────────────────────────
 * La file du poste emporte aussi ce qui n'est pas un blocage, et le premier cas
 * est la CONVERSION `portable` → `installed` : elle s'inscrit au journal par le
 * processus principal (`electron/main.cjs`), au seul instant où elle est
 * constatable. C'est le relevé de parc qui la DATE (§7 du canal) — mais le
 * relevé est **anonyme par construction** : il dit « un poste s'est converti le
 * … », jamais lequel. Or « quelle école ? » est la question que la première
 * conversion pose, et la seule réponse qu'un poste puisse apporter sans qu'on
 * invente est son propre nom. Une conversion se compose donc, comme un blocage,
 * avec le nom du poste — mais **elle ne se dit pas « poste bloqué »** (voir
 * `journalAuditEntry`) : nommer un blocage qui n'existe pas enverrait chercher
 * une porte fermée, et ferait passer la seule bonne nouvelle de ce canal pour
 * une panne.
 */
import type { LogAuditParams } from './auditLogger';
import { schoolField } from './schoolName';

/** Ce que le processus principal inscrit d'un poste bloqué. */
export interface BlockedUpdate {
  code: 'install' | 'manual' | 'download' | 'checksum' | string;
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
 * L'intitulé d'un signalement, choisi par sa CAUSE et pas par un mot passe-partout.
 *
 * Un blocage de la porte et une promesse d'octets non tenue ne se lisent pas de
 * la même façon dans un journal d'audit : dire « mise à jour obligatoire » d'un
 * poste qui n'était PAS obligé ferait chercher une porte fermée qui n'existe pas,
 * alors que le vrai sujet est un canal qui sert autre chose que ce qu'il annonce
 * — et c'est valable pour tous les postes, obligés ou non.
 */
const blockAction = (code: string): string =>
  code === 'checksum'
    ? 'mise à jour refusée — les octets servis ne répondent pas au flux (checksum)'
    : `poste bloqué — mise à jour obligatoire (${code})`;

/**
 * Le code du fait d'une CONVERSION dans le journal du poste.
 *
 * Il doit rester identique à `CONVERSION_CODE` d'`electron/station-beat.cjs`, qui
 * l'écrit : les deux modules sont les deux moitiés du même fait, et un cas de
 * `tests/gate-report.test.ts` fait échouer le désaccord (le lecteur traiterait
 * alors une conversion comme une panne, ou l'inverse).
 */
export const CONVERSION_CODE = 'converted';

/**
 * L'intitulé d'une conversion — il n'annonce pas une panne, parce qu'il n'y en a
 * pas : le poste s'est installé seul et se met à jour tout seul désormais.
 */
const CONVERSION_ACTION =
  'poste portable converti en poste installé — il se met à jour tout seul désormais';

/**
 * Le champ « école <nom> » d'une remontée — ou AUCUN champ, jamais un aveu.
 *
 * Rendu comme une liste à zéro ou un élément, pour que l'appelant l'étale dans
 * les siens (`...schoolPart(school)`) sans écrire deux fois la composition : la
 * position du champ (juste après le poste) est une décision du composeur, pas de
 * ses quatre appelants.
 *
 * @param school le nom lu par le rendu (ou `null` : rien de lu, ou rien déclaré)
 */
function schoolPart(school: string | null | undefined): string[] {
  const field = schoolField(school);
  return field === null ? [] : [field];
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
 * @param school nom de l'école tel que le RENDU l'a lu (voir `useSchoolName`) —
 *   absent ou illisible, le champ disparaît plutôt que de dire « inconnue ».
 * @returns l'entrée d'audit, ou null si le poste n'est pas bloqué.
 */
export function blockedAuditEntry(
  state: ReportableState | null | undefined,
  { station = null, school = null }: { station?: string | null; school?: string | null } = {},
): BlockedReport | null {
  if (!state || !state.blocked) return null;
  const blocked = state.blocked;
  const where = blocked.station || station || 'poste inconnu';
  const parts = [
    `poste ${where}`,
    ...schoolPart(school),
    `version ${state.currentVersion ?? '?'} → ${state.version ?? '?'}`,
    `motif : ${blocked.detail}`,
  ];
  if (blocked.journal) parts.push(`journal local : ${blocked.journal}`);
  // Un journal local qui n'a PAS pu être écrit est dit : sinon l'administrateur
  // chercherait un fichier qui n'existe pas, et croirait le poste silencieux.
  if (blocked.recorded === false) parts.push('journal local non écrit (disque ou droits)');
  return {
    action: blockAction(blocked.code),
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
  options: { station?: string | null; school?: string | null; user?: LogAuditParams['user'] } = {},
): Promise<ReportOutcome> {
  const entry = blockedAuditEntry(state, {
    station: options.station ?? null,
    school: options.school ?? null,
  });
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
 * Le rapport d'un fait REMONTÉ DEPUIS LA FILE — un blocage, ou une conversion.
 *
 * Il porte deux choses que le rapport en direct n'a pas, et sans lesquelles la
 * remontée tardive se lirait de travers : QUAND le poste a buté (`at`), et
 * COMBIEN de fois (`occurrences`) — c'est la seule information que la
 * déduplication de la file pourrait perdre, et « bloqué 40 fois » qui se lirait
 * « bloqué une fois » ferait passer une école entière pour un incident isolé.
 * Ces deux lectures ne s'appliquent qu'à un blocage : une conversion a eu lieu
 * une fois, et sa date est celle du constat, pas d'une répétition.
 *
 * @param entry une entrée de la file
 * @param station le nom du poste, quand l'entrée ne le porte pas
 * @param school le nom de l'école, quand le poste en a déclaré une
 * @returns le rapport, ou null si l'entrée ne dit rien d'exploitable.
 */
export function journalAuditEntry(
  entry: QueuedReport | null | undefined,
  { station = null, school = null }: { station?: string | null; school?: string | null } = {},
): BlockedReport | null {
  if (!entry || !entry.code) return null;
  const where = entry.station || station || 'poste inconnu';
  // ─── Une conversion n'est PAS un blocage ──────────────────────────────────
  // Le même journal porte les deux, et les confondre coûterait cher dans les
  // deux sens : lue comme un blocage, la seule bonne nouvelle de ce canal
  // enverrait chercher une porte fermée qui n'existe pas (et `blockedIncidents`
  // la regrouperait avec des pannes) ; lue comme une conversion, une panne
  // disparaîtrait. Le code est donc jugé AVANT la composition du blocage, et la
  // ligne d'une conversion ne se lit pas comme celle d'un rapport d'échec : il
  // n'y a pas de motif, parce qu'il n'y a pas d'échec — ce que le poste constate
  // est son propre passage.
  if (entry.code === CONVERSION_CODE) {
    const parts = [
      `poste ${where}`,
      ...schoolPart(school),
      'conversion portable → installé',
      `version ${entry.currentVersion ?? '?'} → ${entry.version ?? '?'}`,
    ];
    if (entry.detail) parts.push(`constat : ${entry.detail}`);
    if (entry.at) parts.push(`constaté le ${entry.at}`);
    return {
      action: `${CONVERSION_ACTION} — remonté depuis le journal du poste`,
      targetType: 'update',
      targetId: entry.version ?? null,
      details: parts.join(' · '),
    };
  }
  const parts = [
    `poste ${where}`,
    ...schoolPart(school),
    `version ${entry.currentVersion ?? '?'} → ${entry.version ?? '?'}`,
    `motif : ${entry.detail || 'non précisé'}`,
  ];
  if (entry.at) parts.push(`constaté le ${entry.at}`);
  const occurrences = Number(entry.occurrences ?? 1);
  if (Number.isFinite(occurrences) && occurrences > 1) parts.push(`bloqué ${occurrences} fois`);
  return {
    action: `${blockAction(entry.code)} — remonté depuis le journal du poste`,
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
    school?: string | null;
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
    const report = journalAuditEntry(entry, {
      station: payload?.station ?? null,
      school: options.school ?? null,
    });
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
