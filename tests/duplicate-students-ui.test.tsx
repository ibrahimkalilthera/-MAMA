/**
 * Les fiches d'élève qui partagent un nom ET une classe, vues par l'APPLICATION.
 *
 * Le contrôle de clôture (`scripts/lib/duplicate-students.mjs`) relit la BASE ;
 * l'écran, lui, marque ce qu'il affiche. Rien ne relie les deux au moment de
 * l'exécution — donc c'est ici que le lien est tenu, sur deux fronts :
 *
 *   1. le CRITÈRE est le même que le `partition by` du contrôle : nom replié
 *      (casse + espaces de bord) et classe TELLE QUELLE (le SQL groupe
 *      `coalesce(grade,'')`, sans replier la classe, donc « 5A » ≠ « 5a ») ;
 *   2. le SIGNAL est posé là où l'école consulte les fiches : la ligne du
 *      registre, la légende, et la fiche ouverte qui sert à trancher.
 *
 * Le cas réel du 2026-10-06 (base partagée) est le fixture : « Safiatou
 * COULIBALY » 5A et « Fatoumata COULIBALY » 8A, deux fiches chacune sur 423.
 *
 * Ce que ces cas protègent, et pourquoi ils ne sont pas cosmétiques : une
 * pastille de trop ferait accuser un homonyme légitime, une pastille manquante
 * laisserait un vrai doublon invisible — et c'est l'écran que le bureau lit en
 * premier.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { MainViewsContext } from '../src/app/mainViewsContext';
import { StudentsView } from '../src/components/StudentsView';
import { StudentDetailsModal } from '../src/components/StudentDetailsModal';
import type { Student } from '../src/lib/useSupabaseData';
import type { CurrentTheme } from '../src/app/mainViewsProps';
import { translations } from '../src/i18n/translations';
import {
  CONTROL_STUDENT_NAME_GRADE,
  duplicateStudentGroupSize,
  duplicateStudentGroupsById,
  duplicateStudentKey,
} from '../src/lib/duplicateStudents';
import { DUPLICATE_STUDENT_SQL } from '../scripts/lib/duplicate-students.mjs';
import { makeProps, renderWithContext } from './views-harness';
import { installDomGlobals } from './harness';

const t = translations.en;

// ─── Le registre du cas réel ─────────────────────────────────────────────────
const student = (over: Partial<Student> & { id: string; name: string }): Student => ({
  grade: '5A',
  totalDue: 36000,
  amountPaid: 0,
  parentName: 'Tuteur',
  parentEmail: '',
  parentPhone: '76313228',
  dueDate: '2026-12-31',
  payments: [],
  notes: '',
  ...over,
});

const safiatou1 = student({ id: 'saf-1', name: 'Safiatou COULIBALY', grade: '5A' });
const safiatou2 = student({ id: 'saf-2', name: '  Safiatou COULIBALY ', grade: '5A' });
const fatoumata1 = student({ id: 'fat-1', name: 'Fatoumata COULIBALY', grade: '8A' });
const fatoumata2 = student({ id: 'fat-2', name: 'Fatoumata COULIBALY', grade: '8A' });
/** Même nom, AUTRE classe : deux élèves, pas un doublon. */
const fatoumata8b = student({ id: 'fat-3', name: 'Fatoumata COULIBALY', grade: '8B' });
/** Même nom, classe de casse différente : le contrôle ne replie PAS la classe. */
const fatoumata8aLower = student({ id: 'fat-4', name: 'Fatoumata COULIBALY', grade: '8a' });
/** Deux fiches sans nom : elles ne partagent rien. */
const anonymous1 = student({ id: 'anon-1', name: '', grade: '5A' });
const anonymous2 = student({ id: 'anon-2', name: '   ', grade: '5A' });

const register = [safiatou1, safiatou2, fatoumata1, fatoumata2, fatoumata8b, fatoumata8aLower, anonymous1, anonymous2];

const countOccurrences = (haystack: string, needle: string): number => haystack.split(needle).length - 1;

