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
import { generateAdminBulletinPdf } from '../lib/pdfPayrollBulletin';
import { generateEmployeeFichePdf } from '../lib/pdfPayrollFiche';
import { isAdminPosition } from '../lib/adminPositions';
import type { StaffModalMode, StaffPositionFilter } from './mainViewsProps';

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
  /** Uploaded school logo (data URL) — embedded in the bulletin / fiche headers. */
  schoolLogo: string | null;
}

export function usePayroll(deps: UsePayrollDeps) {
  const { t, lang, selectedYear, lockedYears, staff, salaryPayments, showToast, toastError, addStaff, updateStaff, addSalaryPayment, schoolLogo } = deps;

  const [showStaffModal, setShowStaffModal] = useState(false);
  const [staffModalMode, setStaffModalMode] = useState<StaffModalMode>('employee');
  const [showMonthlyDraftModal, setShowMonthlyDraftModal] = useState(false);
  const [selectedDraftMonth, setSelectedDraftMonth] = useState<number>(new Date().getMonth());
  const [selectedDraftYear, setSelectedDraftYear] = useState<number>(new Date().getFullYear());
  const [showSalaryModal, setShowSalaryModal] = useState(false);

  const [staffForm, setStaffForm] = useState({ name: '', position: '', salary: '', email: '', phone: '', bankDetails: '', emergencyContact: '', inpsNumber: '', hireDate: '', familyStatus: '', childrenCount: '', travelAllowance: '', communicationAllowance: '', housingAllowance: '' });
  const [staffSearchTerm, setStaffSearchTerm] = useState('');
  const [staffPositionFilter, setStaffPositionFilter] = useState<StaffPositionFilter>('all');
  const [visibleBankDetails, setVisibleBankDetails] = useState<Record<string, boolean>>({});
  const [salaryForm, setSalaryForm] = useState({ staffId: '', amount: '', date: new Date().toISOString().split('T')[0] });

  const [editingStaff, setEditingStaff] = useState<Staff | null>(null);

  const adminStaffCount = useMemo(() => staff.filter(s => isAdminPosition(s.position)).length, [staff]);

  const filteredStaff = useMemo(() => {
    return staff.filter(s => {
      const matchesSearch =
        s.name.toLowerCase().includes(staffSearchTerm.toLowerCase()) ||
        s.phone.toLowerCase().includes(staffSearchTerm.toLowerCase());
      if (!matchesSearch) return false;
      if (staffPositionFilter === 'admin') return isAdminPosition(s.position);
      if (staffPositionFilter === 'employee') return !isAdminPosition(s.position);
      return true;
    });
  }, [staff, staffSearchTerm, staffPositionFilter]);

  const handleStaffSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (lockedYears.includes(selectedYear)) {
      toastError(t.thisAcademicYearIsLocked);
      return;
    }
    const salary = parseFloat(staffForm.salary);
    if (isNaN(salary) || salary < 0) return;

    // String form fields → typed staff record (allowances/children parsed,
    // empty optional fields stored as undefined so the DB gets NULL).
    const parseAmount = (v: string): number => {
      const n = parseFloat(v);
      return isNaN(n) || n < 0 ? 0 : n;
    };
    const staffData = {
      ...staffForm,
      salary,
      email: staffForm.email.trim(),
      phone: staffForm.phone.trim(),
      bankDetails: staffForm.bankDetails.trim(),
      emergencyContact: staffForm.emergencyContact.trim(),
      inpsNumber: staffForm.inpsNumber.trim(),
      hireDate: staffForm.hireDate.trim() || undefined,
      familyStatus: (staffForm.familyStatus || undefined) as Staff['familyStatus'],
      childrenCount: staffForm.childrenCount === '' ? 0 : Math.max(0, Math.round(parseAmount(staffForm.childrenCount))),
      travelAllowance: parseAmount(staffForm.travelAllowance),
      communicationAllowance: parseAmount(staffForm.communicationAllowance),
      housingAllowance: parseAmount(staffForm.housingAllowance),
    };
    const saved = editingStaff
      ? await updateStaff(editingStaff.id, staffData)
      : await addStaff(staffData);
    if (!saved) return;
    setShowStaffModal(false);
    setEditingStaff(null);
    setStaffForm({ name: '', position: '', salary: '', email: '', phone: '', bankDetails: '', emergencyContact: '', inpsNumber: '', hireDate: '', familyStatus: '', childrenCount: '', travelAllowance: '', communicationAllowance: '', housingAllowance: '' });
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

    // No overpayment: a payment above the monthly salary would create a
    // negative balance silently treated as "fully paid". Cap at the salary.
    const staffMember = staff.find((s) => s.id === salaryForm.staffId);
    if (staffMember && amount > staffMember.salary) {
      toastError(t.salaryAmountExceedsMonthlySalary);
      return;
    }

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
    setStaffModalMode('employee'); // editing always uses the free-text position
    setEditingStaff(s);
    setStaffForm({
      name: s.name,
      position: s.position,
      salary: s.salary.toString(),
      email: s.email || '',
      phone: s.phone || '',
      bankDetails: s.bankDetails || '',
      emergencyContact: s.emergencyContact || '',
      inpsNumber: s.inpsNumber || '',
      hireDate: s.hireDate || '',
      familyStatus: s.familyStatus || '',
      childrenCount: s.childrenCount !== undefined ? String(s.childrenCount) : '',
      travelAllowance: s.travelAllowance ? String(s.travelAllowance) : '',
      communicationAllowance: s.communicationAllowance ? String(s.communicationAllowance) : '',
      housingAllowance: s.housingAllowance ? String(s.housingAllowance) : ''
    });
    setShowStaffModal(true);
  };

  /**
   * Per-employee salary document PDF.
   *
   * Members of the administration (added via "Ajouter un membre de
   * l'administration") download the official monthly bulletin de paie
   * (src/lib/pdfPayrollBulletin.ts) — school template with the INPS 3,60 %
   * and AMO 3,06 % employee contributions, net salary, amount in words and
   * signature blocks. Other employees (added via "Ajouter un Employé")
   * download the fiche individuelle de paiement de salaire
   * (src/lib/pdfPayrollFiche.ts) — school template with the same frozen
   * INPS/AMO deductions, the net salary and the payment date.
   */
  const handleExportStaffReceiptPdf = async (staffMember: Staff) => {
    if (isAdminPosition(staffMember.position)) {
      await generateAdminBulletinPdf({ staffMember, lang, schoolLogo });
      return;
    }
    await generateEmployeeFichePdf({ staffMember, lang, schoolLogo });
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
    staffModalMode, setStaffModalMode,
    showSalaryModal, setShowSalaryModal,
    showMonthlyDraftModal, setShowMonthlyDraftModal,
    selectedDraftMonth, setSelectedDraftMonth,
    selectedDraftYear, setSelectedDraftYear,
    staffForm, setStaffForm,
    staffSearchTerm, setStaffSearchTerm,
    staffPositionFilter, setStaffPositionFilter,
    visibleBankDetails, setVisibleBankDetails,
    salaryForm, setSalaryForm,
    editingStaff, setEditingStaff,
    filteredStaff,
    adminStaffCount,
    handleStaffSubmit,
    handleSalarySubmit,
    openEditStaffModal,
    handleExportStaffReceiptPdf,
    handleExportMonthlyPayrollExcel,
  };
}