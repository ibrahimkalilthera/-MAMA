/**
 * ─── Les réglages d'affichage, côté BASE ────────────────────────────────────
 *
 * Le contrat (noms, clés, valeurs admises, règles d'adoption et de publication)
 * vit dans `src/lib/displayPreferences.ts`. Ici, et seulement ici, l'accès à la
 * table : LIRE les quatre lignes d'`app_settings` pour qu'un poste neuf adopte
 * ce que l'école avait réglé, et EN ÉCRIRE une quand quelqu'un change un
 * réglage.
 *
 * POURQUOI CETTE COUCHE ET PAS UNE ÉCRITURE AILLEURS : la table est sauvegardée
 * et restaurée (`scripts/lib/db-tables.mjs`), donc l'écrire c'est faire voyager
 * la préférence. Et c'est la couche que `check:write-gates` croise avec la porte
 * d'écran qui l'offre : écrire `app_settings` ailleurs la ferait échapper au
 * contrôle qui compare l'écran aux politiques de la base.
 *
 * DEUX HONNÊTETÉS, qui sont le sujet de cette couche :
 *
 *   • une valeur que la préférence n'ADMET PAS n'est pas écrite du tout — elle
 *     est refusée (`false`) au lieu d'aller poser en base un thème inexistant ;
 *   • un échec d'écriture n'est pas un succès : `false` dit que la copie durable
 *     n'a pas pris le changement (le poste, lui, garde son choix — l'écran n'a
 *     donc pas menti, c'est la copie qui est en retard).
 *
 * HORS LIGNE, le changement n'est pas perdu : il part dans la file (le même
 * chemin que les notes du calendrier et la déclaration de l'année), avec son nom
 * et sa valeur — deux chaînes courtes, et le rejeu écrit exactement la ligne du
 * chemin en ligne (`displayPreferenceRow`).
 */
import { supabase } from '../supabaseClient';
import { logAuditEvent } from '../auditLogger';
import { enqueueOfflineAction } from '../offlineQueue';
import { isStationOffline } from '../networkUtils';
import {
  DISPLAY_PREFERENCE_KEYS,
  displayPreferenceRow,
  isDisplayPreferenceValue,
  parseDisplayPreferences,
  type DisplayPreferenceName,
  type DisplayPreferences,
} from '../displayPreferences';
import {
  SCHOOL_NAME_KEY,
  normalizeSchoolName,
  parseSchoolName,
  schoolNameRow,
  type SchoolNameSaveResult,
} from '../schoolName';

/** Les quatre clés lues d'un coup, dans l'ordre où elles sont déclarées. */
const DISPLAY_KEYS = Object.values(DISPLAY_PREFERENCE_KEYS);

/**
 * Lit les quatre préférences de la copie durable.
 *
 * `null` (et non `{}`) quand la base n'a pas répondu : un échec réseau n'est pas
 * « l'école n'a rien réglé », et l'appelant doit pouvoir distinguer les deux —
 * le premier laisse le poste sur ses défauts SANS rien marquer, le second aussi,
 * mais on ne saura jamais qu'on n'a pas regardé si les deux se confondent.
 */
export async function fetchDisplayPreferences(): Promise<Partial<DisplayPreferences> | null> {
  const { data, error } = await supabase.from('app_settings').select('key, value').in('key', DISPLAY_KEYS);
  if (error || !data) return null;
  return parseDisplayPreferences(data);
}

/**
 * Écrit la préférence qu'un poste vient de changer.
 *
 * @returns `true` si la copie durable a pris le changement (écrit, ou mis en
 *   file hors ligne), `false` si elle ne l'a pas pris — valeur refusée, file
 *   pleine, ou base en échec. Le poste, lui, a déjà écrit son propre choix.
 */
export async function publishDisplayPreference(
  name: DisplayPreferenceName,
  value: string,
): Promise<boolean> {
  const key = DISPLAY_PREFERENCE_KEYS[name];
  if (!key) return false;
  // Une valeur hors contrat n'est pas publiée : elle ne serait relue par aucun
  // poste (la lecture valide), donc l'écrire serait du bruit en base.
  if (!isDisplayPreferenceValue(name, value)) return false;

  if (isStationOffline()) {
    try {
      enqueueOfflineAction('setDisplayPreference', { name, value });
    } catch (err) {
      // La file refuse (pleine, stockage illisible) : la copie durable n'aura
      // pas ce changement, et le dire vaut mieux que de le croire rangé.
      console.error('Préférence d’affichage non mise en file :', (err as Error)?.message ?? err);
      return false;
    }
    return true;
  }

  // `.select('key')` : une écriture retirée par une politique répond 200 avec un
  // corps VIDE, et compter ça comme publié retirerait de l'écran un réglage qui
  // n'est jamais arrivé en base. Le contrôle est celui des autres écritures du
  // dépôt (voir tests/dataops-write-honesty.test.ts).
  const { data, error } = await supabase
    .from('app_settings')
    .upsert(displayPreferenceRow(key, value), { onConflict: 'key' })
    .select('key');
  if (error || !data || data.length === 0) {
    console.warn('Préférence d’affichage non publiée :', error?.message ?? 'aucune ligne écrite');
    return false;
  }
  // Le geste est journalisé comme le sont les autres réglages (`UPDATE_SETTING`,
  // libellé « Réglage modifié ») : la clé et sa valeur sont des identifiants
  // stockés, pas de la prose à traduire.
  void logAuditEvent({
    action: 'UPDATE_SETTING',
    targetType: 'app_settings',
    targetId: key,
    details: `${key} = ${value}`,
  });
  return true;
}

