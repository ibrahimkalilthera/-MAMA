/**
 * ─── Le nom de l'école : un fait de l'ÉTABLISSEMENT, écrit une fois ─────────
 *
 * Une remontée de poste arrivait jusqu'ici avec ce que la MACHINE sait d'elle :
 * son nom d'hôte (`os.hostname()`). C'est exact et c'est utile — « lequel ? » est
 * la première question devant une panne —, mais ça ne répond pas à la question du
 * PROPRIÉTAIRE quand plusieurs écoles (ou plusieurs bâtiments) vivent dans la
 * même base : « de quelle école me parle ce poste ? » Un nom d'hôte est un nom de
 * machine ; l'application n'en demandait aucun d'école, et c'est ce manque que ce
 * module comble — pas en devinant, en demandant.
 *
 * TROIS DÉCISIONS, et chacune évite un défaut précis :
 *
 *   • **un fait d'établissement, pas une préférence d'écran.** Le thème, la
 *     densité et la langue appartiennent à la personne devant le poste et se
 *     règlent poste par poste (`src/lib/displayPreferences.ts`) ; le nom de
 *     l'école est le même partout, et il est écrit UNE fois, dans `app_settings`
 *     (`school.name`), la table qui voyage avec la sauvegarde de l'école. Une
 *     ligne, pas quatre : personne n'adopte quoi que ce soit ici, tout le monde
 *     lit la même.
 *
 *   • **l'administration l'écrit, et c'est la base qui le dit.** Aucune politique
 *     nouvelle n'a été créée (voir `20261022000000_school_name.sql`) : les
 *     politiques d'`app_settings` qui existent déjà réservent l'écriture à
 *     `public.is_admin()`, et c'est le droit qu'un fait d'établissement demande.
 *     L'écran (les Paramètres, réservés à l'administration) et la base disent donc
 *     la même chose — l'écart est contrôlé par `npm run check:write-gates`.
 *
 *   • **ce qui n'est pas lu est refusé, jamais rangé de travers.** Un nom hors
 *     bornes, une valeur qui n'est pas une chaîne, un nom qui porterait le
 *     séparateur des rapports de poste (` · `) : ils ne sont ni tronqués ni
 *     acceptés — `normalizeSchoolName` rend `null`, et l'appelant refuse. C'est la
 *     même discipline que la forme des postes : une valeur non mesurée reste
 *     `null`, elle n'est pas comblée par la plus flatteuse.
 *
 * Ce module est PUR : la normalisation, la validation, la ligne d'`app_settings`
 * et la lecture se jugent sans base, sans réseau et sans React (voir
 * `tests/school-name.test.ts`). L'accès à la base vit dans
 * `src/lib/dataOps/settings.ts`, le rejeu hors ligne dans
 * `src/lib/offlineReplaySchoolName.ts`, et la composition d'un rapport de poste
 * dans `src/lib/desktopUpdateReport.ts` (qui lit `schoolField` ci-dessous, pour
 * que les deux remontées — blocage et conversion — écrivent le nom de la même
 * façon).
 */

/**
 * Le verdict d'un enregistrement, en TROIS états et pas deux.
 *
 * • `saved`   — la copie durable de l'école porte le nouveau nom, maintenant ;
 * • `queued`  — le poste est hors ligne : le changement est parti dans la file,
 *              il partira au retour de la ligne (le geste n'est pas perdu) ;
 * • `refused` — rien n'a été retenu : valeur hors contrat, file pleine, ou base
 *              en échec. L'écran le DIT, il n'annonce pas un enregistrement qui
 *              n'a pas eu lieu.
 *
 * Deux états ne suffiraient pas : « enregistré » qui couvrirait « mis en file »
 * ferait croire à une écriture en base qui n'a pas eu lieu, et « échec » qui
 * couvrirait « mis en file » ferait refaire un geste déjà accepté.
 */
export type SchoolNameSaveResult = 'saved' | 'queued' | 'refused';

/** La clé `app_settings` du nom de l'école — écrite UNE fois (voir la migration). */
export const SCHOOL_NAME_KEY = 'school.name';

/**
 * Les bornes du nom, telles que la BASE les contraint aussi
 * (`app_settings_school_name_check`) : 2 caractères au moins — un nom d'un seul
 * caractère n'en est pas un —, 120 au plus, ce qui laisse la place à un nom
 * d'établissement long sans transformer une ligne de journal en paragraphe.
 */
export const SCHOOL_NAME_MIN = 2;
export const SCHOOL_NAME_MAX = 120;

/**
 * Le séparateur des champs d'un rapport de poste (`src/lib/desktopUpdateReport.ts`).
 *
 * Il est REFUSÉ dans un nom d'école, et ce n'est pas une coquetterie : une
 * remontée se lit en découpant ses champs sur ce séparateur
 * (`src/lib/blockedIncidents.ts` regroupe les pannes par poste et par motif en
 * s'appuyant dessus). Un nom qui le contiendrait décalerait la lecture de toutes
 * les entrées de cette école — le genre de défaut qui ne casse rien et qui fait
 * lire autre chose que ce qui est écrit.
 */
