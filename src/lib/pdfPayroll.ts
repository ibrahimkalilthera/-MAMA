import type { Staff, SalaryPayment } from './useSupabaseData';
import { drawSchoolStamp } from './pdfStamp';
import { translations } from '../i18n/translations';
import type { TranslationDict } from '../i18n/translations';

export interface PayslipDataOptions {
  staffMember: Staff;
  payment: SalaryPayment;
  lang?: 'en' | 'fr';
}

/**
 * Generates and triggers download of a professional A5 Payslip (Bulletin de Paie) PDF for staff.
 */
export async function generateStaffPayslipPdf({
  staffMember,
  payment,
  lang = 'fr',
}: PayslipDataOptions): Promise<void> {
  const { jsPDF } = await import('jspdf');
  const t: TranslationDict = lang === 'fr' ? translations.fr : translations.en;
  const isFr = lang === 'fr';
  const currencySuffix = ' FCFA';
  const formatAmount = (val: number) => (val || 0).toLocaleString('fr-FR') + currencySuffix;

  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: 'a5',
  });

  const payslipNo = `PAY-${payment.id.slice(-6).toUpperCase()}`;
  const dateStr = payment.date 
    ? new Date(payment.date).toLocaleDateString(isFr ? 'fr-FR' : 'en-US', { year: 'numeric', month: 'long', day: 'numeric' })
    : new Date().toLocaleDateString(isFr ? 'fr-FR' : 'en-US', { year: 'numeric', month: 'long', day: 'numeric' });

  // 1. Dark Slate Header Bar
  doc.setFillColor(15, 23, 42); // #0f172a slate-900
  doc.rect(0, 0, 148, 22, 'F');

  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(13);
  doc.text('COMPLEXE SCOLAIRE MAMA THERA', 10, 10);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.text('Bamako, Mali — Gestion de la Paie / Payroll', 10, 16);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.text(t.pdfPayslipTitle, 138, 10, { align: 'right' });
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.text(`${t.pdfRefNo} ${payslipNo}`, 138, 16, { align: 'right' });

  let y = 28;

  // 2. Staff Details Card
  doc.setFillColor(248, 250, 252);
  doc.setDrawColor(226, 232, 240);
  doc.roundedRect(8, y, 132, 28, 2, 2, 'FD');

  doc.setTextColor(15, 23, 42);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.text(t.pdfEmployeeInfo, 12, y + 6);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(71, 85, 105);
  doc.text(`${t.pdfFullName}:`, 12, y + 13);
  doc.setTextColor(15, 23, 42);
  doc.setFont('helvetica', 'bold');
  doc.text(staffMember.name, 35, y + 13);

  doc.setFont('helvetica', 'normal');
  doc.setTextColor(71, 85, 105);
  doc.text(`${t.pdfPosition}:`, 80, y + 13);
  doc.setTextColor(15, 23, 42);
  doc.setFont('helvetica', 'bold');
  doc.text(staffMember.position, 105, y + 13);

  doc.setFont('helvetica', 'normal');
  doc.setTextColor(71, 85, 105);
  doc.text(`${t.pdfPhone}:`, 12, y + 20);
  doc.setTextColor(15, 23, 42);
  doc.text(staffMember.phone || '—', 35, y + 20);

  doc.setFont('helvetica', 'normal');
  doc.setTextColor(71, 85, 105);
  doc.text(`${t.pdfBankInfo}:`, 80, y + 20);
  doc.setTextColor(15, 23, 42);
  doc.text(staffMember.bankDetails || t.pdfCashTransfer, 110, y + 20);

  y += 34;

  // 3. Payment Period & Date Box
  doc.setFillColor(241, 245, 249);
  doc.roundedRect(8, y, 132, 14, 2, 2, 'F');

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(71, 85, 105);
  doc.text(`${t.pdfPaymentDate}:`, 12, y + 9);
  doc.setTextColor(15, 23, 42);
  doc.setFont('helvetica', 'bold');
  doc.text(dateStr, 42, y + 9);

  doc.setFont('helvetica', 'normal');
  doc.setTextColor(71, 85, 105);
  doc.text(`${t.pdfAcademicYear}:`, 80, y + 9);
  doc.setTextColor(15, 23, 42);
  doc.setFont('helvetica', 'bold');
  doc.text(payment.academicYear || staffMember.academicYear || '2025-2026', 110, y + 9);

  y += 20;

  // 4. Salary Table Header
  doc.setFillColor(15, 23, 42);
  doc.rect(8, y, 132, 7, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.text(t.pdfSalaryBreakdown, 12, y + 5);
  doc.text(t.pdfAmountFcfa, 136, y + 5, { align: 'right' });

  y += 7;

  // Base Salary Row
  doc.setFillColor(255, 255, 255);
  doc.setDrawColor(226, 232, 240);
  doc.rect(8, y, 132, 10, 'D');
  doc.setTextColor(15, 23, 42);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.text(t.pdfBaseSalary, 12, y + 6);
  doc.text(formatAmount(staffMember.salary), 136, y + 6, { align: 'right' });

  y += 10;

  // Payment Amount Row
  doc.setFillColor(248, 250, 252);
  doc.rect(8, y, 132, 10, 'FD');
  doc.setFont('helvetica', 'bold');
  doc.text(t.pdfPaidToday, 12, y + 6);
  doc.setTextColor(5, 150, 105);
  doc.text(formatAmount(payment.amount), 136, y + 6, { align: 'right' });

  y += 16;

  // 5. Total Net Box
  doc.setFillColor(240, 253, 244);
  doc.setDrawColor(167, 243, 208);
  doc.roundedRect(8, y, 132, 16, 2, 2, 'FD');

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.setTextColor(15, 23, 42);
  doc.text(t.pdfNetPaid, 12, y + 10);
  doc.setFontSize(11);
  doc.setTextColor(5, 150, 105);
  doc.text(formatAmount(payment.amount), 136, y + 10, { align: 'right' });

  y += 24;

  // 6. Signature & Stamp Blocks
  doc.setDrawColor(203, 213, 225);
  doc.setLineDashPattern([1, 1], 0);

  // Left: Employee Signature
  doc.roundedRect(12, y, 55, 22, 1, 1, 'D');
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7);
  doc.setTextColor(148, 163, 184);
  doc.text(t.pdfEmployeeSignature, 39.5, y + 6, { align: 'center' });
  doc.text(t.pdfAcknowledged, 39.5, y + 16, { align: 'center' });

  // Right: Employer Stamp (official school stamp) & Signature
  doc.roundedRect(81, y, 55, 22, 1, 1, 'D');
  await drawSchoolStamp(doc, 108.5, y + 11, 20);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7);
  doc.setTextColor(148, 163, 184);

  doc.setLineDashPattern([], 0);

  y += 26;

  // Footer text
  doc.setFont('helvetica', 'italic');
  doc.setFontSize(7);
  doc.setTextColor(148, 163, 184);
  doc.text(
    t.pdfPayslipFooter,
    74, 
    y, 
    { align: 'center' }
  );

  const fileName = `Bulletin_Paie_${staffMember.name.replace(/\s+/g, '_')}_${payment.date || 'rec'}.pdf`;
  doc.save(fileName);
}
