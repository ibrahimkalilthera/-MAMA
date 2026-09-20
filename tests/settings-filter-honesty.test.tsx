// ─────────────────────────────────────────────────────────────────────────────
// Bug rapporté le 2026-09-14 : « quand je fais « Définir mot de passe » sur un
// compte qui n'est pas celui de dev, puis que je clique « Annuler », les comptes
// disparaissent ».
//
// Ce que la capture montre, et qui oriente le diagnostic : la liste ne rend plus
// qu'UN compte — celui du dev — et le champ de recherche contient l'e-mail du dev.
// L'onglet « Tous » est actif, donc le rôle ne masque rien : seul le TEXTE de
// recherche peut amputer la liste. Personne n'a tapé cet e-mail — il est arrivé
// pendant la vie de la modale. Or la modale est le SEUL endroit de l'écran qui
// ajoute un `<input type="password">` : pour le gestionnaire de mots de passe du
// navigateur, le champ texte voisin devient alors le champ « identifiant », et il
// l'y verse. Le filtre fait le reste : trois comptes disparaissent de l'écran, sans
// qu'aucun mot ne le dise.
//
// D'où les deux moitiés de ce qu'on verrouille ici :
//   • la DÉFENSE (la cause) : les champs disent ce qu'ils sont — une recherche
//     (`type="search"` + `autoComplete="off"`) et un mot de passe NOUVEAU
//     (`autoComplete="new-password"`), plus la règle de classe qui refuse qu'un
//     champ mot de passe de `src/` s'en remette aux heuristiques du navigateur
//     (elle a trouvé un troisième champ : celui du formulaire d'ajout de compte);
//   • l'HONNÊTETÉ (le symptôme) : ce qu'un filtre masque est DIT, et se défait en
//     un geste. Une liste amputée ne peut plus passer pour une liste vidée.
//
// Deux primitives d'interaction, et pourquoi elles diffèrent : le CLIC traverse
// React pour de vrai (`button.click()`), donc le filtre est exercé par un vrai
// geste (onglet de rôle, bouton « Effacer »). Le TEXTE, lui, ne traverse pas :
// mesuré dans ce harnais, un événement `input` fabriqué à la main ne déclenche
// jamais le `onChange` de React 18 — l'écriture dans les champs passe donc par les
// setters que l'écran appelle lui-même (et le champ est vérifié comme étant le
// champ contrôlé de cet état, sinon le cas ne mesurerait pas la bonne chose).
//
// Ce que ce harnais ne peut pas finir, et pourquoi l'écrire vaut mieux que
// l'espérer : la sortie d'`AnimatePresence` passe par l'API WAAPI, dont le
// talon ne « termine » jamais — mesuré, la modale reste dans le DOM avec
// `opacity: 0` après « Annuler ». La fermeture n'est donc PAS affirmée sur le DOM
// (on affirmerait le talon, pas l'écran) mais sur l'effet qui, lui, est vrai :
// après « Annuler », « Enregistrer » n'écrit plus rien. Et la contre-épreuve
// montre que le même geste écrit quand on n'annule pas.
// ─────────────────────────────────────────────────────────────────────────────
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { join, relative, sep } from 'node:path';
import { readFileSync } from 'node:fs';
import { act, createElement, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { MainViewsContext } from '../src/app/mainViewsContext';
import { SettingsView } from '../src/components/SettingsView';
import { useUsers } from '../src/app/useUsers';
import { translations } from '../src/i18n/translations';
import type { AuthState, UserProfile } from '../src/lib/useAuth';
import { listFiles, maskComments, maskProse } from '../scripts/lib/source-text.mjs';
import { installDomGlobals } from './harness';
import { makeProps } from './views-harness';

const t = translations.fr;

const win = installDomGlobals();
// AnimatePresence anime les modales — happy-dom's WAAPI ticker n'avance jamais,
// donc les animations doivent se résoudre instantanément (même talon que
// parent-form-modal.test).
const finishedAnimation = {
  finished: Promise.resolve(),
  currentTime: 0,
  playState: 'finished',
  effect: null,
  onfinish: null,
  oncancel: null,
  play: () => {},
  pause: () => {},
  cancel: () => {},
  finish: () => {},
  reverse: () => {},
  commitStyles: () => {},
  addEventListener: () => {},
  removeEventListener: () => {},
};
win.Element.prototype.animate = (() => finishedAnimation) as unknown as typeof win.Element.prototype.animate;
win.Element.prototype.getAnimations = (() => []) as unknown as typeof win.Element.prototype.getAnimations;
(win.HTMLElement.prototype as { animate?: unknown }).animate = finishedAnimation;

// ─── Les quatre comptes RÉELS de la base partagée ────────────────────────────
// Les vrais rôles et les vrais e-mails : c'est cette distribution qui rend le cas
// mesurable (un dev + un admin + un gestionnaire + un personnel = la liste doit
// en montrer quatre, et un filtre doit en masquer TROIS, jamais zéro).
const DEV: UserProfile = { id: 'p-dev', email: 'ibrahimkalilthera@mamathera.org', fullName: 'Ibrahim Thera', role: 'dev' };
const ADMIN: UserProfile = { id: 'p-adm', email: 'fantathera2002@mamathera.org', fullName: 'Fanta Thera', role: 'admin' };
const GM: UserProfile = { id: 'p-gm', email: 'mamadoulaminethera@mamathera.org', fullName: 'Mamadou Lamine Thera', role: 'general_manager' };
const STAFF: UserProfile = { id: 'p-staff', email: 'aggeediarra@mamathera.org', fullName: 'Aggee Diarra', role: 'staff' };
const PROFILES: UserProfile[] = [DEV, ADMIN, GM, STAFF];

/** Les écritures que l'écran DEMANDE au port d'authentification (le seul juge). */
const writes: Array<{ id: string; password: string }> = [];

const adminAuth: AuthState = {
  user: null,
  // Le poste connecté est le DEV : c'est de là que le rapport a été fait.
  profile: DEV,
  loading: false,
  error: null,
  isAdmin: true,
  isOfflineSession: false,
  reauthFailed: false,
  signIn: async () => ({ success: true }),
  signOut: async () => {},
  fetchAllProfiles: async () => PROFILES,
  updateUserRole: async () => true,
  createStaffUser: async () => ({ success: true }),
  sendPasswordReset: async () => ({ success: true }),
  setUserPassword: async (id, password) => {
    writes.push({ id, password });
    return { success: true };
  },
};

/** Ce que l'écran expose pour piloter ses champs (voir l'en-tête du fichier). */
const drive: { search: ((value: string) => void) | null; password: ((value: string) => void) | null } = {
  search: null,
  password: null,
};

/**
 * L'écran monté comme l'application le monte : la VRAIE `useUsers` (donc les
 * mêmes setters, le même état) et le VRAI contrat de props. Un harnais qui
 * recopierait ces setters mesurerait son propre code, pas celui de l'écran.
 */
function Host() {
  const [profiles, setProfiles] = useState<UserProfile[]>(PROFILES);
  const users = useUsers({
    t,
    auth: {
      updateUserRole: async () => true,
      sendPasswordReset: async () => ({ success: true }),
      setUserPassword: async (id, password) => {
        writes.push({ id, password });
        return { success: true };
      },
    },
    userProfiles: profiles,
    setUserProfiles: setProfiles,
    toast: { success: () => 'toast-id', error: () => 'toast-id' },
  });
  drive.search = users.setUserSearchTerm;
  drive.password = users.setPasswordInput;
  const props = makeProps({
    t,
    auth: adminAuth,
    userProfiles: profiles,
    setUserProfiles: setProfiles,
    ...users,
  });
  return createElement(MainViewsContext.Provider, { value: props }, createElement(SettingsView));
}

function mount(): { container: HTMLElement; root: ReturnType<typeof createRoot> } {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(createElement(Host));
  });
  return { container, root };
}

