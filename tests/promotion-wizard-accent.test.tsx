import { it } from 'node:test';
import assert from 'node:assert/strict';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { PromotionWizardModal } from '../src/components/PromotionWizardModal';
import { translations } from '../src/i18n/translations';
import { makeProps } from './views-harness';
import { installDomGlobals } from './harness';

it('promotion : les CTA suivent le thème sans recolorer le statut payé ni changer les décisions', async () => {
  installDomGlobals();
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  const t = translations.fr;
  const currentTheme = {
    ...makeProps().currentTheme,
    accentBg: 'accent-surface', accentText: 'accent-surface-text',
    accentHover: 'accent-surface-hover', accentShadow: 'accent-shadow',
    accentSoft: 'accent-soft', accentSoftText: 'accent-soft-text',
    accentSoftHover: 'accent-soft-hover', accentRing: 'accent-ring',
    accentBorder: 'accent-border', inkStrong: 'text-slate-800',
  };
  const calls: unknown[] = [];
  let closed = 0;
  const student = {
    id: 's1', name: 'Awa Traoré', grade: '1ère Année', academicYear: '2025-2026',
    parentName: 'Parent', parentEmail: '', parentPhone: '', totalDue: 100000,
    amountPaid: 100000, dueDate: '', notes: '', payments: [],
  };
  try {
    await act(async () => root.render(createElement(PromotionWizardModal, {
      isOpen: true, onClose: () => { closed += 1; }, students: [student],
      availableAcademicYears: ['2025-2026', '2026-2027'], currentAcademicYear: '2025-2026',
      onPromote: async (promotions) => { calls.push(promotions); return false; },
      t, currentTheme,
    })));
    const primary = [...container.querySelectorAll('button')].find(b => b.textContent?.includes(t.processBatchPromotion));
    assert.ok(primary);
    assert.equal(primary.disabled, true);
    for (const token of [currentTheme.accentBg, currentTheme.accentText, currentTheme.accentHover, currentTheme.accentShadow]) {
      assert.ok(primary.classList.contains(token), `CTA primaire utilise ${token}`);
    }
    const header = container.querySelector('#modal-title-promotion-wizard')?.parentElement?.parentElement?.parentElement;
    assert.ok(header?.classList.contains(currentTheme.accentBg));
    assert.ok(header?.classList.contains(currentTheme.accentText));
    const grade = container.querySelectorAll('select')[1];
    assert.ok(grade.classList.contains(currentTheme.accentRing));
    act(() => {
      grade.value = student.grade;
      grade.dispatchEvent(new Event('change', { bubbles: true }));
    });
    assert.equal(primary.disabled, false);
    const all = [...container.querySelectorAll('button')].find(b => b.textContent?.includes(t.promoteAll));
    assert.ok(all);
    for (const token of [currentTheme.accentSoft, currentTheme.accentSoftText, currentTheme.accentSoftHover]) {
      assert.ok(all.classList.contains(token), `CTA groupé utilise ${token}`);
    }
    assert.ok(container.querySelector('tbody span')?.classList.contains('bg-emerald-100'), 'payé reste vert sémantique');
    const repeat = [...container.querySelectorAll('button')].find(b => b.textContent?.includes(t.repeatAll));
    assert.ok(repeat);
    act(() => repeat.click());
    await act(async () => primary.click());
    assert.deepEqual(calls, [[{
      studentId: 's1', action: 'repeat', targetGrade: student.grade,
      targetAcademicYear: '2026-2027', newTotalDue: 150000,
    }]]);
    const cancel = [...container.querySelectorAll('button')].find(b => b.textContent === t.cancel);
    assert.ok(cancel);
    act(() => cancel.click());
    assert.equal(closed, 1);
  } finally {
    act(() => root.unmount());
    container.remove();
  }
});
