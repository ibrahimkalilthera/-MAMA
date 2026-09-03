import type { Student, Expense, VendorExpense, SalaryPayment } from './useSupabaseData';
import { drawSchoolStamp } from './pdfStamp';

export interface MultiYearReportOptions {
  academicYears: string[];
  lockedYears: string[];
  students: Student[];
  expenses: Expense[];
  vendorExpenses: VendorExpense[];
  salaryPayments: SalaryPayment[];
  lang?: 'en' | 'fr';
}

/**
 * Generates an executive A4 Multi-Year Comparison & Archives Report PDF for Complexe Scolaire MAMA THERA.
 */
export async function generateMultiYearReportPdf({
  academicYears,
  lockedYears,
  students,
  expenses,
  vendorExpenses,
  salaryPayments,
  lang = 'fr',
}: MultiYearReportOptions): Promise<void> {
  const { jsPDF } = await import('jspdf');
  const isFr = lang === 'fr';
  const currencySuffix = ' FCFA';
  const formatAmount = (val: number) => (val || 0).toLocaleString('fr-FR') + currencySuffix;

  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: 'a4',
  });

  const todayStr = new Date().toLocaleDateString(isFr ? 'fr-FR' : 'en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  // Calculate stats for each academic year
  const getYearStats = (year: string) => {
    const filteredStudents = students.filter(s => s.academicYear === year || (!s.academicYear && year === '2024-2025'));
    const filteredExpenses = expenses.filter(e => e.academicYear === year || (!e.academicYear && year === '2024-2025'));
    const filteredVendorExpenses = vendorExpenses.filter(v => v.academicYear === year || (!v.academicYear && year === '2024-2025'));
    const filteredSalaryPayments = salaryPayments.filter(s => s.academicYear === year || (!s.academicYear && year === '2024-2025'));

    const revenue = filteredStudents.reduce((acc, s) => acc + (s.amountPaid || 0), 0);
    const totalVendorPaid = filteredVendorExpenses.reduce((acc, v) => {
      if (v.paymentStatus === 'paid') return acc + (v.amount || 0);
      if (v.paymentStatus === 'partial') return acc + (v.amountPaid || 0);
      return acc;
    }, 0);

    const yearExpenses = filteredExpenses.reduce((acc, e) => acc + (e.amount || 0), 0) +
      filteredSalaryPayments.reduce((acc, s) => acc + (s.amount || 0), 0) +
      totalVendorPaid;

    const balance = revenue - yearExpenses;
    const studentCount = filteredStudents.length;

    return { revenue, expenses: yearExpenses, balance, studentCount };
  };

  const yearData = academicYears.map(year => ({
    year,
    isLocked: lockedYears.includes(year),
    ...getYearStats(year),
  }));

  const grandTotalRevenue = yearData.reduce((sum, y) => sum + y.revenue, 0);
  const grandTotalExpenses = yearData.reduce((sum, y) => sum + y.expenses, 0);
  const grandNetBalance = grandTotalRevenue - grandTotalExpenses;

  // 1. Header Banner
  doc.setFillColor(5, 150, 105); // emerald-600
  doc.rect(0, 0, 210, 30, 'F');

  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(16);
  doc.text('COMPLEXE SCOLAIRE MAMA THERA', 14, 13);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.text(
    isFr ? 'BILAN MULTI-ANNUEL & ARCHIVES FINANCIÈRES' : 'MULTI-YEAR COMPARISON & FINANCIAL ARCHIVES',
    14,
    22
  );

  doc.setFontSize(9);
  doc.text(`Bamako, Mali`, 196, 13, { align: 'right' });
  doc.text(`${isFr ? 'Date :' : 'Date:'} ${todayStr}`, 196, 22, { align: 'right' });

  let y = 38;

  // 2. Executive KPI Cards (3 Summary Boxes)
  const boxWidth = 57;
  const boxHeight = 22;
  const gap = 5;
  let startX = 14;

  // Card 1: Cumulative Revenue
  doc.setFillColor(240, 253, 244); // emerald-50
  doc.setDrawColor(167, 243, 208);
  doc.roundedRect(startX, y, boxWidth, boxHeight, 2, 2, 'FD');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.setTextColor(6, 95, 70);
  doc.text(isFr ? 'TOTAL RECETTES CUMULÉES' : 'TOTAL CUMULATIVE REVENUE', startX + 4, y + 7);
  doc.setFontSize(11);
  doc.text(formatAmount(grandTotalRevenue), startX + 4, y + 16);

  // Card 2: Cumulative Expenses
  startX += boxWidth + gap;
  doc.setFillColor(254, 242, 242); // red-50
  doc.setDrawColor(254, 202, 202);
  doc.roundedRect(startX, y, boxWidth, boxHeight, 2, 2, 'FD');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.setTextColor(153, 27, 27);
  doc.text(isFr ? 'TOTAL DÉPENSES CUMULÉES' : 'TOTAL CUMULATIVE EXPENSES', startX + 4, y + 7);
  doc.setFontSize(11);
  doc.text(formatAmount(grandTotalExpenses), startX + 4, y + 16);

  // Card 3: Net Cash Balance
  startX += boxWidth + gap;
  doc.setFillColor(248, 250, 252); // slate-50
  doc.setDrawColor(203, 213, 225);
  doc.roundedRect(startX, y, boxWidth, boxHeight, 2, 2, 'FD');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.setTextColor(30, 41, 59);
  doc.text(isFr ? 'SOLDE NET GLOBAL' : 'NET GLOBAL BALANCE', startX + 4, y + 7);
  doc.setFontSize(11);
  doc.setTextColor(grandNetBalance >= 0 ? 5 : 220, grandNetBalance >= 0 ? 150 : 38, grandNetBalance >= 0 ? 105 : 38);
  doc.text(formatAmount(grandNetBalance), startX + 4, y + 16);

  y += 32;

  // 3. Multi-Year Comparative Table
  doc.setFillColor(241, 245, 249);
  doc.rect(14, y, 182, 8, 'F');
  doc.setDrawColor(203, 213, 225);
  doc.line(14, y + 8, 196, y + 8);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.setTextColor(51, 65, 85);
  doc.text(isFr ? 'ANNÉE SCOLAIRE' : 'ACADEMIC YEAR', 18, y + 5.5);
  doc.text(isFr ? 'ÉLÈVES' : 'STUDENTS', 65, y + 5.5, { align: 'right' });
  doc.text(isFr ? 'RECETTES (FCFA)' : 'REVENUE (FCFA)', 105, y + 5.5, { align: 'right' });
  doc.text(isFr ? 'DÉPENSES (FCFA)' : 'EXPENSES (FCFA)', 145, y + 5.5, { align: 'right' });
  doc.text(isFr ? 'SOLDE NET' : 'NET BALANCE', 175, y + 5.5, { align: 'right' });
  doc.text(isFr ? 'STATUT' : 'STATUS', 194, y + 5.5, { align: 'right' });

  y += 8;

  yearData.forEach((yd, idx) => {
    const isAlt = idx % 2 === 1;
    if (isAlt) {
      doc.setFillColor(248, 250, 252);
      doc.rect(14, y, 182, 9, 'F');
    }
    doc.setDrawColor(226, 232, 240);
    doc.line(14, y + 9, 196, y + 9);

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8.5);
    doc.setTextColor(15, 23, 42);
    doc.text(yd.year, 18, y + 6);

    doc.setFont('helvetica', 'normal');
    doc.text(String(yd.studentCount), 65, y + 6, { align: 'right' });

    doc.setTextColor(5, 150, 105);
    doc.text(formatAmount(yd.revenue), 105, y + 6, { align: 'right' });

    doc.setTextColor(220, 38, 38);
    doc.text(formatAmount(yd.expenses), 145, y + 6, { align: 'right' });

    doc.setFont('helvetica', 'bold');
    doc.setTextColor(yd.balance >= 0 ? 5 : 220, yd.balance >= 0 ? 150 : 38, yd.balance >= 0 ? 105 : 38);
    doc.text(formatAmount(yd.balance), 175, y + 6, { align: 'right' });

    doc.setFontSize(7.5);
    doc.setTextColor(yd.isLocked ? 185 : 5, yd.isLocked ? 28 : 150, yd.isLocked ? 28 : 105);
    doc.text(yd.isLocked ? (isFr ? 'Clôturée' : 'Locked') : (isFr ? 'Active' : 'Active'), 194, y + 6, { align: 'right' });

    y += 9;
  });

  // Table Grand Total Row
  doc.setFillColor(241, 245, 249);
  doc.rect(14, y, 182, 10, 'F');
  doc.setDrawColor(148, 163, 184);
  doc.line(14, y + 10, 196, y + 10);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.setTextColor(15, 23, 42);
  doc.text(isFr ? 'TOTAL GÉNÉRAL CUMULÉ' : 'CUMULATIVE GRAND TOTAL', 18, y + 6.5);

  doc.setTextColor(5, 150, 105);
  doc.text(formatAmount(grandTotalRevenue), 105, y + 6.5, { align: 'right' });

  doc.setTextColor(220, 38, 38);
  doc.text(formatAmount(grandTotalExpenses), 145, y + 6.5, { align: 'right' });

  doc.setTextColor(grandNetBalance >= 0 ? 5 : 220, grandNetBalance >= 0 ? 150 : 38, grandNetBalance >= 0 ? 105 : 38);
  doc.text(formatAmount(grandNetBalance), 175, y + 6.5, { align: 'right' });

  y += 20;

  // 4. Certification & Notes Box
  doc.setFillColor(248, 250, 252);
  doc.setDrawColor(203, 213, 225);
  doc.roundedRect(14, y, 182, 32, 2, 2, 'FD');

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8.5);
  doc.setTextColor(30, 41, 59);
  doc.text(isFr ? 'NOTE EXPLICATIVE & CONDITIONS D\'ARCHIVAGE :' : 'EXPLANATORY NOTE & ARCHIVE CONDITIONS:', 18, y + 7);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.5);
  doc.setTextColor(71, 85, 105);
  const noteLines = isFr ? [
    '• Ce document récapitule les performances financières certifiées par exercice scolaire du Complexe Scolaire Mama Thera.',
    '• Les exercices clôturés et archivés sont figés en mode lecture seule pour garantir l\'intégrité comptable.',
    '• Les arriérés de scolarité non recouvrés sont reportés comme soldes d\'ouverture dans l\'exercice suivant.',
  ] : [
    '• This document summarizes certified financial performance by school year for Complexe Scolaire Mama Thera.',
    '• Closed and archived academic years are locked in read-only mode to guarantee accounting integrity.',
    '• Uncollected tuition arrears are carried forward as opening balances in the following academic year.',
  ];

  noteLines.forEach((line, i) => {
    doc.text(line, 18, y + 14 + (i * 5));
  });

  y += 42;

  // 5. Signatures Block
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8.5);
  doc.setTextColor(15, 23, 42);

  doc.text(isFr ? 'Pour le Gestionnaire / Économe' : 'For the General Manager / Accountant', 25, y);
  doc.text(isFr ? 'Pour la Direction / Promotrice' : 'For the Director / Promoter', 140, y);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.5);
  doc.setTextColor(100, 116, 139);
  doc.text(isFr ? 'Signature & Cachet' : 'Signature & Stamp', 25, y + 5);
  doc.text(isFr ? 'Signature & Cachet Officiel' : 'Official Signature & Stamp', 140, y + 5);

  // Official school stamp over the official-signature area
  await drawSchoolStamp(doc, 165, y + 17, 24);

  doc.setDrawColor(203, 213, 225);
  doc.line(25, y + 25, 80, y + 25);
  doc.line(140, y + 25, 190, y + 25);

  // Footer
  doc.setFontSize(7);
  doc.setTextColor(148, 163, 184);
  doc.text(
    `Complexe Scolaire MAMA THERA — Document Comptable Officiel Multi-Annuel — ${todayStr}`,
    105,
    288,
    { align: 'center' }
  );

  // Trigger Save / Download
  const filename = `MAMA_THERA_Bilan_Multi_Annuel_${new Date().toISOString().split('T')[0]}.pdf`;
  doc.save(filename);
}
