import type { Student, Expense, VendorExpense, SalaryPayment } from './useSupabaseData';
import { drawSchoolStamp } from './pdfStamp';

export interface FinancialReportDataOptions {
  students: Student[];
  expenses: Expense[];
  vendorExpenses: VendorExpense[];
  salaryPayments: SalaryPayment[];
  selectedYear: string;
  lang?: 'en' | 'fr';
}

/**
 * Generates an executive A4 Financial Report PDF for Complexe Scolaire MAMA THERA.
 */
export async function generateFinancialReportPdf({
  students,
  expenses,
  vendorExpenses,
  salaryPayments,
  selectedYear,
  lang = 'fr',
}: FinancialReportDataOptions): Promise<void> {
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

  // Calculate Financial Aggregates
  const totalTuitionDue = students.reduce((sum, s) => {
    const discount = s.scholarshipDiscount || 0;
    return sum + (s.totalDue * (1 - discount / 100));
  }, 0);

  const totalTuitionCollected = students.reduce((sum, s) => sum + (s.amountPaid || 0), 0);
  const totalTuitionOutstanding = Math.max(0, totalTuitionDue - totalTuitionCollected);

  const totalGeneralExpenses = expenses.reduce((sum, e) => sum + (e.amount || 0), 0);
  const totalVendorExpensesPaid = vendorExpenses.reduce((sum, ve) => sum + (ve.amountPaid || 0), 0);
  const totalStaffSalariesPaid = salaryPayments.reduce((sum, sp) => sum + (sp.amount || 0), 0);

  const totalOperatingOutflows = totalGeneralExpenses + totalVendorExpensesPaid + totalStaffSalariesPaid;
  const netOperatingIncome = totalTuitionCollected - totalOperatingOutflows;
  const collectionRate = totalTuitionDue > 0 ? ((totalTuitionCollected / totalTuitionDue) * 100).toFixed(1) : '0';

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
    isFr ? `RAPPORT FINANCIER & CONSOLIDE — ANNEE SCOLAIRE ${selectedYear}` : `CONSOLIDATED FINANCIAL REPORT — ACADEMIC YEAR ${selectedYear}`,
    14,
    22
  );

  doc.setFontSize(9);
  doc.text(`Bamako, Mali`, 196, 13, { align: 'right' });
  doc.text(`${isFr ? 'Date :' : 'Date:'} ${todayStr}`, 196, 22, { align: 'right' });

  let y = 38;

  // 2. Executive KPI Cards (4 Summary Boxes)
  const boxWidth = 42;
  const boxHeight = 22;
  const gap = 4;
  let startX = 14;

  // Card 1: Revenue Collected
  doc.setFillColor(240, 253, 244); // emerald-50
  doc.setDrawColor(167, 243, 208);
  doc.roundedRect(startX, y, boxWidth, boxHeight, 2, 2, 'FD');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7);
  doc.setTextColor(6, 95, 70);
  doc.text(isFr ? 'RECETTES ENCAISSÉES' : 'REVENUE COLLECTED', startX + 4, y + 6);
  doc.setFontSize(10);
  doc.text(formatAmount(totalTuitionCollected), startX + 4, y + 16);

  // Card 2: Total Outflows / Expenses
  startX += boxWidth + gap;
  doc.setFillColor(254, 242, 242); // red-50
  doc.setDrawColor(254, 202, 202);
  doc.roundedRect(startX, y, boxWidth, boxHeight, 2, 2, 'FD');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7);
  doc.setTextColor(153, 27, 27);
  doc.text(isFr ? 'TOTAL DÉPENSES' : 'TOTAL OUTFLOWS', startX + 4, y + 6);
  doc.setFontSize(10);
  doc.text(formatAmount(totalOperatingOutflows), startX + 4, y + 16);

  // Card 3: Net Operating Income
  startX += boxWidth + gap;
  const isPositive = netOperatingIncome >= 0;
  doc.setFillColor(isPositive ? 236 : 254, isPositive ? 253 : 242, isPositive ? 245 : 242);
  doc.setDrawColor(isPositive ? 167 : 254, isPositive ? 243 : 202, isPositive ? 208 : 202);
  doc.roundedRect(startX, y, boxWidth, boxHeight, 2, 2, 'FD');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7);
  doc.setTextColor(isPositive ? 6 : 153, isPositive ? 95 : 27, isPositive ? 70 : 27);
  doc.text(isFr ? 'SOLDE NET EN CAISSE' : 'NET OPERATING INCOME', startX + 4, y + 6);
  doc.setFontSize(10);
  doc.text(formatAmount(netOperatingIncome), startX + 4, y + 16);

  // Card 4: Collection Rate
  startX += boxWidth + gap;
  doc.setFillColor(248, 250, 252);
  doc.setDrawColor(226, 232, 240);
  doc.roundedRect(startX, y, boxWidth, boxHeight, 2, 2, 'FD');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7);
  doc.setTextColor(30, 41, 59);
  doc.text(isFr ? 'TAUX DE RECOUVREMENT' : 'COLLECTION RATE', startX + 4, y + 6);
  doc.setFontSize(11);
  doc.text(`${collectionRate} %`, startX + 4, y + 16);

  y += 30;

  // 3. Section: Revenue Breakdown
  doc.setFillColor(241, 245, 249);
  doc.rect(14, y, 182, 7, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.setTextColor(15, 23, 42);
  doc.text(isFr ? '1. RECOUVREMENT DES FRAIS DE SCOLARITÉ' : '1. TUITION FEE COLLECTION SUMMARY', 18, y + 5);

  y += 10;

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(71, 85, 105);

  const revenueRows = [
    [isFr ? 'Scolarités totales dues' : 'Total Tuition Expected', formatAmount(totalTuitionDue)],
    [isFr ? 'Scolarités effectivement encaissées' : 'Total Tuition Collected', formatAmount(totalTuitionCollected)],
    [isFr ? 'Reste à recouvrir (Impayés)' : 'Total Outstanding Balance', formatAmount(totalTuitionOutstanding)],
    [isFr ? 'Effectif des élèves inscrits' : 'Total Enrolled Students', `${students.length} ${isFr ? 'élèves' : 'students'}`],
  ];

  revenueRows.forEach(([label, value]) => {
    doc.text(label, 18, y);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(15, 23, 42);
    doc.text(value, 190, y, { align: 'right' });
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(71, 85, 105);
    doc.setDrawColor(241, 245, 249);
    doc.line(18, y + 2, 190, y + 2);
    y += 8;
  });

  y += 6;

  // 4. Section: Outflows & Operating Expenses Breakdown
  doc.setFillColor(241, 245, 249);
  doc.rect(14, y, 182, 7, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.setTextColor(15, 23, 42);
  doc.text(isFr ? '2. DÉPENSES D\'EXPLOITATION & SALAIRES' : '2. OPERATING EXPENSES & PAYROLL', 18, y + 5);

  y += 10;

  const expenseRows = [
    [isFr ? 'Salaires du Personnel versés' : 'Staff Salary Outflows', formatAmount(totalStaffSalariesPaid)],
    [isFr ? 'Charges et Fournisseurs payés' : 'Vendor Expenses Paid', formatAmount(totalVendorExpensesPaid)],
    [isFr ? 'Autres Dépenses générales' : 'General Operating Expenses', formatAmount(totalGeneralExpenses)],
    [isFr ? 'TOTAL DES DÉCAISSEMENTS' : 'TOTAL OPERATING OUTFLOWS', formatAmount(totalOperatingOutflows)],
  ];

  expenseRows.forEach(([label, value], idx) => {
    const isTotalRow = idx === expenseRows.length - 1;
    if (isTotalRow) doc.setFont('helvetica', 'bold');
    doc.text(label, 18, y);
    doc.setTextColor(isTotalRow ? 185 : 15, isTotalRow ? 28 : 23, isTotalRow ? 28 : 42);
    doc.text(value, 190, y, { align: 'right' });
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(71, 85, 105);
    doc.setDrawColor(241, 245, 249);
    doc.line(18, y + 2, 190, y + 2);
    y += 8;
  });

  y += 12;

  // 5. Signatures & Approval Block
  doc.setDrawColor(203, 213, 225);
  doc.roundedRect(14, y, 182, 35, 2, 2, 'D');

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.setTextColor(15, 23, 42);
  doc.text(isFr ? 'APPROBATION ET CERTIFICATION DES COMPTES' : 'ACCOUNT APPROVAL & CERTIFICATION', 18, y + 7);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(100, 116, 139);
  doc.text(isFr ? 'Visa du Comptable Principal' : 'Head Accountant Visa', 35, y + 16);
  doc.text(isFr ? 'Visa de la Direction / Promoteur' : 'School Management Visa', 135, y + 16);

  doc.setFont('helvetica', 'italic');
  doc.setFontSize(7);
  doc.text(isFr ? '[ Signature et Date ]' : '[ Signature & Date ]', 35, y + 28);
  // Official school stamp over the management visa
  await drawSchoolStamp(doc, 135, y + 24, 22);

  y += 42;

  // Footer text
  doc.setFont('helvetica', 'italic');
  doc.setFontSize(8);
  doc.setTextColor(148, 163, 184);
  doc.text(
    isFr
      ? 'Document confidentiel généré par le système de gestion financière MAMA THERA — Bamako, Mali.'
      : 'Confidential document generated by MAMA THERA Finance Suite — Bamako, Mali.',
    105,
    285,
    { align: 'center' }
  );

  const fileName = `Rapport_Financier_MAMA_THERA_${selectedYear}.pdf`;
  doc.save(fileName);
}
