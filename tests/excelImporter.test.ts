import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseCurrency,
  parseExcelDate,
  normalizePhone,
  validateRows,
  type ColumnMapping,
} from '../src/lib/excelImporter';

describe('parseCurrency', () => {
  it('parses plain integers', () => {
    assert.equal(parseCurrency(150000), 150000);
    assert.equal(parseCurrency('150000'), 150000);
    assert.equal(parseCurrency(0), 0);
  });

  it('parses French-style space thousands separators', () => {
    assert.equal(parseCurrency('150 000'), 150000);
    assert.equal(parseCurrency('1 500 000'), 1500000);
    assert.equal(parseCurrency('150 000 FCFA'), 150000);
  });

  it('does NOT truncate thousands separators (regression: 1.500 used to become 1.5)', () => {
    assert.equal(parseCurrency('1.500'), 1500);
    assert.equal(parseCurrency('150.000'), 150000);
    assert.equal(parseCurrency('1.500.000'), 1500000);
    assert.equal(parseCurrency('1,500,000'), 1500000);
  });

  it('handles mixed European decimal/thousands separators', () => {
    assert.equal(parseCurrency('1.500,50'), 1500.5);
    assert.equal(parseCurrency('1,234.56'), 1234.56);
    assert.equal(parseCurrency('150 000,50'), 150000.5);
    assert.equal(parseCurrency('12.5'), 12.5);
  });

  it('handles currency codes and negatives', () => {
    assert.equal(parseCurrency('FCFA 250.000'), 250000);
    assert.equal(parseCurrency('CFA 1000'), 1000);
    assert.equal(parseCurrency('-5 000'), -5000);
  });

  it('returns null for empty or unparseable input', () => {
    assert.equal(parseCurrency(null), null);
    assert.equal(parseCurrency(''), null);
    assert.equal(parseCurrency('  '), null);
    assert.equal(parseCurrency('abc'), null);
  });
});

describe('parseExcelDate', () => {
  it('parses DD/MM/YYYY and YYYY-MM-DD strings', () => {
    assert.equal(parseExcelDate('15/01/2024'), '2024-01-15');
    assert.equal(parseExcelDate('15-01-2024'), '2024-01-15');
    assert.equal(parseExcelDate('2024-01-15'), '2024-01-15');
  });

  it('returns null for empty input', () => {
    assert.equal(parseExcelDate(''), null);
    assert.equal(parseExcelDate(null), null);
  });
});

describe('normalizePhone', () => {
  it('strips country codes and formatting', () => {
    assert.equal(normalizePhone('+223 76 12 34 56'), '76123456');
    assert.equal(normalizePhone('00223 70 11 22 33'), '70112233');
    assert.equal(normalizePhone('76 12 34 56'), '76123456');
  });

  it('returns empty string for empty input', () => {
    assert.equal(normalizePhone(''), '');
    assert.equal(normalizePhone(null), '');
  });
});

describe('validateRows', () => {
  // The payments category declares studentName, amount and date as required,
  // so the test mappings must cover all of them for a row to validate.
  const paymentMappings: ColumnMapping[] = [
    {
      excelColumn: 'Élève',
      targetField: 'studentName',
      fieldType: 'text',
      required: true,
      sampleValues: [],
    },
    {
      excelColumn: 'Montant',
      targetField: 'amount',
      fieldType: 'currency',
      required: true,
      sampleValues: [],
    },
    {
      excelColumn: 'Date',
      targetField: 'date',
      fieldType: 'date',
      required: true,
      sampleValues: [],
    },
  ];

  it('accepts a required field set to 0 (regression: 0 used to be rejected)', () => {
    const result = validateRows(
      [{ Élève: 'Alice', Montant: 0, Date: '15/01/2024' }],
      paymentMappings,
      'payments'
    );
    assert.equal(result.validRows.length, 1);
    assert.equal(result.invalidRows.length, 0);
    assert.equal(result.validRows[0].amount, 0);
  });

  it('rejects a truly missing required field', () => {
    const result = validateRows(
      [{ Élève: 'Alice', Montant: '', Date: '15/01/2024' }],
      paymentMappings,
      'payments'
    );
    assert.equal(result.validRows.length, 0);
    assert.equal(result.invalidRows.length, 1);
    assert.match(result.invalidRows[0].errors[0], /Missing required field/);
  });

  it('normalizes currency values during validation', () => {
    const result = validateRows(
      [{ Élève: 'Alice', Montant: '150 000', Date: '15/01/2024' }],
      paymentMappings,
      'payments'
    );
    assert.equal(result.validRows[0].amount, 150000);
  });

  it('flags invalid currency values', () => {
    const result = validateRows(
      [{ Élève: 'Alice', Montant: 'pas-un-nombre', Date: '15/01/2024' }],
      paymentMappings,
      'payments'
    );
    assert.equal(result.validRows.length, 0);
    assert.match(result.invalidRows[0].errors[0], /Invalid currency value/);
  });
});
