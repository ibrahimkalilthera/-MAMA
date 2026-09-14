/**
 * Academic-year provider — owns `selectedYear`/`lockedYears` for the whole
 * app. The context + useYear hook live in src/app/yearContext.ts; this file
 * only exports the component (react-refresh/only-export-components).
 *
 * Le choix de l'utilisateur SURVIT désormais au rechargement
 * (`mama_thera_selected_year`). Sans cette persistance, chaque rechargement
 * ramenait l'app sur l'année par défaut : un élève enregistré dans l'année où
 * l'on travaillait devenait invisible dès le premier `F5`, et le tableau de bord
 * affichait zéro — c'est l'incident du 2026-09-13, dont le diagnostic le plus
 * tentant (« les données ont disparu ») était faux.
 *
 * Le choix est stocké AVEC SON MOMENT (`{ year, at }`) : c'est ce qui permet à
 * `pickWorkingYear` de l'abandonner quand il appartient à une année scolaire
 * passée. Sans cette date, un poste resterait sur l'année de l'an dernier et
 * continuerait d'y saisir — l'année ne s'avancerait pas toute seule.
 *
 * La valeur initiale reste vide de sens tant que la base n'a pas répondu : c'est
 * `useAcademicYears` qui fixe l'année de travail, à partir du calendrier, du
 * choix stocké et de la déclaration de la base.
 */
import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';

import { readStoredYear, storeYear } from '../lib/academicYears';
import { YearContext } from './yearContext';

export function YearProvider({ children }: { children: ReactNode }) {
  // `typeof` et non `globalThis.localStorage` : lire la propriété peut lever dans
  // un contexte isolé, et un stockage indisponible n'est pas une panne de l'app.
  const storage = () => (typeof localStorage === 'undefined' ? null : localStorage);

  const [selectedYear, setSelectedYear] = useState<string>(() => readStoredYear(storage())?.year ?? '');
  const [lockedYears, setLockedYears] = useState<string[]>([]);

  useEffect(() => {
    storeYear(selectedYear, storage());
  }, [selectedYear]);

  return (
    <YearContext.Provider value={{ selectedYear, setSelectedYear, lockedYears, setLockedYears }}>
      {children}
    </YearContext.Provider>
  );
}
