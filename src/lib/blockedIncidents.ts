/**
 * ─── Plusieurs postes, UNE panne ───────────────────────────────────────────
 *
 * Un blocage remonte au journal d'audit par POSTE : chaque machine bloquée
 * inscrit sa propre ligne (`src/lib/desktopUpdateReport.ts`, qui la compose à
 * partir de la décision de `electron/updater-policy.cjs`). C'est exact — chaque
 * ligne est une preuve, et le journal d'audit est append-only pour cette
 * raison — mais ça ne répond pas à la question que l'administrateur se pose
 * VRAIMENT devant une école entière : « qu'est-ce qui est cassé, et combien de
 * machines ça touche ? ». Vingt postes bloqués par le même 404, ce sont vingt
 * lignes identiques à la station près, donc un motif noyé dans vingt
 * répétitions — et un signalement qu'on ne lit plus ne signale rien.
 *
 * Ce module est la moitié « lecture » de ce problème : il REGROUPE les
 * remontées par panne, en un incident par cause. Il ne touche pas au journal
 * (on ne réécrit pas une preuve, et un journal qu'on modifie n'est plus un
 * journal) : il lit les entrées existantes et rend une vue.
 *
 * ─── Ce qui définit « la même panne », et rien de plus ─────────────────────
 * La clé d'un incident est le COUPLE que la politique et le poste ont déjà
 * choisi comme identité (`entryKey` du journal local, `blockId` de la
 * remontée) — code, et version visée — PLUS le motif :
 *
 *   • **le code** dit la nature de l'échec (installation non aboutie, portable
 *     qui ne peut pas satisfaire la porte, téléchargement en échec) ;
 *   • **la version visée** en fait partie : un blocage sur une version plus
 *     récente est une information NEUVE, et fondre les deux effacerait la
 *     distinction que la file du poste prend déjà la peine de faire ;
 *   • **le motif** est ce qui sépare deux causes réelles. Deux machines
 *     bloquées par le même code ET la même version mais avec deux motifs
 *     différents ne sont pas le même incident : c'est exactement le genre de
 *     raccourci qui ferait disparaître une panne derrière une autre.
 *
 * La VERSION INSTALLÉE, elle, n'entre PAS dans la clé : une même panne frappe
 * naturellement un parc dont les postes ne sont pas tous au même numéro
 * (1.0.3 → 2.0.0 et 1.0.4 → 2.0.0 bloqués par le même 404, c'est une panne,
 * pas deux). La station non plus, évidemment : c'est tout l'objet du
 * regroupement.
 *
 * ─── Ce qu'on refuse de regrouper ──────────────────────────────────────────
 * Une entrée dont le motif ou la station n'est pas lisible n'est PAS fondue
 * dans un incident : elle reste une ligne à part. Deux raisons, dans l'ordre
 * d'importance : on ne devine pas une panne à partir d'un texte qu'on n'a pas
 * su lire, et une entrée illisible rejointe par erreur dans un incident la
 * ferait disparaître — l'inverse exact du but. C'est la même asymétrie que
 * partout ailleurs dans ce dépôt : se tromper en séparant coûte une ligne de
 * plus à lire ; se tromper en fondant coûte une panne.
 */
import type { AuditLogEntry } from './auditLogger';

/** Le préfixe d'action que les deux remontées de poste partagent. */
const BLOCKED_ACTION = /^poste bloqué — mise à jour obligatoire \(([^)]+)\)/;

/** Le séparateur des champs d'un rapport — posé par le composeur, jamais deviné. */
const FIELD_SEP = ' · ';

/**
 * Les champs qui SUIVENT le motif dans un rapport. Ils bornent sa fin : un
 * motif est un message d'erreur libre, qui peut lui-même contenir le
 * séparateur, mais il ne peut pas contenir un de ces marqueurs à leur place.
 */
const MOTIF_END = [/^journal local/, /^constaté le /, /^bloqué \d+ fois$/];

/** « bloqué 3 fois » — le compte que la déduplication de la file ne doit pas perdre. */
const OCCURRENCES = /^bloqué (\d+) fois$/;

/** « constaté le <date> » — quand le poste a buté, pour une remontée tardive. */
const OCCURRED_AT = /^constaté le (.+)$/;

