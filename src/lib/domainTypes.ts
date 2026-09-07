/**
 * Canonical domain types (extracted from useSupabaseData.ts).
 *
 * Pure module: no imports, no runtime logic.
 */
// ─── Type Definitions (matching App.tsx types) ───────────────────────────────

export interface Parent {
  id: string;
  fullName: string;
  phones: string[];
  email?: string;
  address: string;
  occupation: string;
  relationship: string;
  notes?: string;
}

export interface StudentNoteEntry {
  date: string;
  text: string;
}

export interface Payment {
  date: string;
  amount: number;
  academicYear?: string;
  receiptNumber?: string;
}

export interface Student {
  id: string;
  parentId?: string;
  name: string;
  parentName: string;
  parentEmail: string;
  parentPhone: string;
  totalDue: number;
  amountPaid: number;
  scholarshipDiscount?: number;
  dueDate: string;
  lastPaymentDate?: string;
  payments: Payment[];
  notes: string;
  lastNoteDate?: string;
  noteEntries?: StudentNoteEntry[];
  flagged?: boolean;
  academicYear?: string;
  grade?: string;
  studentId?: string;
  photo?: string;
  emergencyContactName?: string;
  emergencyContactRelation?: string;
  emergencyContactPhone?: string;
  medicalNotes?: string;
  enrollmentDate?: string;
  previousSchool?: string;
  status?: 'Active' | 'Graduated' | 'Left';
}

export type FamilyStatus = 'single' | 'married' | 'divorced' | 'widowed';

export interface Staff {
  id: string;
  name: string;
  position: string;
  salary: number;
  email: string;
  phone: string;
  bankDetails: string;
  emergencyContact: string;
  academicYear?: string;
  /** Bulletin de paie details (migration 20260906000001). */
  inpsNumber?: string;
  hireDate?: string; // YYYY-MM-DD
  familyStatus?: FamilyStatus;
  childrenCount?: number;
  travelAllowance?: number;
  communicationAllowance?: number;
  housingAllowance?: number;
}

export interface SalaryPayment {
  id: string;
  staffId: string;
  amount: number;
  date: string;
  academicYear?: string;
}

export interface Expense {
  id: string;
  category: string;
  description: string;
  amount: number;
  date: string;
  academicYear?: string;
}

export interface VendorExpense {
  id: string;
  vendorName: string;
  category: 'stationery' | 'solar_energy' | 'electricity' | 'water' | 'taxes' | 'insurance' | 'security_maintenance' | 'security_guarding' | 'facility_maintenance' | 'works_renovation' | 'machine_management' | 'reforestation' | 'catering' | 'training' | 'social_events' | 'exam_def' | 'exam_bac' | 'internet' | 'cleaning' | 'furniture' | 'social_cases' | string;
  amount: number;
  dueDate: string;
  paymentStatus: 'paid' | 'unpaid' | 'partial';
  amountPaid: number;
  description?: string;
  academicYear?: string;
  aidType?: 'prise_en_charge' | 'kits_fournitures' | 'aide_urgence';
  beneficiaryStudentName?: string;
  beneficiaryStudentGrade?: string;
}

export interface Todo {
  id: string;
  text: string;
  completed: boolean;
  studentId?: string;
  /** Optional calendar date (YYYY-MM-DD) — tasks appear on the calendar. */
  date?: string;
}

export type ClassCycle = 'cycle1' | 'cycle2' | 'lycee' | 'maternelle' | 'other';

export interface CustomClass {
  id: string; // display code, e.g. '1D' or a custom name
  rowId: string; // Supabase uuid primary key
  cycle: ClassCycle;
  year: string;
  section: string;
  nameFr: string;
  nameEn: string;
  isCustom?: boolean;
}

