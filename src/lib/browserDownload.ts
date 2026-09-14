/**
 * ─── Le SEUL endroit qui émet un téléchargement ──────────────────────────────
 *
 * Le 2026-09-13, le reçu d'un parent arrivait **deux fois** sur les postes
 * installés. La cause principale était dans le processus principal (Electron
 * applique sa propre routine d'enregistrement tant que le chemin n'est pas fixé,
 * donc ouvrir un dialogue de plus écrivait un fichier de plus — voir
 * `electron/download-policy.cjs`, corrigé pour tous les téléchargements d'un
 * coup, puisque le gestionnaire est par **session**).
 *
 * Ce module traite la deuxième moitié du problème, celle qui a permis au défaut
 * de survivre : **le mécanisme de téléchargement était recopié**. Quatre fichiers
 * (`pdfReceipt`, `pdfPayrollFiche`, `pdfPayrollTechnique`, `pdfPayrollBulletin`)
 * portaient chacun la même douzaine de lignes — créer une URL d'objet, un
 * `a.download`, le cliquer, le retirer, révoquer l'URL plus tard — et l'export CSV
 * du journal d'audit en avait une cinquième, écrite à la main. Cinq exemplaires
 * d'une opération qui doit se produire **une fois** : il suffisait d'en corriger
 * un pour croire le problème réglé, et d'en oublier un pour qu'il revienne. C'est
 * exactement ce qui s'était passé — le correctif d'hier ne portait que sur la
 * surface d'où venait la plainte.
 *
 * La règle est donc : **un téléchargement = un appel à `downloadBytes`**, et cette
 * fonction est la seule du dépôt qui pose un attribut `download` (un contrôle le
 * vérifie). Le jour où l'on doit changer la façon dont l'app télécharge — le nom
 * d'un fichier, la révocation de l'URL, ce qu'on fait dans Electron — il n'y a
 * qu'un endroit à changer, et aucune surface ne peut rester en arrière.
 */

/** Le type MIME par défaut : neuf téléchargements sur dix sont des PDF. */
const PDF_MIME = 'application/pdf';

/**
 * Combien de temps l'URL d'objet reste vivante après le clic.
 *
 * La révoquer trop tôt annulerait le téléchargement en cours ; ne jamais la
 * révoquer garderait le document entier en mémoire jusqu'au rechargement de la
 * page. Quatre secondes suffisent largement, y compris pour un PDF de plusieurs
 * mégaoctets déjà en mémoire.
 */
const REVOKE_DELAY_MS = 4000;

/**
 * Émet UN téléchargement pour ces octets.
 *
 * Ne fait rien hors navigateur (rendu serveur, tests sans DOM) : un
 * téléchargement est un effet de bord, il n'a pas à faire échouer un rendu.
 *
 * @param bytes le contenu du fichier
 * @param filename le nom proposé au poste
 * @param type le type MIME (PDF par défaut)
 */
export function downloadBytes(
  bytes: Uint8Array | ArrayBuffer,
  filename: string,
  type: string = PDF_MIME,
): void {
  if (typeof document === 'undefined' || typeof URL === 'undefined') return;
  const blob = new Blob([bytes as unknown as BlobPart], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), REVOKE_DELAY_MS);
}
