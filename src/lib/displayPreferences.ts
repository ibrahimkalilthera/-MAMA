/**
 * ─── Les préférences d'affichage, et l'endroit où elles vivent ──────────────
 *
 * Quatre réglages sont ceux d'un ÉCRAN, et pas d'une donnée d'école : le thème,
 * la densité des tableaux, le verre des icônes et la langue. Ils vivaient dans
 * le `localStorage` du poste, et nulle part ailleurs — donc un poste réinstallé
 * repartait aux défauts, alors que la sauvegarde de la base, elle, se restaure.
 *
 * Ils sont maintenant des lignes d'`app_settings` (préfixe `display.`), la table
 * que `scripts/lib/db-tables.mjs` sauvegarde et que `npm run restore:db`
 * restaure : les préférences voyagent parce qu'elles sont des données comme les
 * autres, sans un octet de code en plus dans la chaîne de sauvegarde.
 *
 * DEUX RÈGLES, et ce module les porte une fois :
 *
 *   1. **Le poste gagne.** Un poste qui a DÉJÀ choisi garde son choix : la
 *      copie de la base est adoptée par un poste qui n'a rien (poste neuf,
 *      réinstallation, navigateur vidé). C'est le même principe que le défaut
 *      « animé » du verre : un réglage ne défait pas ce qui est à l'écran, et
 *      l'écran d'un poste ne change pas parce qu'un autre poste a réglé
 *      quelque chose — un vidéoprojecteur de salle et un poste de guichet n'ont
 *      pas le même bon dosage.
 *   2. **Ce qui est publié, c'est un CHANGEMENT.** Le poste écrit la copie
 *      durable au moment où quelqu'un change un réglage — jamais au démarrage :
 *      publier ce que le poste avait déjà ferait de la copie d'école « le
 *      dernier poste qui s'est allumé », c'est-à-dire du bruit.
 *
 * Ce module est PUR (lecture/écriture du poste mises à part) : la comparaison,
 * la validation et la règle d'adoption se jugent sans base, sans réseau et sans
 * React (voir tests/display-preferences.test.ts). L'accès à la base vit dans
 * `src/lib/dataOps/settings.ts`, et la règle d'adoption est APPLIQUÉE par
 * `src/app/useDisplayPreferences.ts`.
 */
import { DENSITY_STORAGE_KEY, type TableDensity } from './density';
import { ICON_GLASS_STORAGE_KEY, type IconGlass } from './iconGlass';
import type { ThemeId } from '../app/mainViewsProps';
import { THEME_IDS, THEME_STORAGE_KEY } from '../app/useTheme';
import type { Language } from '../app/types';

export type DisplayPreferenceName = 'theme' | 'density' | 'iconGlass' | 'language';

/** Les quatre préférences, telles que l'écran les présente. */
export interface DisplayPreferences {
  theme: ThemeId;
  density: TableDensity;
  iconGlass: IconGlass;
  language: Language;
}

/**
 * La clé `app_settings` de chaque préférence — écrite UNE fois.
 *
 * Le préfixe `display.` n'est pas décoratif : c'est lui que la migration
 * `20261019000000_display_preferences.sql` borne dans ses politiques
 * d'écriture (un compte connecté peut écrire CES clés, et rien d'autre), et
 * c'est lui qu'ÉCRIT la copie durable. La même liste existe donc dans le SQL et
 * ici ; un test compare les deux, parce qu'une clé qui ne s'écrirait pas sous
 * son nom publié serait un réglage qui ne voyage jamais.
 */
export const DISPLAY_PREFERENCE_KEYS: Record<DisplayPreferenceName, string> = {
  theme: 'display.theme',
  density: 'display.density',
  iconGlass: 'display.icon_glass',
  language: 'display.language',
};

/** Les valeurs ADMISES, par préférence : une valeur hors liste n'est adoptée jamais. */
export const DISPLAY_PREFERENCE_VALUES: Record<DisplayPreferenceName, readonly string[]> = {
  // Les thèmes sont la liste du type, exhaustive par construction (THEME_IDS).
  theme: THEME_IDS,
  density: ['comfort', 'compact'],
  iconGlass: ['discreet', 'crisp', 'animated'],
  language: ['fr', 'en'],
};

/**
 * Les clés de `localStorage` qui portent « ce poste a-t-il choisi ? ».
 *
 * Ce sont les clés des modules qui ÉCRIVENT le réglage (`density.ts`,
 * `iconGlass.ts`, `useTheme.ts`) et celle de la langue, qui n'est persistée que
 * pour cette question-là (voir plus bas) : recopier ces chaînes ici ferait deux
 * vérités pour une même case de stockage.
 */
export const DISPLAY_PREFERENCE_STORAGE_KEYS: Record<DisplayPreferenceName, string> = {
  theme: THEME_STORAGE_KEY,
  density: DENSITY_STORAGE_KEY,
  iconGlass: ICON_GLASS_STORAGE_KEY,
  language: 'school-finance-language-v1',
};

/** Où la langue du poste est retenue (les trois autres ont leur propre module). */
export const LANGUAGE_STORAGE_KEY = DISPLAY_PREFERENCE_STORAGE_KEYS.language;

/**
 * La langue du poste, ou le français.
 *
 * La langue n'était PERSISTÉE NULLE PART avant le 2026-10-19 : chaque chargement
 * repartait au français, même sans réinstallation. Elle suit maintenant le même
 * contrat que la densité et le verre : la valeur choisie est écrite sur le poste
 * (donc un poste choisit une fois), et l'absence de clé veut dire « ce poste n'a
 * jamais choisi » — la seule chose qui autorise l'adoption de la copie de la
 * base.
 */
