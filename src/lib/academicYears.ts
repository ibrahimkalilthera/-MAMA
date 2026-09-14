/**
 * ─── L'année scolaire : elle vient du CALENDRIER, et elle avance toute seule ─
 *
 * Le 2026-09-13, un élève enregistré a « disparu » : il était bien dans la base,
 * avec son parent et ses paiements, mais invisible. Deux valeurs par défaut
 * vivaient chacune de son côté, en dur :
 *
 *   • l'app s'ouvrait sur `'2026-2027'` (YearProvider) et **filtrait** listes et
 *     tableau de bord sur cette année-là ;
 *   • le formulaire d'élève naissait en `'2024-2025'` (useStudents) et
 *     **écrivait** cette année-là.
 *
 * La première réparation a supprimé les littéraux et fait venir l'année de la
 * base (`academic_years.is_current`). C'était nécessaire, et **pas suffisant** :
 * `is_current` est un réglage qu'il faut penser à changer, et il était déjà
 * périmé dans la base (il disait 2025-2026 pendant que l'app affichait
 * 2026-2027). Une année qui dépend d'un geste manuel finit toujours par avoir un
 * an de retard, et c'est la même panne qui revient, un an plus tard, avec les
 * mêmes effets : un nouveau mois de septembre, et plus personne ne voit ses
 * données.
 *
 * La règle qui remplace ça tient en une phrase : **l'année de travail est celle
 * du calendrier** (une année scolaire va du 1er septembre au 31 août), le choix
 * de l'utilisateur est respecté **tant qu'il appartient à l'année scolaire en
 * cours**, et l'année affichée est celle qui est écrite. Chaque 1er septembre,
 * l'app change donc d'année **toute seule** — c'est le seul geste que personne
 * n'a besoin de faire.
 *
 * Ce module est PUR (aucun React, aucun Supabase) : c'est ce qui permet de
 * verrouiller par des tests ce qui ne se vérifie qu'une fois par an en vrai — le
 * passage 2026-2027 → 2027-2028, la déclaration périmée qu'on n'écoute plus, et
 * le choix d'un poste qui ne doit pas survivre à l'année où il a été fait.
 */
import { academicYearOf } from './dateWindows';

/** Ce qu'une ligne d'`academic_years` porte et que l'app utilise. */
export interface AcademicYearRow {
  year_name: string;
  is_current?: boolean | null;
}

/** La clé sous laquelle le choix de l'utilisateur survit à un rechargement. */
export const YEAR_STORAGE_KEY = 'mama_thera_selected_year';

/**
 * Le repli hors ligne : la base est la source, mais une connexion coupée ne doit
 * pas laisser l'app sans aucune année. Il est remplacé dès que la base répond.
 */
export const FALLBACK_ACADEMIC_YEARS = ['2024-2025', '2025-2026', '2026-2027', '2027-2028'];

/**
 * Le mois (0-indexé) où une année scolaire commence : septembre.
 *
 * C'est la seule règle de calendrier de ce module, et elle est ici pour être
 * citée plutôt que recopiée : 2026-2027 va du 1er septembre 2026 au 31 août 2027.
 */
export const SCHOOL_YEAR_START_MONTH = 8;

const clean = (value: unknown): string => String(value ?? '').trim();

/**
 * La date, lue SANS surprise de fuseau.
 *
 * `new Date('2026-09-01')` est minuit UTC : dans un fuseau négatif, le 1er
 * septembre devient le 31 août et l'année scolaire basculerait un jour trop tard.
 * Une date ISO sans heure est donc construite en **heure locale**.
 */
