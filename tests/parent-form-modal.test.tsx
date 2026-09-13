/**
 * happy-dom render tests for ParentFormModal — the parent/guardian form.
 *
 * L'objet de ces cas est une frontière, pas un rendu : l'ADRESSE était le seul
 * champ facultatif du formulaire qui portait l'astérisque ET l'attribut
 * `required` du navigateur — donc un enregistrement sans adresse était refusé
 * avant même d'atteindre `handleParentSubmit` (qui, lui, tolère déjà le vide et
 * écrit « N/A »). Le second cas existe pour que le retrait reste CIBLÉ : le nom
 * et le téléphone principal doivent rester obligatoires, sinon « enlever une
 * obligation » deviendrait « n'en garder aucune » au prochain passage.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { translations } from '../src/i18n/translations';
import type { TranslationDict } from '../src/i18n/translations';
import type { CurrentTheme, ParentForm } from '../src/app/mainViewsProps';
import { ParentFormModal } from '../src/components/ParentFormModal';
import { installDomGlobals } from './harness';

const t = translations.fr as TranslationDict;

const win = installDomGlobals();
// ModalShell animates with motion — happy-dom's WAAPI ticker never advances,
// so animations must resolve instantly (same stub as staff-form-modal.test).
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

const emptyParentForm: ParentForm = {
  fullName: '',
  primaryPhone: '',
  secondaryPhone: '',
  email: '',
  address: '',
  occupation: '',
  relationship: 'Father',
  notes: '',
  linkedStudentIds: [],
};

/** Le champ repéré par son PLACEHOLDER (traduit) — jamais par son rang. */
function fieldByPlaceholder(container: HTMLElement, placeholder: string): HTMLInputElement {
  const input = Array.from(container.querySelectorAll('input')).find(
    (el) => (el.placeholder ?? '') === placeholder,
  );
  assert.ok(input, `champ « ${placeholder} » rendu`);
  return input;
}

/** Le libellé du `<div>` qui porte ce champ — c'est là que vit l'astérisque. */
function labelOf(input: HTMLInputElement): string {
  return input.parentElement?.querySelector('label')?.textContent ?? '';
}

function mount(): { container: HTMLElement; root: ReturnType<typeof createRoot> } {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(
      createElement(ParentFormModal, {
        t,
        lang: 'fr',
        currentTheme: theme,
        editingParent: null,
        students: [],
        availableClasses: [],
        parentForm: emptyParentForm,
        setParentForm: () => {},
        handleParentSubmit: async (e) => e.preventDefault(),
        formatCurrency: (amount: number) => String(amount),
        overlayRef: () => {},
        onClose: () => {},
        onOpenStudentForm: () => {},
        onRecordPayment: () => {},
        onViewStudent: () => {},
      }),
    );
  });
  return { container, root };
}

describe('ParentFormModal — l’adresse n’est plus obligatoire', () => {
  it('le champ adresse n’est pas `required` et ne porte plus d’astérisque', () => {
    const { container, root } = mount();
    const address = fieldByPlaceholder(container, t.eGQuartierHippodromeBamako);
    assert.equal(address.required, false, 'aucun blocage navigateur sur l’adresse');
    assert.ok(
      !labelOf(address).includes('*'),
      `le libellé ne doit plus annoncer une obligation : « ${labelOf(address)} »`,
    );
    root.unmount();
    document.body.removeChild(container);
  });

  it('le retrait reste ciblé : nom et téléphone principal restent obligatoires', () => {
    const { container, root } = mount();
    assert.equal(fieldByPlaceholder(container, t.eGMamadouTraor).required, true);
    assert.equal(fieldByPlaceholder(container, '+223 70 00 00 00').required, true);
    root.unmount();
    document.body.removeChild(container);
  });
});