export const REPORT_FIELD_SEPARATOR = ' · ';

/**
 * Le nom, ramené à sa forme canonique — ou `null` s'il n'en a pas.
 *
 * Quatre réductions, et elles sont volontairement les seules :
 *   • les espaces autour sont retirés, et les suites d'espaces internes ramenées
 *     à une seule (une valeur collée depuis un document en porte souvent) ;
 *   • les caractères de CONTRÔLE sont retirés (retour à la ligne compris) : ils
 *     viendraient d'un copier-coller et couperaient une ligne de journal en deux ;
 *   • une valeur qui n'est pas une chaîne est refusée (`null`) plutôt que
 *     convertie — « 123 » et 123 ne veulent pas dire la même chose ici ;
 *   • hors bornes, ou portant le séparateur des rapports : refusé, jamais
 *     tronqué. Tronquer écrirait en base un nom que personne n'a écrit.
 *
 * @param value ce que l'écran, la file ou la base a rendu
 * @returns le nom canonique, ou `null` quand il n'y a rien d'acceptable.
 */
export function normalizeSchoolName(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  // Les caractères de contrôle (dont \n, \t et \r) sont retirés AVANT tout :
  // les compter dans la longueur ferait refuser un nom à cause d'un caractère
  // invisible collé par un copier-coller.
  const cleaned = value.replace(/[\u0000-\u001F\u007F]/g, ' ').replace(/\s+/g, ' ').trim();
  if (cleaned.length < SCHOOL_NAME_MIN || cleaned.length > SCHOOL_NAME_MAX) return null;
  if (cleaned.includes(REPORT_FIELD_SEPARATOR)) return null;
  return cleaned;
}

/** Vrai quand la valeur est un nom d'école acceptable (voir `normalizeSchoolName`). */
export function isSchoolName(value: unknown): boolean {
  return normalizeSchoolName(value) !== null;
}

/**
 * La ligne d'`app_settings` que le nom de l'école occupe.
 *
 * UNE écriture de cette forme, lue par les DEUX chemins (en ligne et rejeu) : deux
 * formes jumelles finiraient par diverger, et l'école lirait alors autre chose que
 * ce qui a été écrit.
 *
 * `updated_by` reste NUL, comme pour les préférences d'affichage, et pour la même
 * raison MESURÉE : `restorableRows` (`scripts/lib/db-tables.mjs`) écarte toute
 * ligne dont le compte n'existe pas dans la cible — or les comptes `auth.users` ne
 * voyagent pas. Nommer un compte ici rendrait le nom de l'école non restaurable
 * dans une cible fraîche, c'est-à-dire le jour même où on a besoin de lui. Qui l'a
 * changé vit dans `audit_logs`, qui, lui, se restaure.
 *
 * @param value le nom, DÉJÀ validé par l'appelant (`isSchoolName`)
 */
export function schoolNameRow(
  value: string,
  now: Date = new Date(),
): { key: string; value: string; updated_at: string } {
  return { key: SCHOOL_NAME_KEY, value, updated_at: now.toISOString() };
}

/**
 * Le nom de l'école tel que la table le rend — ou `null` s'il n'est pas déclaré.
 *
 * Deux `null` qui ne se confondent pas, et c'est voulu : « la base n'a pas
 * répondu » et « aucune école n'a déclaré son nom » mènent au même affichage mais
 * pas à la même phrase, et l'appelant reçoit les deux séparément (`fetchSchoolName`
 * rend `null` pour le premier, ce module pour le second).
 *
 * Une ligne illisible (valeur d'un autre type, nom hors bornes, ligne d'une autre
 * clé) est IGNORÉE : on n'affiche pas un nom qu'on n'a pas su lire, on dit qu'il
 * n'est pas déclaré.
 *
 * @param rows `{ key, value }[]` tel que la table le rend (`value` en JSONB)
 */
export function parseSchoolName(rows: { key?: unknown; value?: unknown }[]): string | null {
  for (const row of Array.isArray(rows) ? rows : []) {
    if (String(row?.key ?? '') !== SCHOOL_NAME_KEY) continue;
    return normalizeSchoolName(row?.value);
  }
  return null;
}

/**
 * Le champ « école <nom> » d'un rapport de poste — ou `null` quand il n'y a rien
 * à dire.
 *
 * L'absence est SILENCIEUSE, jamais remplacée par « école inconnue » : un rapport
 * qui ne sait pas ne doit pas fabriquer un nom, et « inconnue » se lirait ailleurs
 * comme un nom d'école parmi d'autres. Un nom illisible est traité comme une
 * absence — pour la même raison.
 *
 * @param name le nom tel qu'il a été lu (déjà normalisé, ou pas : la fonction valide)
 */
export function schoolField(name: string | null | undefined): string | null {
  const normalized = normalizeSchoolName(name);
  return normalized === null ? null : `école ${normalized}`;
}
