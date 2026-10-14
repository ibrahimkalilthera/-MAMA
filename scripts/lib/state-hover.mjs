/**
 * ─── Le contrat de l'échelle de survol, partagé avec sa garde ───────────────
 *
 * Le défaut payé, mesuré : un survol de surface était une RECETTE RECOPIÉE.
 * `hover:bg-slate-50 dark:hover:bg-white/10` sur une rangée, `hover:bg-slate-100
 * dark:hover:bg-slate-800` sur la suivante, `hover:bg-rose-100
 * dark:hover:bg-rose-950/60` sur chaque action destructive. Trois conséquences,
 * et aucune n'est cosmétique :
 *
 *   • la couche de remap d'un thème ne connaît QUE ses propres classes — un
 *     `hover:bg-slate-50` écrit à la main reste froid dans un thème chaud, et
 *     aucun remap ne peut le rattraper (c'est le reproche fait au thème crème,
 *     dont les rangées viraient au gris bleuté) ;
 *   • l'ACCENT d'une ÉCOLE (la couleur de son logo, décidée à l'exécution par
 *     `src/lib/brandAccent.ts`) n'atteint aucune de ces recettes : un contrôle
 *     qui « s'allume à l'accent » devait être réécrit à la main partout, et
 *     restait bleu ailleurs ;
 *   • la même intention s'écrivait de cinq façons (slate-50, slate-100,
 *     white/5, white/10, white/[0.04]), donc deux rangées voisines ne
 *     s'allumaient pas pareil.
 *
 * `src/themes/state-hover.css` porte donc l'échelle — ses crans ET leurs valeurs
 * par thème (`--state-*`) : `state-hover` (neutre), `state-hover-solid` (neutre
 * sur un contrôle au repos déjà rempli), `state-hover-strong` (sur un
 * remplissage neutre fort), `state-hover-dark` (sur une surface toujours sombre
 * ou colorée : un voile blanc), `state-hover-deep` (le pas d'un contrôle neutre
 * DÉJÀ REMPLI sur un chrome toujours sombre), `state-hover-clear` (un contrôle
 * au repos BLANC OPAQUE sur un aplat coloré : l'aplat reparaisse sous lui),
 * `state-accent-hover` + `state-accent-group-ink`
 * (accent), `state-alert-hover`, `state-alert-tint`, `state-alert-solid`,
 * `state-alert-dark` (alerte sur un chrome toujours sombre : voile + encre
 * levée) et `state-alert-plate` (alerte SUR un aplat coloré : la surface seule,
 * l'encre du bandeau restant la sienne). Les jetons sont exposés par `useTheme`
 * (`currentTheme.hoverSurface`, …, voir `CurrentTheme`).
 *
 * Les quatre derniers décrivent des surfaces dont l'identité ne dépend PAS du
 * thème (chrome toujours sombre, aplat d'accent) : leurs valeurs sont posées une
 * fois dans `:root`, pas six fois par thème — et elles ne le sont pas par hasard,
 * ce sont celles des recettes qu'elles remplacent, qu'aucun remap de thème ne
 * couvrait.
 *
 * ─── Ce que la garde interdit, et pourquoi seulement ça ────────────────────
 *
 * Trois familles de couleur SONT remplacées par l'échelle, parce qu'elles ne
 * codent RIEN : le NEUTRE (slate, gray, zinc, neutral, stone, white, black),
 * l'ACCENT DE MARQUE (blue, indigo, sky) et l'ALERTE (rose, red). Écrire l'une
 * d'elles en survol, c'est refaire la recette que l'échelle remplace.
 *
 * Les autres familles sont SÉMANTIQUES — l'ambre dit « en retard / à rattraper »,
 * l'émeraude dit « payé / soldé », le violet et le cyan distinguent des catégories
 * de paie et de rôle. Elles ne suivent aucun thème PARCE QU'ELLES CODENT quelque
 * chose : les migrer effacerait le sens (c'est la leçon déjà écrite dans
 * `scripts/lib/theme-accents.mjs` pour le vert et le bleu de marque). Elles
 * restent donc autorisées, et c'est ce qui garde cette garde utile plutôt que
 * bruyante.
 *
 * ─── Une limite dite, plutôt que découverte plus tard ──────────────────────
 *
 * Une ENCRE NEUTRE au survol (`hover:text-slate-600`, `hover:text-white`) n'a pas
 * de cran dans cette échelle : les crans portent une SURFACE, plus l'encre là où
 * elle change de famille (accent, alerte). Ces survols d'encre restent donc
 * autorisés PAR CETTE GARDE — la lisibilité, elle, est tenue ailleurs :
 * `judgeHoverInk` (tests/tailwind-pairs.ts, verrouillé dans
 * tests/theme-contrast-remap.test.ts) refuse une encre de survol sous AA 4,5:1 sur
 * la surface que le thème peint sous le curseur, et il ne juge que les encres qui
 * se RENDENT — un `!important` de thème sur l'encre de repos masque la variante.
 *
 * Et un survol posé sur une surface COLORÉE — le bandeau de paie, la fiche
 * parent, un contrôle translucide posé dessus — n'est pas pour autant laissé
 * au hasard : ces surfaces-là ont leurs PROPRES crans (`state-hover-clear`,
 * `state-alert-plate`, `state-alert-dark`), posés une fois puisque ces surfaces
 * sont les mêmes dans les six thèmes. L'allowlist de `scripts/check-state-hover.mjs`
 * est donc VIDE : elle ne garde plus que ses règles — le grain (fichier, classe),
 * la raison obligatoire, la péremption — éprouvées par sa suite sur une liste
 * INJECTÉE (`CHECK_STATE_HOVER_ALLOWLIST`), pour qu'un cran manquant reste un
 * échec plutôt qu'une exception qui pourrit.
 */

