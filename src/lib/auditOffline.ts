/**
 * ─── « Ce qui a été saisi hors ligne » : une marque, pas une déduction ──────
 *
 * Un geste fait sans réseau part dans la file du poste et n'atteint la base qu'à
 * la reconnexion. Le défaut mesuré : l'entrée portait alors l'instant du CÂBLE
 * (le dimanche 22 h 50 se lisait « lundi 8 h 05 »), et rien ne disait qu'elle
 * avait attendu. Le geste de fin de semaine basculait donc dans la semaine
 * d'archive suivante, sans que personne puisse s'en apercevoir.
 *
 * Ce module est la seule définition de « cette entrée vient d'un poste coupé »,
 * et elle lit un DRAPEAU (`recordedOffline`), jamais un texte : chercher un
 * « [replay] » glissé dans `details` rapprocherait deux entrées d'un même mot, et
 * le dépôt refuse ce raccourci partout ailleurs.
 *
 * Deux dates en sortent, et elles ne disent pas la même chose :
 *   • `capturedAt` — l'instant du GESTE, celui qui décide de la semaine ;
 *   • `syncedAt` — l'instant où la ligne a atteint la base, donc « quand la
 *     ligne est revenue ». Absent d'une entrée en ligne, et c'est normal : le
 *     serveur vient de l'écrire.
 *
 * Le module est PUR : il formate par la fonction qu'on lui passe, donc il se
 * mesure sans horloge, sans fuseau et sans DOM.
 */
import type { AuditLogEntry } from './auditLogger';

/** L'origine d'une entrée hors ligne, telle qu'elle s'affiche. */
export interface OfflineOrigin {
  /** L'instant du geste (ISO), écrit par le poste qui l'a fait. */
  capturedAt: string;
  /** L'instant où la ligne a atteint la base (ISO), ou `null` si inconnu. */
  syncedAt: string | null;
}

/**
 * L'origine hors ligne d'une entrée, ou `null` si elle est née en ligne.
 *
 * `recordedOffline === true` est la SEULE porte : une entrée sans drapeau n'est
 * pas marquée, même si l'un de ses champs ressemble à une date ancienne.
 */
export function offlineOriginOf(entry: AuditLogEntry | null | undefined): OfflineOrigin | null {
  if (!entry || entry.recordedOffline !== true) return null;
  const capturedAt = String(entry.createdAt ?? '').trim();
  // Sans instant de geste, la marque n'apprendrait rien : mieux vaut ne pas
  // colorer une ligne que de la colorer pour dire « à une date inconnue ».
  if (!capturedAt) return null;
  const syncedAt = String(entry.syncedAt ?? '').trim();
  return { capturedAt, syncedAt: syncedAt || null };
}

/** Cette entrée a-t-elle été saisie sans réseau ? (raccourci lisible) */
export function isOfflineEntry(entry: AuditLogEntry | null | undefined): boolean {
  return offlineOriginOf(entry) !== null;
}

/**
 * La phrase qui accompagne une ligne hors ligne : « saisi hors ligne le X ·
 * synchronisé le Y ».
 *
 * Les deux fragments viennent des traductions (le document suit la langue du
 * poste), et le second est OMIS quand la date de synchronisation est inconnue :
 * une phrase qui annoncerait une date illisible vaudrait moins que pas de
 * phrase du tout.
 *
 * @param origin l'origine de l'entrée (voir `offlineOriginOf`)
 * @param format comment écrire un instant ISO (le PDF passe son formateur local)
 * @param labels les deux fragments traduits, avec `{at}`
 */
export function offlineOriginNote(
  origin: OfflineOrigin,
  format: (iso: string) => string,
  labels: { captured: string; synced: string },
): string {
  const parts = [labels.captured.replace('{at}', format(origin.capturedAt))];
  if (origin.syncedAt) parts.push(labels.synced.replace('{at}', format(origin.syncedAt)));
  return parts.join(' · ');
}