// ─── 1. Le critère, le même que celui du contrôle ────────────────────────────
describe('le critère de l’application est celui du contrôle', () => {
  it('replie le nom (casse + espaces de bord) et garde la classe telle quelle', () => {
    // La requête du contrôle groupe EXACTEMENT ces deux expressions...
    assert.match(
      DUPLICATE_STUDENT_SQL,
      /partition by lower\(trim\(p\.name\)\), coalesce\(p\.grade, ''\)/,
      'le contrôle groupe le nom replié + la classe',
    );
    // ...et le miroir de l'application en fait autant :
    assert.equal(duplicateStudentKey(safiatou1), duplicateStudentKey(safiatou2), 'casse et espaces de bord ignorés');
    assert.notEqual(
      duplicateStudentKey(fatoumata1),
      duplicateStudentKey(fatoumata8aLower),
      'la classe n’est PAS repliée — « 8A » et « 8a » sont deux classes, comme dans le SQL',
    );
    assert.notEqual(duplicateStudentKey(fatoumata1), duplicateStudentKey(fatoumata8b), 'deux classes = deux élèves');
  });

  it('écarte les fiches sans nom — un nom vide n’est pas un doublon', () => {
    assert.equal(duplicateStudentKey(anonymous1), null);
    assert.equal(duplicateStudentKey(anonymous2), null);
    const groups = duplicateStudentGroupsById([anonymous1, anonymous2]);
    assert.equal(groups.size, 0, 'aucune fiche sans nom n’est signalée');
  });

  it('ne signale que les fiches dont le groupe compte plus d’une ligne', () => {
    const groups = duplicateStudentGroupsById(register);
    assert.deepEqual(
      [...groups.entries()].sort(),
      [['fat-1', 2], ['fat-2', 2], ['saf-1', 2], ['saf-2', 2]],
      'les deux groupes réels, et eux seuls',
    );
    assert.ok(!groups.has('fat-3'), 'une classe différente n’est pas un groupe');
    assert.ok(!groups.has('fat-4'), 'une casse de classe différente n’est pas un groupe');
  });

  it('compte les fiches du groupe, cette fiche comprise, sans se compter deux fois', () => {
    assert.equal(duplicateStudentGroupSize([safiatou1, safiatou2], safiatou1), 2);
    assert.equal(duplicateStudentGroupSize([safiatou1, safiatou2], { ...safiatou1 }), 2, 'une COPIE éditée ne double pas');
    assert.equal(duplicateStudentGroupSize(register, fatoumata8b), 1, 'une fiche seule compte pour une');
    assert.equal(duplicateStudentGroupSize(register, anonymous1), 0, 'une fiche sans nom n’a pas de groupe');
    assert.equal(CONTROL_STUDENT_NAME_GRADE, 'meme_nom_meme_classe');
  });
});

// ─── 2. Le signal, là où l'école consulte les fiches ─────────────────────────
describe('le registre signale chaque fiche à regarder', () => {
  const badge = t.duplicateStudentBadge;
  /** La pastille d'une ligne porte le nombre de fiches du groupe. */
  const warningFor = (n: number) => t.duplicateStudentWarning.replace('{n}', String(n));

  it('pose la pastille sur les DEUX fiches de chaque groupe, et sur aucune autre', () => {
    const html = renderWithContext(createElement(StudentsView), { students: register, filteredStudents: register });
    // 4 fiches signalées + la pastille de la légende (qui montre le même dessin).
    assert.equal(countOccurrences(html, badge), 5, '4 lignes + la légende');
    assert.equal(countOccurrences(html, warningFor(2)), 4, 'chaque ligne dit combien de fiches partagent le nom');
    assert.match(html, new RegExp(t.duplicateStudentLegend), 'la légende nomme le critère');
  });

  it('lit l’ANNUAIRE ENTIER : une liste filtrée ne fait pas disparaître le partenaire', () => {
    // Le piège : une recherche active réduit `filteredStudents`. Si la pastille
    // était calculée sur cette liste, la fiche visible cesserait d'être signalée
    // — et son « doublon » serait invisible à l'écran qui doit le montrer.
    const html = renderWithContext(createElement(StudentsView), {
      students: [safiatou1, safiatou2],
      filteredStudents: [safiatou1],
    });
    assert.equal(countOccurrences(html, warningFor(2)), 1, 'la fiche visible est signalée');
    assert.equal(countOccurrences(html, badge), 2, 'une ligne + la légende');
  });

  it('ne signale rien quand le registre n’a aucun homonyme', () => {
    const unique = [fatoumata1, fatoumata8b];
    const html = renderWithContext(createElement(StudentsView), { students: unique, filteredStudents: unique });
    assert.equal(countOccurrences(html, badge), 1, 'seule la légende porte la pastille');
    assert.equal(countOccurrences(html, warningFor(2)), 0);
  });
});

