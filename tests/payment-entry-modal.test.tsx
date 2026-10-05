import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { act, createElement, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { PaymentEntryModal } from '../src/components/PaymentEntryModal';
import { translations } from '../src/i18n/translations';
import type { Student } from '../src/lib/useSupabaseData';
import { installDomGlobals } from './harness';
import { makeProps } from './views-harness';

const students: Student[] = [
  { id: 'a', name: 'Awa', grade: ' 1a ', studentId: 'MAT-001', totalDue: 100000, amountPaid: 10000, scholarshipDiscount: 10, parentName: '', parentEmail: '', parentPhone: '', dueDate: '', payments: [], notes: '' },
  { id: 'b', name: 'Binta', grade: '2A', studentId: '2026-0002', totalDue: 100000, amountPaid: 0, parentName: '', parentEmail: '', parentPhone: '', dueDate: '', payments: [], notes: '' },
  { id: 'c', name: 'Coumba', grade: 'OLD', totalDue: 100000, amountPaid: 0, parentName: '', parentEmail: '', parentPhone: '', dueDate: '', payments: [], notes: '' },
  { id: 'd', name: 'Djeneba', totalDue: 100000, amountPaid: 0, parentName: '', parentEmail: '', parentPhone: '', dueDate: '', payments: [], notes: '' },
];

function mount(lang: 'en' | 'fr' = 'fr', initialStudent = '') {
  installDomGlobals();
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  const submissions: string[] = [];
  const defaults = makeProps();
  function Host() {
    const [paymentStudentId, setPaymentStudentId] = useState(initialStudent);
    const [paymentAmount, setPaymentAmount] = useState('5000');
    const [paymentDate, setPaymentDate] = useState('2026-10-04');
    return createElement(PaymentEntryModal, {
      t: translations[lang], lang, currentTheme: defaults.currentTheme,
      students, availableClasses: [
        { id: '1A', nameEn: 'First A', nameFr: 'Première A' },
        { id: '2A', nameEn: 'Second A', nameFr: 'Deuxième A' },
        { id: 'EMPTY', nameEn: 'Empty', nameFr: 'Vide' },
      ],
      getGradeDisplay: (grade) => `Classe ${grade}`,
      paymentStudentId, setPaymentStudentId, paymentAmount, setPaymentAmount,
      paymentDate, setPaymentDate, formatCurrency: (amount) => `${amount} XOF`,
      handlePaymentSubmit: async (e) => { e.preventDefault(); submissions.push(paymentStudentId); },
      overlayRef: () => {}, onClose: () => {},
    });
  }
  const render = () => act(() => root.render(createElement(Host)));
  render();
  const select = (id: string) => {
    const el = container.querySelector<HTMLSelectElement>(`#${id}`);
    assert.ok(el);
    return el;
  };
  const change = (id: string, value: string) => act(() => {
    const el = select(id);
    el.value = value;
    el.dispatchEvent(new Event('change', { bubbles: true }));
  });
  return {
    container, select, change, submissions,
    reopen: () => { act(() => root.render(null)); render(); },
    cleanup: () => { act(() => root.unmount()); container.remove(); },
  };
}

const values = (select: HTMLSelectElement) => Array.from(select.options, (o) => o.value);

describe('PaymentEntryModal — filtre classe', () => {
  for (const lang of ['fr', 'en'] as const) {
    it(`propose les classes présentes et leurs libellés ${lang}, y compris une classe retirée`, () => {
      const h = mount(lang);
      try {
        assert.deepEqual(values(h.select('payment-class-filter')), ['all', '1A', '2A', 'old']);
        assert.equal(h.select('payment-class-filter').options[1].textContent, lang === 'fr' ? 'Première A' : 'First A');
        assert.deepEqual(values(h.select('payment-student')), ['', 'a', 'b', 'c', 'd']);
        assert.ok(h.select('payment-student').options[1].textContent?.includes('80000 XOF'));
        assert.ok(h.container.querySelector('label[for="payment-class-filter"]'));
        assert.ok(h.container.querySelector('label[for="payment-student"]'));
      } finally { h.cleanup(); }
    });
  }

  it('filtre sans tenir compte de la casse ni des espaces et restaure tous les élèves', () => {
    const h = mount();
    try {
      h.change('payment-class-filter', '1A');
      assert.deepEqual(values(h.select('payment-student')), ['', 'a']);
      h.change('payment-class-filter', 'old');
      assert.deepEqual(values(h.select('payment-student')), ['', 'c']);
      h.change('payment-class-filter', 'all');
      assert.deepEqual(values(h.select('payment-student')), ['', 'a', 'b', 'c', 'd']);
    } finally { h.cleanup(); }
  });

  it('préserve une présélection visible mais efface un élève hors classe sans changer le montant', () => {
    const h = mount('fr', 'a');
    try {
      assert.equal(h.select('payment-student').value, 'a');
      h.change('payment-class-filter', '1A');
      assert.equal(h.select('payment-student').value, 'a');
      h.change('payment-class-filter', '2A');
      assert.equal(h.select('payment-student').value, '');
      assert.equal(h.select('payment-student').validity.valueMissing, true);
      assert.equal(h.container.querySelector<HTMLInputElement>('input[type="number"]')?.value, '5000');
      h.change('payment-student', 'b');
      act(() => h.container.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
      assert.deepEqual(h.submissions, ['b']);
      h.reopen();
      assert.equal(h.select('payment-class-filter').value, 'all');
      assert.equal(h.select('payment-student').value, 'a');
    } finally { h.cleanup(); }
  });
});

describe('PaymentEntryModal — champ de recherche par nom ou matricule', () => {
  // La frappe ne peut pas être simulée ici : React lit `onChange` via son
  // value-tracker, que le harnais happy-dom ne fait jamais changer pour un
  // `<input>` contrôlé. Le COMPORTEMENT de recherche est donc verrouillé à la
  // source pure (tests/payment-student-filter.test.ts) ; ce qui suit vérifie le
  // câblage DOM : le champ existe, est étiqueté, et porte le bon placeholder.
  for (const lang of ['fr', 'en'] as const) {
    it(`rend un champ de recherche étiqueté et combinable au filtre de classe (${lang})`, () => {
      const h = mount(lang);
      try {
        const search = h.container.querySelector<HTMLInputElement>('#payment-student-search');
        assert.ok(search, 'champ de recherche absent');
        assert.equal(search.dataset.slot, 'payment-student-search');
        assert.equal(search.getAttribute('placeholder'), translations[lang].searchStudents);
        assert.ok(h.container.querySelector('label[for="payment-student-search"]'), 'le champ doit être étiqueté');
        // Le filtre de classe reste opérationnel à côté du champ.
        assert.ok(h.container.querySelector('#payment-class-filter'));
      } finally { h.cleanup(); }
    });
  }
});
