/**
 * State-hover gate — « une recette de survol écrite à la main » ne doit pas
 * revenir.
 *
 * Le défaut payé, mesuré : chaque composant recopiait son survol de surface
 * (`hover:bg-slate-50 dark:hover:bg-white/10`, `hover:bg-slate-100
 * dark:hover:bg-slate-800`, `hover:bg-rose-100 dark:hover:bg-rose-950/60`).
 * Aucune couche de thème ne peut rattraper une telle recette — un remap ne
 * connaît que ses propres classes — donc un thème chaud gardait des survols
 * froids, et l'accent d'une école (le logo, décidé à l'exécution) n'atteignait
 * aucun de ces contrôles. `src/themes/state-hover.css` porte maintenant l'échelle
 * — ses crans ET leurs valeurs par thème (`--state-*`), treize classes en quatre
 * familles (voir scripts/lib/state-hover.mjs pour le contrat complet) :
 * `state-hover`, `state-hover-solid`, `state-hover-strong`, `state-hover-dark`,
 * `state-hover-deep`, `state-hover-clear`, `state-accent-hover`,
 * `state-accent-group-ink`, `state-alert-hover`, `state-alert-tint`,
 * `state-alert-solid`, `state-alert-dark`, `state-alert-plate`.
 *
 * Ce contrôle est ce qui empêche la recette de revenir par un copier-coller :
 * un bouton neuf hérite d'un cran, il n'invente plus le sien.
 *
 * ─── Ce qui est interdit, et pourquoi seulement ça ─────────────────────────
 *
 * Trois familles de couleur ne codent RIEN, et sont donc remplacées par
 * l'échelle : le NEUTRE (slate, gray, zinc, neutral, stone, white, black),
 * l'ACCENT DE MARQUE (blue, indigo, sky) et l'ALERTE (rose, red). Les écrire en
 * survol, sur une surface (`bg`, `border`, `ring`, `from`/`to`/`via`, `shadow`)
 * ou en encre pour l'accent et l'alerte, c'est refaire la recette.
 *
 * Les autres familles sont SÉMANTIQUES — l'ambre pour « en retard / à
 * rattraper », l'émeraude pour « payé / soldé », le violet et le cyan pour des
 * catégories de paie et de rôle. Elles ne suivent aucun thème PARCE QU'ELLES
 * CODENT quelque chose ; les migrer effacerait le sens. Elles restent
 * autorisées, et c'est ce qui garde ce contrôle utile plutôt que bruyant (même
 * arbitrage que scripts/check-theme-accents.mjs pour le vert et le bleu).
 *
 * Une limite, dite plutôt que découverte plus tard : une ENCRE NEUTRE au survol
 * (`hover:text-slate-600`) n'a pas de cran dans cette échelle et reste donc
 * tolérée PAR CETTE GARDE — et bornée par le verrou de contraste (`judgeHoverInk`,
 * tests/theme-contrast-remap.test.ts), qui refuse une encre de survol sous AA
 * 4,5:1 sur la surface que le thème peint sous le curseur, et sait qu'une encre de
 * repos forcée par un `!important` de thème ne se rend pas.
 *
 * Un survol posé sur une surface COLORÉE (le bandeau de paie, la fiche parent) et
 * un survol posé sur un chrome TOUJOURS sombre (le rail, l'écran de connexion) ne
 * sont plus des limites : ce sont des crans. L'échelle porte `state-hover-clear`
 * (un contrôle au repos BLANC OPAQUE sur un aplat coloré), `state-alert-plate`
 * (l'alerte sur ce même aplat, la surface seule), `state-alert-dark` (l'alerte sur
 * un chrome sombre : le voile ET l'encre levée) et `state-hover-deep` (un contrôle
 * neutre DÉJÀ REMPLI sur un chrome sombre). Ces quatre-là sont posés UNE fois dans
 * `:root` — ces surfaces sont les mêmes dans les six thèmes, et leurs valeurs sont
 * celles des recettes qu'elles remplacent.
 *
 * ─── L'allowlist est une dette, pas une permission ─────────────────────────
 *
 * Chaque entrée NOMME le fichier, la CLASSE et la RAISON. Le grain est le couple
 * (fichier, classe), jamais le fichier : une exception accordée à un bandeau ne
 * doit pas blanchir une régression ailleurs dans le même fichier. Et quand
 * l'exception disparaît du code, l'entrée devient PÉRIMÉE et le contrôle ÉCHOUE
 * jusqu'à sa suppression — chaque retrait est un diff visible dans le commit qui
 * le gagne, et la liste ne peut pas pourrir en silence (même règle que
 * scripts/check-green-surface.mjs et check-dark-green-ink.mjs).
 *
 * ─── Et elle est VIDE depuis le 2026-10-14 ───────────────────────────────────
 *
 * Les sept entrées qu'elle portait ont été GAGNÉES, pas oubliées : chacune
 * demandait un cran que l'échelle n'avait pas (« un contrôle clair sur un aplat
 * coloré », « l'alerte d'une surface toujours sombre », « une surface colorée, en
 * surface seule »), et ces quatre crans existent maintenant. Ce qui reste ici est
 * le MÉCANISME — grain, raison, péremption — au service de la dette suivante.
 *
 * Une liste vide ne peut plus faire rougir ses propres règles : c'est donc la
 * suite (tests/state-hover-guard.test.ts) qui les éprouve, sur une liste INJECTÉE
 * par `CHECK_STATE_HOVER_ALLOWLIST` — un fichier JSON de la même forme, employé à
 * la place de celle-ci.
 *
 * ─── Lire du code, et refuser la vacuité ───────────────────────────────────
 *
 * La prose est blanchie par la couche partagée (`scripts/lib/source-text.mjs`),
 * qui CONSERVE les littéraux (une classe vit dans une chaîne, c'est la donnée) :
 * un commentaire qui CITE `'hover:bg-slate-50'` — l'en-tête de ce fichier, la
 * JSDoc de `mainViewsProps.ts`, `src/index.css` — ne doit pas être accusé, et
 * les lignes gardées sont celles d'origine, donc `file:ligne` désigne la bonne
 * ligne.
 *
 * Et un scan qui ne lit AUCUNE recette de survol colorée n'est pas un scan vert :
 * c'est un scan dont le motif a disparu. Il sort en **2**, en le disant, plutôt
 * que de rassurer en silence — la même discipline que partout ici.
 *
 * Usage: node scripts/check-state-hover.mjs   (branché sur `npm run lint`)
 */