// ─── 2 bis. L'ENTRÉE de l'outil : la pastille est le bouton qui ouvre la comparaison ──
describe('la pastille du registre ouvre la comparaison des fiches', () => {
  it('est un bouton qui appelle openDuplicateReview, sans ouvrir la fiche au passage', () => {
    installDomGlobals();
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    const opened: Student[] = [];
    let ficheOpened = 0;
    const props = makeProps({
      students: [safiatou1, safiatou2],
      filteredStudents: [safiatou1, safiatou2],
      openDuplicateReview: (student: Student) => { opened.push(student); },
      setSelectedStudent: () => { ficheOpened += 1; },
    });
    try {
      act(() => root.render(createElement(MainViewsContext.Provider, { value: props }, createElement(StudentsView))));
      const badge = Array.from(container.querySelectorAll('button'))
        .find((button) => (button.textContent ?? '').includes(t.duplicateStudentBadge));
      assert.ok(badge, 'la pastille est un bouton (sinon le signal ne mène à rien)');
      assert.match(badge.getAttribute('title') ?? '', new RegExp(t.duplicateReviewOpen), 'l’infobulle dit ce que le clic fait');

      act(() => (badge as HTMLButtonElement).click());
      assert.equal(opened.length, 1, 'un clic, une ouverture');
      assert.equal(opened[0].id, 'saf-1', 'c’est la fiche cliquée qui est comparée');
      assert.equal(ficheOpened, 0, 'la ligne ouvre la fiche : la pastille ne doit pas déclencher les deux écrans');
    } finally {
      act(() => root.unmount());
      container.remove();
    }
  });
});

// ─── 3. La fiche ouverte, l'endroit où l'école tranche ───────────────────────
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
  input: 'bg-white',
  isDark: false,
};

function renderDetails(duplicateGroupSize?: number): string {
  installDomGlobals();
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  const props = {
    student: safiatou1,
    t,
    lang: 'fr' as const,
    currentTheme: theme,
    formatDate: (d: string) => d,
    formatCurrency: (n: number) => `${n} FCFA`,
    getGradeDisplay: (g: string | undefined) => g ?? '',
    generatePaymentReceiptPdf: async () => {},
    currentUser: { name: 'Admin', role: 'admin' },
    copyToClipboard: () => {},
    handleSaveNote: async () => {},
    studentDetailTab: 'general' as const,
    setStudentDetailTab: () => {},
    selectedYear: '2026-2027',
    overlayRef: () => {},
    onClose: () => {},
    onEdit: () => {},
    onPrint: () => {},
    onDeleteRequest: () => {},
    canDelete: true,
    canDeletePayment: true,
    onDeletePayment: async () => true,
    duplicateGroupSize,
  };
  try {
    act(() => root.render(createElement(StudentDetailsModal, props)));
    return container.textContent ?? '';
  } finally {
    act(() => root.unmount());
    container.remove();
  }
}

describe('la fiche ouverte dit ce que le registre montre', () => {
  it('avertit quand le nom et la classe sont partagés, et donne le nombre de fiches', () => {
    const text = renderDetails(2);
    assert.ok(
      text.includes(t.duplicateStudentWarning.replace('{n}', '2')),
      'l’avertissement nomme le nombre de fiches du groupe',
    );
  });

  it('reste muette quand la fiche est seule', () => {
    const alone = renderDetails(1);
    assert.ok(!alone.includes(t.duplicateStudentBadge));
    assert.ok(!alone.includes(t.duplicateStudentWarning.replace('{n}', '1')), 'une fiche seule n’est pas un doublon');
    const unknown = renderDetails(undefined);
    assert.ok(!unknown.includes(t.duplicateStudentWarning.replace('{n}', '1')), 'sans registre sous la main, pas de signal inventé');
  });
});

// ─── Garde-fou : la pastille n'existe qu'avec le vocabulaire partagé ─────────
describe('le vocabulaire du signal est traduit dans les deux langues', () => {
  it('porte les mêmes clés en / fr', () => {
    for (const key of ['duplicateStudentBadge', 'duplicateStudentLegend', 'duplicateStudentWarning'] as const) {
      assert.ok(translations.en[key], `${key} existe en anglais`);
      assert.ok(translations.fr[key], `${key} existe en français`);
      assert.equal(translations.en[key].includes('{n}'), translations.fr[key].includes('{n}'), `${key} : le jeton {n} est des deux côtés`);
    }
  });

  it('la vue a bien reçu l’annuaire complet par le contrat', () => {
    // `students` (annuaire) ET `filteredStudents` (liste de l'onglet) sont deux
    // props distinctes : le signal lit la première. Ce cas échoue si le contrat
    // cesse de fournir l'annuaire à la vue.
    const props = makeProps({ students: register, filteredStudents: [] });
    assert.equal(props.students.length, register.length);
  });
});
