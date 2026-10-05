// Pure-formatter suite (src/lib/formatters, src/lib/classes): no DOM, no
// React — runs in plain node by design, see tests/harness.ts "When NOT to
// use it".
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { formatCurrency, formatDate, formatDateLang } from '../src/lib/formatters';
import { buildClassCode } from '../src/lib/classes';

// U+00A0, never a plain space: a figure must not wrap mid-amount on screen
// ("16 069" / "979 FCFA"). Spelled out in hex on purpose.
describe('formatCurrency', () => {
  it('formats amounts with FCFA suffix', () => {
    assert.equal(formatCurrency(150000), '150\u00a0000\u00a0FCFA');
    assert.equal(formatCurrency(0), '0\u00a0FCFA');
  });

  it('uses no-break spaces only (never a plain space)', () => {
    const formatted = formatCurrency(16069979);
    assert.equal(formatted, '16\u00a0069\u00a0979\u00a0FCFA');
    assert.ok(!/ /.test(formatted), 'a plain space would allow the amount to wrap');
  });

  it('never renders "undefined" or NaN', () => {
    assert.equal(formatCurrency(undefined), '0\u00a0FCFA');
    assert.equal(formatCurrency(NaN), '0\u00a0FCFA');
  });
});

describe('formatDate / formatDateLang', () => {
  it('formats dates without crashing on empty input', () => {
    assert.equal(formatDate(''), '');
    assert.equal(formatDateLang('', 'fr'), '');
  });

  it('returns the raw string when the date is unparseable', () => {
    assert.equal(formatDate('pas-une-date'), 'pas-une-date');
  });
});

describe('buildClassCode', () => {
  it('builds standard class codes with localized names', () => {
    const code = buildClassCode({ cycle: 'cycle1', year: '1', section: 'a', customName: '' });
    assert.equal(code.code, '1A');
    assert.equal(code.nameFr, '1ère Année A (1A)');
    assert.equal(code.nameEn, '1st Year A (1A)');
  });

  it('uses the custom name for custom classes', () => {
    const code = buildClassCode({ cycle: 'other', year: '', section: '', customName: 'CP1' });
    assert.equal(code.code, 'CP1');
    assert.equal(code.nameFr, 'CP1');
  });
});
