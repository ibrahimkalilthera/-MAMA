/**
 * Icon glass preference persistence — « le dosage du verre des icônes ».
 *
 * A single device-level setting, stored in localStorage like the theme and the
 * table density — every account on the poste shares it. Three doses:
 *
 *   • `discreet` — la matière s'efface : une teinte à peine là, aucun flou,
 *     aucun mouvement. L'icône redevient un glyphe, avec un souffle de plaque ;
 *   • `crisp`    — la plaque reste, nette : le liseré se voit, le rayon redevient
 *     régulier, et rien ne dérive sous le curseur ;
 *   • `animated` — la couche telle qu'elle a été livrée : pastille floutée et
 *     morphose liquide au survol ou au clavier.
 *
 * `animated` est le DÉFAUT, et c'est délibéré : le réglage DOSE un effet déjà
 * livré, donc personne ne doit voir son écran changer sans l'avoir demandé. Un
 * défaut à `discreet` retirerait la matière à tous les postes au premier
 * démarrage — un réglage qui commence par défaire ce qu'il prétend régler.
 *
 * Corrupt or missing entries degrade to the default and writes never throw
 * (storage full / private mode simply won't persist) — the same contract as
 * `src/lib/density.ts`, because it is the same kind of choice on the same poste.
 */

export type IconGlass = 'discreet' | 'crisp' | 'animated';

export const DEFAULT_ICON_GLASS: IconGlass = 'animated';

/** Les doses, dans l'ordre où la carte les propose (du plus sobre au plus vif). */
export const ICON_GLASS_LEVELS: readonly IconGlass[] = ['discreet', 'crisp', 'animated'];

/**
 * La clé de stockage, nommée UNE fois.
 *
 * Exportée parce qu'une autre question se pose sur elle que « quelle est la
 * valeur ? » : « ce poste a-t-il DÉJÀ choisi ? » — la clé est-elle seulement
 * présente. Les préférences d'affichage (src/lib/displayPreferences.ts) posent
 * cette question-là pour savoir si la copie de la base doit être adoptée au
 * démarrage d'un poste neuf.
 */
export const ICON_GLASS_STORAGE_KEY = 'school-finance-icon-glass-v1';

const KEY = ICON_GLASS_STORAGE_KEY;

/** Read the stored dose. Never throws; missing/unavailable/unknown → default. */
export function getStoredIconGlass(): IconGlass {
  try {
    // SSR / non-browser (renderToString in tests) has no localStorage.
    if (typeof localStorage === 'undefined') return DEFAULT_ICON_GLASS;
    const raw = localStorage.getItem(KEY);
    return ICON_GLASS_LEVELS.includes(raw as IconGlass) ? (raw as IconGlass) : DEFAULT_ICON_GLASS;
  } catch {
    return DEFAULT_ICON_GLASS;
  }
}

/** Persist the dose. Never throws. */
export function saveIconGlass(glass: IconGlass): void {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(KEY, glass);
  } catch {
    // Storage full / private mode — the choice simply won't persist.
  }
}
