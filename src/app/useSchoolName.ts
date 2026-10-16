/**
 * ─── Le nom de l'école dans le shell : le lire, et l'écrire ─────────────────
 *
 * Le contrat est dans `src/lib/schoolName.ts`, l'accès à la base dans
 * `src/lib/dataOps/settings.ts`. Ce crochet est ce qui les relie au shell, et il
 * ne porte AUCUNE règle d'adoption — contrairement aux préférences d'affichage
 * (`useDisplayPreferences`) : le nom de l'école n'est pas un réglage de poste mais
 * un fait de l'établissement, le même partout. Il n'y a donc rien à adopter, et
 * rien à écraser : on lit la ligne, on l'écrit quand l'administration la change.
 *
 * TROIS ÉTATS DE LECTURE, et c'est le point de ce crochet : `null` tout court ne
 * dirait pas la même chose selon son origine. « La base n'a pas répondu » (réseau
 * coupé : on ne SAIT pas) et « aucune école n'a déclaré son nom » (la lecture a
 * réussi : on SAIT qu'il est vide) se ressemblent à l'écran mais n'autorisent pas
 * le même geste — devant la première, réécrire un nom qu'on ne voit pas peut
 * écraser celui que l'école avait déjà fait voyager. Le crochet expose donc les
 * deux (`schoolName` + `schoolNameReadFailed`) pour que l'écran puisse le DIRE.
 */
import { useCallback, useEffect, useState } from 'react';

import { fetchSchoolName, publishSchoolName } from '../lib/dataOps/settings';
import { normalizeSchoolName, type SchoolNameSaveResult } from '../lib/schoolName';

export interface SchoolNameBindings {
  /** Le nom déclaré, ou `null` (rien de déclaré, ou pas encore lu). */
  schoolName: string | null;
  /**
   * vrai quand la lecture a ÉCHOUÉ (pas de réponse de la base) — donc quand
   * `schoolName === null` ne veut PAS dire « aucune école ne l'a déclaré ».
   */
  schoolNameReadFailed: boolean;
  /** Écrit le nom : rend l'un des trois états du contrat, jamais un booléen. */
  setSchoolName: (name: string) => Promise<SchoolNameSaveResult>;
}

/**
 * Lit le nom de l'école quand une session existe, et le publie quand on le
 * change. Appelé UNE fois, par `<App>`.
 *
 * Sans session, rien n'est lu : `app_settings` n'est lisible que par un compte
 * connecté, et un poste hors session n'a pas de nom d'école à afficher — c'est
 * exactement son état, pas une panne.
 */
export function useSchoolName({ userId }: { userId: string | null }): SchoolNameBindings {
  const [schoolName, setSchoolNameState] = useState<string | null>(null);
  const [readFailed, setReadFailed] = useState(false);

  useEffect(() => {
    if (!userId) {
      // Déconnexion (ou pas encore de session) : le nom lu pour le compte
      // précédent ne doit pas rester à l'écran — il appartient à cette session.
      setSchoolNameState(null);
      setReadFailed(false);
      return;
    }
    let cancelled = false;
    void (async () => {
      const read = await fetchSchoolName();
      if (cancelled) return;
      if (read === null) {
        // Pas de réponse : on le DIT. Écrire « non déclaré » ici ferait passer
        // une ignorance pour un fait, et c'est précisément ce que ce crochet
        // existe pour éviter.
        setReadFailed(true);
        return;
      }
      setReadFailed(false);
      setSchoolNameState(read.declared);
    })();
    return () => {
      cancelled = true;
    };
  }, [userId]);

  const setSchoolName = useCallback(async (name: string) => {
    const result = await publishSchoolName(name);
    // La copie durable a pris le nom : l'écran suit, avec la forme canonique
    // (celle qui est en base, pas la frappe). `queued` laisse l'affichage tel
    // quel : le nom n'est PAS encore en base, et l'écran doit pouvoir le dire —
    // le poser ici ferait croire à une écriture qui n'a pas eu lieu.
    if (result === 'saved') setSchoolNameState(normalizeSchoolName(name));
    return result;
  }, []);

  return { schoolName, schoolNameReadFailed: readFailed, setSchoolName };
}
