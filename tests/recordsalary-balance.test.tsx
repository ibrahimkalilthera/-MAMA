/**
 * RecordSalaryModal — remaining-balance regression suite.
 *
 * The balance derivation must window salary payments by CURRENT YEAR AND
 * MONTH: a payment dated the same month of a PREVIOUS year used to count
 * against this month's salary (month-only filter) and shrink the remaining
 * balance. Fixture dates are derived from `new Date()` at runtime so the
 * suite never goes stale (a real "this month" payment vs a "same month last
 * year" one), and the amounts assert the two surfaces that must agree: the
 * staff <option> labels and the selected-staff summary.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { act, createElement, useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import { translations } from '../src/i18n/translations';
import type { TranslationDict } from '../src/i18n/translations';
import type { Staff, SalaryPayment } from '../src/app/types';
import type { CurrentTheme, SalaryForm } from '../src/app/mainViewsProps';
import { RecordSalaryModal } from '../src/components/RecordSalaryModal';
import { installDomGlobals } from './harness';

const t = translations.fr as TranslationDict;

const win = installDomGlobals();
Object.defineProperty(globalThis, 'MouseEvent', { value: win.MouseEvent, configurable: true, writable: true });
// motion (ModalShell) drives enter/exit animations through the WAAPI, whose
// happy-dom ticker never advances — stub it with instantly-finished
// animations (same preamble as notifications-panel.test.tsx).
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

// ── fixtures ─────────────────────────────────────────────────────────────────
const staff = (overrides: Partial<Staff> & { id: string; name: string; salary: number }): Staff => ({
  position: 'Enseignant',
  email: '',
  phone: '+223 70 00 00 00',
  bankDetails: '',
  emergencyContact: '',
  ...overrides,
});

const fatou = (): Staff => staff({ id: 'st1', name: 'Fatou Traoré', salary: 120000 });
const moussa = (): Staff => staff({ id: 'st2', name: 'Moussa Camara', salary: 90000 });

/** Date-only ISO string for (year, month, day) — day 15 keeps the local
 *  month/year equal to the UTC one under every timezone offset. */