import fs from 'node:fs';
import path from 'node:path';

import { SOURCE_EXTS, assertScanned, listFiles, maskComments } from './lib/source-text.mjs';
import { anyHoverHits, forbiddenHoverHits } from './lib/state-hover.mjs';

const ROOT = process.env.CHECK_STATE_HOVER_ROOT || 'src';

/**
 * Les exceptions tolérées : `file` + `token` + `reason` — VIDE, et c'est l'état
 * gagné (voir l'en-tête : les sept entrées ont été payées par quatre crans).
 *
 * Une entrée dont le couple (fichier, classe) n'est plus une recette interdite
 * sous la racine scannée est PÉRIMÉE — le contrôle échoue jusqu'à sa suppression.
 *
 * `CHECK_STATE_HOVER_ALLOWLIST` pointe un fichier JSON de la MÊME forme, employé
 * À LA PLACE de celle-ci. C'est la porte par laquelle la suite éprouve le grain et
 * la péremption : avec une liste vide, ces deux règles ne s'exerceraient plus
 * nulle part. Une liste injectée porte toujours son propre verdict, donc la
 * péremption se juge sur N'IMPORTE QUELLE racine, arborescence de fixtures
 * comprise — l'ancien contournement « arbre réel » n'a plus d'objet, aucune entrée
 * du dépôt ne pouvant être déclarée périmée par une racine de fixtures.
 */
const ALLOWLIST_PATH = process.env.CHECK_STATE_HOVER_ALLOWLIST || '';
if (ALLOWLIST_PATH && !fs.existsSync(ALLOWLIST_PATH)) {
  console.error(`❌ Allowlist injectée introuvable : ${ALLOWLIST_PATH}`);
  process.exit(2);
}
const ALLOWLIST = ALLOWLIST_PATH ? JSON.parse(fs.readFileSync(ALLOWLIST_PATH, 'utf8')) : [];
if (!Array.isArray(ALLOWLIST) || ALLOWLIST.some((e) => !e?.file || !e?.token || !e?.reason)) {
  console.error(
    `❌ Allowlist injectée illisible (${ALLOWLIST_PATH}) : un tableau de { file, token, reason } est attendu.`,
  );
  process.exit(2);
}

const files = listFiles(ROOT, { ext: SOURCE_EXTS });
assertScanned(files, { what: 'fichier .ts/.tsx', root: ROOT });

const allowed = new Map(ALLOWLIST.map((entry) => [`${entry.file}::${entry.token}`, entry.reason]));
const seen = new Set();

// La clé d'un fichier est DÉPÔT-RELATIVE, jamais dépendante de la forme de la
// racine : `listFiles` rend `src/…` pour une racine relative et un chemin absolu
// pour une racine absolue, et une allowlist écrite en chemins dépôt ne doit pas
// dépendre de ce détail d'appel.
const repoKey = (file) => path.relative(process.cwd(), path.resolve(file)).replace(/\\/g, '/');

const violations = [];
let recipeLines = 0;

