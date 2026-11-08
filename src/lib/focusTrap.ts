/**
 * Piège de focus des dialogues — la règle clavier qu'aucune fenêtre du guichet
 * ne tenait.
 *
 * Un dialogue `aria-modal="true"` promet que le reste de la page n'existe plus
 * pendant qu'il est ouvert. Sans piège, c'est faux : `Tab` sort du panneau, la
 * barre latérale reprend le focus, et la touche `Entrée` suivante active un lien
 * que l'utilisateur ne voit pas. Un utilisateur sans souris — ou un lecteur
 * d'écran — se retrouve donc à naviguer dans une page qu'il croit masquée.
 *
 * Ce module ne connaît ni React ni le thème : il prend un élément racine et
 * rend une fonction de débranchement. C'est `ModalShell` qui le monte, une fois
 * par dialogue ouvert, pour que la règle vive à UN endroit au lieu d'être
 * recopiée dans chaque fenêtre.
 *
 * Trois choix méritent d'être dits :
 *
 *   • **La liste est relue à chaque `Tab`**, jamais figée à l'ouverture : un
 *     dialogue qui affiche un champ conditionnel, désactive un bouton pendant
 *     l'envoi, ou remplace son pied de page doit boucler sur ce qui est
 *     focalisable MAINTENANT. Une liste calculée une fois laisserait le focus
 *     sauter dans le vide.
 *   • **Un dialogue sans aucun focalisable reste utilisable** : la racine
 *     reçoit `tabindex="-1"` et prend le focus, au lieu de laisser la page
 *     reprendre la main — et l'attribut est retiré au débranchement, pour ne pas
 *     laisser une trace dans le DOM.
 *   • **Le focus est RESTAURÉ** à l'élément qui l'avait avant l'ouverture. Sans
 *     cela, fermer une fenêtre au clavier ramène le focus en haut du document, et
 *     il faut retraverser l'écran pour retrouver le bouton qu'on vient d'utiliser.
 *
 * La visibilité est jugée sur les ATTRIBUTS (`hidden`, `aria-hidden`, `disabled`,
 * `tabindex`), pas sur la géométrie : le rendu des tailles n'est pas garanti dans
 * l'environnement de test, et une règle qui dépendrait de `offsetParent` serait
 * invérifiable là où elle est le plus utile.
 */

/** Les éléments qu'un clavier peut atteindre, dans l'ordre du DOM. */
export const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[contenteditable="true"]',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

/** Vrai quand l'élément, ou l'un de ses ancêtres, est déclaré invisible/inerte. */
function insideHiddenSubtree(el: Element): boolean {
  return Boolean(el.closest('[hidden], [aria-hidden="true"]'));
}

/**
 * Les éléments réellement focalisables sous `root`, dans l'ordre du DOM.
 *
 * `tabindex="-1"` est exclu : c'est un point de focus programmatique (la racine
 * du dialogue, par exemple), pas une étape de tabulation — l'inclure ferait
 * boucler `Tab` sur un élément que l'utilisateur ne peut pas quitter au clavier.
 */
export function focusablesIn(root: HTMLElement): HTMLElement[] {
  const candidates = Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
  return candidates.filter((el) => {
    if (el.hasAttribute('disabled')) return false;
    if (el.getAttribute('tabindex') === '-1') return false;
    if (el.closest('[aria-hidden="true"]')) return false;
    // `hidden` est testé sur l'élément ET ses ancêtres : un champ dans une
    // section repliée n'est pas atteignable, même s'il porte un `tabindex`.
    return !insideHiddenSubtree(el);
  });
}

/** Rendre le focus à un élément — sans lever s'il n'existe plus. */
export function restoreFocus(target: HTMLElement | null): void {
  if (!target) return;
  // `isConnected` : le déclencheur d'un dialogue peut avoir été démonté (changement
  // d'onglet, rechargement de liste) pendant que la fenêtre était ouverte.
  if (!target.isConnected) return;
  if (typeof target.focus !== 'function') return;
  target.focus();
}

/** Un seul piège vivant par racine — deux écouteurs se contrediraient. */
const liveTraps = new WeakMap<HTMLElement, () => void>();

/**
 * Piéger le focus dans `root`.
 *
 * @returns la fonction de débranchement (idempotente), qui restaure aussi le
 * focus d'avant l'ouverture.
 */
export function trapFocus(root: HTMLElement): () => void {
  // Re-piéger une racine déjà piégée retire l'ancien piège : deux écouteurs sur
  // le même dialogue traiteraient le même `Tab` deux fois, et le second
  // ramènerait le focus au premier élément quel que soit le sens de la touche.
  liveTraps.get(root)?.();

  const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const addedTabIndex = !root.hasAttribute('tabindex');
  if (addedTabIndex) root.setAttribute('tabindex', '-1');

  const initial = focusablesIn(root);
  if (initial.length > 0) initial[0].focus();
  else root.focus();

  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.key !== 'Tab') return;
    const items = focusablesIn(root);
    if (items.length === 0) {
      // Rien à parcourir : le focus reste dans le dialogue au lieu de partir.
      event.preventDefault();
      root.focus();
      return;
    }
    const first = items[0];
    const last = items[items.length - 1];
    const active = document.activeElement;

    if (event.shiftKey) {
      // Depuis le premier (ou depuis la racine, qui n'est pas dans la liste),
      // `Shift+Tab` doit atteindre le DERNIER : c'est le sens du bouclage.
      if (active === first || !root.contains(active) || active === root) {
        event.preventDefault();
        last.focus();
      }
      return;
    }

    if (active === last) {
      event.preventDefault();
      first.focus();
    }
  };

  root.addEventListener('keydown', onKeyDown);

  let released = false;
  const release = (): void => {
    if (released) return;
    released = true;
    root.removeEventListener('keydown', onKeyDown);
    if (liveTraps.get(root) === release) liveTraps.delete(root);
    if (addedTabIndex) root.removeAttribute('tabindex');
    restoreFocus(previous);
  };
  liveTraps.set(root, release);
  return release;
}