/** Les classes de l'échelle — les seules recettes qu'un composant peut écrire. */
export const STATE_HOVER_CLASSES = [
  'state-hover',
  'state-hover-solid',
  'state-hover-strong',
  'state-hover-dark',
  'state-hover-deep',
  'state-hover-clear',
  'state-accent-hover',
  'state-accent-group-ink',
  'state-alert-hover',
  'state-alert-tint',
  'state-alert-solid',
  'state-alert-dark',
  'state-alert-plate',
];

/** Les jetons par lesquels `useTheme` les expose (mêmes noms que `CurrentTheme`). */
export const STATE_HOVER_TOKENS = {
  hoverSurface: 'state-hover',
  hoverSurfaceSolid: 'state-hover-solid',
  hoverSurfaceStrong: 'state-hover-strong',
  hoverSurfaceDark: 'state-hover-dark',
  hoverSurfaceClear: 'state-hover-clear',
  hoverAccent: 'state-accent-hover',
  hoverAccentGroupInk: 'state-accent-group-ink',
  hoverAlert: 'state-alert-hover',
  hoverAlertTint: 'state-alert-tint',
  hoverAlertSolid: 'state-alert-solid',
  hoverAlertDark: 'state-alert-dark',
  hoverAlertPlate: 'state-alert-plate',
};

/**
 * Les crans qu'AUCUN jeton n'expose, avec la raison — et la liste est courte.
 *
 * `state-hover-deep` n'a qu'un consommateur, l'écran de connexion, qui ne reçoit
 * pas `currentTheme` (il peint son chrome en dur) : il l'écrit donc en clair. Un
 * jeton sans consommateur serait une promesse creuse, et le jour où un composant
 * THÉMÉ demandera ce pas, il se gagne ici comme les autres.
 */
export const STATE_HOVER_CLASSES_WITHOUT_TOKEN = { 'state-hover-deep': 'écran de connexion (chrome en dur, aucun currentTheme)' };

/** Les valeurs que l'échelle lit, par thème (voir src/themes/state-hover.css). */
export const STATE_VARS = [
  '--state-hover',
  '--state-hover-solid',
  '--state-hover-strong',
  '--state-hover-dark',
  '--state-hover-deep',
  '--state-hover-clear',
  '--state-alert-hover',
  '--state-alert-ink',
  '--state-alert-solid',
  '--state-alert-dark',
  '--state-alert-dark-ink',
  '--state-alert-plate',
];

/** Les familles SÉMANTIQUES : elles codent un fait, donc elles ne suivent pas le thème. */
export const SEMANTIC_FAMILIES = [
  'amber',
  'yellow',
  'orange',
  'lime',
  'green',
  'emerald',
  'teal',
  'cyan',
  'violet',
  'purple',
  'fuchsia',
  'pink',
];

/** Les familles neutres : l'échelle les remplace (crans neutres). */
export const NEUTRAL_FAMILIES = ['slate', 'gray', 'zinc', 'neutral', 'stone', 'white', 'black'];

/** Les familles d'accent de marque : l'échelle les remplace (cran d'accent). */
export const ACCENT_FAMILIES = ['blue', 'indigo', 'sky'];

/** Les familles d'alerte : l'échelle les remplace (crans d'alerte). */
export const ALERT_FAMILIES = ['rose', 'red'];