function unmount(container: HTMLElement, root: ReturnType<typeof createRoot>): void {
  act(() => {
    root.unmount();
  });
  document.body.removeChild(container);
}

/** Combien de comptes l'écran MONTRE (un e-mail n'apparaît que sur sa carte). */
function cardsShown(container: HTMLElement): number {
  const text = container.textContent ?? '';
  return PROFILES.filter((p) => text.includes(p.email)).length;
}

function buttonByText(container: HTMLElement, label: string): HTMLElement {
  const found = Array.from(container.querySelectorAll('button')).filter(
    (b) => (b.textContent ?? '').trim() === label,
  );
  assert.ok(found.length > 0, `bouton « ${label} » rendu`);
  return found[0]!;
}

/** La fiche de mot de passe est-elle ouverte ? (jamais la fiche elle-même) */
function passwordModalOpen(container: HTMLElement): boolean {
  return container.querySelector('input[type="password"]') !== null;
}

/**
 * Le bouton d'une carte précise : `title` + remontée de DEUX crans au plus
 * (bouton → barre d'actions → carte). Sans cette borne, le premier bouton venu
 * (celui de la barre d'outils, dont un ancêtre contient toute la liste) passerait
 * pour celui de la carte — et le cas mesurerait un autre clic.
 */
function cardButton(container: HTMLElement, profile: UserProfile, title: string): HTMLElement {
  const found = Array.from(container.querySelectorAll<HTMLElement>(`button[title="${title}"]`)).find((b) => {
    let el: HTMLElement | null = b.parentElement;
    for (let hops = 0; el && hops < 2; hops += 1) {
      if ((el.textContent ?? '').includes(profile.email)) return true;
      el = el.parentElement;
    }
    return false;
  });
  assert.ok(found, `bouton « ${title} » de la carte « ${profile.fullName} » rendu`);
  return found;
}

