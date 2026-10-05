/**
 * Green-surface gate — « un fond vert non sémantique » ne doit pas revenir.
 *
 * Le dépôt a payé ce bug une fois : une SURFACE neutre était choisie par un
 * ternaire de thème, `isDark ? 'bg-emerald-900/10' : 'bg-slate-50'`. La branche
 * sombre portait donc un VERT — un accent de marque — là où il fallait une
 * surface NEUTRE (l'en-tête d'une carte, un encart de recapitulatif). Ce vert
 * déguisé en surface ne suit aucun thème : sur un thème dont l'accent est
 * l'ambre ou le bleu, il reste vert.
 *
 * La migration a porté ces surfaces sur `currentTheme.surfaceInset` (la surface
 * neutre qui suit le thème). Ce contrôle est ce qui empêche la convention de
 * revenir par un copier-coller.
 *
 * ─── Ce qui est interdit, et pourquoi seulement ça ─────────────────────────
 *
 * Toute occurrence de `bg-emerald-900` — avec ou sans suffixe d'opacité
 * (`bg-emerald-900/10`, `bg-emerald-900/90`) — est présumée NON SÉMANTIQUE :
 * c'est exactement la teinte de l'ancien ternaire, la plus sombre des verts de
 * fond, et elle n'a pas sa place comme surface neutre.
 *
 * Le vert SÉMANTIQUE de l'application (« payé », « soldé », toast de succès,
 * badge de rôle, bouton d'action) est une AUTRE chose : il CODE quelque chose.
 * Ces usages-là sont tolérés, mais NOMMÉS un par un dans l'allowlist ci-dessous.
 *
 * ─── L'allowlist est une dette, pas une permission ─────────────────────────
 *
 * Chaque entrée NOMME le fichier, la CLASSE et la RAISON. Le grain est le
 * couple (fichier, classe), jamais le fichier : une exception accordée à un
 * toast ne doit pas blanchir une régression ailleurs dans le même fichier. Et
 * quand l'exception disparaît du code, l'entrée devient PÉRIMÉE et le contrôle
 * ÉCHOUE jusqu'à sa suppression — chaque retrait est un diff visible dans le
 * commit qui le gagne, et la liste ne peut pas pourrir en silence. C'est la
 * même règle que scripts/check-dark-green-ink.mjs et check-theme-accents.mjs.
 *
 * ─── Lire du code, et refuser la vacuité ───────────────────────────────────
 *
 * La prose est blanchie par la couche partagée (`scripts/lib/source-text.mjs`) :
 * les littéraux sont CONSERVÉS (une classe vit dans une chaîne, c'est la donnée),
 * mais un commentaire qui CITE `'bg-emerald-900/10'` (l'en-tête de ce fichier,
 * la JSDoc de `mainViewsProps.ts`, `src/index.css`) ne doit pas être accusé.
 *
 * Et un scan qui ne lit AUCUNE surface verte n'est pas un scan vert : c'est un
 * scan dont le motif a disparu. Il sort en **2**, en le disant, plutôt que de
 * rassurer en silence — la même discipline que partout ici.
 *
 * Usage: node scripts/check-green-surface.mjs   (branché sur `npm run lint`)
 */
import fs from 'node:fs';
import path from 'node:path';

import { SOURCE_EXTS, assertScanned, listFiles, maskComments } from './lib/source-text.mjs';

const ROOT = process.env.CHECK_GREEN_SURFACE_ROOT || 'src';

/**
 * La dette de l'allowlist se juge sur l'ARBRE RÉEL. Une suite de tests pointe
 * ce contrôle sur une racine de fixtures : les exceptions du dépôt n'y existent
 * pas, et les déclarer « périmées » serait un faux échec. Le scan des violations
 * reste, lui, pleinement actif sur n'importe quelle racine.
 */
const scanningRealTree = path.resolve(ROOT) === path.resolve('src');

/**
 * La surface verte, quelle qu'en soit l'opacité (`bg-emerald-900/10`,
 * `bg-emerald-900/90`). Les variantes (`dark:`, `hover:`) sont couvertes : le
 * motif porte sur le jeton `bg-emerald-900`, pas sur son préfixe. `\b` final :
 * `-9000` (qui n'existe pas) ne doit pas matcher le préfixe d'un `-900`.
 */
const GREEN_SURFACE = /\bbg-emerald-900(?:\/\d+)?\b/g;

