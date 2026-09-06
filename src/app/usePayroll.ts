/**
 * Payroll/staff domain hook — extracted verbatim from App.tsx.
 *
 * Owns the staff & payroll domain: the staff CRUD form (`staffForm`,
 * `editingStaff`, open/close state), the salary record form (`salaryForm`,
 * modal state), the payroll draft modal state (month/year), the staff search
 * + bank-details visibility, the filtered staff list, the two submit
 * handlers (`handleStaffSubmit`, `handleSalarySubmit`), the edit-staff opener
 * and the monthly payroll Excel export (`handleExportMonthlyPayrollExcel`).
 * App.tsx only consumes the returned API — the props contracts passed down to
 * MainViews/AppModals are unchanged (guards verify the wiring).
 *
 * Call-site note: the hook takes staff/salaryPayments/showToast and the
 * mutators as arguments, so App.tsx must call it after those are declared.
 */
import { useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import type { Staff, SalaryPayment } from '../app/types';
import type { TranslationDict } from '../i18n/translations';
import { drawSchoolStamp } from '../lib/pdfStamp';

interface UsePayrollDeps {
  t: TranslationDict;
  lang: 'en' | 'fr';
  selectedYear: string;
  lockedYears: string[];
  staff: Staff[];
  salaryPayments: SalaryPayment[];
  showToast: () => void;
  /** Toast an error/validation message (replaces the native alert()). */
  toastError: (message: string) => void;
  addStaff: (s: Omit<Staff, 'id'>) => Promise<Staff | null>;
  updateStaff: (id: string, updates: Partial<Staff>) => Promise<boolean>;
  addSalaryPayment: (sp: Omit<SalaryPayment, 'id'>) => Promise<SalaryPayment | null>;
}

export function usePayroll(deps: UsePayrollDeps) {
  const { t, lang, selectedYear, lockedYears, staff, salaryPayments, showToast, toastError, addStaff, updateStaff, addSalaryPayment } = deps;

  const [showStaffModal, setShowStaffModal] = useState(false);
  const [showMonthlyDraftModal, setShowMonthlyDraftModal] = useState(false);
  const [selectedDraftMonth, setSelectedDraftMonth] = useState<number>(new Date().getMonth());
  const [selectedDraftYear, setSelectedDraftYear] = useState<number>(new Date().getFullYear());
  const [showSalaryModal, setShowSalaryModal] = useState(false);

  const [staffForm, setStaffForm] = useState({ name: '', position: '', salary: '', email: '', phone: '', bankDetails: '', emergencyContact: '' });
  const [staffSearchTerm, setStaffSearchTerm] = useState('');
  const [visibleBankDetails, setVisibleBankDetails] = useState<Record<string, boolean>>({});
  const [salaryForm, setSalaryForm] = useState({ staffId: '', amount: '', date: new Date().toISOString().split('T')[0] });

  const [editingStaff, setEditingStaff] = useState<Staff | null>(null);

  const filteredStaff = useMemo(() => {
    return staff.filter(s =>
      s.name.toLowerCase().includes(staffSearchTerm.toLowerCase()) ||
      s.phone.toLowerCase().includes(staffSearchTerm.toLowerCase())
    );
  }, [staff, staffSearchTerm]);

  const handleStaffSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (lockedYears.includes(selectedYear)) {
      toastError(t.thisAcademicYearIsLocked);
      return;
    }
    const salary = parseFloat(staffForm.salary);
    if (isNaN(salary) || salary < 0) return;

    const staffData = {
      ...staffForm,
      salary,
      email: staffForm.email.trim(),
      phone: staffForm.phone.trim(),
      bankDetails: staffForm.bankDetails.trim(),
      emergencyContact: staffForm.emergencyContact.trim(),
    };
    const saved = editingStaff
      ? await updateStaff(editingStaff.id, staffData)
      : await addStaff(staffData);
    if (!saved) return;
    setShowStaffModal(false);
    setEditingStaff(null);
    setStaffForm({ name: '', position: '', salary: '', email: '', phone: '', bankDetails: '', emergencyContact: '' });
    showToast();
  };

  const handleSalarySubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (lockedYears.includes(selectedYear)) {
      toastError(t.thisAcademicYearIsLocked);
      return;
    }
    const amount = parseFloat(salaryForm.amount);
    if (isNaN(amount) || amount < 0) return;

    const saved = await addSalaryPayment({
      staffId: salaryForm.staffId,
      amount,
      date: salaryForm.date,
      academicYear: selectedYear || undefined,
    });
    if (!saved) return;
    setShowSalaryModal(false);
    setSalaryForm({ staffId: '', amount: '', date: new Date().toISOString().split('T')[0] });
    showToast();
  };

  const openEditStaffModal = (s: Staff) => {
    setEditingStaff(s);
    setStaffForm({
      name: s.name,
      position: s.position,
      salary: s.salary.toString(),
      email: s.email || '',
      phone: s.phone || '',
      bankDetails: s.bankDetails || '',
      emergencyContact: s.emergencyContact || ''
    });
    setShowStaffModal(true);
  };

  /**
   * Per-employee consolidated salary receipt PDF (mirrors the parent ledger
   * receipt): header band, employee info block, cumulative-paid summary,
   * the full salary payment history for this staff member and the official
   * footer. A4 portrait, emerald band like the parent version.
   */
  const handleExportStaffReceiptPdf = async (staffMember: Staff) => {
    const { jsPDF } = await import('jspdf');
    const isFr = lang === 'fr';
    const currencySuffix = ' FCFA';
    const formatPdfAmount = (val: number) => (val || 0).toLocaleString('fr-FR') + currencySuffix;

    const payments = salaryPayments
      .filter(p => p.staffId === staffMember.id)
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
    const totalPaidEver = payments.reduce((sum, p) => sum + (p.amount || 0), 0);

    const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });

    const todayStr = new Date().toLocaleDateString(isFr ? 'fr-FR' : 'en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });

    // Header band (emerald, same family as the parent receipt)
    doc.setFillColor(5, 150, 105);
    doc.rect(0, 0, 210, 28, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(15);
    doc.text('COMPLEXE SCOLAIRE MAMA THERA', 14, 12);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10);
    doc.text(t.consolidatedSalaryReceipt, 14, 20);
    doc.setFontSize(9);
    doc.text(`${t.pdfDateColon} ${todayStr}`, 196, 12, { align: 'right' });
    doc.text(`REF: REC-SAL-${staffMember.id.toUpperCase()}`, 196, 20, { align: 'right' });

    let y = 36;

    // Employee info block
    doc.setFillColor(248, 250, 252);
    doc.setDrawColor(226, 232, 240);
    doc.roundedRect(14, y, 182, 32, 3, 3, 'FD');

    doc.setTextColor(15, 23, 42);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.text(`${t.employeeName}: ${staffMember.name}`, 18, y + 8);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.setTextColor(71, 85, 105);
    doc.text(`${t.position}: ${staffMember.position}`, 18, y + 15);
    doc.text(`${t.phone2}: ${staffMember.phone || '—'}`, 18, y + 21);
    doc.text(`${t.bankDetails}: ${staffMember.bankDetails || '—'}`, 18, y + 27);

    doc.text(`${t.monthlySalary}: ${formatPdfAmount(staffMember.salary)}`, 115, y + 15);
    doc.text(`${t.academicYear2}: ${selectedYear || staffMember.academicYear || '2026-2027'}`, 115, y + 21);

    y += 40;

    // Summary financial banner
    doc.setFillColor(236, 253, 245);
    doc.setDrawColor(167, 243, 208);
    doc.roundedRect(14, y, 182, 18, 3, 3, 'FD');

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.setTextColor(6, 95, 70);
    doc.text(t.cumulativePaymentsMade, 18, y + 8);
    doc.setFontSize(11);
    doc.text(formatPdfAmount(totalPaidEver), 18, y + 14);

    doc.setFontSize(9);
    doc.setTextColor(153, 27, 27);
    doc.text(t.remainingBalanceFcfa, 115, y + 8);
    doc.setFontSize(11);
    doc.text(formatPdfAmount(Math.max(0, staffMember.salary - totalPaidEver)), 115, y + 14);

    y += 24;

    // Salary payment history table
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.setTextColor(15, 23, 42);
    doc.text(t.paymentHistory, 14, y);
    y += 5;

    doc.setFillColor(241, 245, 249);
    doc.rect(14, y, 182, 7, 'F');
    doc.setFontSize(8);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(71, 85, 105);
    doc.text(t.receipt, 18, y + 5);
    doc.text(t.date, 60, y + 5);
    doc.text(t.year, 110, y + 5);
    doc.text(t.amount, 165, y + 5);
    y += 7;

    doc.setFont('helvetica', 'normal');
    doc.setTextColor(15, 23, 42);

    if (payments.length === 0) {
      doc.text(t.noPaymentRecordsFound, 18, y + 5);
      y += 8;
    } else {
      payments.forEach((p) => {
        if (y > 270) {
          doc.addPage();
          y = 20;
          doc.setFillColor(241, 245, 249);
          doc.rect(14, y, 182, 7, 'F');
          doc.setFontSize(8);
          doc.setFont('helvetica', 'bold');
          doc.setTextColor(71, 85, 105);
          doc.text(t.receipt, 18, y + 5);
          doc.text(t.date, 60, y + 5);
          doc.text(t.year, 110, y + 5);
          doc.text(t.amount, 165, y + 5);
          y += 7;
          doc.setFont('helvetica', 'normal');
          doc.setTextColor(15, 23, 42);
        }

        doc.text(`SAL-${p.id.slice(-6).toUpperCase()}`, 18, y + 5);
        doc.text(p.date || '', 60, y + 5);
        doc.text(p.academicYear || '-', 110, y + 5);
        doc.text(formatPdfAmount(p.amount), 165, y + 5);
        y += 6;

        doc.setDrawColor(241, 245, 249);
        doc.line(14, y, 196, y);
      });
    }

    y += 2;
    doc.setFillColor(236, 253, 245);
    doc.rect(14, y, 182, 8, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.setTextColor(6, 95, 70);
    doc.text(t.totalCumulativePaymentsRecorded, 18, y + 5.5);
    doc.text(formatPdfAmount(totalPaidEver), 165, y + 5.5);

    // Official school stamp — always BELOW the content so it can never hide
    // anything (history rows, dates, footer): 10 mm under the totals row, the
    // footer note pushed below the stamp. A nearly-full page moves the whole
    // stamp block to a fresh page instead of overlapping content.
    y += 10;
    const STAMP_DIAMETER = 22;
    let stampCy = y + STAMP_DIAMETER / 2;
    if (stampCy + STAMP_DIAMETER / 2 + 8 > 289) {
      doc.addPage();
      stampCy = 30;
    }
    await drawSchoolStamp(doc, 105, stampCy, STAMP_DIAMETER);
    doc.setFont('helvetica', 'italic');
    doc.setFontSize(8);
    doc.setTextColor(148, 163, 184);
    doc.text(
      t.officialElectronicDocumentGeneratedByExecutiveFinanceComplexeScolaireMamaThera,
      105,
      stampCy + STAMP_DIAMETER / 2 + 6,
      { align: 'center' }
    );

    const safeName = staffMember.name.replace(/[^a-zA-Z0-9_-]/g, '_');
    doc.save(`Recu_Salaire_${safeName}_${new Date().toISOString().slice(0, 10)}.pdf`);
  };

  const handleExportMonthlyPayrollExcel = async (monthIdx: number, yr: number) => {
    const XLSX = await import('xlsx');
    const monthNames = lang === 'fr'
      ? ['Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin', 'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre']
      : ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
    const monthName = monthNames[monthIdx];

    const data = staff.map((s, i) => {
      const payments = salaryPayments.filter(p => {
        const d = new Date(p.date);
        return d.getFullYear() === yr && d.getMonth() === monthIdx && p.staffId === s.id;
      });
      const totalPaid = payments.reduce((sum, p) => sum + (p.amount || 0), 0);
      const balance = Math.max(0, s.salary - totalPaid);
      const lastDate = payments.length > 0 ? payments[payments.length - 1].date : '—';

      return {
        [lang === 'fr' ? 'N°' : 'No.']: i + 1,
        [t.employeeName]: s.name,
        [t.position]: s.position,
        [t.baseSalaryFcfa]: s.salary,
        [t.paidThisMonthFcfa]: totalPaid,
        [t.remainingBalanceFcfa]: balance,
        [t.lastPaymentDate]: lastDate,
        [t.status]: totalPaid >= s.salary && s.salary > 0 ? (t.fullyPaid) : (totalPaid > 0 ? (t.partial2) : (t.unpaid)),
        [t.academicYear2]: selectedYear || '2026-2027',
      };
    });

    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, `Paie_${monthName}`);
    XLSX.writeFile(wb, `MAMA_THERA_Bordereau_Paie_${monthName}_${yr}.xlsx`);
    showToast();
  };

  return {
    showStaffModal, setShowStaffModal,
    showSalaryModal, setShowSalaryModal,
    showMonthlyDraftModal, setShowMonthlyDraftModal,
    selectedDraftMonth, setSelectedDraftMonth,
    selectedDraftYear, setSelectedDraftYear,
    staffForm, setStaffForm,
    staffSearchTerm, setStaffSearchTerm,
    visibleBankDetails, setVisibleBankDetails,
    salaryForm, setSalaryForm,
    editingStaff, setEditingStaff,
    filteredStaff,
    handleStaffSubmit,
    handleSalarySubmit,
    openEditStaffModal,
    handleExportStaffReceiptPdf,
    handleExportMonthlyPayrollExcel,
  };
}