export function getStoredLanguage(): Language {
  try {
    if (typeof localStorage === 'undefined') return 'fr';
    return localStorage.getItem(LANGUAGE_STORAGE_KEY) === 'en' ? 'en' : 'fr';
  } catch {
    return 'fr';
  }
}

/** Retient la langue du poste. Ne lève jamais (quota, mode privé). */
export function saveLanguage(language: Language): void {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(LANGUAGE_STORAGE_KEY, language);
  } catch {
    /* quota, mode privé : la base reste la copie durable */
  }
}

/**
 * La ligne d'`app_settings` qu'une préférence occupe.
 *
 * UNE écriture de cette forme, lue par les deux chemins (en ligne et rejeu) :
 * deux formes jumelles finiraient par diverger, et un poste neuf adopterait
 * alors autre chose que ce que le poste auteur avait à l'écran.
 *
 * `updated_by` reste NUL, et ce n'est pas un oubli : `restorableRows`
 * (`scripts/lib/db-tables.mjs`) écarte toute ligne dont le compte n'existe pas
 * dans la cible — or les comptes `auth.users` ne voyagent pas. Nommer un compte
 * ici rendrait donc les préférences NON RESTAURABLES dans une cible fraîche,
 * c'est-à-dire le jour même où on a besoin d'elles. Qui a changé quoi vit dans
 * `audit_logs`, qui, lui, se restaure.
 */
export function displayPreferenceRow(
  key: string,
  value: string,
  now: Date = new Date(),
): { key: string; value: string; updated_at: string } {
  return { key, value, updated_at: now.toISOString() };
}

/** Vrai quand la valeur est une de celles que cette préférence admet. */
export function isDisplayPreferenceValue(name: DisplayPreferenceName, value: unknown): boolean {
  const allowed = DISPLAY_PREFERENCE_VALUES[name];
  return typeof value === 'string' && allowed !== undefined && allowed.includes(value);
}

/**
 * « Ce poste a-t-il déjà choisi, pour chacune des quatre ? »
 *
 * Lu en UNE fois, au PREMIER rendu (`useDisplayPreferences` en garde
 * l'instantané). C'est indispensable pour le thème : son effet de persistance
 * écrit la clé dès le premier montage, avec le défaut — donc une lecture faite
 * après coup répondrait « oui, ce poste a choisi » sur un poste qui n'a jamais
 * rien choisi, et la copie de la base ne serait jamais adoptée.
 */
export function readStoredChoices(): Record<DisplayPreferenceName, boolean> {
  const choices = {} as Record<DisplayPreferenceName, boolean>;
  for (const name of Object.keys(DISPLAY_PREFERENCE_STORAGE_KEYS) as DisplayPreferenceName[]) {
    choices[name] = hasStoredChoice(name);
  }
  return choices;
}

/** Vrai quand la case de stockage de cette préférence est présente. */
export function hasStoredChoice(name: DisplayPreferenceName): boolean {
  try {
    if (typeof localStorage === 'undefined') return false;
    return localStorage.getItem(DISPLAY_PREFERENCE_STORAGE_KEYS[name]) !== null;
  } catch {
    return false;
  }
}

/**
 * Les lignes d'`app_settings` réduites aux quatre préférences, VALIDÉES.
 *
 * Une ligne inconnue, une valeur d'un autre type, une valeur que la préférence
 * n'admet pas : elle est IGNORÉE (et non adoptée par défaut). Adopter une valeur
 * illisible peindrait un thème inexistant, ou poserait une langue sans
 * traduction — le genre de panne qui ne se voit que sur le poste d'une école.
 *
 * @param rows `{ key, value }[]` tel que la table le rend (`value` en JSONB)
 * @returns les préférences reconnues, et seulement celles-là
 */
export function parseDisplayPreferences(
  rows: { key?: unknown; value?: unknown }[],
): Partial<DisplayPreferences> {
  const byKey = new Map<string, DisplayPreferenceName>();
  for (const name of Object.keys(DISPLAY_PREFERENCE_KEYS) as DisplayPreferenceName[]) {
    byKey.set(DISPLAY_PREFERENCE_KEYS[name], name);
  }
  const parsed: Partial<Record<DisplayPreferenceName, string>> = {};
  for (const row of Array.isArray(rows) ? rows : []) {
    const name = byKey.get(String(row?.key ?? ''));
    if (!name) continue;
    const value = row?.value;
    if (!isDisplayPreferenceValue(name, value)) continue;
    parsed[name] = String(value);
  }
  return parsed as Partial<DisplayPreferences>;
}

/**
 * Ce qu'un poste doit ADOPTER de la copie durable : les préférences qu'il n'a
 * jamais choisies, et seulement celles-là (règle 1 de l'en-tête).
 *
 * @param choices ce que le poste a déjà choisi (voir `readStoredChoices`)
 * @param remote la copie de la base, déjà validée (`parseDisplayPreferences`)
 */
export function adoptablePreferences(
  choices: Partial<Record<DisplayPreferenceName, boolean>>,
  remote: Partial<DisplayPreferences>,
): Partial<DisplayPreferences> {
  const adopt = {} as Partial<DisplayPreferences>;
  for (const name of Object.keys(DISPLAY_PREFERENCE_KEYS) as DisplayPreferenceName[]) {
    if (choices[name]) continue; // le poste a choisi : le poste gagne
    const value = remote[name];
    if (value === undefined) continue; // rien à adopter : le poste garde son défaut compilé
    (adopt as Record<string, unknown>)[name] = value;
  }
  return adopt;
}
