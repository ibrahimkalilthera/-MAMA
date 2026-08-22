import { jsPDF } from 'jspdf';
import type { Staff, SalaryPayment } from './useSupabaseData';

export interface MonthlyPayrollDraftOptions {
  monthIndex: number; // 0 to 11
  year: number;
  staff: Staff[];
  salaryPayments: SalaryPayment[];
  selectedAcademicYear?: string;
  lang?: 'en' | 'fr';
}

const MONTH_NAMES_FR = [
  'Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin',
  'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre'
];

const MONTH_NAMES_EN = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'
];

/**
 * Generates an executive A4 Monthly Payroll Draft / Bordereau Récapitulatif de Paie for Complexe Scolaire MAMA THERA.
 */
export function generateMonthlyPayrollDraftPdf({
  monthIndex,
  year,
  staff,
  salaryPayments,
  selectedAcademicYear = '2026-2027',
  lang = 'fr',
}: MonthlyPayrollDraftOptions): void {
  const isFr = lang === 'fr';
  const currencySuffix = ' FCFA';
  const formatAmount = (val: number) => (val || 0).toLocaleString('fr-FR') + currencySuffix;

  const doc = new jsPDF({
    orientation: 'landscape',
    unit: 'mm',
    format: 'a4',
  });

  const monthName = isFr ? MONTH_NAMES_FR[monthIndex] : MONTH_NAMES_EN[monthIndex];

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

    let status = isFr ? 'Non payé' : 'Unpaid';
    if (totalPaid >= s.salary && s.salary > 0) {
      status = isFr ? 'Entièrement payé' : 'Fully Paid';
    } else if (totalPaid > 0) {
      status = isFr ? 'Acompte versé' : 'Partial Paid';
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
    isFr
      ? `ÉTAT RÉCAPITULATIF & BORDEREAU DE PAIE DU PERSONNEL — MOIS DE ${monthName.toUpperCase()} ${year}`
      : `MONTHLY PAYROLL SUMMARY & SALARY DISBURSEMENT DRAFT — ${monthName.toUpperCase()} ${year}`,
    14,
    20
  );

  doc.setFontSize(8.5);
  doc.text(`Année Scolaire: ${selectedAcademicYear}`, 283, 11, { align: 'right' });
  doc.text(`Édité le: ${todayStr}`, 283, 20, { align: 'right' });

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
  doc.text(isFr ? 'MASSE SALARIALE THÉORIQUE' : 'TOTAL SALARY BUDGET', startX + 4, y + 6);
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
  doc.text(isFr ? 'TOTAL SALAIRES PAYÉS CE MOIS' : 'TOTAL SALARIES PAID THIS MONTH', startX + 4, y + 6);
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
  doc.text(isFr ? 'TOTAL RELIQUATS RESTANTS DÛS' : 'TOTAL REMAINING ARREARS', startX + 4, y + 6);
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
  doc.text(isFr ? 'TAUX D\'EXÉCUTION PAIE' : 'PAYROLL EXECUTION RATE', startX + 4, y + 6);
  doc.setFontSize(10.5);
  const execRate = grandTotalExpected > 0 ? ((grandTotalPaid / grandTotalExpected) * 100).toFixed(1) : '0';
  doc.text(`${execRate}% (${paidEmployeesCount}/${staff.length} ${isFr ? 'employés réglés' : 'staff paid'})`, startX + 4, y + 14);

  y += 24;

  // 3. Staff Table Header
  doc.setFillColor(241, 245, 249);
  doc.rect(14, y, 269, 7.5, 'F');
  doc.setDrawColor(203, 213, 225);
  doc.line(14, y + 7.5, 283, y + 7.5);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7.5);
  doc.setTextColor(51, 65, 85);
  doc.text('N°', 16, y + 5);
  doc.text(isFr ? 'NOM & PRÉNOM' : 'EMPLOYEE NAME', 28, y + 5);
  doc.text(isFr ? 'POSTE / FONCTION' : 'POSITION / ROLE', 82, y + 5);
  doc.text(isFr ? 'SALAIRE BASE' : 'BASE SALARY', 135, y + 5, { align: 'right' });
  doc.text(isFr ? 'VERSÉ CE MOIS' : 'PAID THIS MONTH', 170, y + 5, { align: 'right' });
  doc.text(isFr ? 'RELIQUAT DÛ' : 'REMAINING', 205, y + 5, { align: 'right' });
  doc.text(isFr ? 'DATE PAIE' : 'PAY DATE', 222, y + 5);
  doc.text(isFr ? 'STATUT' : 'STATUS', 248, y + 5);
  doc.text(isFr ? 'ÉMARGEMENT' : 'SIGNATURE', 281, y + 5, { align: 'right' });

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
    doc.text(isFr ? 'TOTAUX GÉNÉRAUX' : 'GRAND TOTALS', 28, y + 5.5);

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
      isFr ? 'Aucun membre du personnel enregistré pour cette période.' : 'No staff members registered for this period.',
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

  doc.text(isFr ? 'Pour le Gestionnaire / Comptable :' : 'For the General Manager / Accountant:', 30, y);
  doc.text(isFr ? 'Pour la Direction / Promotrice :' : 'For the Director / Promoter:', 190, y);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.5);
  doc.setTextColor(100, 116, 139);
  doc.text(isFr ? 'Signature & Visa de paiement' : 'Signature & Payment Verification', 30, y + 4.5);
  doc.text(isFr ? 'Approbation & Cachet Officiel' : 'Approval & Official Stamp', 190, y + 4.5);

  doc.setDrawColor(203, 213, 225);
  doc.line(30, y + 20, 100, y + 20);
  doc.line(190, y + 20, 260, y + 20);

  // Footer
  doc.setFontSize(7);
  doc.setTextColor(148, 163, 184);
  doc.text(
    `Complexe Scolaire MAMA THERA — Bordereau Mensuel de Paie — ${monthName} ${year} — Document Comptable Officiel`,
    148.5,
    202,
    { align: 'center' }
  );

  // Save / Download PDF
  const filename = `MAMA_THERA_Bordereau_Paie_${monthName}_${year}.pdf`;
  doc.save(filename);
}
