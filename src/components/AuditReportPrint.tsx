/**
 * AuditReportPrint — the hidden-until-printed annual audit report.
 * Extracted from AppModals.tsx during the per-domain split (MainViews model):
 * receives only the props it needs and renders the print-only block.
 */
import type { CurrentTheme } from '../app/mainViewsProps';
import type { Student } from '../lib/useSupabaseData';
import type { TranslationDict } from '../i18n/translations';

interface AuditReportPrintProps {
  t: TranslationDict;
  auditYear: string;
  students: Student[];
  getYearStats: (year: string) => { revenue: number; expenses: number; balance: number };
  formatCurrency: (n: number) => string;
  tokens: { paperFillMid: string };
}

export function AuditReportPrint({ t, auditYear, students, getYearStats, formatCurrency, tokens }: AuditReportPrintProps) {
  const { revenue, expenses, balance } = getYearStats(auditYear);
  const closedYearStudents = students.filter(s => s.academicYear === auditYear || (!s.academicYear && auditYear === '2024-2025'));
  const studentsWithDebt = closedYearStudents.filter(s => {
    const discount = s.scholarshipDiscount || 0;
    const discountedTotal = s.totalDue * (1 - discount / 100);
    return (discountedTotal - s.amountPaid) > 0;
  });

  return (
    <div className="hidden print:block print-container bg-white text-black font-sans space-y-8">
      <div className="text-center border-b-2 border-black pb-4">
        <h1 className="font-bold text-2xl uppercase tracking-wider">{t.title}</h1>
        <p className="text-xs text-black/70 uppercase tracking-widest">{t.subtitle}</p>
        <h2 className="font-black text-lg mt-3 uppercase tracking-wider border-2 border-black px-4 py-2 inline-block">
          {t.finalAcademicAuditReport}
        </h2>
        <p className="text-sm mt-2 font-semibold">{t.academicYear3} : {auditYear}</p>
      </div>

      <div className="grid grid-cols-3 gap-4 text-center py-4 border-b border-black">
        <div className="border border-black p-4 rounded-xl">
          <span className="text-[10px] font-bold block uppercase tracking-wide">{t.totalRevenue}</span>
          <span className="text-lg font-black">{formatCurrency(revenue)}</span>
        </div>
        <div className="border border-black p-4 rounded-xl">
          <span className="text-[10px] font-bold block uppercase tracking-wide">{t.totalExpenses2}</span>
          <span className="text-lg font-black">{formatCurrency(expenses)}</span>
        </div>
        <div className="border border-black p-4 rounded-xl">
          <span className="text-[10px] font-bold block uppercase tracking-wide">{t.netClosingBalance}</span>
          <span className="text-lg font-black">{formatCurrency(balance)}</span>
        </div>
      </div>

      {/* Debts Carried Over */}
      <div className="space-y-3">
        <h3 className="font-bold text-sm uppercase tracking-wider">
          {t.outstandingParentDebtsCarriedForwardReliquats}
        </h3>
        {studentsWithDebt.length > 0 ? (
          <table className="w-full text-left text-xs border border-black">
            <thead>
              <tr className={`${tokens.paperFillMid} border-b border-black font-bold`}>
                <th className="px-3 py-2 border-r border-black">{t.studentName2}</th>
                <th className="px-3 py-2 border-r border-black">{t.parentContact2}</th>
                <th className="px-3 py-2 text-right">{t.debtCarriedOver}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-black">
              {studentsWithDebt.map(student => {
                const discount = student.scholarshipDiscount || 0;
                const discountedTotal = student.totalDue * (1 - discount / 100);
                const debt = discountedTotal - student.amountPaid;
                return (
                  <tr key={student.id}>
                    <td className="px-3 py-2 border-r border-black font-bold">{student.name}</td>
                    <td className="px-3 py-2 border-r border-black">{student.parentName} ({student.parentPhone})</td>
                    <td className="px-3 py-2 text-right font-bold">{formatCurrency(debt)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        ) : (
          <p className="text-xs italic">{t.noOutstandingStudentDebtsRecorded}</p>
        )}
      </div>

      {/* Certified signature block */}
      <div className="flex justify-between items-center pt-12 border-t border-black text-xs">
        <div>
          <p className="font-bold">{t.certifiedSincerelyBy}</p>
          <p className="font-black mt-1">Ibrahim Thera, Executive Admin</p>
          <p className="text-black/60 text-[10px]">{t.schoolDirectorController}</p>
        </div>
        <div className="text-right">
          <p className="font-bold">{t.authorizedSignature}</p>
          <div className="h-12 w-48 border-b border-dashed border-black mt-2 ml-auto" />
          <p className="text-[8px] text-black/60 mt-1">Ibrahim Thera / Official Board Seal</p>
        </div>
      </div>

      <div className="text-center text-[10px] pt-8 border-t border-black/10">
        <p>{t.systemCertifiedClosingDocument}</p>
        <p className="mt-1 font-bold">Finance Exécutive Admin Portal</p>
      </div>
    </div>
  );
}