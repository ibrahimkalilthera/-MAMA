/**
 * `DuplicateReviewModal` — l'écran où l'école TRANCHE, monté sur un VRAI DOM et
 * cliqué comme un doigt le ferait.
 *
 * Ce qui est verrouillé ici est l'INTERFACE, pas la forme du HTML :
 *
 *   • les deux fiches se lisent sur les MÊMES lignes, l'une sous l'autre, et
 *     seules les lignes qui DIFFÈRENT portent la marque — une ligne où les deux
 *     fiches disent la même chose qui serait surlignée ferait douter de tout ;
 *   • le choix de la fiche gardée est un vrai bouton radio, et il change la
 *     décision (la première fiche est gardée par défaut) ;
 *   • les DEUX gestes destructifs passent par une confirmation à recopier, et la
 *     recopie porte le MATRICULE — un nom partagé par deux fiches ne prouverait
 *     rien ; le bouton reste INERTE tant que la valeur n'est pas recopiée ;
 *   • confirmer appelle bien le domaine, avec la fiche gardée et les fiches
 *     retirées (jamais l'inverse) ;
 *   • sans droit d'écriture, aucun des deux gestes n'est offert : c'est ce que la
 *     base applique (`is_admin()`), donc l'écran ne propose pas l'échec.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { DuplicateReviewModal } from '../src/components/DuplicateReviewModal';
import type { Student } from '../src/lib/useSupabaseData';
import type { CurrentTheme } from '../src/app/mainViewsProps';
import { translations } from '../src/i18n/translations';
import { installDomGlobals } from './harness';

const t = translations.en;

const theme: CurrentTheme = {
  bg: 'bg-slate-100',
  card: 'bg-white',
  text: 'text-slate-900',
  muted: 'text-slate-500',
  border: 'border-slate-200',
  header: '#0F172A',
  sidebar: 'bg-slate-800',
  accent: 'text-emerald-600',
  accentBg: 'bg-emerald-50',
  accentText: 'text-white',
  accentHover: 'hover:bg-emerald-100',
  accentGroupHover: 'accent-group-hover',
  accentShadow: 'shadow-emerald-200',
  accentSoft: 'bg-emerald-50',
  accentSoftText: 'text-emerald-600',
  accentSoftHover: 'hover:bg-emerald-100', accentSoftTextHover: 'hover:text-emerald-700',
  accentHex: '#059669',
  accentHexDeep: '#047857',
  accentRing: 'focus:ring-emerald-500/20',
  accentBorder: 'border-slate-300',
  accentBorderHover: 'hover:border-slate-400',
  surfaceInset: 'bg-slate-50',
  inkStrong: 'text-slate-800',
  accentSoftDark: 'bg-blue-500/15',
  accentSoftDarkHover: 'hover:bg-blue-500/25',
  accentSoftDarkText: 'text-blue-300',
  tableHeader: 'bg-slate-100',
  rowHover: 'hover:bg-slate-50',
  hoverSurface: 'state-hover',
  hoverSurfaceSolid: 'state-hover-solid',
  hoverSurfaceStrong: 'state-hover-strong',
  hoverSurfaceDark: 'state-hover-dark',
  hoverSurfaceClear: 'state-hover-clear',
  hoverAccent: 'state-accent-hover',
  hoverAccentGroupInk: 'state-accent-group-ink',
  hoverAlert: 'state-alert-hover',
  hoverAlertTint: 'state-alert-tint',
  hoverAlertSolid: 'state-alert-solid',
  hoverAlertDark: 'state-alert-dark',
  hoverAlertPlate: 'state-alert-plate',
  input: 'bg-white',
  isDark: false,
};

/** Les deux fiches du cas mesuré : même nom, même classe, fiches qui diffèrent. */
const KEPT: Student = {
  id: 'saf-1', name: 'Safiatou COULIBALY', studentId: 'MT-2026-252', grade: '5A',
  academicYear: '2026-2027', parentName: 'Tuteur', parentEmail: '', parentPhone: '76313228',
  totalDue: 36000, amountPaid: 0, dueDate: '2026-12-31', enrollmentDate: '2026-09-24',
  status: 'Active', notes: '', payments: [],
};
const OTHER: Student = {
  ...KEPT, id: 'saf-2', studentId: 'MT-2026-415', parentName: 'Fanta BAH', parentPhone: '71121470',
  amountPaid: 36000, enrollmentDate: '2026-10-05',
  payments: [
    { id: 'p1', amount: 20000, date: '2026-09-24', receiptNumber: 'REC-p1' },
    { id: 'p2', amount: 16000, date: '2026-10-05', receiptNumber: 'REC-p2' },
  ],
};

