/**
 * Préférences d'affichage — la moitié « crochet » : ADOPTER, puis PUBLIER.
 *
 * Le thème, la densité, le verre des icônes et la langue vivaient uniquement
 * dans le `localStorage` du poste. Conséquence : un poste réinstallé — Windows
 * refait, navigateur vidé, machine neuve — repartait aux défauts compilés alors
 * que la sauvegarde de la base, elle, se restaure. La copie d'école vit donc en
 * base, et ce crochet est ce qui la relie au poste. Deux invariants, et ce sont
 * eux que les cas ci-dessous mesurent :
 *
 *   • **le poste gagne.** Un poste qui a DÉJÀ choisi n'est jamais écrasé : la
 *     copie de l'école n'est adoptée que par un poste qui n'a rien (la règle
 *     elle-même est jugée sans base dans tests/display-preferences.test.ts ;
 *     ici, c'est son APPLICATION qui se mesure) ;
 *   • **ce qui se publie, c'est un changement.** Un réglage changé part en base,
 *     mais l'adoption, elle, ne publie rien : publier ce que le poste vient
 *     d'adopter ferait de la copie d'école « le dernier poste qui s'est
 *     allumé », c'est-à-dire du bruit.
 *
 * `../src/lib/dataOps/settings` est simulé AVANT l'import du crochet (le vrai
 * accès passe par le client Supabase, qui ne se charge pas sous le runner) : la
 * copie d'école devient une valeur que le cas choisit, et les publications sont
 * comptées une par une.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { act } from 'react';
import { installDomGlobals, renderHook } from './harness';
import { mockModule } from './module-mock';
import {
  DISPLAY_PREFERENCE_STORAGE_KEYS,
  LANGUAGE_STORAGE_KEY,
} from '../src/lib/displayPreferences';
import type { DisplayPreferenceName, DisplayPreferences } from '../src/lib/displayPreferences';
import type { Language } from '../src/app/types';
import type { ThemeId } from '../src/app/mainViewsProps';

/** La copie d'école que le faux accès rendra (voir `remote` avant chaque cas). */
let remote: Partial<DisplayPreferences> | null = null;
let fetches = 0;
const published: { name: DisplayPreferenceName; value: string }[] = [];

mockModule('../src/lib/dataOps/settings', {
  fetchDisplayPreferences: async () => {
    fetches += 1;
    return remote;
  },
  publishDisplayPreference: async (name: DisplayPreferenceName, value: string) => {
    published.push({ name, value });
    return true;
  },
});

const { useDisplayPreferences } = await import('../src/app/useDisplayPreferences');

/**
 * Vider ce que le crochet a lancé d'ASYNCHRONE : la lecture de la base (une
 * promesse) et la balayure `[data-i18n]` d'`applyLanguage` (un
 * `setTimeout(…, 0)`). Sans ça, on observerait l'état d'avant l'adoption.
 */
