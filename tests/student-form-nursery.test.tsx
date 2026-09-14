/**
 * « Ajouter CR » n'ajoute pas un second formulaire : c'est le MÊME, ouvert sur
 * une seule famille de classes (Petit / Moyen / Grand). Ces cas mesurent cette
 * frontière sur le rendu réel, parce que « même formulaire » est justement ce
 * qui ne se voit pas dans un diff :
 *
 *   1. en mode CR, seules les trois classes CR sont proposées — ni 1A/6B, ni
 *      « + Ajouter une autre classe » ;
 *   2. en mode ordinaire, les classes CR RESTENT proposées : sinon un élève CR
 *      ne pourrait plus être relu ni corrigé (sa classe courante serait un
 *      choix qui n'existe pas dans la liste) ;
 *   3. le reste du formulaire est bien le même : parent, montant, échéance et
 *      soumission sont rendus dans le mode CR (c'est ce qui fait que le parent,
 *      le reçu et la fiche sont identiques) ;
 *   4. éditer un élève CR ouvre le formulaire ORDINAIRE avec sa classe déjà
 *      sélectionnée.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { translations } from '../src/i18n/translations';
import type { TranslationDict } from '../src/i18n/translations';
import type { CurrentTheme, ManagedClass } from '../src/app/mainViewsProps';
import { DEFAULT_SCHOOL_CLASSES } from '../src/app/types';
import { YearContext } from '../src/app/yearContext';
import { StudentFormModal } from '../src/components/StudentFormModal';
import type { StudentForm } from '../src/components/StudentFormModal';
import type { Student } from '../src/lib/useSupabaseData';
import { installDomGlobals } from './harness';

const t = translations.fr as TranslationDict;
const win = installDomGlobals();
// ModalShell animates with motion — happy-dom's WAAPI ticker never advances, so
// animations must resolve instantly (same stub as parent-form-modal.test).
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

const theme: CurrentTheme = {
  bg: 'bg-slate-100',
  card: 'bg-white',
  input: 'bg-white',
  text: 'text-slate-800',
  muted: 'text-slate-500',
  border: 'border-slate-200',
  header: 'bg-slate-800',
  sidebar: 'bg-slate-900',
  accent: 'text-blue-600',
  accentBg: 'bg-blue-600',
  accentText: 'text-white',
  accentHover: 'hover:bg-blue-700',
  accentShadow: 'shadow-blue-500/20',
  tableHeader: 'bg-slate-50',
  isDark: false,
  rowHover: 'hover:bg-slate-50',
};

const nurseryForm = (overrides: Partial<StudentForm> = {}): StudentForm => ({
  name: 'Enfant CR',
  parentName: 'Parent CR',
  parentEmail: '',
  parentPhone: '+223 70 00 00 00',
  totalDue: '90000',
  scholarshipDiscount: '0',
  dueDate: '2026-12-31',
  academicYear: '2026-2027',
  grade: '',
  studentId: '',
  photo: '',
  emergencyContactName: '',
  emergencyContactRelation: '',
  emergencyContactPhone: '',
  medicalNotes: 'None',
  enrollmentDate: '2026-09-01',
  previousSchool: '',
  status: 'Active',
  classScope: 'all',
  ...overrides,
});

const crStudent = (): Student => ({
  id: 'ST-CR',
  name: 'Enfant CR',
  parentName: 'Parent CR',
  parentEmail: '',
  parentPhone: '+223 70 00 00 00',
  totalDue: 90000,
  amountPaid: 0,
  dueDate: '2026-12-31',
  payments: [],
  notes: '',
  grade: 'CR-PETIT',
});

function mount(
  studentForm: StudentForm,
  editingStudent: Student | null = null,
): { container: HTMLElement; root: ReturnType<typeof createRoot> } {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(
      createElement(
        YearContext.Provider,
        {
          value: {
            selectedYear: '2026-2027',
            setSelectedYear: () => {},
            lockedYears: [],
            setLockedYears: () => {},
          },
        },
        createElement(StudentFormModal, {
          t,
          lang: 'fr',
          open: true,
          editingStudent,
          studentForm,
          setStudentForm: () => {},
          handleStudentSubmit: async (e) => e.preventDefault(),
          onClose: () => {},
          onOpenAddClass: () => {},
          onDeleteRequest: () => {},
          canDelete: false,
          availableClasses: DEFAULT_SCHOOL_CLASSES as ManagedClass[],
          academicYears: ['2026-2027'],
          isPromoter: true,
          isGeneralManager: false,
          currentTheme: theme,
        }),
      ),
    );
  });
  return { container, root };
}

function unmount(container: HTMLElement, root: ReturnType<typeof createRoot>) {
  act(() => root.unmount());
  document.body.removeChild(container);
}

/** Le select de classe — le seul `required` du formulaire. */
function classSelect(container: HTMLElement): HTMLSelectElement {
  const select = container.querySelector('select[required]');
  assert.ok(select, 'le select de classe est rendu');
  return select as HTMLSelectElement;
}

