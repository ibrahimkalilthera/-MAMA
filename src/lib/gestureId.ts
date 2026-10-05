/**
 * L'id du GESTE d'une création.
 *
 * Le défaut mesuré le 2026-10-05 sur la base partagée : un élève créé EN LIGNE
 * n'envoyait aucun id, donc chaque envoi répété (double clic, reprise) créait une
 * NOUVELLE ligne — « Mahamadou DJIRE » en sept exemplaires. La réparation tient à
 * un id stable par geste : le second envoi retombe sur la même clé primaire, et
 * la base le refuse (23505) au lieu de dupliquer.
 *
 * `gestureId()` minte l'id au PREMIER appel et le rend identique tant que
 * `resetGestureId()` n'a pas été appelé. Un geste = un idem. Après un
 * enregistrement réussi, l'écran appelle `resetGestureId()` : la fiche suivante
 * est un autre geste, donc un autre id (sinon un nouvel enregistrement serait
 * pris pour le doublon du précédent). Si l'envoi ÉCHOUE, l'id est conservé — un
 * nouvel essai du même geste le réutilise, ce qui est exactement voulu.
 */
import { useRef } from 'react';
import { createRowId } from './rowMappers';

export interface GestureIdHandle {
  /** L'id stable du geste en cours, minté au premier appel. */
  gestureId: () => string;
  /** Le geste est terminé (succès) : le prochain en mint un nouveau. */
  resetGestureId: () => void;
}

export function useGestureId(): GestureIdHandle {
  const ref = useRef<string | null>(null);
  const gestureId = () => (ref.current ??= createRowId());
  const resetGestureId = () => {
    ref.current = null;
  };
  return { gestureId, resetGestureId };
}
