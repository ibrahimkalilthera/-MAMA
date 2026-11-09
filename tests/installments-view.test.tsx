// L'ÉCRAN DES VERSEMENTS PARTIELS, tel qu'il se lit et tel qu'il s'ouvre.
//
// L'agrégat est jugé à part (`tests/outstanding-installments.test.ts`) : ici on
// mesure ce que l'écran en FAIT. Trois choses seulement, chacune cassable en
// silence :
//
//   • **par élève ET par mois** — une ligne par famille qui doit, une ligne par
//     mois entamé et non soldé, avec le reste de CE mois (`installments-month`,
//     `data-month`) : c'est la demande, et un total global seul ne la tient pas ;
//   • **le total affiché suit ce qui est affiché** — la pastille lit le rapport
//     restreint, pas le rapport complet ;
//   • **le clic OUVRE la fiche** (`setSelectedStudent`) au lieu d'encaisser :
//     relancer n'est pas écrire un reçu pour de l'argent absent.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { InstallmentsView } from '../src/components/InstallmentsView';
import { MainViews } from '../src/components/MainViews';
import { MainViewsContext } from '../src/app/mainViewsContext';
import type { MainViewsProps } from '../src/app/mainViewsProps';
import { translations } from '../src/i18n/translations';
import type { Payment, Student } from '../src/lib/domainTypes';
import { installDomGlobals } from './harness';
import { makeProps } from './views-harness';

const t = translations.en;

// Frais annuels 120 000 → 10 000 par mois, sans bourse.
const student = (id: string, name: string, grade: string, payments: Payment[]): Student => ({
  id,
  name,
  parentName: `Parent ${name}`,
  parentEmail: '',
  parentPhone: '',
  totalDue: 120000,
  amountPaid: payments.reduce((sum, p) => sum + p.amount, 0),
  dueDate: '2027-06-30',
  notes: '',
  payments,
  grade,
  academicYear: '2026-2027',
});

const STUDENTS: Student[] = [
  student('st-awa', 'Awa Traoré', '3A', [
    { id: 'p-a1', date: '2026-10-01', amount: 4000, dueAmount: 10000, months: ['2026-09'] },
    { id: 'p-a2', date: '2026-10-08', amount: 3000, dueAmount: 6000, months: ['2026-09'] },
  ]),
  student('st-ali', 'Ali Diallo', '1A', [
    { id: 'p-b1', date: '2026-10-03', amount: 9000, dueAmount: 10000, months: ['2026-10'] },
    // Un versement partiel sans mois : il pèse sur la caisse, pas sur un mois. Il
    // doit être DIT, jamais replié dans un total.
    { id: 'p-c1', date: '2026-10-04', amount: 2500, dueAmount: 10000 },
  ]),
];

const CLEAN: Student[] = [
  student('st-ok', 'Fanta Keïta', '2A', [
    { id: 'p-ok', date: '2026-09-10', amount: 10000, dueAmount: 10000, months: ['2026-09'] },
  ]),
];

function mount(students: Student[], overrides: Partial<MainViewsProps> = {}) {
  installDomGlobals();
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  const selected: (Student | null)[] = [];

  const props = makeProps({
    students,
    setSelectedStudent: (value) => {
      selected.push(typeof value === 'function' ? value(null) : value);
    },
    ...overrides,
  });

  act(() => {
    root.render(createElement(MainViewsContext.Provider, { value: props }, createElement(InstallmentsView)));
  });

  const slot = (name: string) => container.querySelector(`[data-slot="${name}"]`);
  const rows = () => Array.from(container.querySelectorAll('[data-slot="installments-row"]'));

  return {
    selected,
    click: (el: Element) => act(() => { (el as HTMLElement).click(); }),
    screen: () => slot('installments'),
    rows,
    total: () => (slot('installments-total')?.textContent ?? '').trim(),
    empty: () => slot('installments-empty'),
    undeclared: () => (slot('installments-undeclared')?.textContent ?? '').trim(),
    /** Les couples (élève, mois) tels que l'écran les affiche. */
    months: () => rows().flatMap((row) => Array.from(row.querySelectorAll('[data-slot="installments-month"]')).map((month) => ({
      student: row.getAttribute('data-student') ?? '',
      month: month.getAttribute('data-month') ?? '',
      text: (month.textContent ?? '').trim(),
    }))),
    text: () => container.textContent ?? '',
    cleanup: () => { act(() => root.unmount()); container.remove(); },
  };
}

