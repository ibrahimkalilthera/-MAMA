import type { Staff, SalaryPayment } from './useSupabaseData';
import { drawSchoolStamp } from './pdfStamp';
import { translations } from '../i18n/translations';
import type { TranslationDict } from '../i18n/translations';

export interface MonthlyPayrollDraftOptions {
  monthIndex: number; // 0 to 11
  year: number;
  staff: Staff[];
  salaryPayments: SalaryPayment[];
  selectedAcademicYear?: string;
  lang?: 'en' | 'fr';
}

/**
 * Generates an executive A4 Monthly Payroll Draft / Bordereau Récapitulatif de Paie for Complexe Scolaire MAMA THERA.
 */
export async function generateMonthlyPayrollDraftPdf({
  monthIndex,
  year,
  staff,
  salaryPayments,
  selectedAcademicYear = '2026-2027',
  lang = 'fr',
}: MonthlyPayrollDraftOptions): Promise<void> {
  const { jsPDF } = await import('jspdf');
  const t: TranslationDict = lang === 'fr' ? translations.fr : translations.en;
  const isFr = lang === 'fr';
  const currencySuffix = ' FCFA';
  const formatAmount = (val: number) => (val || 0).toLocaleString('fr-FR') + currencySuffix;

  const doc = new jsPDF({
    orientation: 'landscape',
    unit: 'mm',
    format: 'a4',
  });

  const monthNames = [t.jan, t.feb, t.mar, t.apr, t.may, t.jun, t.jul, t.aug, t.sep, t.oct, t.nov, t.dec];
  const monthName = monthNames[monthIndex];

  const todayStr = new Date().toLocaleDateString(isFr ? 'fr-FR' : 'en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  // Calculate staff payroll for this specific month
  const staffPayrollList = staff.map((s, index) => {
    const paymentsThisMonth = salaryPayments.filter(p => {
      const payDate = new Date(p.date);
      return payDate.getFullYear() === year && payDate.getMonth() === monthIndex && p.staffId === s.id;
    });

    const totalPaid = paymentsThisMonth.reduce((sum, p) => sum + (p.amount || 0), 0);
    const balance = Math.max(0, s.salary - totalPaid);
    const lastPayDate = paymentsThisMonth.length > 0 ? paymentsThisMonth[paymentsThisMonth.length - 1].date : '—';

    let status = t.pdfUnpaid;
    if (totalPaid >= s.salary && s.salary > 0) {
      status = t.pdfFullyPaid;
    } else if (totalPaid > 0) {
      status = t.pdfPartialPaid;
    }

    return {
      index: index + 1,
      id: s.id,
      name: s.name,
      position: s.position,
      salary: s.salary,
      totalPaid,
      balance,
      lastPayDate,
      status,
      paymentsCount: paymentsThisMonth.length,
    };
  });

  const grandTotalExpected = staffPayrollList.reduce((sum, s) => sum + s.salary, 0);
  const grandTotalPaid = staffPayrollList.reduce((sum, s) => sum + s.totalPaid, 0);
  const grandTotalRemaining = staffPayrollList.reduce((sum, s) => sum + s.balance, 0);
  const paidEmployeesCount = staffPayrollList.filter(s => s.totalPaid >= s.salary && s.salary > 0).length;

  // 1. Header Banner (Landscape: 297mm width)
  doc.setFillColor(15, 23, 42); // slate-900
  doc.rect(0, 0, 297, 28, 'F');

  doc.setFillColor(5, 150, 105); // emerald-600 accent bar
  doc.rect(0, 26, 297, 2, 'F');

  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(15);
  doc.text('COMPLEXE SCOLAIRE MAMA THERA', 14, 11);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9.5);
  doc.text(
    t.pdfDraftTitle.replace('{month}', monthName.toUpperCase()).replace('{year}', String(year)),
    14,
    20
  );

  doc.setFontSize(8.5);
  doc.text(`${t.pdfAcademicYearColon} ${selectedAcademicYear}`, 283, 11, { align: 'right' });
  doc.text(`${t.pdfGeneratedOn} ${todayStr}`, 283, 20, { align: 'right' });

  let y = 35;

  // 2. Summary KPI Boxes (4 boxes across landscape width)
  const boxWidth = 64;
  const boxHeight = 18;
  const gap = 5;
  let startX = 14;

  // Box 1: Total Salary Budget
  doc.setFillColor(248, 250, 252);
  doc.setDrawColor(203, 213, 225);
  doc.roundedRect(startX, y, boxWidth, boxHeight, 2, 2, 'FD');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7.5);
  doc.setTextColor(71, 85, 105);
  doc.text(t.pdfSalaryBudget, startX + 4, y + 6);
  doc.setFontSize(10.5);
  doc.setTextColor(15, 23, 42);
  doc.text(formatAmount(grandTotalExpected), startX + 4, y + 14);

  // Box 2: Total Paid This Month
  startX += boxWidth + gap;
  doc.setFillColor(240, 253, 244); // emerald-50
  doc.setDrawColor(167, 243, 208);
  doc.roundedRect(startX, y, boxWidth, boxHeight, 2, 2, 'FD');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7.5);
  doc.setTextColor(6, 95, 70);
  doc.text(t.pdfSalariesPaidMonth, startX + 4, y + 6);
  doc.setFontSize(10.5);
  doc.setTextColor(5, 150, 105);
  doc.text(formatAmount(grandTotalPaid), startX + 4, y + 14);

  // Box 3: Total Remaining Arrears
  startX += boxWidth + gap;
  doc.setFillColor(254, 242, 242); // red-50
  doc.setDrawColor(254, 202, 202);
  doc.roundedRect(startX, y, boxWidth, boxHeight, 2, 2, 'FD');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7.5);
  doc.setTextColor(153, 27, 27);
  doc.text(t.pdfRemainingArrears, startX + 4, y + 6);
  doc.setFontSize(10.5);
  doc.setTextColor(220, 38, 38);
  doc.text(formatAmount(grandTotalRemaining), startX + 4, y + 14);

  // Box 4: Execution Rate
  startX += boxWidth + gap;
  doc.setFillColor(243, 244, 246);
  doc.setDrawColor(229, 231, 235);
  doc.roundedRect(startX, y, boxWidth, boxHeight, 2, 2, 'FD');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7.5);
  doc.setTextColor(31, 41, 55);
  doc.text(t.pdfExecutionRate, startX + 4, y + 6);
  doc.setFontSize(10.5);
  const execRate = grandTotalExpected > 0 ? ((grandTotalPaid / grandTotalExpected) * 100).toFixed(1) : '0';
  doc.text(`${execRate}% (${paidEmployeesCount}/${staff.length} ${t.pdfStaffPaid})`, startX + 4, y + 14);

  y += 24;

  // 3. Staff Table Header
  doc.setFillColor(241, 245, 249);
  doc.rect(14, y, 269, 7.5, 'F');
  doc.setDrawColor(203, 213, 225);
  doc.line(14, y + 7.5, 283, y + 7.5);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7.5);
  doc.setTextColor(51, 65, 85);
  doc.text(t.pdfNo, 16, y + 5);
  doc.text(t.pdfEmployeeName, 28, y + 5);
  doc.text(t.pdfPositionRole, 82, y + 5);
  doc.text(t.pdfBaseSalaryHeader, 135, y + 5, { align: 'right' });
  doc.text(t.pdfPaidThisMonth, 170, y + 5, { align: 'right' });
  doc.text(t.pdfRemainingDue, 205, y + 5, { align: 'right' });
  doc.text(t.pdfPayDate, 222, y + 5);
  doc.text(t.pdfStatus, 248, y + 5);
  doc.text(t.pdfSigning, 281, y + 5, { align: 'right' });

  y += 7.5;

  if (staffPayrollList.length > 0) {
    staffPayrollList.forEach((st, idx) => {
      if (y > 175) {
        doc.addPage();
        y = 20;
      }

      const isAlt = idx % 2 === 1;
      if (isAlt) {
        doc.setFillColor(248, 250, 252);
        doc.rect(14, y, 269, 7.5, 'F');
      }
      doc.setDrawColor(226, 232, 240);
      doc.line(14, y + 7.5, 283, y + 7.5);

      doc.setFont('helvetica', 'normal');
      doc.setFontSize(7.5);
      doc.setTextColor(100, 116, 139);
      doc.text(String(st.index), 16, y + 5);

      doc.setFont('helvetica', 'bold');
      doc.setTextColor(15, 23, 42);
      doc.text(st.name, 28, y + 5);

      doc.setFont('helvetica', 'normal');
      doc.setTextColor(71, 85, 105);
      doc.text(st.position, 82, y + 5);

      doc.setFont('helvetica', 'bold');
      doc.setTextColor(15, 23, 42);
      doc.text(formatAmount(st.salary), 135, y + 5, { align: 'right' });

      doc.setTextColor(5, 150, 105);
      doc.text(formatAmount(st.totalPaid), 170, y + 5, { align: 'right' });

      doc.setTextColor(st.balance > 0 ? 220 : 100, st.balance > 0 ? 38 : 116, st.balance > 0 ? 38 : 139);
      doc.text(formatAmount(st.balance), 205, y + 5, { align: 'right' });

      doc.setFont('helvetica', 'normal');
      doc.setTextColor(100, 116, 139);
      doc.text(st.lastPayDate, 222, y + 5);

      // Status pill text
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(7);
      if (st.totalPaid >= st.salary && st.salary > 0) {
        doc.setTextColor(5, 150, 105);
      } else if (st.totalPaid > 0) {
        doc.setTextColor(217, 119, 6);
      } else {
        doc.setTextColor(220, 38, 38);
      }
      doc.text(st.status, 248, y + 5);

      // Signature line spot
      doc.setDrawColor(203, 213, 225);
      doc.line(268, y + 5.5, 281, y + 5.5);

      y += 7.5;
    });

    // Grand Total Row
    doc.setFillColor(241, 245, 249);
    doc.rect(14, y, 269, 8, 'F');
    doc.setDrawColor(148, 163, 184);
    doc.line(14, y + 8, 283, y + 8);

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    doc.setTextColor(15, 23, 42);
    doc.text(t.pdfGrandTotals, 28, y + 5.5);

    doc.text(formatAmount(grandTotalExpected), 135, y + 5.5, { align: 'right' });
    doc.setTextColor(5, 150, 105);
    doc.text(formatAmount(grandTotalPaid), 170, y + 5.5, { align: 'right' });
    doc.setTextColor(220, 38, 38);
    doc.text(formatAmount(grandTotalRemaining), 205, y + 5.5, { align: 'right' });
    y += 12;
  } else {
    doc.setFont('helvetica', 'italic');
    doc.setFontSize(8.5);
    doc.setTextColor(148, 163, 184);
    doc.text(
      t.pdfNoStaffPeriod,
      14,
      y + 8
    );
    y += 16;
  }

  // 4. Signatures & Stamp Block
  if (y > 165) {
    doc.addPage();
    y = 25;
  } else {
    y = Math.max(y + 6, 165);
  }

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8.5);
  doc.setTextColor(15, 23, 42);

  doc.text(t.pdfForManager, 30, y);
  doc.text(t.pdfForDirector, 190, y);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.5);
  doc.setTextColor(100, 116, 139);
  doc.text(t.pdfSignatureVisa, 30, y + 4.5);

  // Official school stamp over the director's approval area
  await drawSchoolStamp(doc, 225, y + 16, 24);

  doc.setDrawColor(203, 213, 225);
  doc.line(30, y + 20, 100, y + 20);
  doc.line(190, y + 20, 260, y + 20);

  // Footer
  doc.setFontSize(7);
  doc.setTextColor(148, 163, 184);
  doc.text(
    t.pdfDraftFooter.replace('{month}', monthName).replace('{year}', String(year)),
    148.5,
    202,
    { align: 'center' }
  );

  // Save / Download PDF
  const filename = `MAMA_THERA_Bordereau_Paie_${monthName}_${year}.pdf`;
  doc.save(filename);
}