/** Le champ de recherche, tel qu'un navigateur le voit. */
function searchField(container: HTMLElement): HTMLInputElement {
  const input = container.querySelector<HTMLInputElement>('input[name="user-search"]');
  assert.ok(input, 'champ de recherche rendu');
  return input;
}

/** Le texte qui DIT ce que le filtre masque, s'il est rendu. */
function hiddenBanner(container: HTMLElement): string | null {
  const wanted = (count: number) => t.usersHiddenByFilter.replace('{count}', String(count));
  const body = container.textContent ?? '';
  return [1, 2, 3, 4].map(wanted).find((line) => body.includes(line)) ?? null;
}

/** Remplit la fiche de mot de passe et la valide, par les vrais gestes. */
async function fillAndSave(container: HTMLElement, password: string): Promise<void> {
  assert.ok(drive.password, 'l’écran a livré son setter de mot de passe');
  await act(async () => {
    drive.password!(password);
  });
  await act(async () => {
    buttonByText(container, t.save).click();
  });
}

describe('Paramètres Système — une liste filtrée ne peut plus passer pour une liste vidée', () => {
  it('les quatre comptes sont rendus, et les filtres sont à zéro', () => {
    const { container, root } = mount();
    assert.equal(cardsShown(container), 4, 'les 4 comptes propriétaires sont visibles sans filtre');
    assert.equal(hiddenBanner(container), null, 'aucun bandeau quand rien n’est masqué');
    assert.equal(searchField(container).value, '', 'la recherche démarre vide');
    unmount(container, root);
  });

  it('le champ de recherche se déclare pour ce qu’il est — jamais un identifiant', () => {
    const { container, root } = mount();
    // Ce que le navigateur lit : un type qui n'est pas un champ d'identité (donc
    // aucun couple « identifiant + mot de passe » à remplir) et un `autoComplete`
    // explicite. C'est la cause du bug, mesurée sur l'attribut qui la porte.
    const search = searchField(container);
    assert.equal(search.type, 'search', 'un champ de recherche n’est pas un champ texte libre');
    assert.equal(search.getAttribute('autocomplete'), 'off', 'le gestionnaire de mots de passe n’a rien à y verser');
    assert.equal(
      container.querySelector('input[type="text"]') !== null,
      false,
      'aucun champ texte libre ne reste dans cet écran : c’est lui qui se faisait remplir',
    );
    unmount(container, root);
  });

  it('le champ de la modale se déclare NOUVEAU mot de passe (pas une connexion)', () => {
    const { container, root } = mount();
    act(() => {
      cardButton(container, ADMIN, t.setPassword).click();
    });
    const input = container.querySelector<HTMLInputElement>('input[type="password"]');
    assert.equal(input !== null, true, 'la modale « Définir mot de passe » est ouverte');
    assert.equal(
      input!.getAttribute('autocomplete'),
      'new-password',
      'un mot de passe qu’on DÉFINIT n’est pas un mot de passe qu’on SAISAIT : c’est cet attribut qui empêche le navigateur d’associer la recherche voisine à une connexion',
    );
    assert.equal(input!.name, 'new-password');
    unmount(container, root);
  });

  it('« Annuler » ne touche ni la liste, ni la recherche', () => {
    const { container, root } = mount();
    assert.equal(passwordModalOpen(container), false, 'aucune fiche ouverte au départ');
    act(() => {
      cardButton(container, ADMIN, t.setPassword).click();
    });
    assert.equal(passwordModalOpen(container), true, 'modale ouverte avant l’annulation');
    act(() => {
      buttonByText(container, t.cancel).click();
    });
    assert.equal(cardsShown(container), 4, 'les quatre comptes sont TOUJOURS là après « Annuler »');
    assert.equal(searchField(container).value, '', 'la recherche est restée vide — c’est elle qui faisait « disparaître » les comptes');
    assert.equal(hiddenBanner(container), null, 'rien n’est masqué, donc rien à dire');
    unmount(container, root);
  });

  it('« Annuler » ferme vraiment la cible : « Enregistrer » ensuite n’écrit rien', async () => {
    // La sortie d'AnimatePresence ne peut pas être « finie » par le talon WAAPI,
    // donc la fermeture se prouve par son EFFET sur le port d'authentification :
    // `handleSetPassword` sort tôt quand la cible est retombée à null.
    writes.length = 0;
    const { container, root } = mount();
    act(() => {
      cardButton(container, ADMIN, t.setPassword).click();
    });
    act(() => {
      buttonByText(container, t.cancel).click();
    });
    await fillAndSave(container, 'motDePasse1');
    assert.deepEqual(writes, [], 'après « Annuler », plus rien ne s’écrit sur le compte');
    unmount(container, root);
  });

  it('sans annuler, le même geste écrit — c’est ce qui rend le cas précédent probant', async () => {
    writes.length = 0;
    const { container, root } = mount();
    act(() => {
      cardButton(container, ADMIN, t.setPassword).click();
    });
    await fillAndSave(container, 'motDePasse2');
    assert.deepEqual(
      writes,
      [{ id: ADMIN.id, password: 'motDePasse2' }],
      'la fiche ouverte écrit sur SON compte : le geste mesuré plus haut est le même, seul « Annuler » le supprime',
    );
    unmount(container, root);
  });

  it('le filtre EST capable de masquer — et le dit, puis se défait en un geste', () => {
    // Anti-vacuité : ce cas REJOUE le mécanisme du bug (l'e-mail du dev atterrit
    // dans la recherche). Sans lui, les cas ci-dessus seraient verts sur un écran
    // dont le filtre ne filtre plus rien du tout.
    const { container, root } = mount();
    assert.ok(drive.search, 'l’écran a livré son setter de recherche');
    act(() => {
      drive.search!(DEV.email);
    });
    assert.equal(
      searchField(container).value,
      DEV.email,
      'le champ rendu est bien le champ contrôlé de cet état (sinon le cas ne mesure pas la recherche)',
    );
    assert.equal(cardsShown(container), 1, 'la recherche par e-mail ne laisse que le compte cherché');
    assert.equal(
      hiddenBanner(container),
      t.usersHiddenByFilter.replace('{count}', '3'),
      'ce que le filtre masque est ÉCRIT — c’est ce que l’écran taisait',
    );

    act(() => {
      buttonByText(container, t.clearUserFilter).click();
    });
    assert.equal(cardsShown(container), 4, '« Effacer » remontre les quatre comptes');
    assert.equal(searchField(container).value, '', 'et le champ redevient vide');
    assert.equal(hiddenBanner(container), null, 'plus rien à signaler');
    unmount(container, root);
  });

  it('l’onglet de rôle dit aussi ce qu’il masque, et se défait avec le même bouton', () => {
    // Ici tout passe par un VRAI clic : c'est ce qui prouve que le mécanisme du
    // filtre (et son bandeau) est exercé par un geste, pas par un état posé.
    const { container, root } = mount();
    act(() => {
      buttonByText(container, t.staff2).click();
    });
    assert.equal(cardsShown(container), 1, 'l’onglet Personnel ne montre que le personnel');
    assert.equal(
      hiddenBanner(container),
      t.usersHiddenByFilter.replace('{count}', '3'),
      'un onglet qui masque est un filtre comme un autre : il le dit aussi',
    );
    act(() => {
      buttonByText(container, t.clearUserFilter).click();
    });
    assert.equal(cardsShown(container), 4, 'remis sur « Tous »');
    unmount(container, root);
  });
});

