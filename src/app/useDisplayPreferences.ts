/**
 * ─── Les préférences d'affichage dans le shell : adopter, et publier ────────
 *
 * Le contrat est dans `src/lib/displayPreferences.ts`, l'accès à la base dans
 * `src/lib/dataOps/settings.ts`. Ce crochet est ce qui les relie au shell, et il
 * porte les deux moitiés d'une même promesse :
 *
 *   • **ADOPTER** — à la première connexion d'un poste qui n'a JAMAIS choisi
 *     (poste neuf, Windows refait, navigateur vidé), les quatre réglages de la
 *     copie durable sont appliqués : c'est ce qui fait qu'une école réinstallée
 *     retrouve son thème, sa densité, son verre et sa langue au lieu de repartir
 *     aux défauts compilés. Un poste qui a déjà choisi n'est jamais écrasé : la
 *     décision est prise par `adoptablePreferences`, une seule fois, et elle est
 *     jugée sans base dans la suite du module.
 *   • **PUBLIER** — un réglage CHANGÉ part en base (offline, il part dans la
 *     file) : c'est ce qui fait que la copie durable suit ce que l'école règle
 *     vraiment. Publier au démarrage serait publier « ce que le poste avait
 *     déjà » — la copie d'école deviendrait alors le dernier poste allumé.
 *
 * L'INSTANTANÉ DES CHOIX LOCAUX est pris au PREMIER rendu, et c'est
 * indispensable pour le thème : son effet de persistance écrit sa clé dès le
 * premier montage, avec le défaut. Une lecture faite après coup répondrait donc
 * « ce poste a choisi » sur un poste qui n'a rien choisi — et la copie durable
 * ne serait jamais adoptée, c'est-à-dire exactement le poste réinstallé que
 * cette fonctionnalité existe pour servir.
 */
import { useCallback, useEffect, useState } from 'react';

import { applyLanguage } from './applyLanguage';
import { useDensityState } from './densityContext';
import { useIconGlassState } from './iconGlassContext';
import type { DensityValue } from './densityContext';
import type { IconGlassValue } from './iconGlassContext';
import type { ThemeId } from './mainViewsProps';
import type { Language } from './types';
import { fetchDisplayPreferences, publishDisplayPreference } from '../lib/dataOps/settings';
import { adoptablePreferences, readStoredChoices, saveLanguage } from '../lib/displayPreferences';
import type { TableDensity } from '../lib/density';

export interface UseDisplayPreferencesOptions {
  /** L'identité de la session. Sans elle, rien n'est lu : la copie durable demande un compte connecté. */
  userId: string | null;
  /** Le poseur du thème, tel que le shell le reçoit — jamais enveloppé deux fois. */
  setTheme: (theme: ThemeId) => void;
  /** La langue, et son poseur, pour la SEULE adoption (le changement de langue est publié par l'appelant). */
  setLang: (language: Language) => void;
}

export interface DisplayPreferenceBindings {
  /** La densité — servie au shell (classe `density-*`) et à la carte des Préférences. */
  density: DensityValue;
  /** Le verre des icônes — même partage que la densité. */
  iconGlass: IconGlassValue;
  /** Changer de thème : le poste choisit, et la copie durable suit. */
  setTheme: (theme: ThemeId) => void;
  /**
   * Changer la langue : le poste la retient, l'écran se réécrit, la copie
   * durable suit. Le geste complet vit ici parce que l'état de langue appartient
   * à `<App>` (le sélecteur du bandeau et celui des Réglages passent par ce
   * même poseur).
   */
  setLanguage: (language: Language) => void;
}

/**
 * Possède densité et verre (avec publication), adopté les quatre préférences de
 * la copie durable, et rend le thème enveloppé. Appelé UNE fois, par `<App>`.
 */
export function useDisplayPreferences({
  userId,
  setTheme,
  setLang,
}: UseDisplayPreferencesOptions): DisplayPreferenceBindings {
  const density = useDensityState();
  const iconGlass = useIconGlassState();
  const { density: densityValue, setDensity: setDensityLocal } = density;
  const { iconGlass: glassValue, setIconGlass: setIconGlassLocal } = iconGlass;
  // Pris au premier rendu (voir l'en-tête) et jamais recalculé.
  const [choicesAtBoot] = useState(readStoredChoices);

  useEffect(() => {
    // Sans compte connecté, il n'y a pas de copie durable à lire — et un poste
    // hors session garde ses défauts locaux, ce qui est exactement son état.
    if (!userId) return;
    let cancelled = false;
    void (async () => {
      const remote = await fetchDisplayPreferences();
      if (cancelled || !remote) return;
      const adopt = adoptablePreferences(choicesAtBoot, remote);
      if (adopt.theme !== undefined) setTheme(adopt.theme);
      if (adopt.density !== undefined) setDensityLocal(adopt.density);
      if (adopt.iconGlass !== undefined) setIconGlassLocal(adopt.iconGlass);
      if (adopt.language !== undefined) {
        // La langue adoptée devient celle du poste (donc un poste choisit une
        // fois), et la balayure `[data-i18n]` suit le changement d'état comme
        // elle le fait pour un changement à la main.
        saveLanguage(adopt.language);
        setLang(adopt.language);
        applyLanguage(adopt.language);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [userId, choicesAtBoot, setTheme, setLang, setDensityLocal, setIconGlassLocal]);

  const publishTheme = useCallback(
    (next: ThemeId) => {
      setTheme(next);
      void publishDisplayPreference('theme', next);
    },
    [setTheme],
  );

  const publishDensity = useCallback(
    (next: TableDensity) => {
      setDensityLocal(next);
      void publishDisplayPreference('density', next);
    },
    [setDensityLocal],
  );

  const publishIconGlass = useCallback(
    (next: IconGlassValue['iconGlass']) => {
      setIconGlassLocal(next);
      void publishDisplayPreference('iconGlass', next);
    },
    [setIconGlassLocal],
  );

  const setLanguage = useCallback(
    (next: Language) => {
      // Le poste D'ABORD (c'est lui que l'écran montre et que le prochain
      // chargement relira), la copie durable ensuite — et la balayure des nœuds
      // `[data-i18n]` comme pour un changement à la main.
      saveLanguage(next);
      setLang(next);
      applyLanguage(next);
      void publishDisplayPreference('language', next);
    },
    [setLang],
  );

  return {
    density: { density: densityValue, setDensity: publishDensity },
    iconGlass: { iconGlass: glassValue, setIconGlass: publishIconGlass },
    setTheme: publishTheme,
    setLanguage,
  };
}