// ─── Le nom de l'école : une ligne, écrite par l'administration ──────────────
//
// Le contrat (clé, bornes, forme de la ligne) vit dans `src/lib/schoolName.ts`.
// Ici, et seulement ici, l'accès à la table — la MÊME couche que les préférences
// d'affichage, pour la même raison : `app_settings` est la table que la
// sauvegarde emporte, donc l'écrire c'est faire voyager le nom ; et c'est la
// couche que `check:write-gates` croise avec la porte d'écran qui l'offre.
//
// Deux différences avec les préférences, et elles viennent du sujet : le nom
// n'est PAS adopté poste par poste (il est le même partout, `parseSchoolName`
// n'a pas de règle d'adoption à appliquer), et il n'est écrit que par
// l'administration — c'est la base qui le dit (les politiques d'`app_settings`
// réservent l'écriture à `is_admin()`, aucune politique nouvelle n'a été créée
// pour lui).

/**
 * Lit le nom de l'école.
 *
 * `null` veut dire « la base n'a pas répondu » — la lecture a ÉCHOUÉ. C'est
 * distinct de `{ declared: null }`, qui dit « la lecture a réussi, et aucune
 * école n'a déclaré son nom » : les confondre ferait afficher « non déclaré »
 * devant une coupure réseau, c'est-à-dire ferait passer une ignorance pour un
 * fait. C'est la même asymétrie que `fetchDisplayPreferences`.
 */
export async function fetchSchoolName(): Promise<{ declared: string | null } | null> {
  const { data, error } = await supabase.from('app_settings').select('key, value').eq('key', SCHOOL_NAME_KEY);
  if (error || !data) return null;
  // Aucune ligne : l'école n'a jamais écrit son nom. `parseSchoolName` rend
  // `null` — et cette fois c'est un FAIT, pas une panne.
  return { declared: parseSchoolName(data) };
}

/**
 * Écrit le nom de l'école — le geste de l'administration.
 *
 * @returns l'un des TROIS états, jamais un booléen : `saved` (la copie durable
 *   porte le nom), `queued` (hors ligne, le geste partira au retour de la ligne)
 *   ou `refused` (nom hors contrat, file pleine, droits, ou base en échec).
 *   L'écran les dit séparément — « enregistré » qui couvrirait « mis en file »
 *   annoncerait une écriture en base qui n'a pas eu lieu.
 */
export async function publishSchoolName(name: string): Promise<SchoolNameSaveResult> {
  // Ce que le contrat refuse n'est PAS écrit : ni tronqué, ni « réparé ». Un nom
  // hors bornes écrit en base serait lu par toutes les remontées de poste.
  const normalized = normalizeSchoolName(name);
  if (normalized === null) return 'refused';

  if (isStationOffline()) {
    try {
      // Le nom voyage (pas la clé `app_settings`) : la correspondance nom → clé
      // n'existe qu'au contrat, et une file écrite par une version antérieure ne
      // peut pas porter une clé qu'elle ne connaît pas.
      enqueueOfflineAction('setSchoolName', { name: normalized });
    } catch (err) {
      console.error('Nom de l’école non mis en file :', (err as Error)?.message ?? err);
      return 'refused';
    }
    return 'queued';
  }

  // `.select('key')` : une écriture retirée par une politique répond 200 avec un
  // corps VIDE, et la compter comme enregistrée retirerait de l'école un nom que
  // la base n'a jamais reçu. C'est ici que la porte d'administration se vérifie
  // pour de vrai — un compte non administrateur écrit zéro ligne.
  const { data, error } = await supabase
    .from('app_settings')
    .upsert(schoolNameRow(normalized), { onConflict: 'key' })
    .select('key');
  if (error || !data || data.length === 0) {
    console.warn('Nom de l’école non publié :', error?.message ?? 'aucune ligne écrite');
    return 'refused';
  }
  // Le geste est journalisé comme les autres réglages (`UPDATE_SETTING`, libellé
  // « Réglage modifié ») : la clé et la valeur sont des identifiants stockés, pas
  // de la prose à traduire.
  void logAuditEvent({
    action: 'UPDATE_SETTING',
    targetType: 'app_settings',
    targetId: SCHOOL_NAME_KEY,
    details: `${SCHOOL_NAME_KEY} = ${normalized}`,
  });
  return 'saved';
}