/** Les versions d'un rapport : « version 1.0.4 → 1.0.5 ». */
const VERSIONS = /^version (\S+) → (\S+)$/;

export interface ParsedBlockedReport {
  /** La nature de l'échec, telle que la politique l'a nommée. */
  code: string;
  /** Le poste bloqué — ce qui DISTINGUE deux remontées de la même panne. */
  station: string;
  /** La version installée sur ce poste, ou null si le rapport ne la portait pas. */
  currentVersion: string | null;
  /** La version visée par la mise à jour obligatoire, ou null. */
  targetVersion: string | null;
  /** Le motif, recopié sans être résumé (c'est lui qui sépare deux causes). */
  motif: string;
  /** Combien de fois le poste a buté (« 1 » quand le rapport n'en dit rien). */
  occurrences: number;
  /** L'instant du constat, quand c'est une remontée depuis le journal local. */
  occurredAt: string | null;
  /** vrai = remontée tardive depuis le journal du poste, faux = signalement en direct. */
  queued: boolean;
}

export interface BlockedIncident {
  /** L'identité de la panne : code + version visée + motif. */
  key: string;
  code: string;
  targetVersion: string | null;
  motif: string;
  /** Les postes touchés, sans doublon, du plus récent au plus ancien. */
  stations: string[];
  /** Le nombre de remontées brutes (une par poste et par version, en général). */
  reports: AuditLogEntry[];
  /** La somme des occurrences déclarées : « bloqué 40 fois » ne se lit pas « une fois ». */
  occurrences: number;
  /** La remontée la plus ancienne et la plus récente du lot. */
  firstAt: string;
  lastAt: string;
}

/**
 * Lire un rapport de poste bloqué tel que le journal d'audit l'a stocké.
 *
 * @param log une entrée du journal d'audit
 * @returns les champs du rapport, ou `null` quand ce n'en est pas un — ou quand
 *   ce qu'il dit n'est pas lisible (auquel cas il ne doit pas être regroupé).
 */
export function parseBlockedReport(log: AuditLogEntry | null | undefined): ParsedBlockedReport | null {
  if (!log || typeof log.action !== 'string') return null;
  const action = BLOCKED_ACTION.exec(log.action);
  if (!action) return null;
  if (log.targetType && log.targetType !== 'update') return null;
  const parts = String(log.details ?? '').split(FIELD_SEP);
  const station = parts.find((part) => part.startsWith('poste '))?.slice('poste '.length).trim();
  const motifAt = parts.findIndex((part) => part.startsWith('motif : '));
  // Sans station ou sans motif, il n'y a rien à regrouper : une entrée qu'on ne
  // sait pas lire reste une ligne à part plutôt que de rejoindre un incident
  // par défaut (elle y disparaîtrait).
  if (!station || motifAt === -1) return null;
  let motifEnd = parts.length;
  for (let index = motifAt + 1; index < parts.length; index += 1) {
    if (MOTIF_END.some((pattern) => pattern.test(parts[index]))) {
      motifEnd = index;
      break;
    }
  }
  const motif = [parts[motifAt].slice('motif : '.length), ...parts.slice(motifAt + 1, motifEnd)]
    .join(FIELD_SEP)
    .trim();
  const versionLine = parts.find((part) => part.startsWith('version ')) ?? '';
  const versions = VERSIONS.exec(versionLine);
  const counted = parts.map((part) => OCCURRENCES.exec(part)).find(Boolean);
  const at = parts.map((part) => OCCURRED_AT.exec(part)).find(Boolean);
  const occurrences = counted ? Math.max(1, Number(counted[1])) : 1;
  return {
    code: action[1].trim(),
    station,
    currentVersion: versions && versions[1] !== '?' ? versions[1] : null,
    targetVersion: versions && versions[2] !== '?' ? versions[2] : (log.targetId ?? null),
    motif: motif || 'non précisé',
    occurrences: Number.isFinite(occurrences) ? occurrences : 1,
    occurredAt: at ? at[1].trim() : null,
    queued: /— remonté depuis le journal du poste\s*$/.test(log.action),
  };
}

/** L'instant d'une entrée, en millisecondes — 0 quand il est illisible, jamais NaN. */
function timeOf(iso: string | null | undefined): number {
  const ms = Date.parse(String(iso ?? ''));
  return Number.isFinite(ms) ? ms : 0;
}