/**
 * Les exceptions tolérées : `file` + `token` + `reason`. Une entrée dont le
 * couple (fichier, classe) n'est plus une surface verte dans src/ est PÉRIMÉE —
 * le contrôle échoue jusqu'à sa suppression.
 *
 * Catégories sémantiques admises (une surface verte qui CODE quelque chose) :
 *   • un TOAST de succès/confirmation (fond plein, très sombre) ;
 *   • un badge « payé » / « soldé » (statut encodé par la couleur) ;
 *   • un CTA (bouton d'action dont l'affordance est verte).
 * Chaque tolérance doit tomber dans une de ces catégories — et le dire.
 */
const ALLOWLIST = [
  {
    file: 'src/components/ToastNotification.tsx',
    token: 'bg-emerald-900/90',
    reason:
      'Toast de succès : le fond plein et sombre CODE la confirmation (la même famille que le point de statut vert) ; c’est un signal sémantique, pas une surface neutre détournée — l’effacer vers surfaceInset éteindrait le sens.',
  },
];

const files = listFiles(ROOT, { ext: SOURCE_EXTS });
assertScanned(files, { what: 'fichier .ts/.tsx', root: ROOT });

const allowed = new Map(ALLOWLIST.map((entry) => [`${entry.file}::${entry.token}`, entry.reason]));
const seen = new Set();

const violations = [];
let greenLines = 0;

// La clé d'un fichier est DÉPÔT-RELATIVE, jamais dépendante de la forme de la
// racine : `listFiles` rend `src/…` pour une racine relative et un chemin
// absolu pour une racine absolue, et une allowlist écrite en chemins dépôt ne
// doit pas dépendre de ce détail d'appel.
const repoKey = (file) => path.relative(process.cwd(), path.resolve(file)).replace(/\\/g, '/');

for (const file of files) {
  const key = repoKey(file);
  const raw = fs.readFileSync(file, 'utf8');
  // Commentaires blanchis, littéraux CONSERVÉS : une classe vit dans une chaîne,
  // et c'est exactement ce qu'on veut lire. La longueur et les lignes ne bougent
  // pas, donc `file:ligne` ci-dessous désigne la ligne d'origine.
  const masked = maskComments(raw);
  const maskedLines = masked.split(/\r?\n/);
  const rawLines = raw.split(/\r?\n/);
  for (let i = 0; i < maskedLines.length; i += 1) {
    const line = maskedLines[i];
    if (!line.includes('bg-emerald-900')) continue;
    greenLines += 1;
    for (const hit of line.matchAll(GREEN_SURFACE)) {
      const token = hit[0];
      const id = `${key}::${token}`;
      if (allowed.has(id)) {
        seen.add(id);
        continue;
      }
      violations.push(
        `${key}:${i + 1} → ${token}\n      ${(rawLines[i] ?? '').trim().slice(0, 160)}`,
      );
    }
  }
}

// Un scan vide n'est pas un vert : si plus aucune surface verte n'est lue, le
// motif que ce contrôle protège a disparu — à retirer, ou à corriger.
if (greenLines === 0) {
  console.error(
    `❌ Rien à vérifier : aucune surface \`bg-emerald-900/*\` lue sous ${ROOT} — un scan vide n'est pas un vert.`,
  );
  console.error(
    '   Si la convention `bg-emerald-900` a été retirée du code, retirez ce contrôle ; sinon vérifiez sa racine.',
  );
  process.exit(2);
}

const stale = scanningRealTree
  ? ALLOWLIST.map((entry) => `${entry.file}::${entry.token}`).filter((id) => !seen.has(id))
  : [];

let failed = false;

if (violations.length > 0) {
  failed = true;
  console.error(
    '❌ Fond vert non sémantique (`bg-emerald-900/*`) réintroduit — la surface ne suivra pas le thème :',
  );
  for (const v of violations) console.error(`   ${v}`);
  console.error(
    '   → utilisez currentTheme.surfaceInset (la surface neutre qui suit le thème).' +
      '\n   → ou, si l’usage est SÉMANTIQUE (toast, badge « payé », CTA), ajoutez une entrée motivée dans ALLOWLIST.',
  );
}

if (stale.length > 0) {
  failed = true;
  console.error(
    '❌ Entrée(s) PÉRIMÉE(S) dans ALLOWLIST — le couple (fichier, classe) n’est plus une surface verte :',
  );
  for (const id of stale) console.error(`   ${id}`);
  console.error('   → retirez l’entrée dans le commit qui l’a gagnée.');
}

if (failed) process.exit(1);

console.log(
  `✅ Aucun fond vert non sémantique (\`bg-emerald-900/*\`) hors allowlist (${files.length} fichier(s) .ts/.tsx, ` +
    `${greenLines} ligne(s) verte(s), ${ALLOWLIST.length} exception(s) motivée(s)).`,
);
