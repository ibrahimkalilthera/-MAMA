// ─────────────────────────────────────────────────────────────────────────────
// tests/expenses-month-year.test.tsx — le KPI « dépenses ce mois-ci »
// d'ExpensesView filtre le mois ET l'année, tous deux INJECTÉS.
//
// Défaut visé : `currentMonth` arrivait par le contrat de props, mais l'année
// était lue à l'horloge murale (`sameYearMonth(e.date, new Date().getFullYear(),
// currentMonth)`). Une dépense du même mois d'une autre année entrait alors dans
// le KPI. L'année injectée est décalée de l'année machine pour que la fuite de
// l'horloge soit détectable quel que soit le jour d'exécution.
// ─────────────────────────────────────────────────────────────────────────────
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { ExpensesView } from '../src/components/ExpensesView';
import type { Expense } from '../src/lib/useSupabaseData';
import { renderWithContext } from './views-harness';

const WALL_YEAR = new Date().getFullYear();
const INJECTED_YEAR = WALL_YEAR + 1;

function expense(id: string, date: string, amount: number): Expense {
  return { id, category: 'Supplies', description: id, amount, date };
}

const expenses: Expense[] = [
  expense('ce-mois-annee-injectee', `${INJECTED_YEAR}-09-15`, 5000),
  // Même mois (septembre) mais année de l'horloge : ne doit PAS compter.
  expense('meme-mois-annee-machine', `${WALL_YEAR}-09-15`, 7000),
  // Autre mois, même année injectée : ne doit PAS compter.
  expense('autre-mois', `${INJECTED_YEAR}-08-15`, 3000),
];

describe('ExpensesView — « dépenses ce mois-ci » : année injectée, pas l’horloge', () => {
  it('ne compte que les dépenses du mois de l’année injectée', () => {
    const html = renderWithContext(createElement(ExpensesView), {
      expenses,
      currentMonth: 8, // septembre
      currentYear: INJECTED_YEAR,
    });
    assert.ok(
      html.includes('5000 XOF'),
      'seule la dépense de septembre de l’année injectée doit alimenter le KPI',
    );
    assert.ok(
      !html.includes('7000 XOF'),
      'une dépense de septembre de l’année de la machine ne doit pas entrer dans le KPI',
    );
    assert.ok(
      !html.includes('12000 XOF'),
      'le KPI ne doit pas additionner l’année machine (5000 + 7000)',
    );
  });
});