function toDate(when: Date | string | number): Date | null {
  if (when instanceof Date) return Number.isNaN(when.getTime()) ? null : when;
  if (typeof when === 'number') {
    const fromNumber = new Date(when);
    return Number.isNaN(fromNumber.getTime()) ? null : fromNumber;
  }
  const text = clean(when);
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (dateOnly) return new Date(Number(dateOnly[1]), Number(dateOnly[2]) - 1, Number(dateOnly[3]));
  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/**
 * Le nom de l'année scolaire qui CONTIENT cette date.
 *
 * 2026-09-01 → « 2026-2027 », 2027-08-31 → « 2026-2027 », 2027-09-01 →
 * « 2027-2028 ». Une date illisible rend la chaîne vide : l'appelant décide, on
 * n'invente pas une année à partir de rien.
 */
export function schoolYearName(when: Date | string | number = new Date()): string {
  const date = toDate(when);
  if (!date) return '';
  // Le 1er septembre comme charnière est décidé UNE fois, dans
  // dateWindows.academicYearOf — le dupliquer ici a déjà produit deux réponses
  // à la même question (voir l'en-tête de dateWindows.ts).
  return academicYearOf(date);
}

/** Les noms d'année, sans doublon et dans l'ordre croissant des libellés. */
export function yearNames(rows: AcademicYearRow[] = []): string[] {
  const names = [...new Set((rows ?? []).map((r) => clean(r?.year_name)).filter(Boolean))];
  return names.sort((a, b) => a.localeCompare(b));
}

/**
 * L'année que la base déclare courante : `is_current`, sinon la plus récente.
 *
 * C'est encore ce qui se lit ailleurs (scripts, audits, sauvegardes), et l'app la
 * **maintient** désormais au lieu de la subir — voir `keepAcademicYearCurrent`.
 */
export function currentYearName(rows: AcademicYearRow[] = []): string | null {
  const names = yearNames(rows);
  if (names.length === 0) return null;
  const flagged = (rows ?? []).find((r) => r?.is_current && clean(r.year_name));
  return flagged ? clean(flagged.year_name) : names[names.length - 1];
}

/** « 2027-2028 » est-il plus récent que « 2026-2027 » ? (l'ordre du texte suffit) */
export const isLaterYear = (candidate: string, other: string): boolean =>
  Boolean(clean(candidate)) && Boolean(clean(other)) && clean(candidate) > clean(other);

/** Un choix d'année, avec le moment où il a été fait. */
export interface StoredYearChoice {
  year: string;
  /** ISO ; vide pour un choix écrit par une version qui ne datait pas son choix. */
  at: string;
}

/**
 * Le choix stocké, ou `null`.
 *
 * Deux formes sont lues : `{"year":"2026-2027","at":"…"}` et l'ancienne chaîne
 * nue (« 2026-2027 »). La date compte : c'est elle qui dit à quelle année
 * scolaire ce choix appartenait, donc si le poste peut encore s'en servir.
 */
export function readStoredYear(storage?: Pick<Storage, 'getItem'> | null): StoredYearChoice | null {
  let raw = '';
  try {
    raw = clean(storage?.getItem(YEAR_STORAGE_KEY));
  } catch {
    return null;
  }
  if (!raw) return null;
  if (raw.startsWith('{')) {
    try {
      const parsed = JSON.parse(raw) as { year?: unknown; at?: unknown };
      const year = clean(parsed?.year);
      return year ? { year, at: clean(parsed?.at) } : null;
    } catch {
      return null;
    }
  }
  return { year: raw, at: '' };
}

/** Persiste le choix **avec son moment**. Un stockage indisponible n'échoue jamais. */
export function storeYear(year: string, storage?: Pick<Storage, 'setItem'> | null, at: Date = new Date()): void {
  try {
    if (year) storage?.setItem(YEAR_STORAGE_KEY, JSON.stringify({ year, at: at.toISOString() }));
  } catch {
    /* mode privé, quota : le choix ne survivra pas, l'app si */
  }
}

/**
 * L'année sur laquelle l'app doit travailler aujourd'hui.
 *
 * Trois règles, dans cet ordre, et chacune a une raison mesurée :
 *
 *  1. **Le choix de l'utilisateur, s'il appartient à l'année scolaire en
 *     cours.** Un poste resté sur « 2024-2025 » un 1er septembre 2026 ne doit pas
 *     continuer d'y saisir : son choix a été fait pour l'année précédente, donc
 *     il est abandonné — c'est ce qui fait que l'app **avance toute seule**. Un
 *     choix fait *pendant* l'année en cours reste respecté (consulter une
 *     archive, travailler une classe à part).
 *  2. **Le calendrier**, sinon : 2026-09-01 → 2026-2027, sans qu'aucune
 *     déclaration n'ait à être mise à jour.
 *  3. **Une déclaration de la base en AVANCE sur le calendrier**, si elle
 *     existe : c'est une école qui prépare la rentrée suivante, et son `is_current`
 *     doit être suivi. En RETARD, elle est ignorée — c'est exactement la
 *     déclaration périmée qui a rendu un élève invisible.
 *
 * @param input.rows les années de la base (`[]` ou absent = base injoignable)
 * @param input.stored le choix stocké
 * @param input.today la date du jour (injectée : c'est le seul moyen de tester un 1er septembre)
 */
export function pickWorkingYear({
  rows = [],
  stored = null,
  today = new Date(),
}: {
  rows?: AcademicYearRow[];
  stored?: StoredYearChoice | null;
  today?: Date | string | number;
} = {}): string {
  const names = yearNames(rows);
  const known = (year: string) => names.length === 0 || names.includes(year);
  const calendar = schoolYearName(today);
  const chosen = clean(stored?.year);
  const chosenAt = clean(stored?.at);

  // 1. Le choix de l'utilisateur, s'il vient de l'année scolaire en cours.
  if (chosen && known(chosen) && chosenAt) {
    const sameSchoolYear = schoolYearName(chosenAt) === calendar && calendar !== '';
    if (sameSchoolYear) return chosen;
  }

  // 2. La déclaration de la base en avance sur le calendrier (rentrée préparée).
  //
  // Le DRAPEAU est lu, pas `currentYearName` : celui-ci retombe sur « la plus
  // récente » quand rien n'est marqué, et la base contient TOUJOURS une année
  // future (le jeu de données initial pose 2027-2028). Confondre les deux ferait
  // avancer l'app d'un an — la panne d'origine, dans l'autre sens.
  const flagged = (rows ?? []).find((row) => row?.is_current && clean(row.year_name));
  const declared = flagged ? clean(flagged.year_name) : '';
  if (declared && calendar && isLaterYear(declared, calendar) && known(declared)) return declared;

  // 3. Le calendrier. C'est la règle qui n'a besoin d'aucune maintenance — et
  //    elle vaut MÊME si la base ne connaît pas encore cette année : un 1er
  //    septembre, personne n'a encore créé la ligne, et retomber sur l'année
  //    précédente serait exactement la panne d'origine. C'est
  //    `keepAcademicYearCurrent` qui l'ajoute, pas l'inverse.
  if (calendar) return calendar;

  // Une date illisible (horloge cassée) : la plus récente des années connues.
  // `||` et non `??` : une déclaration absente vaut la chaîne vide, qui est
  // falsy — et une année vide à l'écran serait un zéro déguisé en année.
  const latestFallback = FALLBACK_ACADEMIC_YEARS[FALLBACK_ACADEMIC_YEARS.length - 1];
  return names[names.length - 1] || declared || latestFallback;
}
