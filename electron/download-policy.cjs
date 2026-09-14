/**
 * ─── Un téléchargement, UNE sortie ──────────────────────────────────────────
 *
 * Mesuré le 2026-09-13 : le reçu PDF d'un parent arrivait **deux fois** sur les
 * postes installés. La cause n'est pas dans l'application, elle est dans le
 * contrat d'Electron, et il est écrit noir sur blanc dans la documentation de
 * `DownloadItem` :
 *
 *   « If user doesn't set the save path via the API, Electron will use the
 *     original routine to determine the save path; this usually prompts a save
 *     dialog. »
 *
 * Tant que le chemin d'enregistrement n'est pas fixé, Electron applique donc sa
 * **routine d'origine** — un dialogue. Le code faisait exactement ça : il
 * laissait la routine d'Electron décider, **et** ouvrait son propre
 * `dialog.showSaveDialog` en parallèle. Un clic déclenchait donc deux
 * enregistrements : celui que l'utilisateur voyait, et l'autre, silencieux, dans
 * le dossier par défaut. Deux fichiers pour un reçu — et aucun remontage d'erreur,
 * puisque les deux réussissent.
 *
 * Ce module ne rend qu'une décision : comment CE téléchargement se termine. Il
 * est pur (pas d'Electron, pas de disque), donc la règle est testée comme une
 * décision plutôt que constatée en cliquant deux fois dans une fenêtre.
 *
 * Deux sorties possibles, **jamais les deux** :
 *   • un **chemin imposé** (`ELECTRON_DL_DIR` : preuve E2E, poste en kiosque) —
 *     `setSavePath` prend la main et Electron ne demande rien ;
 *   • des **options de dialogue** — `setSaveDialogOptions` personnalise le
 *     dialogue qu'Electron ouvre **lui-même** (titre, nom proposé). Un seul
 *     dialogue, un seul fichier.
 *
 * Ce que ce module ne fait pas volontairement : ouvrir un dialogue. C'est
 * précisément la main en trop qui a produit le doublon, et la laisser ici la
 * rendrait de nouveau possible.
 */
const { join } = require('node:path');

/** Le titre du dialogue d'enregistrement (le poste parle français). */
const SAVE_DIALOG_TITLE = 'Enregistrer le PDF';

/** Un nom de fichier utilisable même si le téléchargement n'en propose aucun. */
const DEFAULT_FILENAME = 'document.pdf';

/**
 * Comment terminer ce téléchargement.
 *
 * @param {{ autoDir?: string, filename?: string, title?: string }} input
 *   `autoDir` : dossier imposé (mode automatique) ; `filename` : nom proposé par
 *   le téléchargement.
 * @returns {{ kind: 'path', dir: string, path: string }
 *          |{ kind: 'dialog', options: { defaultPath: string, title: string } }}
 */
function downloadPlan({ autoDir, filename, title } = {}) {
  const name = String(filename ?? '').trim() || DEFAULT_FILENAME;
  const dir = String(autoDir ?? '').trim();
  if (dir) return { kind: 'path', dir, path: join(dir, name) };
  return { kind: 'dialog', options: { defaultPath: name, title: title || SAVE_DIALOG_TITLE } };
}

module.exports = { downloadPlan, SAVE_DIALOG_TITLE, DEFAULT_FILENAME };
