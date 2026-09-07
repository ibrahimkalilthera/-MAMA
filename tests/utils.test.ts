// Pure-formatter suite (src/lib/formatters, src/lib/classes): no DOM, no
// React — runs in plain node by design, see tests/harness.ts "When NOT to
// use it".
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { formatCurrency, formatDate, formatDateLang } from '../src/lib/formatters';
import { buildClassCode } from '../src/lib/classes';

describe('formatCurrency', () => {
  it('formats amounts with FCFA suffix', () => {
    assert.equal(formatCurrency(150000), '150 000 FCFA');
    assert.equal(formatCurrency(0), '0 FCFA');
  });

  it('never renders "undefined" or NaN', () => {
    assert.equal(formatCurrency(undefined), '0 FCFA');
    assert.equal(formatCurrency(NaN), '0 FCFA');
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