/** Les trois familles que l'échelle remplace. */
export const REPLACED_FAMILIES = [...NEUTRAL_FAMILIES, ...ACCENT_FAMILIES, ...ALERT_FAMILIES];

const REPLACED = `(?:${REPLACED_FAMILIES.join('|')})`;
/** Les positions d'une SURFACE ou d'une bordure (les crans peignent des surfaces). */
const SURFACE_POSITIONS = '(?:bg|border|ring|from|to|via|shadow|decoration)';
/**
 * La fin d'un nom de couleur : l'échelon (`slate-600`) et l'alpha (`white/10`)
 * sont consommés EN ENTIER. Les avaler à moitié (`hover:bg-slate-5` pour
 * `hover:bg-slate-50`) rendait chaque jeton d'allowlist faux et chaque message
 * tronqué — un contrôle qui nomme mal ce qu'il refuse ne peut pas être corrigé.
 */
const COLOR_TAIL = '(?:-[0-9]{1,3})?(?:\\/[0-9.]+)?(?![\\w-])';

/** Le préfixe de variante, avec ce qui le précède (blanc, guillemet, début). */
const VARIANT = `(?:^|[\\s"'\`])(?:group-)?hover:`;

/**
 * Une recette de SURVOL DE SURFACE écrite à la main : `hover:bg-slate-50`,
 * `group-hover:bg-white/10`, `hover:border-blue-600`, `hover:ring-rose-500`…
 */
export const HOVER_SURFACE_RECIPE = new RegExp(
  `${VARIANT}${SURFACE_POSITIONS}-${REPLACED}${COLOR_TAIL}`,
  'g',
);

/** L'ENCRE d'accent ou d'alerte au survol : le cran la porte déjà. */
export const HOVER_INK_RECIPE = new RegExp(
  `${VARIANT}text-(?:${ACCENT_FAMILIES.join('|')}|${ALERT_FAMILIES.join('|')})${COLOR_TAIL}`,
  'g',
);

/**
 * Une couleur ARBITRAIRE au survol (`hover:bg-[#1E5E3A]`) : c'est le même défaut
 * écrit autrement — Tailwind ne la suit pas d'un thème, et personne ne la relit.
 */
export const HOVER_ARBITRARY_RECIPE = new RegExp(
  `${VARIANT}(?:bg|text|border|ring)-\\[[^\\]]+\\]`,
  'g',
);

/**
 * Toute recette de survol COLORÉE, toutes familles confondues — la mesure
 * d'anti-vacuité de la garde : si plus aucune recette n'est lue, le motif a
 * disparu (racine déplacée, filtre cassé) et le vert ne voudrait rien dire.
 *
 * Elle accepte les trois écritures d'une couleur — la famille nommée
 * (`slate-50`), la couleur ARBITRAIRE (`[#1E5E3A]`) et l'interpolation
 * (`\${accent}`) : les deux dernières sont précisément celles qu'un motif trop
 * étroit ne voit plus, et une garde qui ne les compte pas déclarerait « rien à
 * vérifier » au lieu d'accuser — le mauvais verdict, celui qui rassure.
 */
const ANY_COLOR = '(?:[a-z]+(?:-[0-9]{1,3})?(?:\\/[0-9.]+)?|\\[[^\\]]+\\]|\\$\\{[^}]+\\})';

export const ANY_HOVER_RECIPE = new RegExp(
  `${VARIANT}(?:bg|text|border|ring|from|to|via|shadow|decoration)-${ANY_COLOR}`,
  'g',
);

/**
 * Les occurrences d'une des recettes interdites dans une source déjà blanchie
 * de ses commentaires (`maskComments`, scripts/lib/source-text.mjs).
 *
 * @param {string} masked
 * @returns {{ token: string, kind: 'surface' | 'ink' | 'arbitrary' }[]}
 */
export function forbiddenHoverHits(masked) {
  const text = String(masked ?? '');
  const out = [];
  for (const [kind, pattern] of [
    ['surface', HOVER_SURFACE_RECIPE],
    ['ink', HOVER_INK_RECIPE],
    ['arbitrary', HOVER_ARBITRARY_RECIPE],
  ]) {
    pattern.lastIndex = 0;
    for (const hit of text.matchAll(pattern)) {
      out.push({ token: hit[0].trim(), kind });
    }
  }
  return out;
}

/** Les occurrences de N'IMPORTE quelle recette colorée (anti-vacuité). */
export function anyHoverHits(masked) {
  ANY_HOVER_RECIPE.lastIndex = 0;
  return [...String(masked ?? '').matchAll(ANY_HOVER_RECIPE)].map((hit) => hit[0].trim());
}
