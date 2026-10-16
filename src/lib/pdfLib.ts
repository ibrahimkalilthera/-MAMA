/**
 * Le SEUL endroit qui charge `pdf-lib` — et il refuse de rendre un `undefined`
 * tacite.
 *
 * POURQUOI CE FICHIER EXISTE (panne mesurée le 2026-10-16, CI `pdf-e2e.yml`)
 * -------------------------------------------------------------------------
 * `const { PDFDocument } = await import('pdf-lib')` a produit :
 *
 *     TypeError: Cannot destructure property 'PDFDocument' of
 *     '(intermediate value)' as it is undefined
 *
 * Le reçu n'était donc pas produit, et le message ne disait RIEN de la vraie
 * panne. Le mécanisme, lui, est dans le chargeur de Vite (helper de préchargement
 * du bundle) : quand un import dynamique échoue — le fichier du morceau n'arrive
 * pas —, le helper émet `vite:preloadError` puis ne relance l'erreur QUE si
 * personne n'a appelé `preventDefault()`. L'application l'appelle (c'est sa
 * reprise : `chunkLoadRecovery`) : la promesse est donc **résolue avec
 * `undefined`** au lieu d'être **rejetée**. Un appelant qui déstructure ne voit
 * pas un échec de chargement : il voit « undefined », et son TypeError parle de
 * déstructuration, pas de réseau.
 *
 * DEUX DÉFENSES, et aucune n'est cosmétique :
 *
 *   1. **Une nouvelle tentative.** Un morceau qui n'est pas arrivé est exactement
 *      la panne qu'un second essai répare — et ce n'est pas une relecture du même
 *      échec : la spécification RETIRE de la table des modules un module dont le
 *      chargement a échoué, donc le second `import()` refait la requête.
 *   2. **Un refus NOMMÉ.** Si l'import rend un objet sans `PDFDocument`/
 *      `StandardFonts`/`rgb` (bundle incomplet, interopérabilité cassée), l'erreur
 *      dit CE QUI a été reçu — jamais un « cannot destructure » qui envoie
 *      chercher la panne dans le code d'à côté.
 *
 * Rien n'est mémorisé ici à dessein : le navigateur garde déjà le module chargé
 * dans sa table des modules, donc le `import()` suivant ne refait aucune requête.
 * Un cache local recopierait une garantie de la plateforme — et masquerait un
 * `undefined` reçu une fois, au lieu de forcer une reprise.
 */

/** Ce que les générateurs utilisent réellement de `pdf-lib`. */
export interface PdfLibModule {
  PDFDocument: typeof import('pdf-lib').PDFDocument;
  StandardFonts: typeof import('pdf-lib').StandardFonts;
  rgb: typeof import('pdf-lib').rgb;
}

/** Le chargement réel — littéral, pour que Vite en fasse un morceau à part. */
const importPdfLib = (): Promise<unknown> => import('pdf-lib');

/** Un essai rend-il de quoi dessiner un document ? (jamais un `undefined` llisible) */
const usableModule = (module: unknown): module is PdfLibModule => {
  const candidate = module as Partial<PdfLibModule> | null | undefined;
  return (
    !!candidate &&
    typeof candidate.PDFDocument === 'function' &&
    typeof candidate.rgb === 'function' &&
    !!candidate.StandardFonts
  );
};

/** Ce qu'un essai a rendu, dit sans mentir (pour le message d'échec). */
const describe = (module: unknown): string =>
  module === undefined
    ? 'aucun module (le chargement a rendu `undefined` — un morceau non arrivé, pas un module)'
    : module === null
      ? '`null` au lieu d’un module'
      : `un objet sans PDFDocument/StandardFonts/rgb (clés : ${
          Object.keys(module as object).slice(0, 8).join(', ') || 'aucune'
        })`;

/** Nombre d'essais : le chargement réel, puis UNE reprise. */
export const PDF_LIB_ATTEMPTS = 2;

/**
 * Charge `pdf-lib`, avec UNE reprise, et refuse un module inutilisable.
 *
 * @param load le chargeur (les tests injectent le leur ; l'application garde
 *   l'import littéral, sinon Vite ne découperait plus le morceau)
 * @returns les trois exportations employées par les générateurs
 * @throws Error nommant `pdf-lib` et la raison du refus, `cause` = dernier échec
 */
export async function loadPdfLib(
  load: () => Promise<unknown> = importPdfLib,
  attempts: number = PDF_LIB_ATTEMPTS,
): Promise<PdfLibModule> {
  let lastFailure: unknown;
  for (let attempt = 1; attempt <= Math.max(1, attempts); attempt += 1) {
    try {
      const module = await load();
      if (usableModule(module)) return module;
      lastFailure = new Error(describe(module));
    } catch (error) {
      lastFailure = error;
    }
  }
  const reason = lastFailure instanceof Error ? lastFailure.message : String(lastFailure);
  throw new Error(
    `pdf-lib n’a pas pu être chargé après ${Math.max(1, attempts)} essai(s) : ${reason}. ` +
      'Le document n’a pas été produit — aucun « undefined » ne circule : le refus dit ce qui manque.',
    { cause: lastFailure },
  );
}
