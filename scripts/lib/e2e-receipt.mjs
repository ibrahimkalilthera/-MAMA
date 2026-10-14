/**
 * ─── LE GESTE « TÉLÉCHARGER LE REÇU », ET COMMENT LE PIXEL-CHECK LE VISE ─────
 *
 * Le pixel-check E2E (`scripts/verify-pdf-download.mjs`) doit cliquer le bouton
 * qui produit le reçu d'un élève ou d'un membre du personnel — dans le carnet de
 * la fiche (`PaymentLedger`), sur la carte d'un membre (`PayrollView`), et
 * demain où l'application l'offrira.
 *
 * Il le faisait par le LIBELLÉ : « premier bouton dont le titre ou le texte
 * matche /reçu|recu|receipt/i ». C'est exactement ce que ce dépôt s'interdit
 * ailleurs (`scripts/check-data-slots.mjs` : « un nom STABLE, jamais un libellé
 * traduit »), et le 2026-10-14 la facture est tombée — mesurée, pas supposée :
 *
 *   la 1.0.33 a donné au rail un onglet « Reçus muets » (`navSilentReceipts`).
 *   Ce bouton de navigation dit « Reçus muets », il est rendu AVANT les modales
 *   dans le DOM, et il matche donc /reçu/i. Le pixel-check cliquait `btns[0]` :
 *   il quittait la fiche ouverte au lieu de générer le reçu, puis accusait
 *   l'application — « aperçu du reçu non affiché » — d'un défaut qui n'existait
 *   pas. Le run `recu-parent` est devenu rouge sur deux commits de suite, alors
 *   que le geste du guichet, lui, allait très bien.
 *
 * La leçon n'est pas « la 1.0.33 a cassé un test » : c'est qu'un contrôle qui
 * vise un mot traduit dépend de TOUT le vocabulaire de l'écran, y compris des
 * mots qui n'ont rien à voir avec lui. Il vise donc désormais un MARQUEUR, posé
 * par le composant qui porte le geste, et lu par un préfixe — un hôte nouveau
 * n'a qu'à se nommer dans la famille pour être trouvé, sans toucher au script.
 *
 * Ce module est PUR (aucun DOM, aucun accès réseau) : il ne porte que les noms.
 * Il ne CLIQUE rien — le script passe la constante dans la page, et le clic
 * reste dans `page.evaluate`, sous les yeux du contrôle.
 */

/**
 * Le préfixe des marqueurs du geste « télécharger le reçu ». Un hôte le reprend
 * en suffixe (`payment-receipt-ledger`, `payment-receipt-payroll`), ce qui garde
 * l'unicité exigée par `check-data-slots.mjs` (un marqueur = une région) tout en
 * laissant le pixel-check viser les trois d'un seul sélecteur.
 */
export const RECEIPT_SLOT_PREFIX = 'payment-receipt';

/**
 * Le sélecteur que le pixel-check emploie dans la page. Un suffixe plutôt qu'une
 * valeur exacte : plusieurs écrans portent le geste, et le contrôle doit suivre
 * l'application, pas l'inventaire des écrans d'aujourd'hui.
 */
export const RECEIPT_BUTTON_SELECTOR = `[data-slot^="${RECEIPT_SLOT_PREFIX}"]`;

/**
 * Le SECOND geste du même reçu : le bouton de l'APERÇU qui déclenche vraiment le
 * téléchargement (`ReceiptPreviewModal`). Il a son propre marqueur, hors de la
 * famille ci-dessus, pour une raison de sélection : l'aperçu s'affiche PAR-DESSUS
 * la fiche ouverte, donc un préfixe commun ferait désigner deux boutons à la fois
 * et « le premier du DOM » deviendrait la réponse à une question qu'on n'a pas
 * posée.
 *
 * Il était attendu par sa phrase (« Télécharger le reçu ») : même dépendance au
 * vocabulaire, même facture possible. Le marqueur la supprime.
 */
export const PREVIEW_DOWNLOAD_SELECTOR = '[data-slot="receipt-preview-download"]';
