import type { Student, Payment } from './useSupabaseData';

export interface ReceiptDataOptions {
  student: Student;
  payment: Payment;
  lang?: 'en' | 'fr';
  cashierName?: string;
}

/**
 * Generates and triggers download of a clean, professional PDF receipt for a payment.
 */
export async function generatePaymentReceiptPdf({
  student,
  payment,
  lang = 'fr',
  cashierName = 'Administration',
}: ReceiptDataOptions): Promise<void> {
  const { jsPDF } = await import('jspdf');
  const isFr = lang === 'fr';
  const currencySuffix = ' FCFA';
  const formatAmount = (val: number) => (val || 0).toLocaleString('fr-FR') + currencySuffix;

  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: 'a5', // A5 format is ideal for receipts
  });

  const receiptNo = payment.receiptNumber || `REC-${Date.now().toString().slice(-6)}`;
  const dateStr = payment.date 
    ? new Date(payment.date).toLocaleDateString(isFr ? 'fr-FR' : 'en-US', { year: 'numeric', month: 'long', day: 'numeric' })
    : new Date().toLocaleDateString(isFr ? 'fr-FR' : 'en-US', { year: 'numeric', month: 'long', day: 'numeric' });

  // 1. Emerald Header Bar
  doc.setFillColor(5, 150, 105); // #059669 emerald-600
  doc.rect(0, 0, 148, 22, 'F');

  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(13);
  doc.text('COMPLEXE SCOLAIRE MAMA THERA', 10, 10);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.text('Bamako, Mali — Excellence & Éducation', 10, 16);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.text(isFr ? 'REÇU DE PAIEMENT' : 'PAYMENT RECEIPT', 138, 10, { align: 'right' });
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.text(`N°: ${receiptNo}`, 138, 16, { align: 'right' });

  let y = 28;

  // 2. Receipt Details Card (Slate Box)
  doc.setFillColor(248, 250, 252);
  doc.setDrawColor(226, 232, 240);
  doc.roundedRect(8, y, 132, 22, 2, 2, 'FD');

  doc.setTextColor(15, 23, 42);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.text(isFr ? 'DÉTAILS DE LA TRANSACTION' : 'TRANSACTION DETAILS', 12, y + 6);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(71, 85, 105);
  doc.text(`${isFr ? 'Date' : 'Date'}:`, 12, y + 12);
  doc.setTextColor(15, 23, 42);
  doc.setFont('helvetica', 'bold');
  doc.text(dateStr, 25, y + 12);

  doc.setFont('helvetica', 'normal');
  doc.setTextColor(71, 85, 105);
  doc.text(`${isFr ? 'Année scol.' : 'Acad. Year'}:`, 75, y + 12);
  doc.setTextColor(15, 23, 42);
  doc.setFont('helvetica', 'bold');
  doc.text(payment.academicYear || student.academicYear || '2025-2026', 100, y + 12);

  doc.setFont('helvetica', 'normal');
  doc.setTextColor(71, 85, 105);
  doc.text(`${isFr ? 'Caissier' : 'Cashier'}:`, 12, y + 17);
  doc.setTextColor(15, 23, 42);
  doc.text(cashierName, 30, y + 17);

  y += 28;

  // 3. Student Information Section
  doc.setFillColor(241, 245, 249);
  doc.roundedRect(8, y, 132, 26, 2, 2, 'F');

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.setTextColor(15, 23, 42);
  doc.text(isFr ? 'INFORMATIONSÉLÈVE & PARENT' : 'STUDENT & PARENT INFO', 12, y + 6);

  doc.setFont('helvetica', 'normal');
  doc.setTextColor(71, 85, 105);
  doc.text(`${isFr ? 'Élève' : 'Student'}:`, 12, y + 13);
  doc.setTextColor(15, 23, 42);
  doc.setFont('helvetica', 'bold');
  doc.text(student.name, 30, y + 13);

  doc.setFont('helvetica', 'normal');
  doc.setTextColor(71, 85, 105);
  doc.text(`${isFr ? 'Classe' : 'Grade'}:`, 85, y + 13);
  doc.setTextColor(15, 23, 42);
  doc.setFont('helvetica', 'bold');
  doc.text(student.grade || '—', 100, y + 13);

  doc.setFont('helvetica', 'normal');
  doc.setTextColor(71, 85, 105);
  doc.text(`${isFr ? 'Parent/Tuteur' : 'Parent/Guardian'}:`, 12, y + 20);
  doc.setTextColor(15, 23, 42);
  doc.text(`${student.parentName} (${student.parentPhone || '—'})`, 38, y + 20);

  y += 32;

  // 4. Payment Table Header
  doc.setFillColor(16, 185, 129); // emerald-500
  doc.rect(8, y, 132, 7, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.text(isFr ? 'DESCRIPTION / MOTIF DE PAIEMENT' : 'DESCRIPTION / PAYMENT ITEM', 12, y + 5);
  doc.text(isFr ? 'MONTANT REÇU' : 'AMOUNT RECEIVED', 136, y + 5, { align: 'right' });

  y += 7;

  // 5. Payment Row
  doc.setFillColor(255, 255, 255);
  doc.setDrawColor(226, 232, 240);
  doc.rect(8, y, 132, 12, 'D');

  doc.setTextColor(15, 23, 42);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.text(isFr ? 'Frais de Scolarité / PAIEMENT REÇU' : 'Tuition Fees / PAYMENT RECEIVED', 12, y + 7);
  doc.setFont('helvetica', 'bold');
  doc.text(formatAmount(payment.amount), 136, y + 7, { align: 'right' });

  y += 16;

  // 6. Summary Balance Card
  doc.setFillColor(240, 253, 244); // emerald-50
  doc.setDrawColor(167, 243, 208); // emerald-200
  doc.roundedRect(8, y, 132, 26, 2, 2, 'FD');

  const remaining = Math.max(0, student.totalDue - student.amountPaid);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(71, 85, 105);
  doc.text(isFr ? 'Total Scolarité dûe:' : 'Total Due:', 12, y + 7);
  doc.text(formatAmount(student.totalDue), 60, y + 7);

  doc.text(isFr ? 'Total Cumulé Payé:' : 'Total Cumulative Paid:', 12, y + 13);
  doc.text(formatAmount(student.amountPaid), 60, y + 13);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.setTextColor(remaining > 0 ? 185 : 5, remaining > 0 ? 28 : 150, remaining > 0 ? 28 : 105);
  doc.text(isFr ? 'Reste à Payer / Solde:' : 'Remaining Balance:', 12, y + 21);
  doc.text(formatAmount(remaining), 136, y + 21, { align: 'right' });

  y += 32;

  // 7. Signatures & Stamp Section
  doc.setDrawColor(203, 213, 225);
  doc.setLineDashPattern([1, 1], 0);

  // Left box: Stamp
  doc.roundedRect(12, y, 55, 22, 1, 1, 'D');
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7);
  doc.setTextColor(148, 163, 184);
  doc.text(isFr ? '[ Cachet de l\'Établissement ]' : '[ School Official Stamp ]', 39.5, y + 12, { align: 'center' });

  // Right box: Signature
  doc.roundedRect(81, y, 55, 22, 1, 1, 'D');
  doc.text(isFr ? '[ Signature du Caissier ]' : '[ Cashier Signature ]', 108.5, y + 12, { align: 'center' });

  doc.setLineDashPattern([], 0); // reset line pattern

  y += 26;

  // 8. Footer note
  doc.setFont('helvetica', 'italic');
  doc.setFontSize(7);
  doc.setTextColor(148, 163, 184);
  doc.text(
    isFr 
      ? 'Document officiel délivré par le Complexe Scolaire MAMA THERA. Conserver ce reçu comme preuve de paiement.' 
      : 'Official document issued by Complexe Scolaire MAMA THERA. Keep this receipt as proof of payment.',
    74, 
    y, 
    { align: 'center' }
  );

  // Trigger Save
  const fileName = `Recu_${receiptNo}_${student.name.replace(/\s+/g, '_')}.pdf`;
  doc.save(fileName);
}
