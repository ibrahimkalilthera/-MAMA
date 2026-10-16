// ─────────────────────────────────────────────────────────────────────────────
// La section « nom de l'école » des Paramètres, MESURÉE SUR LE DOM MONTÉ.
//
// Ce que cette suite protège, et chaque point est une décision de l'écran :
//
//   • **le droit** — le champ n'est offert qu'à l'administration
//     (`isAdminRole`, la liste qui reflète `is_admin()`), et à tout autre rôle
//     l'écran DIT pourquoi : un champ absent sans phrase laisserait croire à une
//     panne d'affichage, et l'écart avec la politique de la base se lirait comme
//     un bug plutôt que comme une décision ;
//   • **la lecture ratée est dite** — `schoolNameReadFailed` a sa ligne, et son
//     ABSENCE est vérifiée en contre-épreuve : un champ vide devant une lecture
//     ratée inviterait à réécrire un nom que l'école avait déjà publié ;
//   • **le champ se déclare** — `autoComplete="off"`, la règle payée par le bug
//     du 2026-09-14 (le gestionnaire de mots de passe remplissait le champ voisin
//     de la fiche mot de passe) ;
//   • **rien n'est écrit sans changement** — le bouton est fermé sur un brouillon
//     identique à ce qui est écrit, et le clic ne part pas.
//
// ── CE QUE CETTE SUITE NE PEUT PAS MESURER, et où c'est mesuré ───────────────
// Le chemin d'enregistrement complet (une frappe, puis les trois phrases
// « enregistré » / « hors ligne » / « refusé ») n'est PAS drivable ici : sous ce
// harnais, un événement `input` fabriqué n'atteint jamais le `onChange` de React
// (mesuré — le traqueur de valeur de React n'est pas mis à jour par le setter de
// la spec, et la valeur contrôlée ne bouge pas ; c'est la même limite que
// documentent `tests/settings-filter-honesty.test.tsx` et
// `tests/payment-entry-modal.test.tsx`). Les trois issues sont donc prouvées là
// où elles sont décidables : sur la couche qui écrit et sur le contrat
// (`tests/school-name.test.ts` — 200 au corps vide, file hors ligne, refus sans
// écriture, ligne sans `updated_by`), et les phrases elles-mêmes sont tenues par
// la parité des deux langues (`npm run l10n-verify`). Ce fichier prouve ce que
// l'écran MONTRE sans geste : le droit, la lecture ratée, les attributs du champ
// et l'état du bouton.
// ─────────────────────────────────────────────────────────────────────────────
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { MainViewsContext } from '../src/app/mainViewsContext';
import type { MainViewsProps } from '../src/app/mainViewsProps';
import { SettingsSchoolCard } from '../src/components/SettingsSchoolCard';
import { SCHOOL_NAME_MAX } from '../src/lib/schoolName';
import type { AuthState, UserProfile } from '../src/lib/useAuth';
import { translations } from '../src/i18n/translations';
import { installDomGlobals } from './harness';
import { makeProps } from './views-harness';

const t = translations.fr;
const SCHOOL = 'Complexe Scolaire Mama Thera';

installDomGlobals();

const ADMIN: UserProfile = { id: 'p-adm', email: 'fanta@mamathera.org', fullName: 'Fanta Thera', role: 'admin' };
const STAFF: UserProfile = { id: 'p-staff', email: 'aggee@mamathera.org', fullName: 'Aggee Diarra', role: 'staff' };

/** Le poste connecté, avec le rôle que le cas veut éprouver. */
function authFor(profile: UserProfile): AuthState {
  return {
    user: null,
    profile,
    loading: false,
    error: null,
    // `isAdmin` suit le rôle : c'est le RÔLE qui décide ici, comme la politique
    // de la base (`public.is_admin()`), et non un booléen d'écran.
    isAdmin: profile.role === 'admin',
    isOfflineSession: false,
    reauthFailed: false,
    signIn: async () => ({ success: true }),
    signOut: async () => {},
    fetchAllProfiles: async () => [],
    updateUserRole: async () => true,
    createStaffUser: async () => ({ success: true }),
    sendPasswordReset: async () => ({ success: true }),
    setUserPassword: async () => ({ success: true }),
  };
}

interface Mounted {
  container: HTMLElement;
  root: ReturnType<typeof createRoot>;
}

