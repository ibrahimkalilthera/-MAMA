/**
 * LinkStudentModal — le RATTACHEMENT d'un enfant à un parent doit se chercher.
 *
 * Avant : la liste déroulante portait tous les élèves de l'école, dans une liste
 * plate. Dans un établissement de plusieurs centaines de pensionnaires, retrouver
 * l'enfant du parent ouvert demandait de la dérouler en entier — c'est ce que le
 * propriétaire a demandé de corriger, avec une recherche par matricule.
 *
 * Ce que cette suite VERROUILLE, et ce qu'elle ne peut pas :
 *   • la RÈGLE de recherche (nom OU matricule, casse ignorée) est prouvée à la
 *     source pure, dans tests/student-search.test.ts — la frappe ne peut pas être
 *     simulée ici (React lit `onChange` via un value-tracker que le harnais
 *     happy-dom ne fait jamais bouger pour un `<input>` contrôlé) ;
 *   • cette suite prouve donc le CÂBLAGE : le champ existe, il est étiqueté, il
 *     porte le placeholder du dictionnaire, il précède la liste qu'il réduit, le
 *     matricule est VISIBLE sur chaque ligne, la sélection part bien au
 *     rattachement, et les deux états vides (aucun élève dans l'école / aucun
 *     élève dans la liste affichée) ne disent pas la même chose.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { act, createElement, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { LinkStudentModal } from '../src/components/LinkStudentModal';
import { translations } from '../src/i18n/translations';
import type { Parent, Student } from '../src/lib/domainTypes';
import { installDomGlobals } from './harness';
import { makeProps } from './views-harness';

const parent: Parent = {
  id: 'p1',
  fullName: 'Djeneba Traoré',
  phones: ['+223 70 00 00 00'],
  address: 'Bamako',
  occupation: 'Commerçante',
  relationship: 'Mother',
};

const student = (id: string, name: string, grade: string, studentId?: string): Student => ({
  id, name, grade, studentId,
  parentName: '', parentEmail: '', parentPhone: '',
  totalDue: 0, amountPaid: 0, dueDate: '', payments: [], notes: '',
});

const students: Student[] = [
  student('a', 'Awa', '1A', 'MT-2026-001'),
  student('b', 'Binta', '2A', 'MT-2026-002'),
  student('c', 'Coumba', '3A'),
];

function mount(options: { lang?: 'en' | 'fr'; students?: Student[] } = {}) {
  installDomGlobals();
  const lang = options.lang ?? 'fr';
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  const submissions: string[] = [];
  const defaults = makeProps();
  function Host() {
    const [studentToLinkId, setStudentToLinkId] = useState('');
    return createElement(LinkStudentModal, {
      t: translations[lang],
      currentTheme: defaults.currentTheme,
      activeLinkingParent: parent,
      students: options.students ?? students,
      studentToLinkId,
      setStudentToLinkId,
      handleLinkStudentSubmit: async (e) => { e.preventDefault(); submissions.push(studentToLinkId); },
      overlayRef: () => {},
      onClose: () => {},
    });
  }
  act(() => root.render(createElement(Host)));
  const select = () => {
    const el = container.querySelector<HTMLSelectElement>('select');
    assert.ok(el, 'la liste déroulante des élèves est absente');
    return el;
  };
  const submitButton = () => container.querySelector<HTMLButtonElement>('button[type="submit"]');
  return {
    container,
    select,
    submitButton,
    submissions,
    setSelection: (value: string) => act(() => {
      const el = select();
      el.value = value;
      el.dispatchEvent(new Event('change', { bubbles: true }));
    }),
    submit: () => act(() => container.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))),
    cleanup: () => { act(() => root.unmount()); container.remove(); },
  };
}

const optionTexts = (select: HTMLSelectElement) => Array.from(select.options, (o) => o.textContent ?? '');

describe('LinkStudentModal — recherche par nom ou matricule', () => {
  for (const lang of ['fr', 'en'] as const) {
    it(`rend un champ de recherche étiqueté, placé avant la liste qu’il réduit (${lang})`, () => {
      const h = mount({ lang });
      try {
        const search = h.container.querySelector<HTMLInputElement>('#link-student-search');
        assert.ok(search, 'champ de recherche absent');
        assert.equal(search.dataset.slot, 'link-student-search');
        assert.equal(search.getAttribute('placeholder'), translations[lang].searchNameOrId);
        assert.equal(search.getAttribute('aria-label'), translations[lang].searchNameOrId);
        // Le champ précède la liste : on tape avant de choisir.
        const fields = Array.from(h.container.querySelectorAll('input, select'), (el) => el.tagName.toLowerCase());
        assert.deepEqual(fields, ['input', 'select']);
      } finally { h.cleanup(); }
    });
  }

  it('ne montre le bouton d’effacement que lorsqu’il y a quelque chose à effacer', () => {
    const h = mount();
    try {
      assert.equal(h.container.querySelectorAll('button[aria-label]').length, 0);
    } finally { h.cleanup(); }
  });

  it('porte le matricule sur chaque ligne, et n’en invente pas pour un élève qui n’en a pas', () => {
    const h = mount();
    try {
      const texts = optionTexts(h.select());
      assert.equal(texts.length, 4); // « — sélectionner — » + trois élèves
      assert.ok(texts[1].includes(translations.fr.studentId), `libellé de matricule absent de « ${texts[1]} »`);
      assert.ok(texts[1].includes('MT-2026-001'), `matricule absent de « ${texts[1]} »`);
      assert.ok(texts[2].includes('MT-2026-002'), `matricule absent de « ${texts[2]} »`);
      assert.ok(texts[3].includes('Coumba'));
      assert.equal(texts[3].includes(translations.fr.studentId), false, 'aucun matricule affiché pour un élève qui n’en a pas');
      assert.ok(texts[1].includes('1A'), 'la classe de l’élève accompagne la ligne');
    } finally { h.cleanup(); }
  });

  it('n’active le rattachement qu’avec un élève choisi, et rattache celui-là', () => {
    const h = mount();
    try {
      assert.equal(h.submitButton()?.disabled, true, 'aucun rattachement ne part sans élève choisi');
      h.setSelection('b');
      assert.equal(h.submitButton()?.disabled, false);
      h.submit();
      assert.deepEqual(h.submissions, ['b']);
    } finally { h.cleanup(); }
  });

  it('dit « aucun élève dans l’école » seulement quand l’école est vide', () => {
    const empty = mount({ students: [] });
    try {
      assert.equal(optionTexts(empty.select()).length, 1);
      assert.ok(empty.container.textContent?.includes(translations.fr.noStudentsInSystem));
      assert.equal(empty.container.textContent?.includes(translations.fr.noStudentsFound), false);
    } finally { empty.cleanup(); }

    // Une liste peuplée n'affirme jamais que l'école est vide : les deux phrases
    // ne veulent pas dire la même chose, donc elles ne s'affichent pas ensemble.
    const populated = mount();
    try {
      const text = populated.container.textContent ?? '';
      assert.equal(text.includes(translations.fr.noStudentsInSystem), false);
      assert.equal(text.includes(translations.fr.noStudentsFound), false);
    } finally { populated.cleanup(); }
  });
});