async function flush(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

/** Le crochet monté, avec des poseurs de thème et de langue ESPIONS. */
function mountHook(userId: string | null) {
  const themes: ThemeId[] = [];
  const languages: Language[] = [];
  const rendered = renderHook(useDisplayPreferences, {
    userId,
    setTheme: (theme) => {
      themes.push(theme);
    },
    setLang: (language) => {
      languages.push(language);
    },
  });
  return { ...rendered, themes, languages };
}

describe("préférences d'affichage dans le shell", () => {
  it('un poste qui n’a jamais choisi ADOPTE les quatre réglages, et les retient', async () => {
    installDomGlobals();
    remote = { theme: 'emerald', density: 'compact', iconGlass: 'discreet', language: 'en' };
    fetches = 0;
    published.length = 0;
    const { api, themes, languages, unmount } = mountHook('u1');

    await flush();

    assert.equal(fetches, 1, 'la copie d’école est lue une fois, à la connexion du poste');
    assert.deepEqual(themes, ['emerald'], 'le thème adopté est posé sur le poste');
    assert.deepEqual(languages, ['en'], 'la langue adoptée devient celle du poste');
    assert.equal(api.current?.density.density, 'compact');
    assert.equal(api.current?.iconGlass.iconGlass, 'discreet');
    // Le poste RETIENT ce qu'il a adopté : sans ces écritures, chaque démarrage
    // redemanderait la copie à la base, et un poste hors ligne repartirait aux
    // défauts. (Le thème, lui, est écrit par `useTheme` — voir tests/theme.test.tsx.)
    assert.equal(localStorage.getItem(DISPLAY_PREFERENCE_STORAGE_KEYS.density), 'compact');
    assert.equal(localStorage.getItem(DISPLAY_PREFERENCE_STORAGE_KEYS.iconGlass), 'discreet');
    assert.equal(localStorage.getItem(LANGUAGE_STORAGE_KEY), 'en');
    // Adopter n'est pas choisir : rien n'est publié en retour.
    assert.deepEqual(published, [], 'l’adoption ne publie rien — sinon la copie d’école serait le dernier poste allumé');
    unmount();
  });

  it('un poste qui a DÉJÀ choisi n’est jamais écrasé par la copie d’école', async () => {
    installDomGlobals();
    localStorage.setItem(DISPLAY_PREFERENCE_STORAGE_KEYS.theme, 'navy');
    localStorage.setItem(DISPLAY_PREFERENCE_STORAGE_KEYS.density, 'comfort');
    localStorage.setItem(DISPLAY_PREFERENCE_STORAGE_KEYS.iconGlass, 'animated');
    localStorage.setItem(DISPLAY_PREFERENCE_STORAGE_KEYS.language, 'fr');
    remote = { theme: 'bordeaux', density: 'compact', iconGlass: 'crisp', language: 'en' };
    fetches = 0;
    const { api, themes, languages, unmount } = mountHook('u1');

    await flush();

    assert.equal(fetches, 1, 'la copie est lue (on ne sait pas avant de l’avoir lue)');
    assert.deepEqual(themes, [], 'le choix du poste gagne');
    assert.deepEqual(languages, []);
    assert.equal(api.current?.density.density, 'comfort', 'la densité du poste est gardée');
    assert.equal(api.current?.iconGlass.iconGlass, 'animated', 'le verre du poste est gardé');
    unmount();
  });

  it('les quatre réglages se jugent SÉPARÉMENT : le poste adopte ce qui lui manque', async () => {
    installDomGlobals();
    // Ce poste a réglé sa densité et rien d'autre (une tablette de classe).
    localStorage.setItem(DISPLAY_PREFERENCE_STORAGE_KEYS.density, 'compact');
    remote = { theme: 'slate', density: 'comfort', iconGlass: 'discreet', language: 'en' };
    const { api, themes, languages, unmount } = mountHook('u1');

    await flush();

    assert.deepEqual(themes, ['slate'], 'ce qui n’a jamais été choisi est adopté');
    assert.deepEqual(languages, ['en']);
    assert.equal(api.current?.density.density, 'compact', 'ce qui a été choisi reste intact');
    assert.equal(api.current?.iconGlass.iconGlass, 'discreet');
    unmount();
  });

  it('un changement délibéré est PUBLIÉ, après avoir bougé le poste', async () => {
    installDomGlobals();
    remote = null; // la base ne dit rien : ce cas ne regarde que la publication
    const { api, themes, languages, unmount } = mountHook('u1');
    await flush();

    act(() => api.current?.setTheme('cream'));
    assert.deepEqual(themes, ['cream'], 'l’écran suit le geste sans attendre la base');
    assert.deepEqual(published.at(-1), { name: 'theme', value: 'cream' });

    act(() => api.current?.density.setDensity('compact'));
    assert.equal(api.current?.density.density, 'compact');
    assert.equal(localStorage.getItem(DISPLAY_PREFERENCE_STORAGE_KEYS.density), 'compact', 'le poste a écrit son choix');
    assert.deepEqual(published.at(-1), { name: 'density', value: 'compact' });

    act(() => api.current?.iconGlass.setIconGlass('crisp'));
    assert.deepEqual(published.at(-1), { name: 'iconGlass', value: 'crisp' });

    act(() => api.current?.setLanguage('en'));
    assert.deepEqual(languages, ['en']);
    assert.equal(localStorage.getItem(LANGUAGE_STORAGE_KEY), 'en', 'la langue du poste est retenue');
    assert.deepEqual(published.at(-1), { name: 'language', value: 'en' });
    // La balayure `[data-i18n]` est un `setTimeout` : on la laisse passer avant
    // de démonter, pour qu'elle ne tourne pas sur le DOM du cas suivant.
    await flush();
    unmount();
  });

  it('sans compte connecté, rien n’est lu et rien n’est marqué sur le poste', async () => {
    installDomGlobals();
    remote = { theme: 'emerald', density: 'compact', iconGlass: 'discreet', language: 'en' };
    fetches = 0;
    const { api, themes, languages, unmount } = mountHook(null);

    await flush();

    assert.equal(fetches, 0, 'la copie d’école demande un compte connecté');
    assert.deepEqual(themes, []);
    assert.deepEqual(languages, []);
    assert.equal(api.current?.density.density, 'comfort', 'un poste hors session garde ses défauts');
    // Aucun « choix » n'a été inventé en chemin : le poste reste « n’a jamais
    // choisi », donc il adoptera à la première session connectée.
    assert.equal(localStorage.getItem(DISPLAY_PREFERENCE_STORAGE_KEYS.density), null);
    assert.equal(localStorage.getItem(LANGUAGE_STORAGE_KEY), null);
    unmount();
  });
});