const iso = (year: number, month: number, day = 15): string =>
  `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;

const now = new Date();
const currentMonth = now.getMonth();
const currentYear = now.getFullYear();
const payment = (id: string, staffId: string, amount: number, date: string): SalaryPayment =>
  ({ id, staffId, amount, date, academicYear: '2026-2027' });

const thisMonthPayment = (id: string, staffId: string, amount: number): SalaryPayment =>
  payment(id, staffId, amount, iso(currentYear, currentMonth));
const lastYearSameMonthPayment = (id: string, staffId: string, amount: number): SalaryPayment =>
  payment(id, staffId, amount, iso(currentYear - 1, currentMonth));

const theme: CurrentTheme = {
  bg: '', card: '', text: '', muted: '', border: '', header: '', sidebar: '',
  accent: '', accentBg: '', accentHover: '', accentShadow: '', tableHeader: '',
  rowHover: '', input: '', isDark: true,
};

const formatCurrency = (n: number): string => `${n.toLocaleString('fr-FR')} FCFA`;

interface Fixture {
  salaryPayments: SalaryPayment[];
  salaryForm?: Partial<SalaryForm>;
}

function Harness(props: Fixture): React.ReactNode {
  const { salaryPayments, salaryForm: initialForm = {} } = props;
  // Real state so the select's onChange (staff → amount auto-fill) is live,
  // not a no-op: the auto-fill path is what the select-interaction test
  // exercises.
  const [form, setForm] = useState<SalaryForm>({
    staffId: '',
    amount: '',
    date: iso(currentYear, currentMonth),
    ...initialForm,
  });
  return (
    <RecordSalaryModal
      t={t}
      currentTheme={theme}
      staff={[fatou(), moussa()]}
      salaryPayments={salaryPayments}
      currentMonth={currentMonth}
      salaryForm={form}
      setSalaryForm={setForm}
      formatCurrency={formatCurrency}
      generateInstallmentMemo={() => {}}
      handleSalarySubmit={async () => {}}
      overlayRef={() => {}}
      onClose={() => {}}
    />
  );
}

function mount(): { root: Root; container: Element } {
  const container = win.document.createElement('div');
  win.document.body.appendChild(container);
  const root = createRoot(container as unknown as Element);
  return { root, container: container as unknown as Element };
}

/** fr-FR grouping uses narrow no-break spaces — normalize them for matching. */
const norm = (s: string): string => s.replace(/[\u00A0\u202F]/g, ' ');

const optionFor = (staffId: string): Element | undefined =>
  (Array.from(win.document.querySelectorAll('option')) as unknown as Element[]).find(
    (o) => o.getAttribute('value') === staffId,
  );

/** The remaining-balance figure the summary shows for the selected staff. */
const summaryBalance = (): string | null => {
  const spans = Array.from(win.document.querySelectorAll('span')) as unknown as Element[];
  const money = spans.find((s) => /FCFA/.test(s.textContent ?? ''));
  return money?.textContent === null || money?.textContent === undefined ? null : norm(money.textContent);
};

describe('RecordSalaryModal — remaining balance windows year+month', () => {
  it('excludes a same-month payment from the previous year', async () => {
    const { root, container } = mount();
    try {
      await act(async () => {
        root.render(createElement(Harness, {
          salaryPayments: [
            thisMonthPayment('sp-now', 'st1', 20000),
            lastYearSameMonthPayment('sp-last-year', 'st1', 30000),
          ],
          salaryForm: { staffId: 'st1' },
        }));
      });
      // 120000 − 20000 = 100000: the 30000 from last September must NOT count.
      const opt = optionFor('st1');
      assert.ok(opt, 'staff option rendered');
      assert.ok(norm(opt!.textContent ?? '').includes('100 000 FCFA'), `option shows this-month-only balance, got: ${opt!.textContent}`);
      assert.ok(!norm(opt!.textContent ?? '').includes('90 000 FCFA'), 'previous-year payment must not reduce the balance');
      assert.equal(summaryBalance(), '100 000 FCFA', 'summary agrees with the option label');
    } finally {
      await act(async () => root.unmount());
      container.remove();
    }
  });

  it('sums every payment of the current year+month', async () => {
    const { root, container } = mount();
    try {
      await act(async () => {
        root.render(createElement(Harness, {
          salaryPayments: [
            thisMonthPayment('sp-a', 'st1', 20000),
            thisMonthPayment('sp-b', 'st1', 15000),
            payment('sp-other-month', 'st1', 40000, iso(currentYear, (currentMonth + 1) % 12)),
          ],
          salaryForm: { staffId: 'st1' },
        }));
      });
      // 120000 − (20000 + 15000) = 85000; the other-month payment stays out.
      const opt = optionFor('st1');
      assert.ok(norm(opt!.textContent ?? '').includes('85 000 FCFA'), `option sums all this-month payments, got: ${opt!.textContent}`);
      assert.equal(summaryBalance(), '85 000 FCFA');
    } finally {
      await act(async () => root.unmount());
      container.remove();
    }
  });

  it('auto-fills the amount from the year+month balance when a staff is picked', async () => {
    const { root, container } = mount();
    try {
      await act(async () => {
        root.render(createElement(Harness, {
          salaryPayments: [
            thisMonthPayment('sp-now', 'st1', 20000),
            lastYearSameMonthPayment('sp-last-year', 'st1', 30000),
          ],
        }));
      });

      const select = win.document.querySelector('select') as unknown as HTMLSelectElement;
      const amount = win.document.querySelector('input[type="number"]') as unknown as HTMLInputElement;
      assert.ok(select, 'staff select rendered');
      assert.ok(amount, 'amount input rendered');
      assert.equal(select.value, '', 'no staff pre-selected');
      assert.equal(amount.value, '', 'amount empty until a staff is chosen');

      // Pick Fatou: 120000 − 20000 = 100000. The 30000 paid the same month
      // LAST year must NOT be subtracted (the old month-only filter would
      // have auto-filled 70000).
      await act(async () => {
        select.value = 'st1';
        select.dispatchEvent(new win.Event('change', { bubbles: true }) as unknown as Event);
      });
      assert.equal(select.value, 'st1', 'select reflects the chosen staff');
      assert.equal(amount.value, '100000', 'amount auto-fills with the year+month-aware balance');
      assert.equal(summaryBalance(), '100 000 FCFA', 'summary agrees with the auto-filled amount');

      // Switch to Moussa (no payments this year+month): full salary fills in.
      await act(async () => {
        select.value = 'st2';
        select.dispatchEvent(new win.Event('change', { bubbles: true }) as unknown as Event);
      });
      assert.equal(amount.value, '90000', 'untouched staff auto-fills at full salary');
      assert.equal(summaryBalance(), '90 000 FCFA');
    } finally {
      await act(async () => root.unmount());
      container.remove();
    }
  });

  it('leaves staff without payments at their full salary', async () => {
    const { root, container } = mount();
    try {
      await act(async () => {
        root.render(createElement(Harness, {
          salaryPayments: [thisMonthPayment('sp-now', 'st1', 20000)],
        }));
      });
      const opt = optionFor('st2');
      assert.ok(norm(opt!.textContent ?? '').includes('90 000 FCFA'), 'untouched staff shows full salary');
    } finally {
      await act(async () => root.unmount());
      container.remove();
    }
  });
});