interface Handles {
  container: HTMLElement;
  text: () => string;
  button: (label: string) => HTMLButtonElement | undefined;
  cleanup: () => void;
}

function mount(opts: { canDelete?: boolean; group?: Student[] } = {}): Handles & {
  merges: Array<[string, string[]]>;
  deletions: string[];
} {
  installDomGlobals();
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  const merges: Array<[string, string[]]> = [];
  const deletions: string[] = [];
  const props = {
    group: opts.group ?? [KEPT, OTHER],
    t,
    lang: 'fr' as const,
    currentTheme: theme,
    formatCurrency: (amount: number) => `${amount} FCFA`,
    formatDate: (dateStr: string) => dateStr,
    getGradeDisplay: (grade: string | undefined) => grade ?? '',
    canDelete: opts.canDelete ?? true,
    mergeStudents: async (survivorId: string, mergedIds: string[]) => {
      merges.push([survivorId, mergedIds]);
      return true;
    },
    deleteStudent: async (id: string) => {
      deletions.push(id);
      return true;
    },
    overlayRef: () => {},
    onClose: () => {},
  };
  act(() => root.render(createElement(DuplicateReviewModal, props)));
  return {
    container,
    merges,
    deletions,
    text: () => container.textContent ?? '',
    button: (label: string) =>
      Array.from(container.querySelectorAll('button'))
        .find((b) => (b.textContent ?? '').trim() === label),
    cleanup: () => {
      act(() => root.unmount());
      container.remove();
    },
  };
}

/**
 * Les cellules de valeur d'UNE ligne de comparaison, repérées par le libellé de
 * la ligne — jamais par leur contenu : « 36000 FCFA » se lit aussi sur les
 * lignes payé et restant dû, et compter les occurrences par contenu confondrait
 * trois lignes distinctes.
 */
function rowCells(container: HTMLElement, label: string): HTMLElement[] {
  const row = Array.from(container.querySelectorAll<HTMLElement>('div.contents'))
    .find((el) => (el.firstElementChild?.textContent ?? '') === label);
  return row ? (Array.from(row.children).slice(1) as HTMLElement[]) : [];
}

/**
 * Recopie une valeur dans le champ d'une confirmation à saisir.
 *
 * Mesuré dans cet environnement : happy-dom + cette version de React ne livrent
 * PAS un événement de champ TEXTE au `onChange` de React. Le `click` d'un bouton
 * passe, le `change` d'un `<select>` passe, `onInput` d'un champ texte passe...
 * mais `onChange` d'un champ texte ne se déclenche jamais, quel que soit
 * l'événement expédié (`input`, `change`, `beforeinput`, `InputEvent`, avec ou
 * sans le setter natif de la propriété) — c'est une limite du routeur
 * d'événements de React sous happy-dom, pas du composant.
 *
 * On appelle donc le gestionnaire que React a RÉELLEMENT câblé sur ce champ
 * (son `onChange` de nœud, exposé sur `__reactProps$…`). Ce qui est vérifié ici
 * reste le garde-fou du COMPOSANT — un bouton qui ne s'arme que sur la recopie
 * exacte, et un geste qui n'appelle le domaine qu'une fois armé.
 */
function typeInto(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
  setter?.call(input, value);
  const propsKey = Object.getOwnPropertyNames(input).find((name) => name.startsWith('__reactProps$'));
  const onChange = (
    propsKey ? (input as unknown as Record<string, { onChange?: (e: unknown) => void }>)[propsKey] : undefined
  )?.onChange;
  assert.ok(onChange, 'le champ de confirmation est câblé sur React');
  onChange({ target: input, currentTarget: input });
}