for (const file of files) {
  const key = repoKey(file);
  const raw = fs.readFileSync(file, 'utf8');
  const masked = maskComments(raw);
  const maskedLines = masked.split(/\r?\n/);
  const rawLines = raw.split(/\r?\n/);
  for (let i = 0; i < maskedLines.length; i += 1) {
    const line = maskedLines[i];
    if (anyHoverHits(line).length > 0) recipeLines += 1;
    for (const { token, kind } of forbiddenHoverHits(line)) {
      const id = `${key}::${token}`;
      if (allowed.has(id)) {
        seen.add(id);
        continue;
      }
      violations.push(
        `${key}:${i + 1} → ${token}  (${kind === 'ink' ? 'encre' : kind === 'arbitrary' ? 'couleur arbitraire' : 'surface'})\n` +
          `      ${(rawLines[i] ?? '').trim().slice(0, 160)}`,
      );
    }
  }
}

// Un scan vide n'est pas un vert : si plus aucune recette de survol colorée
// n'est lue, le motif que ce contrôle protège a disparu — à retirer, ou à
// corriger (racine, filtre).
if (recipeLines === 0) {
  console.error(
    `❌ Rien à vérifier : aucune recette de survol colorée lue sous ${ROOT} — un scan vide n'est pas un vert.`,
  );
  console.error(
    '   Si les survols colorés ont quitté le code, retirez ce contrôle ; sinon vérifiez sa racine.',
  );
  process.exit(2);
}

// La péremption se juge sur CE QUI A ÉTÉ SCANNÉ, quelle que soit la racine : une
// entrée périmée est une entrée qui ne tolère plus rien.
const stale = ALLOWLIST.map((entry) => `${entry.file}::${entry.token}`).filter(
  (id) => !seen.has(id),
);

let failed = false;

if (violations.length > 0) {
  failed = true;
  console.error(
    '❌ Recette de survol écrite à la main — elle ne suivra ni le thème ni l’accent de l’école :',
  );
  for (const v of violations) console.error(`   ${v}`);
  console.error(
    '   → crans disponibles (currentTheme) :\n' +
      '       hoverSurface        — surface neutre de page (carte, bouton fantôme, icône) ; `rowHover` pour une RANGÉE\n' +
      '       hoverSurfaceSolid   — le même pas sur un contrôle au repos DÉJÀ rempli (neutre doux)\n' +
      '       hoverSurfaceStrong  — le même pas sur un remplissage neutre FORT (bouton slate-800/700)\n' +
      '       hoverSurfaceDark    — surface toujours sombre ou COLORÉE (rail, bandeau, en-tête teinté) : un voile\n' +
      '       hoverSurfaceClear   — un contrôle au repos BLANC OPAQUE sur un aplat COLORÉ (bandeau, fiche parent)\n' +
      '       hoverAccent         — accent : surface atténuée + encre d’accent\n' +
      '       hoverAccentGroupInk — l’encre d’accent seule, sous un ancêtre `.group` survolé\n' +
      '       hoverAlert          — alerte (geste destructif) : surface rose + encre rose\n' +
      '       hoverAlertTint      — la surface d’alerte seule (rangée en retard)\n' +
      '       hoverAlertSolid     — l’ombre d’un CTA destructif déjà plein (rose-500/600/700)\n' +
      '       hoverAlertDark      — l’alerte sur un chrome TOUJOURS sombre (déconnexion du rail) : voile + encre levée\n' +
      '       hoverAlertPlate     — l’alerte SUR un aplat coloré (corbeille d’un bandeau) : la surface seule, en voile\n' +
      '   → une famille SÉMANTIQUE (ambre, émeraude, violet… ou cyan) reste permise : elle CODE un fait.\n' +
      '   → hors de portée du thème (l’écran de connexion ne reçoit pas currentTheme), les crans se nomment en clair :\n' +
      '       state-hover-dark, state-hover-deep — chrome en dur, identique dans les six thèmes.\n' +
      '   → l’ALLOWLIST n’est plus que le dernier recours : une entrée y est une DETTE (voir son en-tête), et un cran\n' +
      '     manquant se gagne dans src/themes/state-hover.css — pas dans un composant.',
  );
}

if (stale.length > 0) {
  failed = true;
  console.error(
    '❌ Entrée(s) PÉRIMÉE(S) dans ALLOWLIST — le couple (fichier, classe) n’est plus une recette interdite :',
  );
  for (const id of stale) console.error(`   ${id}`);
  console.error('   → retirez l’entrée dans le commit qui l’a gagnée.');
}

if (failed) process.exit(1);

console.log(
  `✅ Aucune recette de survol écrite à la main hors allowlist (${files.length} fichier(s) .ts/.tsx, ` +
    `${recipeLines} ligne(s) de survol coloré, ${ALLOWLIST.length} exception(s) motivée(s)).`,
);