describe('InstallmentsView — le reste dû, par élève et par mois', () => {
  it('liste chaque élève avec le reste de CHAQUE mois entamé', () => {
    const view = mount(STUDENTS);
    try {
      assert.ok(view.screen(), 'la racine de l’écran est montée');
      // L'ordre est celui de la relance : le nom, pas l'ordre de chargement.
      assert.deepEqual(view.rows().map((el) => el.getAttribute('data-student')), ['st-ali', 'st-awa']);

      // Le même mois entamé deux fois ne produit qu'UNE ligne, avec la somme.
      assert.deepEqual(view.months().map(({ student, month }) => [student, month]), [
        ['st-ali', '2026-10'],
        ['st-awa', '2026-09'],
      ]);
      const awa = view.months()[1]!;
      assert.match(awa.text, /Still 3000 XOF/);
      assert.match(awa.text, /Due 10000 XOF/);
      assert.match(awa.text, /Paid 7000 XOF/);
      assert.match(awa.text, /last payment on 2026-10-08/);

      // Le nom de l'élève et son reste sont lisibles sur sa ligne.
      const awaRow = view.rows().find((el) => el.getAttribute('data-student') === 'st-awa')!;
      assert.match(awaRow.textContent ?? '', /Awa Traoré/);
      assert.match(awaRow.textContent ?? '', /3000 XOF still owed/);
    } finally {
      view.cleanup();
    }
  });

  it('annonce le total des restes affichés, et nomme les versements sans mois', () => {
    const view = mount(STUDENTS);
    try {
      assert.equal(view.total(), '2 student(s) · 4000 XOF still owed');
      assert.equal(
        view.undeclared(),
        t.installmentsUndeclared.replace('{count}', '1'),
        'un versement partiel sans mois est dit, pas additionné',
      );
    } finally {
      view.cleanup();
    }
  });

  it('ouvre la fiche de l’élève au clic, sans rien encaisser', () => {
    const view = mount(STUDENTS);
    try {
      const row = view.rows().find((el) => el.getAttribute('data-student') === 'st-awa');
      assert.ok(row);
      const button = row!.querySelector('button');
      assert.ok(button);
      view.click(button!);
      assert.equal(view.selected.length, 1);
      assert.equal(view.selected[0]?.id, 'st-awa');
    } finally {
      view.cleanup();
    }
  });

  it('la ROUTE de l’onglet rend bien cet écran, et rien d’autre', async () => {
    // Le dernier maillon, et celui que l'utilisateur clique : le routeur des vues
    // doit rendre CET écran sur `activeTab === 'installments'`. Un câblage oublié
    // entre l'union de types, le routeur et l'import paresseux ne se voit pas
    // dans les cas ci-dessus — ils rendent la vue directement.
    installDomGlobals();
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    const props = makeProps({ students: STUDENTS, activeTab: 'installments' });
    try {
      await act(async () => {
        root.render(createElement(MainViewsContext.Provider, { value: props }, createElement(MainViews, props)));
      });
      // L'import paresseux se résout en promesse : on la laisse aboutir.
      for (let i = 0; i < 5 && !container.querySelector('[data-slot="installments"]'); i += 1) {
        await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
      }
      assert.ok(container.querySelector('[data-slot="installments"]'),
        'la route de l’onglet rend l’écran des versements partiels');
      assert.equal(container.querySelectorAll('[data-slot="installments-month"]').length, 2,
        'avec ses mois — la route n’est pas un simple fallback');
    } finally {
      await act(async () => root.unmount());
      container.remove();
    }
  });

  it('sans reste dû, dit une phrase au lieu d’une liste vide', () => {
    const view = mount(CLEAN);
    try {
      assert.ok(view.empty(), 'l’état vide a son propre marqueur');
      assert.equal(view.rows().length, 0);
      assert.equal(view.total(), '');
      assert.match(view.text(), new RegExp(t.installmentsEmpty.replace(/\./g, '\\.')));
      assert.match(view.text(), new RegExp(t.installmentsEmptyHint.replace(/\./g, '\\.')));
    } finally {
      view.cleanup();
    }
  });
});
