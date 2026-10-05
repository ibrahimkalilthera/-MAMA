/**
 * ─── Le contrat d'accent, partagé avec le contrôle bleu ────────────────────
 *
 * Le dépôt a payé ce bug deux fois. Une première fois avec l'accent de marque
 * BLEU : ParentsView portait huit boutons `bg-blue-600` codés en dur, et le
 * remap `!important` d'un thème sombre ne connaît que son propre accent, donc
 * les boutons restaient bleus dans un thème ambre. Une seconde fois avec le
 * VERT : l'accent historique de l'application est l'émeraude, et un fond ou une
 * bordure `bg-emerald-600` / `border-emerald-500` codé en dur ne suivra, lui
 * non plus, aucun thème.
 *
 * `scripts/check-theme-accents.mjs` garde ce contrat pour la famille BLEU /
 * INDIGO / SKY. La famille VERTE, elle, a été ENTIÈREMENT migrée vers les jetons
 * d'accent (`accentBg`, `accentBorder`, `accentSoft`, `accentHexDeep`…) : il ne
 * reste plus AUCUN `bg`/`from`/`to`/`via`/`border-emerald-400…800` dans les
 * composants `.tsx`. Le contrôle dédié à cette famille — scripts/check-green-accent.mjs
 * — devenait donc vacant (sa sortie 2 anti-vacuité), et il a été retiré avec son
 * entrée d'inventaire et son segment `lint:chain`, comme son propre en-tête le
 * prescrivait. Le vert SÉMANTIQUE qui subsiste (« payé / soldé », toast, badge
 * de rôle) est tenu par les deux contrôles voisins et plus fins :
 * `scripts/check-green-surface.mjs` (surface `bg-emerald-900/*`) et
 * `scripts/check-dark-green-ink.mjs` (encre `text-emerald-*` sous `isDark`).
 *
 * ─── L'allowlist est une dette, pas une permission ─────────────────────────
 *
 * Chaque entrée NOMMAIT le fichier et la RAISON. Le grain est le FICHIER, comme
 * pour le contrôle historique : un fichier qui porte encore un accent codé en
 * dur y figure, et la raison dit ce qui reste à migrer. Une entrée dont le
 * fichier ne porte PLUS aucun accent — bleu NI vert — est PÉRIMÉE, et
 * `check-theme-accents.mjs` échoue jusqu'à sa suppression ; la liste ne peut
 * donc pas pourrir en silence, et chaque retrait est un diff visible.
 *
 * Elle est VIDE : la migration est terminée. La garder comme objet (plutôt que de
 * la supprimer) laisse le contrôle juger la péremption d'une future dette, et
 * documente l'intention — on n'y ajoute pas un fichier, on MIGRE ses accents.
 *
 * ─── Les familles, et pourquoi seulement elles ─────────────────────────────
 *
 * Le BLEU, l'INDIGO et le SKY ne sont pas des couleurs sémantiques dans cette
 * application : rien n'est « bleu parce que c'est grave ». Ils servent d'accent
 * de marque, donc appartiennent au thème.
 *
 * Le VERT est AMBIGU : il CODE « payé / soldé » (badges, points de statut,
 * cases cochées) autant qu'il servait d'accent historique (CTA, en-têtes). Un
 * contrôle ne peut pas trancher cette ambiguïté au grain de la classe ; la dette
 * au grain du FICHIER, elle, la tranchait par l'allowlist. C'est pourquoi
 * `GREEN_ACCENT` ne visait que les nuances SATURÉES (400…800) : les teintes de
 * statut (`emerald-50/100`) et les teintes sombres (`emerald-900`, tenue par
 * scripts/check-green-surface.mjs) restaient dehors. `GREEN_ACCENT` /
 * `greenAccentHits` sont conservés pour que `check-theme-accents.mjs` puisse
 * encore juger la péremption d'une entrée verte si l'allowlist en accueille une.
 */

import path from 'node:path';

/**
 * L'accent de marque (bleu/indigo/sky) sur une position de surface ou de
 * bordure. `\b` final : `-600` ne doit pas matcher le préfixe d'un `-6000`.
 */
export const BRAND_ACCENT =
  /(?:^|[\s"'`:])(?:bg|from|to|via|shadow|ring|border)-(?:blue|indigo|sky)-(?:400|500|600|700)\b/g;

/**
 * Le fond ou la bordure VERTE d'accent : la famille émeraude, nuances saturées
 * seulement (400…800), sur les positions de surface (`bg-`, et les arrêts de
 * dégradé `from-`/`to-`/`via-`, qui sont des fonds) et de bordure (`border-`).
 * Les anneaux et les ombres (`ring-`, `shadow-`) ne sont ni des fonds ni des
 * bordures, donc restent dehors.
 *
 * Conservé après la migration : il sert à `check-theme-accents.mjs` pour juger la
 * péremption d'une entrée de dette qui ne porterait qu'un vert. Plus aucun
 * fichier des composants ne le déclenche aujourd'hui.
 */
export const GREEN_ACCENT =
  /(?:^|[\s"'`:])(?:bg|from|to|via|border)-emerald-(?:400|500|600|700|800)\b/g;

/**
 * La dette partagée : VIDE, la migration d'accent est terminée. On la garde
 * comme objet pour que `check-theme-accents.mjs` continue de juger la péremption
 * d'une future entrée — une dette ne se consent pas, elle se migre.
 */
export const THEME_ACCENT_DEBT = {};

/**
 * La clé de l'allowlist, DÉPÔT-RELATIVE et indépendante de la forme de la
 * racine : `listFiles` rend `src/…` pour une racine relative et un chemin
 * absolu pour une racine absolue, et une allowlist écrite en chemins dépôt ne
 * doit pas dépendre de ce détail d'appel. (C'est le bug latent qu'un test a
 * révélé : une exécution avec une racine absolue déclarait toutes les entrées
 * périmées.)
 */
export const repoKey = (file) =>
  path.relative(process.cwd(), path.resolve(file)).replace(/\\/g, '/');

/** Les occurrences d'accent de marque dans une source blanchie des commentaires. */
export function brandAccentHits(masked) {
  BRAND_ACCENT.lastIndex = 0;
  return [...String(masked ?? '').matchAll(BRAND_ACCENT)];
}

/** Les occurrences de fond/bordure verts d'accent dans une source blanchie. */
export function greenAccentHits(masked) {
  GREEN_ACCENT.lastIndex = 0;
  return [...String(masked ?? '').matchAll(GREEN_ACCENT)];
}