describe('règle de classe — un champ mot de passe dit ce qu’il attend', () => {
  const SRC = join(import.meta.dirname, '..', 'src');
  const ALLOWED = new Set(['off', 'new-password', 'current-password', 'one-time-code']);

  it('aucun `<input type="password">` de src/ ne s’en remet aux heuristiques du navigateur', () => {
    const files = listFiles(SRC);
    const offenders: string[] = [];
    let seen = 0;
    for (const file of files) {
      // Prose blanchie : un commentaire qui PARLE d'un champ mot de passe n'est pas
      // un champ mot de passe.
      const code = maskComments(readFileSync(file, 'utf8')) as string;
      for (const tag of code.match(/<input\b[^>]*>/g) ?? []) {
        if (!/type="password"/.test(tag)) continue;
        seen += 1;
        const declared = /autoComplete="([a-z-]+)"/.exec(tag);
        if (!declared || !ALLOWED.has(declared[1]!)) {
          offenders.push(
            `${file.slice(SRC.length + 1).replace(/\\/g, '/')} — ${tag.replace(/\s+/g, ' ').slice(0, 90)}`,
          );
        }
      }
    }
    assert.ok(seen >= 3, `le contrôle a lu ${seen} champ(s) mot de passe (connexion, définition, création)`);
    assert.ok(files.length >= 50, `le contrôle a lu ${files.length} fichiers de src/`);
    assert.deepEqual(
      offenders,
      [],
      'chaque champ mot de passe déclare son attente : `current-password` pour une connexion, `new-password` pour un mot de passe qu’on définit',
    );
  });

  it('le contrôle mord : un champ sans `autoComplete` est refusé', () => {
    const pattern = /autoComplete="([a-z-]+)"/;
    assert.equal(pattern.exec('<input type="password" value={x} onChange={f} />'), null, 'le motif reconnaît l’absence');
    assert.equal(
      pattern.exec('<input type="password" autoComplete="new-password" />')?.[1],
      'new-password',
      'et il lit la déclaration quand elle est là',
    );
    assert.equal(
      pattern.exec('<input type="password" autoComplete="whatever" />')?.[1] === 'whatever'
        && ALLOWED.has('whatever'),
      false,
      'une valeur inventée ne passe pas non plus',
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Le défaut de harnais qui a coûté six minutes et un tas de 400 Mo.
//
// `assert.equal(nœud, null)` paraît anodin : quand l'assertion ÉCHOUE, Node
// formate la valeur reçue — et un élément happy-dom entraîne le document, la
// fenêtre, ses circularités et tout ce qui y est accroché. Mesuré en corrigeant
// ce fichier : la suite n'échouait pas, elle mourait en « JavaScript heap out of
// memory » après ~6 min de GC, ce qui ressemble à une boucle infinie et se
// diagnostique très mal. Un nœud se projette en booléen avant d'être affirmé.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Les assert.<égalité> qui reçoivent une RECHERCHE D'ÉLÉMENT au premier argument.
 *
 * Deux finesses, toutes deux payées par un faux positif mesuré : une PROJECTION
 * (`élément !== null`) est un booléen et reste permise — c'est même la forme qu'on
 * recommande ; et le texte scanné a ses chaînes blanchies, sinon les fragments
 * cités par les cas « le contrôle mord » seraient pris pour des violations.
 */
function domNodeAssertions(code: string): string[] {
  const found: string[] = [];
  for (const line of code.split('\n')) {
    const call = /assert\.(equal|notEqual|deepEqual|strictEqual)\(\s*([^,]*)/.exec(line);
    if (!call) continue;
    const first = call[2]!;
    if (first.includes('!==') || first.includes('===')) continue;
    if (/(querySelector|getElementById)\s*\(/.test(first)) found.push(line.trim().slice(0, 100));
  }
  return found;
}

describe('règle de classe — une assertion ne reçoit jamais un nœud du DOM', () => {
  const TESTS = join(import.meta.dirname);

  it('aucun assert.<égalité> des suites ne passe un élément à inspecter', () => {
    const files = listFiles(TESTS);
    const offenders: string[] = [];
    let seen = 0;
    for (const file of files) {
      // Commentaires ET chaînes blanchis : un fragment de code cité entre
      // guillemets (les cas « le contrôle mord ») n'est pas un violateur.
      const code = maskProse(readFileSync(file, 'utf8'), { comments: true, literals: true }) as string;
      seen += code.split('\n').filter((l) => l.includes('assert.')).length;
      for (const hit of domNodeAssertions(code)) {
        offenders.push(`${relative(TESTS, file).split(sep).join('/')} — ${hit}`);
      }
    }
    assert.ok(seen >= 100, `le contrôle a lu ${seen} assertion(s) dans les suites`);
    assert.ok(files.length >= 40, `le contrôle a lu ${files.length} fichiers de tests/`);
    assert.deepEqual(
      offenders,
      [],
      'un nœud happy-dom passé à une assertion fait exploser le tas au lieu de dire « attendu null, reçu <div…> » : projetez-le en booléen',
    );
  });

  it('le contrôle mord : les deux formes qu’un violateur écrirait sont reconnues', () => {
    assert.deepEqual(
      domNodeAssertions("assert.equal(container.querySelector('input'), null);"),
      ["assert.equal(container.querySelector('input'), null);"],
      'la recherche d’élément au premier argument est refusée',
    );
    assert.deepEqual(
      domNodeAssertions("assert.deepEqual(document.getElementById('x'), null);"),
      ["assert.deepEqual(document.getElementById('x'), null);"],
      'la seconde forme aussi',
    );
    assert.deepEqual(
      domNodeAssertions('assert.equal(container.querySelectorAll(\'a\').length, 0);'),
      [],
      'un NOMBRE dérivé d’une recherche n’est pas un nœud : il reste permis',
    );
    assert.deepEqual(
      domNodeAssertions('assert.equal(inputs.length, 0);'),
      [],
      'et une longueur déjà calculée ne déclenche rien',
    );
    assert.deepEqual(
      domNodeAssertions("assert.equal(container.querySelector('input') !== null, false);"),
      [],
      'la projection en booléen est la forme recommandée — elle n’est pas une violation',
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Ce que la COUPURE change dans ce panneau — dit AVANT le clic.
//
// Deux familles de gestes y cohabitent, et elles ne se comportent pas pareil sans
// ligne : un RÔLE part en file (il arrivera tout seul au retour de la connexion),
// tandis qu'un MOT DE PASSE ou une CRÉATION DE COMPTE passent par
// l'authentification du serveur et ne peuvent pas attendre. Le panneau le dit
// donc à l'avance, au lieu de laisser l'utilisateur découvrir l'échec.
// ─────────────────────────────────────────────────────────────────────────────

describe('le panneau des comptes dit ce que la coupure change', () => {
  const withOnLine = <T,>(value: boolean, run: () => T): T => {
    const realOnLine = win.navigator.onLine;
    Object.defineProperty(win.navigator, 'onLine', { value, configurable: true });
    try {
      return run();
    } finally {
      Object.defineProperty(win.navigator, 'onLine', { value: realOnLine, configurable: true });
    }
  };

  it('hors ligne, l’écran prévient : les rôles partent en file, les mots de passe exigent la connexion', () => {
    withOnLine(false, () => {
      const { container, root } = mount();
      try {
        assert.equal(
          (container.textContent ?? '').includes(t.accountGesturesOffline),
          true,
          'la mention doit être visible AVANT le geste, pas après son échec',
        );
      } finally {
        unmount(container, root);
      }
    });
  });

  it('une session hors ligne (ligne revenue, jeton pas encore rouvert) compte aussi comme hors ligne', () => {
    const realOfflineSession = adminAuth.isOfflineSession;
    adminAuth.isOfflineSession = true;
    const { container, root } = mount();
    try {
      assert.equal((container.textContent ?? '').includes(t.accountGesturesOffline), true);
    } finally {
      unmount(container, root);
      adminAuth.isOfflineSession = realOfflineSession;
    }
  });

  it('en ligne, aucune mention de coupure (l’écran ne parle pas pour rien)', () => {
    withOnLine(true, () => {
      const { container, root } = mount();
      try {
        assert.equal((container.textContent ?? '').includes(t.accountGesturesOffline), false);
      } finally {
        unmount(container, root);
      }
    });
  });
});