function mount(overrides: Partial<MainViewsProps> = {}): Mounted {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(
      createElement(
        MainViewsContext.Provider,
        { value: makeProps({ t, auth: authFor(ADMIN), schoolName: SCHOOL, ...overrides }) },
        createElement(SettingsSchoolCard),
      ),
    );
  });
  return { container, root };
}

function unmount({ container, root }: Mounted): void {
  act(() => {
    root.unmount();
  });
  document.body.removeChild(container);
}

function field(container: HTMLElement): HTMLInputElement | null {
  return container.querySelector<HTMLInputElement>('input[type="text"]');
}

function saveButton(container: HTMLElement): HTMLButtonElement | null {
  return (
    Array.from(container.querySelectorAll('button')).find(
      (b) => (b.textContent ?? '').trim() === t.schoolNameSave,
    ) ?? null
  );
}

describe('la section « nom de l’école » — le droit, la lecture, et l’état du geste', () => {
  it('l’administration voit le champ, et il se déclare comme un champ libre', () => {
    const mounted = mount();
    try {
      const { container } = mounted;
      assert.ok(container.querySelector('[data-slot="settings-school-name"]'), 'la section porte son marqueur');

      const input = field(container);
      assert.ok(input, 'le champ est offert à l’administration');
      assert.equal(input.value, SCHOOL, 'le champ est amorcé avec le nom lu');
      assert.equal(
        input.getAttribute('autocomplete'),
        'off',
        'un champ libre se déclare : le gestionnaire de mots de passe n’a rien à y verser (bug du 2026-09-14)',
      );
      assert.equal(input.maxLength, SCHOOL_NAME_MAX, 'la borne du contrat est aussi celle du champ');
      assert.equal(input.getAttribute('aria-label'), t.schoolNameTitle, 'le champ est nommé pour qui ne voit pas le titre');
    } finally {
      unmount(mounted);
    }
  });

  it('sans ce droit, le champ n’est PAS offert — et l’écran dit pourquoi', () => {
    const mounted = mount({ auth: authFor(STAFF) });
    try {
      assert.equal(field(mounted.container), null, 'aucun champ pour un rôle qui n’a pas le droit d’écrire');
      assert.equal(saveButton(mounted.container), null, 'et aucun geste à offrir');
      assert.ok(
        (mounted.container.textContent ?? '').includes(t.schoolNameAdminOnly),
        'l’écran DIT que l’écriture appartient à l’administration, au lieu de laisser un vide inexpliqué',
      );
    } finally {
      unmount(mounted);
    }
  });

  it('rien à enregistrer : le bouton est fermé, et le clic n’écrit pas', () => {
    const writes: string[] = [];
    const mounted = mount({
      setSchoolName: async (name) => {
        writes.push(name);
        return 'saved';
      },
    });
    try {
      const button = saveButton(mounted.container);
      assert.ok(button, 'le bouton est rendu');
      assert.equal(button.disabled, true, 'un brouillon identique à ce qui est écrit n’est pas un geste');
      act(() => {
        button.click();
      });
      assert.deepEqual(writes, [], 'un clic sur un geste fermé n’écrit rien');
    } finally {
      unmount(mounted);
    }
  });

  it('le champ reste vide quand rien n’est déclaré — et l’écran n’en dit pas plus', () => {
    const mounted = mount({ schoolName: null });
    try {
      assert.equal(field(mounted.container)?.value, '');
      assert.equal(
        mounted.container.querySelector('[data-school-name-read="failed"]'),
        null,
        'aucune école n’a déclaré son nom : c’est un FAIT, pas une panne à annoncer',
      );
    } finally {
      unmount(mounted);
    }
  });

  it('une lecture RATÉE se dit — elle ne se lit pas comme « rien de déclaré »', () => {
    const mounted = mount({ schoolName: null, schoolNameReadFailed: true });
    try {
      assert.ok(
        mounted.container.querySelector('[data-school-name-read="failed"]'),
        'la lecture ratée porte son marqueur',
      );
      assert.ok(
        (mounted.container.textContent ?? '').includes(t.schoolNameUnread),
        'et sa phrase : sans elle, un champ vide inviterait à réécrire un nom que l’école avait déjà publié',
      );
    } finally {
      unmount(mounted);
    }
  });
});