const confirmInput = (container: HTMLElement) =>
  container.querySelector<HTMLInputElement>('input[type="text"]');

describe('DuplicateReviewModal — comparer les deux fiches, ligne par ligne', () => {
  it('montre les valeurs des deux fiches et ne marque QUE les lignes qui diffèrent', () => {
    const h = mount();
    try {
      const text = h.text();
      for (const value of ['MT-2026-252', 'MT-2026-415', 'Tuteur', 'Fanta BAH', '76313228', '71121470']) {
        assert.ok(text.includes(value), `${value} est à l'écran`);
      }
      // Le total dû est le MÊME sur les deux fiches : la ligne doit rester muette.
      const same = rowCells(h.container, t.totalDue);
      assert.equal(same.length, 2, 'une cellule par fiche');
      assert.deepEqual(same.map((el) => el.textContent), ['36000 FCFA', '36000 FCFA']);
      assert.deepEqual(same.map((el) => el.getAttribute('title')), [null, null], 'une valeur identique n’est pas surlignée');

      // Le matricule, lui, diffère : les deux cellules portent la marque.
      const matricule = rowCells(h.container, t.studentId);
      assert.deepEqual(matricule.map((el) => el.textContent), ['MT-2026-252', 'MT-2026-415']);
      assert.deepEqual(
        matricule.map((el) => el.getAttribute('title')),
        [t.duplicateReviewDiffers, t.duplicateReviewDiffers],
        'une ligne où les deux fiches diffèrent est marquée sur TOUTES les colonnes',
      );
    } finally {
      h.cleanup();
    }
  });

  it('garde la première fiche par défaut, et le choix suit le bouton radio', () => {
    const h = mount();
    try {
      const radios = Array.from(h.container.querySelectorAll<HTMLInputElement>('input[type="radio"]'));
      assert.equal(radios.length, 2, 'un choix par fiche');
      assert.equal(radios[0].checked, true, 'la première est gardée par défaut');
      assert.equal(radios[1].checked, false);

      act(() => radios[1].click());
      assert.equal(radios[1].checked, true, 'le choix change');
      assert.equal(radios[0].checked, false);
    } finally {
      h.cleanup();
    }
  });

  it('annonce le résultat de la fusion calculé par la fonction qui la réalisera', () => {
    const h = mount();
    try {
      // 2 reçus (p1 + p2) et 36000 FCFA consolidés, pour la fiche gardée.
      assert.match(h.text(), /2/, 'le compte des reçus du groupe est annoncé');
      assert.ok(h.text().includes('36000 FCFA'), 'le montant consolidé est annoncé');
    } finally {
      h.cleanup();
    }
  });
});