/**
 * Une clé de motif comparable : espaces normalisés, casse ignorée.
 *
 * Le même message d'erreur arrive avec deux espaces après un saut de ligne
 * selon la façon dont il a été capturé ; deux postes qui rapportent le même
 * 404 doivent se rejoindre. En revanche rien d'autre n'est masqué : ni les
 * chemins, ni les numéros de statut, ni les noms de fichiers — masquer
 * « quelque chose qui ressemble à un nombre » ferait tomber deux pannes
 * distinctes (404 et 500) dans le même incident, ce qui est le mauvais sens de
 * l'erreur.
 */
function motifKey(motif: string): string {
  return motif.replace(/\s+/g, ' ').trim().toLowerCase();
}

/**
 * Les incidents du journal : une entrée par panne, quelle que soit la taille du
 * parc qui la subit.
 *
 * @param logs les entrées du journal d'audit (l'ordre n'importe pas)
 * @returns les incidents, du plus récemment vu au plus ancien
 */
export function blockedIncidents(logs: AuditLogEntry[] | null | undefined): BlockedIncident[] {
  const byKey = new Map<string, BlockedIncident>();
  for (const log of Array.isArray(logs) ? logs : []) {
    const report = parseBlockedReport(log);
    if (!report) continue;
    const key = `${report.code}|${report.targetVersion ?? ''}|${motifKey(report.motif)}`;
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, {
        key,
        code: report.code,
        targetVersion: report.targetVersion,
        motif: report.motif,
        stations: [report.station],
        reports: [log],
        occurrences: report.occurrences,
        firstAt: log.createdAt,
        lastAt: log.createdAt,
      });
      continue;
    }
    existing.reports.push(log);
    existing.occurrences += report.occurrences;
    if (!existing.stations.includes(report.station)) existing.stations.push(report.station);
    if (timeOf(log.createdAt) > timeOf(existing.lastAt)) existing.lastAt = log.createdAt;
    if (timeOf(log.createdAt) < timeOf(existing.firstAt)) existing.firstAt = log.createdAt;
  }
  for (const incident of byKey.values()) {
    // Les rapports et les postes se lisent du plus récent au plus ancien : dans
    // un incident, la question « qui est encore bloqué ? » se pose avant « qui
    // l'a été le premier ? ».
    incident.reports.sort((a, b) => timeOf(b.createdAt) - timeOf(a.createdAt));
    const firstSeen = new Map<string, number>();
    for (const record of incident.reports) {
      const station = parseBlockedReport(record)?.station;
      if (station && !firstSeen.has(station)) firstSeen.set(station, timeOf(record.createdAt));
    }
    incident.stations.sort((a, b) => (firstSeen.get(b) ?? 0) - (firstSeen.get(a) ?? 0));
  }
  return [...byKey.values()].sort((a, b) => timeOf(b.lastAt) - timeOf(a.lastAt));
}

/** Une ligne de la vue « journal d'audit » : une entrée, ou un incident regroupé. */
export type AuditRow =
  | { kind: 'log'; at: string; log: AuditLogEntry }
  | { kind: 'incident'; at: string; incident: BlockedIncident };

/**
 * Les lignes à afficher, incidents regroupés.
 *
 * Un incident prend la place de sa remontée la PLUS RÉCENTE : c'est là que
 * l'administrateur regarde, et l'incident y reste visible tant qu'un poste
 * bute. Rien n'est retiré : les remontées brutes restent attachées à
 * l'incident (`incident.reports`), et l'interface les déplie.
 *
 * @param logs les entrées du journal d'audit
 * @returns les lignes, du plus récent au plus ancien
 */
export function incidentRows(logs: AuditLogEntry[] | null | undefined): AuditRow[] {
  const all = Array.isArray(logs) ? logs : [];
  const incidents = blockedIncidents(all);
  const grouped = new Set<AuditLogEntry>();
  for (const incident of incidents) for (const record of incident.reports) grouped.add(record);
  const rows: AuditRow[] = [];
  for (const log of all) {
    if (!grouped.has(log)) rows.push({ kind: 'log', at: log.createdAt, log });
  }
  for (const incident of incidents) rows.push({ kind: 'incident', at: incident.lastAt, incident });
  return rows.sort((a, b) => timeOf(b.at) - timeOf(a.at));
}
