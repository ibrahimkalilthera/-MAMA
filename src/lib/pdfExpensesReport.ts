import { jsPDF } from 'jspdf';
import type { Expense, VendorExpense } from './useSupabaseData';

export interface ExpensesReportOptions {
  expenses: Expense[];
  vendorExpenses: VendorExpense[];
  selectedYear: string;
  subTab?: 'general' | 'vendors' | 'all';
  lang?: 'en' | 'fr';
}

/**
 * Generates an executive A4 Expenses & Operational Outflows PDF Report for Complexe Scolaire MAMA THERA.
 */
export function generateExpensesReportPdf({
  expenses,
  vendorExpenses,
  selectedYear,
  subTab = 'all',
  lang = 'fr',
}: ExpensesReportOptions): void {
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

  // Filter expenses by academic year
  const filteredGeneralExpenses = expenses.filter(e => !selectedYear || e.academicYear === selectedYear);
  const filteredVendorExpenses = vendorExpenses.filter(v => !selectedYear || v.academicYear === selectedYear);

  const totalGeneral = filteredGeneralExpenses.reduce((sum, e) => sum + (e.amount || 0), 0);
  const totalVendorInvoiced = filteredVendorExpenses.reduce((sum, v) => sum + (v.amount || 0), 0);
  const totalVendorPaid = filteredVendorExpenses.reduce((sum, v) => {
    if (v.paymentStatus === 'paid') return sum + (v.amount || 0);
    if (v.paymentStatus === 'partial') return sum + (v.amountPaid || 0);
    return sum;
  }, 0);
  const totalVendorOutstanding = Math.max(0, totalVendorInvoiced - totalVendorPaid);
  const grandTotalOutflows = totalGeneral + totalVendorPaid;

  // 1. Header Banner
  doc.setFillColor(225, 29, 72); // rose-600
  doc.rect(0, 0, 210, 30, 'F');

  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(16);
  doc.text('COMPLEXE SCOLAIRE MAMA THERA', 14, 13);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.text(
    isFr ? `RAPPORT DES DÉPENSES & CHARGES D'EXPLOITATION — ${selectedYear}` : `EXPENSES & OPERATING OUTFLOWS REPORT — ${selectedYear}`,
    14,
    22
  );

  doc.setFontSize(9);
  doc.text(`Bamako, Mali`, 196, 13, { align: 'right' });
  doc.text(`Date: ${todayStr}`, 196, 22, { align: 'right' });

  let y = 38;

  // 2. Executive KPI Cards (3 Summary Boxes)
  const boxWidth = 57;
  const boxHeight = 22;
  const gap = 5;
  let startX = 14;

  // Card 1: General Expenses Total
  doc.setFillColor(255, 241, 242); // rose-50
  doc.setDrawColor(254, 205, 211);
  doc.roundedRect(startX, y, boxWidth, boxHeight, 2, 2, 'FD');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.setTextColor(159, 18, 57);
  doc.text(isFr ? 'DÉPENSES GÉNÉRALES' : 'GENERAL EXPENSES', startX + 4, y + 7);
  doc.setFontSize(11);
  doc.text(formatAmount(totalGeneral), startX + 4, y + 16);

  // Card 2: Vendor / Service Charges Paid
  startX += boxWidth + gap;
  doc.setFillColor(243, 244, 246); // gray-50
  doc.setDrawColor(229, 231, 235);
  doc.roundedRect(startX, y, boxWidth, boxHeight, 2, 2, 'FD');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.setTextColor(31, 41, 55);
  doc.text(isFr ? 'FOURNISSEURS RÉGLÉS' : 'VENDOR CHARGES PAID', startX + 4, y + 7);
  doc.setFontSize(11);
  doc.text(formatAmount(totalVendorPaid), startX + 4, y + 16);

  // Card 3: Grand Total Operating Outflows
  startX += boxWidth + gap;
  doc.setFillColor(254, 242, 242); // red-50
  doc.setDrawColor(254, 202, 202);
  doc.roundedRect(startX, y, boxWidth, boxHeight, 2, 2, 'FD');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.setTextColor(185, 28, 28);
  doc.text(isFr ? 'TOTAL DÉCAISSEMENTS' : 'TOTAL OUTFLOWS', startX + 4, y + 7);
  doc.setFontSize(11);
  doc.text(formatAmount(grandTotalOutflows), startX + 4, y + 16);

  y += 30;

  // 3. Itemized Tables

  // Section A: General Expenses Log
  if (subTab === 'all' || subTab === 'general') {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.setTextColor(15, 23, 42);
    doc.text(isFr ? '1. Journal des Dépenses Générales' : '1. General Expenses Log', 14, y);
    y += 4;

    doc.setFillColor(241, 245, 249);
    doc.rect(14, y, 182, 7, 'F');
    doc.setDrawColor(203, 213, 225);
    doc.line(14, y + 7, 196, y + 7);

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    doc.setTextColor(51, 65, 85);
    doc.text(isFr ? 'DATE' : 'DATE', 18, y + 5);
    doc.text(isFr ? 'CATÉGORIE' : 'CATEGORY', 50, y + 5);
    doc.text(isFr ? 'DESCRIPTION / MOTIF' : 'DESCRIPTION', 95, y + 5);
    doc.text(isFr ? 'MONTANT (FCFA)' : 'AMOUNT (FCFA)', 190, y + 5, { align: 'right' });

    y += 7;

    if (filteredGeneralExpenses.length > 0) {
      filteredGeneralExpenses.forEach((exp, idx) => {
        if (y > 250) {
          doc.addPage();
          y = 20;
        }

        const isAlt = idx % 2 === 1;
        if (isAlt) {
          doc.setFillColor(248, 250, 252);
          doc.rect(14, y, 182, 7.5, 'F');
        }
        doc.setDrawColor(226, 232, 240);
        doc.line(14, y + 7.5, 196, y + 7.5);

        doc.setFont('helvetica', 'normal');
        doc.setFontSize(8);
        doc.setTextColor(100, 116, 139);
        doc.text(exp.date, 18, y + 5);

        doc.setFont('helvetica', 'bold');
        doc.setTextColor(159, 18, 57);
        doc.text(exp.category, 50, y + 5);

        doc.setFont('helvetica', 'normal');
        doc.setTextColor(15, 23, 42);
        doc.text(exp.description ? (exp.description.length > 45 ? exp.description.slice(0, 42) + '...' : exp.description) : '—', 95, y + 5);

        doc.setFont('helvetica', 'bold');
        doc.setTextColor(220, 38, 38);
        doc.text(formatAmount(exp.amount), 190, y + 5, { align: 'right' });

        y += 7.5;
      });
    } else {
      doc.setFont('helvetica', 'italic');
      doc.setFontSize(8);
      doc.setTextColor(148, 163, 184);
      doc.text(isFr ? 'Aucune dépense générale enregistrée pour cette période.' : 'No general expenses recorded for this period.', 18, y + 6);
      y += 9;
    }

    y += 8;
  }

  // Section B: Vendor Expenses Log
  if (subTab === 'all' || subTab === 'vendors') {
    if (y > 220) {
      doc.addPage();
      y = 20;
    }

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.setTextColor(15, 23, 42);
    doc.text(isFr ? '2. Fournisseurs, Services & Cas Sociaux' : '2. Vendors, Services & Social Cases', 14, y);
    y += 4;

    doc.setFillColor(241, 245, 249);
    doc.rect(14, y, 182, 7, 'F');
    doc.setDrawColor(203, 213, 225);
    doc.line(14, y + 7, 196, y + 7);

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    doc.setTextColor(51, 65, 85);
    doc.text(isFr ? 'FOURNISSEUR / BÉNÉFICIAIRE' : 'VENDOR / BENEFICIARY', 18, y + 5);
    doc.text(isFr ? 'CATÉGORIE' : 'CATEGORY', 80, y + 5);
    doc.text(isFr ? 'ÉCHÉANCE' : 'DUE DATE', 120, y + 5);
    doc.text(isFr ? 'STATUT' : 'STATUS', 150, y + 5);
    doc.text(isFr ? 'MONTANT (FCFA)' : 'AMOUNT (FCFA)', 190, y + 5, { align: 'right' });

    y += 7;

    if (filteredVendorExpenses.length > 0) {
      filteredVendorExpenses.forEach((ve, idx) => {
        if (y > 250) {
          doc.addPage();
          y = 20;
        }

        const isAlt = idx % 2 === 1;
        if (isAlt) {
          doc.setFillColor(248, 250, 252);
          doc.rect(14, y, 182, 7.5, 'F');
        }
        doc.setDrawColor(226, 232, 240);
        doc.line(14, y + 7.5, 196, y + 7.5);

        doc.setFont('helvetica', 'bold');
        doc.setFontSize(8);
        doc.setTextColor(15, 23, 42);
        const nameText = ve.vendorName || ve.beneficiaryStudentName || '—';
        doc.text(nameText.length > 30 ? nameText.slice(0, 27) + '...' : nameText, 18, y + 5);

        doc.setFont('helvetica', 'normal');
        doc.setTextColor(71, 85, 105);
        doc.text(ve.category, 80, y + 5);
        doc.text(ve.dueDate || '—', 120, y + 5);

        // Status badge text
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(7.5);
        if (ve.paymentStatus === 'paid') {
          doc.setTextColor(5, 150, 105);
          doc.text(isFr ? 'Payé' : 'Paid', 150, y + 5);
        } else if (ve.paymentStatus === 'partial') {
          doc.setTextColor(217, 119, 6);
          doc.text(isFr ? 'Partiel' : 'Partial', 150, y + 5);
        } else {
          doc.setTextColor(220, 38, 38);
          doc.text(isFr ? 'Non payé' : 'Unpaid', 150, y + 5);
        }

        doc.setFont('helvetica', 'bold');
        doc.setFontSize(8);
        doc.setTextColor(15, 23, 42);
        doc.text(formatAmount(ve.amount), 190, y + 5, { align: 'right' });

        y += 7.5;
      });
    } else {
      doc.setFont('helvetica', 'italic');
      doc.setFontSize(8);
      doc.setTextColor(148, 163, 184);
      doc.text(isFr ? 'Aucun engagement fournisseur ou cas social enregistré pour cette période.' : 'No vendor commitments or social cases recorded for this period.', 18, y + 6);
      y += 9;
    }
  }

  // 4. Signatures & Stamp Block
  if (y > 230) {
    doc.addPage();
    y = 25;
  } else {
    y = Math.max(y + 12, 235);
  }

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8.5);
  doc.setTextColor(15, 23, 42);

  doc.text(isFr ? 'L\'Économe / Responsable Achats' : 'The Accountant / Purchasing Lead', 25, y);
  doc.text(isFr ? 'La Direction / Promotrice' : 'The Director / Promoter', 140, y);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.5);
  doc.setTextColor(100, 116, 139);
  doc.text(isFr ? 'Signature & Visa' : 'Signature & Verification', 25, y + 5);
  doc.text(isFr ? 'Approbation & Cachet' : 'Approval & Official Stamp', 140, y + 5);

  doc.setDrawColor(203, 213, 225);
  doc.line(25, y + 25, 80, y + 25);
  doc.line(140, y + 25, 190, y + 25);

  // Footer
  doc.setFontSize(7);
  doc.setTextColor(148, 163, 184);
  doc.text(
    `Complexe Scolaire MAMA THERA — Bilan des Charges & Dépenses — ${todayStr}`,
    105,
    288,
    { align: 'center' }
  );

  // Trigger Save / Download
  const filename = `MAMA_THERA_Rapport_Depenses_${selectedYear}_${new Date().toISOString().split('T')[0]}.pdf`;
  doc.save(filename);
}
