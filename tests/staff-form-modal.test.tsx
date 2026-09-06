/**
 * happy-dom render tests for StaffFormModal — the shared staff form.
 *
 * Employee mode renders the position as a free-text input; admin mode
 * ("Ajouter un Membre de l'Administration") renders a curated position
 * dropdown (ADMIN_POSITIONS) and retitles the dialog. The select writes into
 * staffForm.position through the same setStaffForm channel as the input.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import { translations } from '../src/i18n/translations';
import type { TranslationDict } from '../src/i18n/translations';
import { ADMIN_POSITIONS, isAdminPosition } from '../src/lib/adminPositions';
import type { CurrentTheme, StaffForm } from '../src/app/mainViewsProps';
import { StaffFormModal } from '../src/components/StaffFormModal';
import { installDomGlobals } from './harness';

const t = translations.fr as TranslationDict;

const win = installDomGlobals();
// ModalShell animates with motion — happy-dom's WAAPI ticker never advances,
// so animations must resolve instantly (same stub as floating-chat.test).
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
  accentHover: 'hover:bg-blue-700',
  accentShadow: 'shadow-blue-500/20',
  tableHeader: 'bg-slate-50',
  isDark: false,
  rowHover: 'hover:bg-slate-50',
};

const emptyForm: StaffForm = {
  name: '',
  position: '',
  salary: '',
  email: '',
  phone: '',
  bankDetails: '',
  emergencyContact: '',
};

interface Harness {
  root: Root;
  container: HTMLElement;
  setStaffFormCalls: StaffForm[];
}

function mount(props: Partial<Parameters<typeof StaffFormModal>[0]>): Harness {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  const setStaffFormCalls: StaffForm[] = [];
  act(() => {
    root.render(
      createElement(StaffFormModal, {
        t,
        currentTheme: theme,
        editingStaff: null,
        staffForm: emptyForm,
        setStaffForm: (updater) => {
          const next = typeof updater === 'function' ? updater(emptyForm) : updater;
          setStaffFormCalls.push(next);
        },
        handleStaffSubmit: async (e) => e.preventDefault(),
        overlayRef: () => {},
        onClose: () => {},
        ...props,
      }),
    );
  });
  return { root, container, setStaffFormCalls };
}

describe('StaffFormModal', () => {
  it('mode employé : poste en champ libre, titre « Ajouter un Employé »', () => {
    const { root, container } = mount({});
    const title = container.querySelector('#modal-title-staff-form');
    assert.ok(title, 'dialog title present');
    assert.equal(title?.textContent, t.addStaff);
    const input = container.querySelector<HTMLInputElement>('input[type="text"]');
    assert.ok(input, 'free-text position input rendered');
    assert.ok(!container.querySelector('select'), 'no select in employee mode');
    root.unmount();
    document.body.removeChild(container);
  });

  it("mode administration : liste déroulante des postes, titre « Ajouter un Membre de l'Administration »", () => {
    const { root, container, setStaffFormCalls } = mount({
      adminMode: true,
      positionOptions: ADMIN_POSITIONS.fr,
    });
    const title = container.querySelector('#modal-title-staff-form');
    assert.equal(title?.textContent, t.addAdminMember);
    const select = container.querySelector<HTMLSelectElement>('select');
    assert.ok(select, 'position select rendered in admin mode');
    const options = Array.from(select?.querySelectorAll('option') ?? []);
    // 8 positions + 1 placeholder disabled
    assert.equal(options.length, ADMIN_POSITIONS.fr.length + 1);
    for (const position of ADMIN_POSITIONS.fr) {
      assert.ok(
        options.some((o) => o.value === position && o.textContent === position),
        `option manquante : ${position}`,
      );
    }
    assert.equal(select?.value, '', 'placeholder selected initially');

    // Selection writes through the same setStaffForm channel.
    const expected = 'Proviseur';
    act(() => {
      select!.value = expected;
      select!.dispatchEvent(new win.Event('change', { bubbles: true }) as unknown as Event);
    });
    assert.equal(setStaffFormCalls.at(-1)?.position, expected, 'position propagated to staffForm');
    root.unmount();
    document.body.removeChild(container);
  });

  it('édition : titre « Modifier » même en mode administration (champ libre conservé)', () => {
    const { root, container } = mount({
      adminMode: true,
      positionOptions: ADMIN_POSITIONS.fr,
      editingStaff: {
        id: 's1',
        name: 'Madi',
        position: 'Professeur',
        salary: 150000,
        email: '',
        phone: '',
        bankDetails: '',
        emergencyContact: '',
      },
    });
    const title = container.querySelector('#modal-title-staff-form');
    assert.equal(title?.textContent, t.editStaff);
    root.unmount();
    document.body.removeChild(container);
  });

  it('édition d\'un membre admin : petit bouclier violet à côté du titre et du libellé POSTE', () => {
    const { root, container } = mount({
      editingStaff: {
        id: 's2',
        name: 'Awa',
        position: 'Proviseur',
        salary: 250000,
        email: '',
        phone: '',
        bankDetails: '',
        emergencyContact: '',
      },
    });
    const title = container.querySelector('#modal-title-staff-form');
    assert.equal(title?.textContent, t.editStaff, 'titre d\'édition conservé');
    const shields = container.querySelectorAll('svg.lucide-shield-check');
    // shield dans le titre + shield à côté du libellé POSTE
    assert.ok(shields.length >= 2, `attendu ≥ 2 boucliers violet, trouvé ${shields.length}`);
    root.unmount();
    document.body.removeChild(container);
  });

  it('édition d\'un poste non listé : aucun bouclier violet', () => {
    const { root, container } = mount({
      editingStaff: {
        id: 's3',
        name: 'Fatou',
        position: 'Enseignante',
        salary: 80000,
        email: '',
        phone: '',
        bankDetails: '',
        emergencyContact: '',
      },
    });
    const shields = container.querySelectorAll('svg.lucide-shield-check');
    assert.equal(shields.length, 0, 'aucun bouclier pour un poste non admin');
    root.unmount();
    document.body.removeChild(container);
  });
});

describe('isAdminPosition', () => {
  it('reconnaît les postes des deux langues, insensible à la casse', () => {
    assert.equal(isAdminPosition('Proviseur'), true);
    assert.equal(isAdminPosition('proviseur'), true);
    assert.equal(isAdminPosition('Directeur des Études'), true);
    assert.equal(isAdminPosition('Principal'), true);
    assert.equal(isAdminPosition('Bursar'), true);
  });  it('rejette les postes non listés et les valeurs vides', () => {
    assert.equal(isAdminPosition('Enseignante'), false);
    assert.equal(isAdminPosition('Professeur'), false);
    assert.equal(isAdminPosition(''), false);
    assert.equal(isAdminPosition(null), false);
    assert.equal(isAdminPosition(undefined), false);
  });
});
