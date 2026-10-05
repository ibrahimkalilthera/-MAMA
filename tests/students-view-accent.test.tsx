/**
 * L'avatar d'une ligne d'élève devient une surface d'accent pleine quand sa
 * ligne est survolée. Il portait `group-hover:bg-blue-600 group-hover:text-white`
 * — un bleu de marque codé en dur que le remap `!important` d'un thème sombre ne
 * peut pas rattraper (il ne connaît que son propre accent). Il porte maintenant
 * `currentTheme.accentGroupHover`, le jeton partagé dont le CSS peint le fond
 * ET l'encre sous `.group:hover` (voir tests/theme-css.test.ts).
 *
 * Le contrôle mesure le HTML rendu, pas la source : c'est la classe réellement
 * émise qui décide si l'affordance suit le thème.
 */
import { it } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { StudentsView } from '../src/components/StudentsView';
import type { Student } from '../src/lib/useSupabaseData';
import { makeProps, renderWithContext } from './views-harness';

const student: Student = {
  id: 's1',
  name: 'Awa Traoré',
  grade: '1A',
  totalDue: 100000,
  amountPaid: 40000,
  parentName: 'Mamadou Diallo',
  parentEmail: 'parent@example.com',
  parentPhone: '+223 70 00 00 00',
  dueDate: '2026-12-31',
  payments: [],
  notes: '',
};

it('l’avatar d’élève suit le thème au survol de la ligne (accentGroupHover, plus de bleu en dur)', () => {
  const theme = { ...makeProps().currentTheme, accentGroupHover: 'accent-group-hover' };
  const html = renderWithContext(createElement(StudentsView), {
    currentTheme: theme,
    filteredStudents: [student],
  });
  assert.ok(html.includes('accent-group-hover'), 'l’affordance groupe porte le jeton du thème');
  assert.ok(!html.includes('group-hover:bg-blue-600'), 'plus de bleu d’accent codé en dur');
});