const optionValues = (select: HTMLSelectElement): string[] =>
  Array.from(select.querySelectorAll('option')).map((o) => o.value);

const titleOf = (container: HTMLElement): string =>
  container.querySelector('#modal-title-student-form')?.textContent ?? '';

const hasField = (container: HTMLElement, placeholder: string): boolean =>
  Array.from(container.querySelectorAll('input, textarea')).some(
    (el) => (el as HTMLInputElement).placeholder === placeholder,
  );

describe('StudentFormModal — « Ajouter CR » = le même formulaire, classes CR seules', () => {
  it('mode CR : seules Petit / Moyen / Grand sont proposées', () => {
    const { container, root } = mount(nurseryForm({ classScope: 'nursery' }));
    const values = optionValues(classSelect(container));
    assert.deepEqual(values, ['', 'CR-PETIT', 'CR-MOYEN', 'CR-GRAND'], `options rendues : ${values.join(', ')}`);
    assert.ok(!values.includes('1A'), 'aucune classe du 1er cycle');
    assert.ok(!values.includes('__ADD_NEW_CLASS__'), 'pas de « + Ajouter une autre classe » en mode CR');
    assert.equal(titleOf(container), t.addCrStudent, 'le titre dit quel flux est ouvert');
    unmount(container, root);
  });

  it('mode ordinaire : les classes CR restent sélectionnables (et groupées)', () => {
    const { container, root } = mount(nurseryForm());
    const values = optionValues(classSelect(container));
    assert.ok(values.includes('1A'), 'les classes historiques restent là');
    assert.ok(values.includes('CR-PETIT'), 'un élève CR reste relisible/corrigeable');
    assert.ok(values.includes('__ADD_NEW_CLASS__'), 'le raccourci de création reste disponible');
    assert.equal(titleOf(container), t.addStudent);
    const crGroup = Array.from(classSelect(container).querySelectorAll('optgroup')).find(
      (g) => g.label === t.crClasses,
    );
    assert.ok(crGroup, 'les classes CR ont leur propre groupe');
    assert.deepEqual(
      Array.from(crGroup!.querySelectorAll('option')).map((o) => o.value),
      ['CR-PETIT', 'CR-MOYEN', 'CR-GRAND'],
    );
    unmount(container, root);
  });

  it('mode CR : parent, montant et échéance sont ceux du formulaire ordinaire', () => {
    const { container, root } = mount(nurseryForm({ classScope: 'nursery' }));
    assert.ok(hasField(container, 'Djeneba'), 'le parent est là (donc le lien parent aussi)');
    assert.ok(hasField(container, '120000'), 'les frais sont là (donc le reçu aussi)');
    const submit = Array.from(container.querySelectorAll('button[type="submit"]'));
    assert.equal(submit.length, 1, 'un seul bouton d’enregistrement');
    assert.equal(submit[0]?.textContent, t.submit);
    // Le matricule est réservé aux 9e : une classe CR ne le fait pas apparaître.
    assert.ok(!hasField(container, 'MT-2026-001 (Optional)'), 'pas de matricule pour une classe CR');
    unmount(container, root);
  });

  it('éditer un élève CR ouvre le formulaire ordinaire, sa classe déjà choisie', () => {
    const { container, root } = mount(nurseryForm({ grade: 'CR-PETIT' }), crStudent());
    const select = classSelect(container);
    assert.equal(select.value, 'CR-PETIT', 'la classe actuelle est affichée');
    assert.equal(titleOf(container), t.editStudent);
    assert.ok(optionValues(select).includes('1A'), 'édition : toutes les classes restent proposées');
    unmount(container, root);
  });
});
