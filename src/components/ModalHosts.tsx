/**
 * Host components for the lazily-loaded Excel Import and Monthly Payroll
 * Draft modals, extracted from App.tsx.
 *
 * The open state lives in App.tsx because the views trigger the modals via
 * setters; each host receives the visibility flag and change callback, and
 * renders its lazily-loaded modal only while open.
 */

import { Suspense, lazy } from 'react';
import type { Language, Staff, SalaryPayment } from '../app/types';
import type { TranslationDict } from '../i18n/translations';
import type { ImportCategory } from '../lib/excelImporter';
import type { ImportOptions } from './ExcelImportModal';

const ExcelImportModal = lazy(() =>
  import('./ExcelImportModal').then(m => ({ default: m.ExcelImportModal }))
);
const MonthlyPayrollDraftModal = lazy(() =>
  import('./MonthlyPayrollDraftModal').then(m => ({ default: m.MonthlyPayrollDraftModal }))
);

export interface ExcelImportHostProps {
  isOpen: boolean;
  onClose: () => void;
  lang: Language;
  t: TranslationDict;
  academicYears: string[];
  selectedYear: string;
  batchImportData: (
    category: ImportCategory,
    records: Record<string, unknown>[],
    options: ImportOptions,
  ) => Promise<{ inserted: number; updated: number; errors: number }>;
  themeCard: string;
  themeBorder: string;
  themeMuted: string;
  themeIsDark: boolean;
}

export const ExcelImportHost = ({
  isOpen,
  onClose,
  lang,
  t,
  academicYears,
  selectedYear,
  batchImportData,
  themeCard,
  themeBorder,
  themeMuted,
  themeIsDark,
}: ExcelImportHostProps) => {
  if (!isOpen) return null;

  return (
    <Suspense fallback={null}>
      <ExcelImportModal
        isOpen={isOpen}
        onClose={onClose}
        lang={lang}
        t={t}
        academicYears={academicYears}
        selectedYear={selectedYear}
        onImportComplete={async (category: ImportCategory, records: Record<string, unknown>[], options: ImportOptions) => {
          return await batchImportData(category, records, options);
        }}
        themeCard={themeCard}
        themeBorder={themeBorder}
        themeMuted={themeMuted}
        themeIsDark={themeIsDark}
      />
    </Suspense>
  );
};

export interface MonthlyDraftHostProps {
  isOpen: boolean;
  onClose: () => void;
  monthIndex: number;
  year: number;
  onMonthChange: (m: number) => void;
  onYearChange: (y: number) => void;
  lang: Language;
  t: TranslationDict;
  staff: Staff[];
  salaryPayments: SalaryPayment[];
  selectedYear: string;
  onExportExcel: (monthIndex: number, year: number) => void;
  onRecordPayment: (staffId: string, balance: number) => void;
  formatCurrency: (amount: unknown) => string;
  themeCard: string;
  themeBorder: string;
  themeMuted: string;
  themeIsDark: boolean;
}

export const MonthlyDraftHost = ({
  isOpen,
  onClose,
  monthIndex,
  year,
  onMonthChange,
  onYearChange,
  lang,
  t,
  staff,
  salaryPayments,
  selectedYear,
  onExportExcel,
  onRecordPayment,
  formatCurrency,
  themeCard,
  themeBorder,
  themeMuted,
  themeIsDark,
}: MonthlyDraftHostProps) => {
  if (!isOpen) return null;

  return (
    <Suspense fallback={null}>
      <MonthlyPayrollDraftModal
        isOpen={isOpen}
        onClose={onClose}
        lang={lang}
        staff={staff}
        salaryPayments={salaryPayments}
        selectedAcademicYear={selectedYear || '2026-2027'}
        monthIndex={monthIndex}
        year={year}
        onMonthChange={onMonthChange}
        onYearChange={onYearChange}
        onExportExcel={onExportExcel}
        onRecordPayment={onRecordPayment}
        formatCurrency={formatCurrency}
        t={t}
        themeCard={themeCard}
        themeBorder={themeBorder}
        themeMuted={themeMuted}
        themeIsDark={themeIsDark}
      />
    </Suspense>
  );
};
