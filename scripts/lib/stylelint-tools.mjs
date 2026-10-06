/**
 * ─── Pourquoi le CSS se vérifie depuis un arbre ISOLÉ ───────────────────────
 *
 * Mesuré le 2026-10-06 : le seul chemin vers `braces@3.0.3` dans l'arbre racine
 * était `stylelint@17.16.0 → micromatch@4.0.8 → braces@3.0.3` (plus ses
 * `fast-glob`/`globby`, eux aussi à leur dernière version). Or `braces` s'arrête
 * à **3.0.3**, l'avis couvre `<= 3.0.3` et sa liste de versions corrigées est
 * VIDE : un `overrides` ne peut pas viser une version qui n'existe pas, et le
 * seul « correctif » que npm propose est un DOWNGRADE (stylelint 7.7.0) qui
 * casserait la chaîne CSS. Relever la base d'audit était donc la seule issue
 * honnête à ce moment-là — et elle est restée à 15.
 *
 * Le dépôt avait déjà payé ce cas une fois, et il en avait tiré la règle : les
 * épingles dev-only du CLI Vercel sont sorties du lockfile RACINE en déménageant
 * dans le manifeste isolé `tools/`, et la base est revenue à zéro (voir
 * scripts/check-audit.mjs). C'est exactement la même opération, appliquée à
 * l'outil qui porte `braces`.
 *
 * ─── Ce que ce module fait, et ce qu'il ne fait pas ─────────────────────────
 *
 * Il NE réécrit pas la règle : le `stylelint.config.js` est celui d'avant, la
 * version de stylelint est celle d'avant, les 5 règles (dont
 * `reportNeedlessDisables`, qui fait rougir un `stylelint-disable` devenu
 * inutile) sont celles d'avant. Il change UNE chose : d'où le binaire est
 * résolu. L'entrée est lue dans le `bin` DÉCLARÉ du paquet isolé — la même
 * déclaration dont npm génère ses wrappers —, jamais recopiée à la main.
 *
 * Il ne masque rien non plus : `braces@3.0.3` n'est PAS corrigé, il est
 * DÉPLACÉ hors du gate racine, et l'arbre isolé reste audité en avertissement
 * seul par `scripts/report-tools-audit.mjs` à chaque push. L'avis reste visible ;
 * il ne fait simplement plus échouer un gate qui ne protège que l'application.
 *
 * Pure où ça compte : chemins in, argv out, système de fichiers injectable —
 * chaque branche d'échec (arbre absent, `bin` illisible, entrée déclarée mais
 * absente du disque) est ainsi asserée au lieu d'être espérée.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/** Le manifeste isolé qui porte le linter CSS (hors lockfile racine). */
export const ISOLATED_DIR = 'tools/csslint';

/** Le paquet dont on lit le `bin` déclaré. */
export const ISOLATED_TOOL = 'stylelint';

/** La commande d'installation, citée telle quelle dans les messages d'échec. */
export const INSTALL_SCRIPT = 'tools:csslint:install';

/** Le dossier de `node_modules` de l'arbre isolé — base des plugins du config. */
export const isolatedModules = (root) => join(root, ISOLATED_DIR, 'node_modules');

/** Le manifeste du paquet isolé. */
export const isolatedManifest = (root) => join(isolatedModules(root), ISOLATED_TOOL, 'package.json');

/** Défaut : lecture JSON d'un manifeste. Injecté dans les tests. */
function readManifest(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

/**
 * L'entrée du binaire, résolue depuis le `bin` DÉCLARÉ du paquet isolé.
 *
 * Aucune valeur de repli : un `bin` absent, illisible, ou déclaré mais absent du
 * disque rend `null`, et l'appelant le dit — au lieu de retomber sur un
 * `node_modules` racine qui n'existe plus (ce qui est le POINT de ce module).
 *
 * @param {{ root: string, exists?: (p: string) => boolean, readPackage?: (p: string) => any }} options
 * @returns {{ entry: string, packageDir: string } | null}
 */
export function stylelintEntry({ root, exists = existsSync, readPackage = readManifest }) {
  const packageDir = join(isolatedModules(root), ISOLATED_TOOL);
  const manifest = join(packageDir, 'package.json');
  if (!exists(manifest)) return null;
  let pkg;
  try {
    pkg = readPackage(manifest);
  } catch {
    return null;
  }
  const declared = pkg?.bin;
  if (declared && typeof declared === 'object' && typeof declared[ISOLATED_TOOL] === 'string') {
    const entry = join(packageDir, declared[ISOLATED_TOOL]);
    return exists(entry) ? { entry, packageDir } : null;
  }
  return null;
}

/**
 * L'argv complet : l'entrée, les arguments reçus de la chaîne, puis la base de
 * résolution des PLUGINS.
 *
 * Le config `stylelint.config.js` nomme `stylelint-order` et `stylelint-scss` :
 * ces deux paquets vivent maintenant dans l'arbre isolé, donc la base doit être
 * le `node_modules` de cet arbre — sinon stylelint chercherait les plugins dans
 * le `node_modules` racine, où ils ne sont plus, et le gate CSS mourrait sur une
 * erreur de résolution. C'est le seul ajout d'argument du module.
 *
 * @param {{ entry: string, args?: string[], root: string }} options
 * @returns {string[]}
 */
export function stylelintArgv({ entry, args = [], root }) {
  return [entry, ...args, '--config-basedir', isolatedModules(root)];
}

/**
 * Le message d'échec nommé — arbre isolé absent.
 *
 * Il dit ce qui manque, où, et la commande qui répare : la chaîne ne doit jamais
 * rendre un `Cannot find module` sec, ni (pire) sauter le CSS en silence.
 *
 * @param {{ root: string }} options
 * @returns {string}
 */
export function missingTreeMessage({ root }) {
  return (
    `le linter CSS isolé n'est pas installé : ${isolatedModules(root)} est absent.\n` +
    `  Le gate CSS tourne depuis ${ISOLATED_DIR}/ (hors lockfile racine) pour que \`braces@3.0.3\` — sans correctif amont — ` +
    `ne fasse pas échouer l'audit de l'application.\n` +
    `  Installez-le : npm run ${INSTALL_SCRIPT}`
  );
}
