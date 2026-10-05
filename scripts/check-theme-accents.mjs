/**
 * Theme-accent gate — « l'accent suit le thème » se vérifie, il ne s'espère pas.
 *
 * Le dépôt a payé ce bug une fois, en grand : ParentsView portait huit boutons
 * `bg-blue-600` codés en dur. Comme le remap `!important` de Cyber Minuit ne
 * connaît que l'ambre, ces boutons restaient BLEUS dans un thème dont l'accent
 * est AMBRE — le seul défaut visuel que le thème ne pouvait pas rattraper, parce
 * qu'il n'existait pas dans le contrat.
 *
 * Le contrat existe maintenant (`currentTheme.accentBg/accentText/accentHover/
 * accentShadow/accentSoft…`, voir src/app/useTheme.ts). Ce contrôle est ce qui
 * empêche le prochain écran de réinventer le problème.
 *
 * ─── Ce qui est interdit, et pourquoi seulement ça ─────────────────────────
 *
 * Seuls `blue`, `indigo` et `sky` sont visés, sur les positions de SURFACE et
 * de BORDURE (`bg-`, `from-`, `to-`, `via-`, `shadow-`, `ring-`, `border-`). Ce
 * ne sont pas des couleurs sémantiques dans cette application : rien n'est
 * « bleu parce que c'est grave ». Elles servent d'accent de marque, donc elles
 * appartiennent au thème.
 *
 * Les positions `ring-` et `border-` ont été ajoutées après une vérification à
 * l'écran : le sélecteur d'année portait `focus:border-blue-500` et
 * `focus:ring-blue-500/5`, invisibles au premier motif — le focus restait bleu
 * dans un thème ambre. Comme pour les surfaces, `text-` reste dehors : c'est
 * là que vivent le vert « payé » et le rouge « en retard ».
 *
 * `emerald`, `rose`, `amber` et les autres sont DÉLIBÉRÉMENT laissés dehors :
 * ici, vert = payé/soldé, rouge = en retard/suppression, ambre = alerte. Les
 * peindre avec l'accent du thème effacerait du sens métier. Un contrôle qui les
 * interdirait forcerait à choisir entre « conforme » et « lisible ».
 *
 * ─── L'allowlist est une dette, pas une permission ─────────────────────────
 *
 * Les fichiers listés portent encore un accent codé en dur. Chaque entrée NOMME
 * la raison ; quand la migration passe, l'entrée devient PÉRIMÉE et le contrôle
 * ÉCHOUE jusqu'à sa suppression — donc chaque retrait est un diff visible dans
 * le commit qui le gagne, et la liste ne peut pas pourrir en silence. C'est la
 * même règle que scripts/check-line-budget.mjs.
 *
 * ─── Une dette PARTAGÉE avec le contrôle vert ──────────────────────────────
 *
 * L'allowlist et les motifs vivent dans `scripts/lib/theme-accents.mjs`, que
 * (le contrôle vert dédié a été retiré une fois sa famille migrée) : un fichier qui porte un fond ou une
 * bordure VERTE d'accent (mais aucun bleu) figure dans cette même liste, et il ne
 * doit PAS être jugé périmé ici. La péremption se juge donc sur les DEUX
 * familles — une entrée n'est périmée que si le fichier ne porte plus AUCUN
 * accent, bleu ni vert.
 *
 * Usage: node scripts/check-theme-accents.mjs   (branché sur `npm run lint`)
 */
import fs from 'node:fs';

import { assertScanned, listFiles, maskComments } from './lib/source-text.mjs';
import { THEME_ACCENT_DEBT, brandAccentHits, greenAccentHits, repoKey } from './lib/theme-accents.mjs';

const ROOT = process.env.CHECK_THEME_ACCENTS_ROOT || 'src';

const files = listFiles(ROOT, { ext: /\.tsx$/ });
assertScanned(files, { what: 'fichier(s) .tsx', root: ROOT });

const violations = [];
const seen = new Set();

for (const file of files) {
  const key = repoKey(file);
  // Commentaires blanchis, littéraux CONSERVÉS : une classe vit dans une chaîne,
  // et c'est exactement ce qu'on veut lire. Un commentaire qui *parle* d'un
  // `bg-blue-600` (comme l'en-tête de ce fichier) ne doit pas être accusé.
  const text = maskComments(fs.readFileSync(file, 'utf8'));
  const hits = brandAccentHits(text);
  // La péremption se juge sur les DEUX familles : un fichier qui ne porte qu'un
  // vert d'accent (aucun bleu) reste une dette légitime de l'allowlist partagée
  // et ne doit pas être déclaré périmé ici.
  if (hits.length === 0 && greenAccentHits(text).length === 0) continue;
  seen.add(key);
  if (THEME_ACCENT_DEBT[key]) continue;
  const lineOf = (offset) => text.slice(0, offset).split('\n').length;
  for (const hit of hits) violations.push(`${key}:${lineOf(hit.index)} → ${hit[0].trim()}`);
}

const stale = Object.keys(THEME_ACCENT_DEBT).filter((key) => !seen.has(key));

let failed = false;

if (violations.length > 0) {
  failed = true;
  console.error('❌ Accent de marque codé en dur dans un composant — il ne suivra pas le thème :');
  for (const v of violations) console.error(`   ${v}`);
  console.error('   → utilisez currentTheme.accentBg / accentText / accentHover / accentShadow');
  console.error('     (ou accentSoft / accentSoftText pour une surface teintée).');
}

if (stale.length > 0) {
  failed = true;
  console.error('❌ Entrée(s) PÉRIMÉE(S) dans ALLOWLIST — le fichier ne porte plus d’accent codé en dur :');
  for (const key of stale) console.error(`   ${key}`);
  console.error('   → retirez l’entrée dans le commit qui l’a gagnée.');
}

if (failed) process.exit(1);

console.log(
  `✅ Aucun accent de marque codé en dur hors allowlist (${files.length} fichier(s) .tsx, ` +
    `${Object.keys(THEME_ACCENT_DEBT).length} en dette).`,
);