describe('DuplicateReviewModal — trancher : fusionner ou supprimer', () => {
  it('la fusion demande de RECOPIER le matricule de la fiche qui disparaît, puis appelle le domaine', () => {
    const h = mount();
    try {
      const merge = h.button(t.duplicateReviewMerge);
      assert.ok(merge, 'le bouton de fusion est offert à qui peut écrire');
      act(() => merge.click());

      assert.ok(
        h.text().includes(t.duplicateReviewMergeConfirm.replace('{survivor}', 'Safiatou COULIBALY (MT-2026-252, 5A)').replace('{loser}', 'Safiatou COULIBALY (MT-2026-415, 5A)')),
        'la confirmation dit exactement ce qui va se passer, en nommant les deux fiches',
      );

      const input = confirmInput(h.container);
      assert.ok(input, 'la confirmation est du type « recopiez » — un clic seul ne suffit pas');
      assert.equal(input.value, '', 'le champ part vide');
      assert.equal(input.placeholder, 'MT-2026-415', 'c’est le MATRICULE de la fiche retirée qu’il faut recopier');

      const confirm = h.button(t.duplicateReviewMergeAction);
      assert.ok(confirm, 'le bouton de confirmation existe');
      assert.equal(confirm.disabled, true, 'et il est INERTE tant que rien n’est recopié');

      act(() => typeInto(input, 'MT-2026-415'));
      assert.equal(confirm.disabled, false, 'la recopie exacte l’active');

      act(() => confirm.click());
      assert.deepEqual(h.merges, [['saf-1', ['saf-2']]], 'la fiche gardée, puis celle qui disparaît');
    } finally {
      h.cleanup();
    }
  });

  it('avec TROIS fiches du même nom, la recopie nomme CHAQUE fiche qui disparaît', () => {
    // Le garde-fou doit couvrir exactement ce qui s'en va : un seul matricule
    // recopié ne peut pas armer la disparition de deux fiches.
    const THIRD: Student = { ...OTHER, id: 'saf-3', studentId: 'MT-2026-416', parentPhone: '70000000' };
    const h = mount({ group: [KEPT, OTHER, THIRD] });
    try {
      assert.equal(
        Array.from(h.container.querySelectorAll('button'))
          .filter((b) => (b.textContent ?? '').trim() === t.duplicateReviewDelete).length,
        3,
        'les trois fiches sont comparées',
      );

      const merge = h.button(t.duplicateReviewMerge);
      assert.ok(merge);
      act(() => merge.click());

      const input = confirmInput(h.container);
      assert.ok(input);
      assert.equal(input.placeholder, 'MT-2026-415, MT-2026-416', 'un identifiant par fiche retirée');

      const confirm = h.button(t.duplicateReviewMergeAction);
      assert.ok(confirm);
      assert.equal(confirm.disabled, true);
      act(() => typeInto(input, 'MT-2026-415'));
      assert.equal(confirm.disabled, true, 'un seul matricule ne suffit pas quand deux fiches disparaissent');

      act(() => typeInto(input, 'MT-2026-415, MT-2026-416'));
      assert.equal(confirm.disabled, false);
      act(() => confirm.click());
      assert.deepEqual(h.merges, [['saf-1', ['saf-2', 'saf-3']]], 'la gardée, puis les deux qui s’en vont');
    } finally {
      h.cleanup();
    }
  });

  it('supprimer une fiche demande de recopier SON matricule, et n’appelle que cette fiche', () => {
    const h = mount();
    try {
      const deleteButtons = Array.from(h.container.querySelectorAll('button'))
        .filter((b) => (b.textContent ?? '').trim() === t.duplicateReviewDelete);
      assert.equal(deleteButtons.length, 2, 'chaque fiche porte sa sortie de secours');

      act(() => deleteButtons[1].click());
      const input = confirmInput(h.container);
      assert.ok(input, 'la suppression aussi se recopie');
      assert.equal(input.placeholder, 'MT-2026-415', 'le matricule de LA fiche visée');
      assert.ok(h.text().includes(t.duplicateReviewDeleteConfirm.replace('{name}', 'Safiatou COULIBALY (MT-2026-415, 5A)')));

      const confirm = h.button(t.deleteStudent);
      assert.ok(confirm);
      assert.equal(confirm.disabled, true);
      act(() => typeInto(input, 'MT-2026-415'));
      act(() => confirm.click());

      assert.deepEqual(h.deletions, ['saf-2'], 'une seule fiche part, celle qu’on a nommée');
      assert.deepEqual(h.merges, [], 'et rien n’est fusionné au passage');
    } finally {
      h.cleanup();
    }
  });

  it('sans droit d’écriture, aucun des deux gestes n’est offert', () => {
    const h = mount({ canDelete: false });
    try {
      assert.equal(h.button(t.duplicateReviewMerge), undefined, 'pas de fusion');
      assert.equal(h.button(t.duplicateReviewDelete), undefined, 'pas de suppression');
      assert.ok(h.text().includes(t.duplicateReviewAdminOnly), 'et l’écran dit POURQUOI');
      // La comparaison, elle, reste entièrement lisible : refuser le geste n'est
      // pas cacher le problème.
      assert.ok(h.text().includes('MT-2026-415'));
    } finally {
      h.cleanup();
    }
  });
});
