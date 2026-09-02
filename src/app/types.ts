/**
 * Shared domain types extracted verbatim from App.tsx.
 *
 * NOTE: the data-model interfaces (Parent/Student/Staff/...) are the
 * App-side shapes used by the UI layer. lib/useSupabaseData.ts exports
 * its own identical shapes for the data layer; these are intentionally
 * kept separate until the two are unified.
 */

export type Language = 'en' | 'fr';
export interface User {
  username: string;
  role: 'admin' | 'staff' | 'dev' | 'general_manager' | 'econome';
  name?: string;
}

export interface Payment {
  date: string;
  amount: number;
  academicYear?: string;
  receiptNumber?: string;
}

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

/** A dated note entry — the Notes ⇄ Calendar bridge record. */
export interface StudentNoteEntry {
  date: string; // YYYY-MM-DD (local date chosen in the calendar)
  text: string;
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
  scholarshipDiscount?: number; // Percentage
  dueDate: string; // YYYY-MM-DD
  lastPaymentDate?: string;
  payments: Payment[];
  notes: string;
  lastNoteDate?: string;
  /** Dated note entries (Notes ⇄ Calendar bridge) — complements the free-text `notes`. */
  noteEntries?: StudentNoteEntry[];
  flagged?: boolean;
  academicYear?: string;
  grade?: string;
  
  // Student Profiles & Enrollment Fields
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

export interface SchoolClass {
  id: string; // e.g. '1A', '1B', '1C', '2A', '2B', '2C', '7A', '7B', etc.
  cycle: 'cycle1' | 'cycle2' | 'lycee' | 'maternelle' | 'other';
  year: number | string;
  section: string;
  nameFr: string;
  nameEn: string;
  isCustom?: boolean;
}

export const DEFAULT_SCHOOL_CLASSES: SchoolClass[] = [
  // --- Premier Cycle (1ère à 6ème Année — sections A, B, C) ---
  { id: '1A', cycle: 'cycle1', year: 1, section: 'A', nameFr: '1ère Année A (1A)', nameEn: '1st Year A (1A)' },
  { id: '1B', cycle: 'cycle1', year: 1, section: 'B', nameFr: '1ère Année B (1B)', nameEn: '1st Year B (1B)' },
  { id: '1C', cycle: 'cycle1', year: 1, section: 'C', nameFr: '1ère Année C (1C)', nameEn: '1st Year C (1C)' },
  { id: '2A', cycle: 'cycle1', year: 2, section: 'A', nameFr: '2ème Année A (2A)', nameEn: '2nd Year A (2A)' },
  { id: '2B', cycle: 'cycle1', year: 2, section: 'B', nameFr: '2ème Année B (2B)', nameEn: '2nd Year B (2B)' },
  { id: '2C', cycle: 'cycle1', year: 2, section: 'C', nameFr: '2ème Année C (2C)', nameEn: '2nd Year C (2C)' },
  { id: '3A', cycle: 'cycle1', year: 3, section: 'A', nameFr: '3ème Année A (3A)', nameEn: '3rd Year A (3A)' },
  { id: '3B', cycle: 'cycle1', year: 3, section: 'B', nameFr: '3ème Année B (3B)', nameEn: '3rd Year B (3B)' },
  { id: '3C', cycle: 'cycle1', year: 3, section: 'C', nameFr: '3ème Année C (3C)', nameEn: '3rd Year C (3C)' },
  { id: '4A', cycle: 'cycle1', year: 4, section: 'A', nameFr: '4ème Année A (4A)', nameEn: '4th Year A (4A)' },
  { id: '4B', cycle: 'cycle1', year: 4, section: 'B', nameFr: '4ème Année B (4B)', nameEn: '4th Year B (4B)' },
  { id: '4C', cycle: 'cycle1', year: 4, section: 'C', nameFr: '4ème Année C (4C)', nameEn: '4th Year C (4C)' },
  { id: '5A', cycle: 'cycle1', year: 5, section: 'A', nameFr: '5ème Année A (5A)', nameEn: '5th Year A (5A)' },
  { id: '5B', cycle: 'cycle1', year: 5, section: 'B', nameFr: '5ème Année B (5B)', nameEn: '5th Year B (5B)' },
  { id: '5C', cycle: 'cycle1', year: 5, section: 'C', nameFr: '5ème Année C (5C)', nameEn: '5th Year C (5C)' },
  { id: '6A', cycle: 'cycle1', year: 6, section: 'A', nameFr: '6ème Année A (6A)', nameEn: '6th Year A (6A)' },
  { id: '6B', cycle: 'cycle1', year: 6, section: 'B', nameFr: '6ème Année B (6B)', nameEn: '6th Year B (6B)' },
  { id: '6C', cycle: 'cycle1', year: 6, section: 'C', nameFr: '6ème Année C (6C)', nameEn: '6th Year C (6C)' },
  
  // --- Second Cycle (7ème à 9ème Année — sections A, B, C) ---
  { id: '7A', cycle: 'cycle2', year: 7, section: 'A', nameFr: '7ème Année A (7A)', nameEn: '7th Year A (7A)' },
  { id: '7B', cycle: 'cycle2', year: 7, section: 'B', nameFr: '7ème Année B (7B)', nameEn: '7th Year B (7B)' },
  { id: '7C', cycle: 'cycle2', year: 7, section: 'C', nameFr: '7ème Année C (7C)', nameEn: '7th Year C (7C)' },
  { id: '8A', cycle: 'cycle2', year: 8, section: 'A', nameFr: '8ème Année A (8A)', nameEn: '8th Year A (8A)' },
  { id: '8B', cycle: 'cycle2', year: 8, section: 'B', nameFr: '8ème Année B (8B)', nameEn: '8th Year B (8B)' },
  { id: '8C', cycle: 'cycle2', year: 8, section: 'C', nameFr: '8ème Année C (8C)', nameEn: '8th Year C (8C)' },
  { id: '9A', cycle: 'cycle2', year: 9, section: 'A', nameFr: '9ème Année A (9A)', nameEn: '9th Year A (9A)' },
  { id: '9B', cycle: 'cycle2', year: 9, section: 'B', nameFr: '9ème Année B (9B)', nameEn: '9th Year B (9B)' },
  { id: '9C', cycle: 'cycle2', year: 9, section: 'C', nameFr: '9ème Année C (9C)', nameEn: '9th Year C (9C)' },
];
