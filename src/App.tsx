/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useMemo, FormEvent, ChangeEvent, useEffect, useRef, useCallback } from 'react';
import { useSupabaseData } from './lib/useSupabaseData';
import { useAuth } from './lib/useAuth';
import type { UserProfile } from './lib/useAuth';
import { useToast, ToastContainer, OfflineBanner, EnvBadge } from './components/ToastNotification';
import { PromotionWizardModal } from './components/PromotionWizardModal';
import { ExcelImportModal } from './components/ExcelImportModal';
import type { ImportCategory } from './lib/excelImporter';
import { getAppEnv, formatSupabaseError } from './lib/networkUtils';
import { generatePaymentReceiptPdf } from './lib/pdfReceipt';
import { generateStaffPayslipPdf } from './lib/pdfPayroll';
import { generateFinancialReportPdf } from './lib/pdfFinancialReport';
import { generateMultiYearReportPdf } from './lib/pdfMultiYearReport';
import { generateExpensesReportPdf } from './lib/pdfExpensesReport';
import { generateMonthlyPayrollDraftPdf } from './lib/pdfPayrollDraft';
import { MonthlyPayrollDraftModal } from './components/MonthlyPayrollDraftModal';
import { motion, AnimatePresence } from 'motion/react';
import * as XLSX from 'xlsx';
import { jsPDF } from 'jspdf';
import { 
  BarChart, 
  Bar, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  Legend as RechartsLegend, 
  ResponsiveContainer, 
  PieChart as RePieChart, 
  Pie, 
  Cell 
} from 'recharts';
import { 
  LayoutDashboard, 
  Users, 
  Layers,
  CreditCard, 
  AlertCircle, 
  CheckCircle2, 
  Clock, 
  Plus, 
  Globe,
  TrendingUp,
  DollarSign,
  Search,
  Mail,
  Phone,
  MessageSquare,
  X,
  Download,
  Copy,
  ChevronRight,
  ChevronLeft,
  Printer,
  ShieldCheck,
  Calendar,
  FileText,
  Bell,
  StickyNote,
  Trash2,
  CheckSquare,
  UploadCloud,
  Flag,
  Briefcase,
  Receipt,
  PieChart,
  Wallet,
  Lock,
  LogOut,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  GraduationCap,
  TrendingDown,
  Coins,
  Edit2,
  Zap,
  Droplet,
  Wifi,
  Sparkles,
  BookOpen,
  Heart,
  UserPlus,
  ChevronDown,
  ChevronUp,
  MapPin,
  UserCheck,
  Link as LinkIcon,
  Unlink,
  FileSpreadsheet,
  Sun,
  Utensils,
  Landmark,
  Award,
  Wrench,
  Shield,
  Cpu,
  Sprout,
  Hammer
} from 'lucide-react';

// --- Types ---

type Language = 'en' | 'fr';

interface User {
  username: string;
  role: 'admin' | 'staff' | 'dev';
  name?: string;
}

interface Payment {
  date: string;
  amount: number;
  academicYear?: string;
  receiptNumber?: string;
}

interface Parent {
  id: string;
  fullName: string;
  phones: string[];
  email?: string;
  address: string;
  occupation: string;
  relationship: string;
  notes?: string;
}

interface Student {
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

interface Staff {
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

interface SalaryPayment {
  id: string;
  staffId: string;
  amount: number;
  date: string;
  academicYear?: string;
}

interface Expense {
  id: string;
  category: string;
  description: string;
  amount: number;
  date: string;
  academicYear?: string;
}

interface VendorExpense {
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

interface Todo {
  id: string;
  text: string;
  completed: boolean;
  studentId?: string;
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

// --- Translations ---

const translations = {
  en: {
    title: "Executive Finance",
    subtitle: "School Management Suite",
    dashboard: "Executive Summary",
    students: "Student Management",
    parents: "Parent Directory",
    settings: "System Settings",
    classesSettings: "Classes & Grade Levels",
    addClass: "Add Class / Section",
    allClasses: "All Classes",
    filterByClass: "Filter by Class",
    newClass: "New Class",
    schoolCycle: "School Cycle",
    gradeLevel: "Grade / Year Level",
    sectionLetter: "Section (e.g., A, B, C, D)",
    classNameOrCode: "Class Code / Name",
    totalOutstanding: "Total Outstanding",
    collectedMonth: "Collected This Month",
    lateParents: "Late Parents",
    cashBalance: "Cash Balance (Solde)",
    incomeThisMonth: "Income This Month",
    expensesThisMonth: "Expenses This Month",
    enrolledStudents: "Enrolled Students",
    studentsCountLabel: "Students",
    studentName: "Student Name",
    parentName: "Parent Name",
    parentContact: "Parent Contact",
    totalDue: "Total Tuition",
    balance: "Balance",
    status: "Status",
    settle: "Fully Paid",
    partial: "Partial",
    overdue: "Overdue",
    searchPlaceholder: "Search by student or parent name...",
    exportLate: "Export Late Payments",
    allUpToDate: "All payments are up to date!",
    copyEmail: "Copy Email",
    copied: "Copied!",
    contactCard: "Contact Card",
    parentDetails: "Parent Details",
    studentDetails: "Student Details",
    contactParent: "Contact Parent",
    close: "Close",
    recordPayment: "Record Payment",
    selectStudent: "Select Student",
    amount: "Amount",
    date: "Date",
    submit: "Submit",
    paymentEntry: "Payment Entry",
    currency: "XOF",
    langToggle: "Français",
    navDashboard: "Dashboard",
    navStudents: "Students & Grades",
    navParents: "Parents",
    navSettings: "System Settings",
    navArchives: "Yearly Archives",
    navCalendar: "Financial Calendar",
    calendar: "Financial Calendar",
    printReport: "Print Report",
    monthlyReport: "Monthly Financial Report",
    totalCollected: "Total Collected",
    today: "Today",
    mon: "Mon", tue: "Tue", wed: "Wed", thu: "Thu", fri: "Fri", sat: "Sat", sun: "Sun",
    jan: "January", feb: "February", mar: "March", apr: "April", may: "May", jun: "June",
    jul: "July", aug: "August", sep: "September", oct: "October", nov: "November", dec: "December",
    addStudent: "Add New Student",
    editStudent: "Edit Student",
    saveChanges: "Save Changes",
    email: "Email Address",
    phone: "Phone Number",
    successMessage: "Changes saved successfully!",
    invalidEmail: "Please enter a valid email address",
    invalidAmount: "Please enter a valid numeric amount",
    dueDate: "Due Date",
    paymentDate: "Payment Date",
    paidOnTime: "Paid on Time",
    daysOverdue: "Days Overdue",
    paymentHistory: "Payment History",
    goodStanding: "Good Standing",
    dueSoon: "Due Soon",
    accountingNotes: "Accounting Notes",
    saveNote: "Save Note",
    todoList: "To-Do List",
    addTask: "Add Task",
    taskPlaceholder: "What needs to be done?",
    notifications: "Notifications",
    dueReminder: "Payment due in less than 2 days",
    noteReminder: "No update since last note (3+ days)",
    followUpCompleted: "Follow-up call completed",
    productivity: "Productivity",
    themeSettings: "Theme Settings",
    corporateNavy: "Corporate Navy",
    warmCreamLedger: "Warm Cream Ledger",
    slateSlate: "Dark Slate",
    emeraldGreen: "MAMA THERA Emerald",
    bordeauxRed: "Academic Burgundy",
    midnightDark: "Cyber Midnight Dark",
    uploadLogo: "Upload School Logo",
    logoColor: "Logo Accent Color",
    autoHeader: "Header color synced with logo",
    legend: "Legend",
    overdue30: "Overdue > 30 days",
    due48: "Due within 48 hours",
    flaggedLabel: "Flagged for follow-up",
    payroll: "Staff Payroll",
    expenses: "Expenses",
    staff: "Staff Directory",
    addStaff: "Add Employee",
    recordSalary: "Record Salary",
    addExpense: "Add Expense",
    position: "Position",
    monthlySalary: "Monthly Salary",
    category: "Category",
    description: "Description",
    cashFlow: "Cash Flow Summary",
    totalFees: "Total Fees Collected",
    totalExpenses: "Total Expenses Paid",
    netProfit: "Net Cash Flow",
    salaryPayment: "Salary Payment",
    expenseEntry: "Expense Entry",
    utilities: "Utilities",
    supplies: "Supplies",
    maintenance: "Maintenance",
    other: "Other",
    installment: "Installment",
    remainingBalance: "Remaining Balance",
    totalArrears: "Total Staff Arrears",
    acompte: "Installment",
    reliquat: "Remaining Balance",
    payDate: "Pay Date",
    unpaid: "Unpaid",
    partialPaid: "Partially Paid",
    fullyPaid: "Fully Paid",
    emergencyContact: "Emergency Contact",
    bankDetails: "Bank Details",
    generateMemo: "Generate Memo",
    memoCopied: "Memo copied!",
    staffSearchPlaceholder: "Search staff by name or phone...",
    showBankDetails: "Show Bank Details",
    hideBankDetails: "Hide Bank Details",
    loginTitle: "School Finance Portal",
    loginSubtitle: "Secure Access",
    username: "Username",
    password: "Password",
    signIn: "Sign In",
    signOut: "Sign Out",
    loginError: "Invalid username or password",
    restricted: "Restricted Area",
    notes: "Notes",
    scholarship: "Scholarship/Discount %",
    academicYear: "Academic Year",
    allYears: "All Years",
    incomeVsExpenses: "Monthly Income vs Expenses",
    feeStatus: "Fee Payment Status",
    paid: "Paid",
    outstanding: "Outstanding",
    income: "Income",
    exportData: "Export All Data to CSV",
    backupSettings: "Backup & Data Management",
    vendorExpenses: "General Expenses",
    generalExpenses: "General Expenses",
    totalVendorBills: "Total Expenses / Bills",
    paidPortions: "Paid Portions",
    outstandingBalanceVendor: "Outstanding Balance",
    overdueUnpaid: "Overdue Unpaid",
    billsCountLabel: "Bills",
    vendorName: "Vendor / Payee Name",
    paymentStatus: "Payment Status",
    addVendorExpense: "Add Expense",
    editVendorExpense: "Edit Expense",
    amountPaid: "Amount Paid",
    overdueWarning: "Overdue unpaid expenses shown in bright red",
    stationery: "Supplies & Stationery",
    solar_energy: "Solar Panels & Batteries",
    electricity: "EDM-SA Electricity",
    water: "Borehole Maintenance & Water",
    taxes: "Taxes & Fiscal Duties",
    insurance: "Insurance",
    security_maintenance: "Guarding & Campus Maintenance",
    works_renovation: "Works & Improvements",
    machine_management: "Machinery & Equipment Management",
    reforestation: "Reforestation & Green Spaces",
    security_guarding: "Security & Guarding Services",
    facility_maintenance: "Campus & Facility Maintenance",
    catering: "Catering & Meals",
    training: "Staff Training & Workshops",
    social_events: "Social Events & Ceremonies",
    exam_def: "DEF Examination Expenses",
    exam_bac: "BAC Examination Expenses",
    furniture: "Furniture & Equipment",
    internet: "Internet Providers",
    cleaning: "Cleaning & Maintenance",
    social_cases: "Student Welfare & Social Aid",
    prise_en_charge: "Tuition Waiver",
    kits_fournitures: "Supplies Support",
    aide_urgence: "Emergency Aid",
    yearlyArchives: "Yearly Comparison & Archives",
    annualAggregation: "Annual Financial Aggregation",
    schoolYear: "School Year",
    totalRevenueArchive: "Total Revenue (Somme des Recettes)",
    totalExpensesArchive: "Total Expenses (Somme des Dépenses)",
    netBalanceArchive: "Net Balance (Solde Net)",
    closeYear: "Close Current School Year",
    closeYearSuccess: "School year closed successfully and data locked.",
    lockedTag: "Locked",
    revenueVsExpenses: "Revenue vs Expenses",
    auditSheet: "Final Audit Sheet",
    printAudit: "Print Audit Sheet",
    carriedOver: "Debt Carried Over",
    openingBalance: "Opening Balance",

    // Profile & Student File specific fields
    studentIdLabel: "Student ID",
    photoPlaceholder: "Photo Placeholder (URL)",
    parentInfo: "Parent Information",
    activeStatus: "Active",
    graduatedStatus: "Graduated",
    leftStatus: "Left",
    printReceipt: "Print Receipt",
    generateTicket: "Generate Ticket",
    editProfile: "Edit Profile",
    saveAsPdf: "Save as PDF",
    guardianTitle: "Primary Guardian",
    emergencyTitle: "Emergency Contact",
    relationshipLabel: "Relation / Relationship",
    emergencyPhoneLabel: "Emergency Phone Number",
    previousSchoolHistory: "Previous School / Transfer History",
    medicalNotesTitle: "Medical Notes & Conditions",
    noPayments: "No payments registered.",
    lastUpdated: "Last updated",
    notesPlaceholder: "Add payment promises or issues...",

    // Conversational AI Assistant
    aiTitle: "Conversational AI Assistant",
    aiSubtitle: "Financial intelligence & live metrics",
    aiAskPlaceholder: "Ask me about cash balance, late students...",
    aiQuickQuestion1: "What is the school cash balance?",
    aiQuickQuestion2: "Which students are overdue?",
    aiQuickQuestion3: "What are the expenses this month?",
    aiQuickQuestion4: "Tell me about the staff payroll.",
    aiResponseBalance: "The current school cash balance is {balance} XOF, with total collected fees of {income} XOF and total expenses of {expenses} XOF this month.",
    aiResponseOverdue: "There are currently {count} students with overdue balances, totaling {amount} XOF in outstanding debt.",
    aiResponseExpenses: "Expenses this month total {expenses} XOF, with major items including {categories}.",
    aiResponsePayroll: "The staff directory has {count} employees. Total monthly salary liability is {salary} XOF, with {unpaidCount} unpaid salaries.",
    aiGreeting: "Hello! I am your Mama Thera Finance Assistant. How can I assist you with calculations or school statistics today?",
    aiNoData: "I could not find matching statistics for your query. Try one of the quick questions below!",
    navVendorExpenses: "Vendor & Utilities",
    actions: "Actions",
    noTasks: "No financial tasks for this day",

    // Parent/Guardian Management
    parentGuardian: "Parent/Guardian",
    occupation: "Occupation",
    listOfChildren: "List of Children",
    totalOutstandingBalance: "Total Outstanding Balance",
    address: "Address",
    relationship: "Relationship to Student",
    linkStudent: "Link Student",
    primaryPhone: "Primary Phone",
    secondaryPhone: "Secondary Phone",
    addParent: "Add Parent/Guardian",
    editParent: "Edit Parent Profile",
    noChildrenLinked: "No children linked yet",
    receiptNo: "Receipt #",
    father: "Father",
    mother: "Mother",
    guardian: "Guardian",
    uncle: "Uncle",
    aunt: "Aunt",
    relationshipOther: "Other",
    unlinkStudent: "Unlink Student",
    selectStudentToLink: "Select a student to link...",
    searchParentsPlaceholder: "Search by parent name, phone, occupation, address, or child name...",
    parentDirectorySubtitle: "Centralized parent directory with multi-child linkage, consolidated balances & payment histories.",
    confirmDeleteParent: "Are you sure you want to delete this parent profile?",
    totalPaymentsAllChildren: "Total Payments Made Across All Children",
    notify: "Notify",
    sendReminder: "Send Late Payment Reminder",
    reminderModalTitle: "Late Payment Follow-Up",
    reminderModalSubtitle: "Generate and send a pre-filled WhatsApp or SMS notice for overdue balances.",
    selectPhone: "Select Phone Number",
    selectTemplate: "Message Template",
    templatePolite: "Polite Reminder",
    templateUrgent: "Urgent Notice",
    templateDetailed: "Detailed Itemized Breakdown",
    customMessage: "Custom Message Content",
    openWhatsApp: "Send via WhatsApp",
    sendSMS: "Send via SMS",
    copyMessage: "Copy Message",
    copiedToClipboard: "Message copied to clipboard!",
    overdueChildren: "Children with Overdue Fees",
    downloadLedger: "Download Ledger (PDF)",
    sortHighestBalance: "Highest Balance",
    sortAlphabetical: "Alphabetical",
    sortByLabel: "Sort:"
  },
  fr: {
    title: "Finance Exécutive",
    subtitle: "Suite de Gestion Scolaire",
    dashboard: "Résumé Exécutif",
    students: "Gestion des Élèves",
    parents: "Annuaire des Parents",
    settings: "Paramètres Système",
    classesSettings: "Classes & Niveaux Scolaires",
    addClass: "Ajouter une Classe / Section",
    allClasses: "Toutes les classes",
    filterByClass: "Filtrer par classe",
    newClass: "Nouvelle Classe",
    schoolCycle: "Cycle Scolaire",
    gradeLevel: "Niveau / Année",
    sectionLetter: "Section (ex. A, B, C, D)",
    classNameOrCode: "Code / Nom de la classe",
    totalOutstanding: "Total Impayé",
    collectedMonth: "Collecté ce Mois",
    lateParents: "Parents en Retard",
    cashBalance: "Solde de Caisse",
    incomeThisMonth: "Revenus ce Mois",
    expensesThisMonth: "Dépenses ce Mois",
    enrolledStudents: "Élèves Inscrits",
    studentsCountLabel: "Élèves",
    studentName: "Nom de l'Élève",
    parentName: "Nom du Parent",
    parentContact: "Contact Parent",
    totalDue: "Scolarité Totale",
    balance: "Solde",
    status: "Statut",
    settle: "Payé",
    partial: "Partiel",
    overdue: "En retard",
    searchPlaceholder: "Rechercher par élève ou parent...",
    exportLate: "Exporter les Retards",
    allUpToDate: "Tous les paiements sont à jour !",
    copyEmail: "Copier l'Email",
    copied: "Copié !",
    contactCard: "Fiche de Contact",
    parentDetails: "Détails du Parent",
    studentDetails: "Détails de l'Élève",
    contactParent: "Contacter le Parent",
    close: "Fermer",
    recordPayment: "Enregistrer le Paiement",
    selectStudent: "Sélectionner l'Élève",
    amount: "Montant",
    date: "Date",
    submit: "Soumettre",
    paymentEntry: "Saisie de Paiement",
    currency: "XOF",
    langToggle: "English",
    navDashboard: "Tableau de bord",
    navStudents: "Élèves & Notes",
    navParents: "Parents",
    navSettings: "Paramètres Système",
    navArchives: "Archives Annuelles",
    navCalendar: "Calendrier",
    calendar: "Calendrier Financier",
    printReport: "Imprimer le Rapport",
    monthlyReport: "Rapport Financier Mensuel",
    totalCollected: "Total Collecté",
    today: "Aujourd'hui",
    mon: "Lun", tue: "Mar", wed: "Mer", thu: "Jeu", fri: "Ven", sat: "Sam", sun: "Dim",
    jan: "Janvier", feb: "Février", mar: "Mars", apr: "Avril", may: "Mai", jun: "Juin",
    jul: "Juillet", aug: "Août", sep: "Septembre", oct: "Octobre", nov: "Novembre", dec: "Décembre",
    addStudent: "Ajouter un Élève",
    editStudent: "Modifier l'Élève",
    saveChanges: "Enregistrer",
    email: "Adresse Email",
    phone: "Numéro de Téléphone",
    successMessage: "Modifications enregistrées !",
    invalidEmail: "Veuillez entrer un email valide",
    invalidAmount: "Veuillez entrer un montant valide",
    dueDate: "Date d'Échéance",
    paymentDate: "Date de Paiement",
    paidOnTime: "Payé à Temps",
    daysOverdue: "Jours de Retard",
    paymentHistory: "Historique des Paiements",
    goodStanding: "En Règle",
    dueSoon: "Échéance Proche",
    accountingNotes: "Notes Comptables",
    saveNote: "Enregistrer la Note",
    todoList: "Liste de Tâches",
    addTask: "Ajouter Tâche",
    taskPlaceholder: "Que faut-il faire ?",
    notifications: "Notifications",
    dueReminder: "Paiement dû dans moins de 2 jours",
    noteReminder: "Pas de mise à jour depuis la note (3+ jours)",
    followUpCompleted: "Appel de suivi terminé",
    productivity: "Productivité",
    themeSettings: "Paramètres du Thème",
    corporateNavy: "Navy Exécutif",
    warmCreamLedger: "Livre Crème",
    slateSlate: "Ardoise Sombre",
    emeraldGreen: "Émeraude MAMA THERA",
    bordeauxRed: "Bordeaux Académique",
    midnightDark: "Cyber Minuit (Sombre)",
    uploadLogo: "Télécharger le Logo de l'École",
    logoColor: "Couleur d'Accent du Logo",
    autoHeader: "Couleur d'en-tête synchronisée avec le logo",
    legend: "Légende",
    overdue30: "En retard > 30 jours",
    due48: "Échéance < 48 heures",
    flaggedLabel: "Marqué pour suivi",
    payroll: "Paie/Salaires",
    expenses: "Dépenses",
    staff: "Annuaire du Personnel",
    addStaff: "Ajouter un Employé",
    recordSalary: "Enregistrer Salaire",
    addExpense: "Ajouter une Dépense",
    position: "Poste",
    monthlySalary: "Salaire Mensuel",
    category: "Catégorie",
    description: "Description",
    cashFlow: "Résumé de Trésorerie",
    totalFees: "Total Frais Collectés",
    totalExpenses: "Total Dépenses Payées",
    netProfit: "Flux de Trésorerie Net",
    salaryPayment: "Paiement de Salaire",
    expenseEntry: "Saisie de Dépense",
    utilities: "Services Publics",
    supplies: "Fournitures",
    maintenance: "Maintenance",
    other: "Autre",
    installment: "Acompte",
    remainingBalance: "Reliquat",
    totalArrears: "Total Arriérés Personnel",
    acompte: "Acompte",
    reliquat: "Reliquat",
    payDate: "Date de Paie",
    unpaid: "Non payé",
    partialPaid: "Payé partiellement",
    fullyPaid: "Entièrement payé",
    emergencyContact: "Contact d'urgence",
    bankDetails: "Coordonnées bancaires",
    generateMemo: "Générer Mémo",
    memoCopied: "Mémo copié !",
    staffSearchPlaceholder: "Rechercher par nom ou téléphone...",
    showBankDetails: "Afficher les coordonnées",
    hideBankDetails: "Masquer les coordonnées",
    loginTitle: "Portail Financier Scolaire",
    loginSubtitle: "Accès Sécurisé",
    username: "Nom d'utilisateur",
    password: "Mot de passe",
    signIn: "Se connecter",
    signOut: "Déconnexion",
    loginError: "Nom d'utilisateur ou mot de passe incorrect",
    restricted: "Zone Restreinte",
    notes: "Notes",
    scholarship: "Bourse/Remise %",
    academicYear: "Année Académique",
    allYears: "Toutes les Années",
    incomeVsExpenses: "Revenus vs Dépenses Mensuels",
    feeStatus: "Statut de Paiement des Frais",
    paid: "Payé",
    outstanding: "Impayé",
    income: "Revenus",
    exportData: "Exporter toutes les données en CSV",
    backupSettings: "Sauvegarde et Gestion des Données",
    vendorExpenses: "Dépenses Générales",
    generalExpenses: "Dépenses Générales",
    totalVendorBills: "Total Dépenses & Factures",
    paidPortions: "Montants Réglés",
    outstandingBalanceVendor: "Solde Restant Dû",
    overdueUnpaid: "Factures en Retard",
    billsCountLabel: "Factures",
    vendorName: "Bénéficiaire / Fournisseur",
    paymentStatus: "Statut de Paiement",
    addVendorExpense: "Ajouter une Dépense",
    editVendorExpense: "Modifier la Dépense",
    amountPaid: "Montant Payé",
    overdueWarning: "Les dépenses impayées en retard sont affichées en rouge vif",
    stationery: "Fournitures & Papeterie",
    solar_energy: "Panneaux Solaires & Batteries",
    electricity: "Électricité EDM-SA",
    water: "Entretien de forage",
    taxes: "Impôts & Taxes",
    insurance: "Assurances",
    security_maintenance: "Gardiennage & Entretien de l'établissement",
    works_renovation: "Travaux et Aménagements",
    machine_management: "Gestion Machine",
    reforestation: "Reboisement & Espaces Verts",
    security_guarding: "Frais de gardiennage",
    facility_maintenance: "Entretien de l'établissement",
    catering: "Restauration & Cantine",
    training: "Volet Formation",
    social_events: "Événements Sociaux",
    exam_def: "Dépenses liées au DEF",
    exam_bac: "Dépenses liées au BAC",
    furniture: "Mobilier & Équipements",
    internet: "Fournisseurs d'accès Internet",
    cleaning: "Entretien & Nettoyage",
    social_cases: "Cas Sociaux & Aides Liés aux Élèves",
    prise_en_charge: "Prise en charge Scolarité",
    kits_fournitures: "Kits Scolaires & Fournitures",
    aide_urgence: "Aide d'Urgence",
    yearlyArchives: "Comparaison Annuelle & Archives",
    annualAggregation: "Agrégation Financière Annuelle",
    schoolYear: "Année Scolaire",
    totalRevenueArchive: "Total Recettes (Somme des Recettes)",
    totalExpensesArchive: "Total Dépenses (Somme des Dépenses)",
    netBalanceArchive: "Solde Net (Solde Net)",
    closeYear: "Clôturer l'Année Scolaire Actuelle",
    closeYearSuccess: "Année scolaire clôturée avec succès et données verrouillées.",
    lockedTag: "Verrouillé",
    revenueVsExpenses: "Recettes vs Dépenses",
    auditSheet: "Bilan de Clôture Annuel",
    printAudit: "Imprimer le Bilan",
    carriedOver: "Arriérés reportés",
    openingBalance: "Solde d'Ouverture",

    // Profile & Student File specific fields
    studentIdLabel: "ID de l'élève",
    photoPlaceholder: "Lien de la photo d'identité",
    parentInfo: "Informations Parentales",
    activeStatus: "Actif",
    graduatedStatus: "Diplômé",
    leftStatus: "Parti",
    printReceipt: "Imprimer le Reçu",
    generateTicket: "Générer le Ticket",
    editProfile: "Modifier le Profil",
    saveAsPdf: "Enregistrer en PDF",
    guardianTitle: "Tuteur Principal",
    emergencyTitle: "Contact d'Urgence",
    relationshipLabel: "Relation / Parenté",
    emergencyPhoneLabel: "Numéro de Téléphone d'Urgence",
    previousSchoolHistory: "École Précédente / Historique de Transfert",
    medicalNotesTitle: "Notes Médicales & Conditions",
    noPayments: "Aucun paiement enregistré.",
    lastUpdated: "Dernière mise à jour",
    notesPlaceholder: "Ajouter des promesses de paiement ou des problèmes...",

    // Conversational AI Assistant
    aiTitle: "Assistant IA Conversationnel",
    aiSubtitle: "Intelligence financière & indicateurs en direct",
    aiAskPlaceholder: "Posez-moi des questions sur le solde, les retards...",
    aiQuickQuestion1: "Quel est le solde de caisse de l'école ?",
    aiQuickQuestion2: "Quels sont les élèves en retard ?",
    aiQuickQuestion3: "Quelles sont les dépenses ce mois-ci ?",
    aiQuickQuestion4: "Parlez-moi de la paie du personnel.",
    aiResponseBalance: "Le solde de caisse actuel de l'école est de {balance} XOF, avec un total de frais collectés de {income} XOF et des dépenses totales de {expenses} XOF ce mois-ci.",
    aiResponseOverdue: "Il y a actuellement {count} élèves avec des soldes en retard, pour un total de {amount} XOF de dette impayée.",
    aiResponseExpenses: "Les dépenses de ce mois s'élèvent à {expenses} XOF, avec des postes majeurs comprenant {categories}.",
    aiResponsePayroll: "L'annuaire du personnel compte {count} employés. La masse salariale mensuelle totale est de {salary} XOF, avec {unpaidCount} salaires impayés.",
    aiGreeting: "Bonjour ! Je suis votre assistant financier Mama Thera. Comment puis-je vous aider avec des calculs ou statistiques scolaires aujourd'hui ?",
    aiNoData: "Je n'ai pas trouvé de statistiques correspondantes pour votre requête. Essayez l'une des questions rapides ci-dessous !",
    navVendorExpenses: "Dépenses Fournisseurs",
    actions: "Actions",
    noTasks: "Aucune tâche financière pour ce jour",

    // Parent/Guardian Management
    parentGuardian: "Parent/Tuteur",
    occupation: "Profession",
    listOfChildren: "Liste des Enfants",
    totalOutstandingBalance: "Solde Total Dû",
    address: "Adresse",
    relationship: "Lien de Parenté",
    linkStudent: "Lier un Élève",
    primaryPhone: "Téléphone Principal",
    secondaryPhone: "Téléphone Secondaire",
    addParent: "Ajouter Parent/Tuteur",
    editParent: "Modifier le Profil Parent",
    noChildrenLinked: "Aucun enfant lié pour le moment",
    receiptNo: "N° Reçu",
    father: "Père",
    mother: "Mère",
    guardian: "Tuteur",
    uncle: "Oncle",
    aunt: "Tante",
    relationshipOther: "Autre",
    unlinkStudent: "Délier l'Élève",
    selectStudentToLink: "Sélectionner un élève à lier...",
    searchParentsPlaceholder: "Rechercher par nom du parent, téléphone, profession, adresse ou nom de l'enfant...",
    parentDirectorySubtitle: "Annuaire centralisé des parents avec rattachement multi-enfants, soldes consolidés & historiques de paiement.",
    confirmDeleteParent: "Êtes-vous sûr de vouloir supprimer ce profil parent ?",
    totalPaymentsAllChildren: "Total des Paiements Effectués (Tous Enfants)",
    notify: "Relancer",
    sendReminder: "Envoyer Relance de Paiement",
    reminderModalTitle: "Relance de Paiement Impayé",
    reminderModalSubtitle: "Générez et envoyez une notification WhatsApp ou SMS pré-remplie pour les soldes en retard.",
    selectPhone: "Sélectionner le Numéro",
    selectTemplate: "Modèle de Message",
    templatePolite: "Rappel Courtois",
    templateUrgent: "Relance Urgente",
    templateDetailed: "Détail Récapitulatif",
    customMessage: "Contenu du Message",
    openWhatsApp: "Envoyer via WhatsApp",
    sendSMS: "Envoyer via SMS",
    copyMessage: "Copier le Message",
    copiedToClipboard: "Message copié dans le presse-papier !",
    overdueChildren: "Élèves avec Retards de Paiement",
    downloadLedger: "Télécharger le Relevé (PDF)",
    sortHighestBalance: "Plus Solde Impayé",
    sortAlphabetical: "Alphabétique",
    sortByLabel: "Trier :"
  }
};

// Mock data has been migrated to Supabase. Data is now fetched via useSupabaseData hook.

// --- Components ---

const HighlightText = ({ text, highlight }: { text: string, highlight: string }) => {
  if (!highlight.trim()) {
    return <span>{text}</span>;
  }
  const regex = new RegExp(`(${highlight.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
  const parts = text.split(regex);
  return (
    <span>
      {parts.map((part, i) => 
        regex.test(part) ? (
          <mark key={i} className="bg-yellow-200 font-bold rounded-sm px-0.5 text-slate-900">{part}</mark>
        ) : (
          <span key={i}>{part}</span>
        )
      )}
    </span>
  );
};

// --- Login Component ---

const Login = ({ 
  onLogin, 
  lang, 
  setLang, 
  t
}: { 
  onLogin: (email: string, password: string) => Promise<{ success: boolean; error?: string }>, 
  lang: Language, 
  setLang: (l: Language) => void, 
  t: any
}) => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setIsLoading(true);

    const result = await onLogin(email.trim(), password);
    
    if (!result.success) {
      // Translate common Supabase auth errors
      let errorMsg = result.error || '';
      if (errorMsg.includes('Invalid login credentials')) {
        errorMsg = lang === 'en' ? 'Invalid email or password' : 'Email ou mot de passe incorrect';
      } else if (errorMsg.includes('Email not confirmed')) {
        errorMsg = lang === 'en' ? 'Please confirm your email first' : 'Veuillez d\'abord confirmer votre email';
      } else if (errorMsg.includes('Too many requests')) {
        errorMsg = lang === 'en' ? 'Too many attempts. Please wait a moment.' : 'Trop de tentatives. Veuillez patienter.';
      }
      setError(errorMsg);
    }
    setIsLoading(false);
  };

  return (
    <div className="fixed inset-0 bg-slate-900 flex items-center justify-center p-4 z-[100]">
      <div className="absolute top-8 right-8">
        <button 
          onClick={() => setLang(lang === 'en' ? 'fr' : 'en')}
          className="flex items-center gap-2 px-4 py-2 rounded-xl bg-white/10 text-white hover:bg-white/20 transition-all text-sm font-bold border border-white/10"
        >
          <Globe size={18} />
          {lang === 'en' ? 'Français' : 'English'}
        </button>
      </div>
      
      <motion.div 
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        className="w-full max-w-md bg-white rounded-[2.5rem] shadow-2xl overflow-hidden"
      >
        <div className="bg-slate-800 p-10 text-center relative overflow-hidden">
          <div className="absolute top-0 left-0 w-full h-full opacity-10">
             <div className="grid grid-cols-6 gap-2 transform -rotate-12 scale-150">
               {[...Array(24)].map((_, i) => (
                 <div key={i} className="w-full aspect-square bg-white rounded-lg"></div>
               ))}
              </div>
          </div>
          <div className="relative z-10">
            <div className="w-20 h-20 bg-emerald-500 rounded-3xl flex items-center justify-center mx-auto mb-6 shadow-xl shadow-emerald-500/20">
              <ShieldCheck size={40} className="text-white" />
            </div>
            <h1 className="text-2xl font-black text-white tracking-tight mb-2">{t.loginTitle}</h1>
            <p className="text-emerald-400 text-xs font-bold uppercase tracking-[0.2em]">{t.loginSubtitle}</p>
          </div>
        </div>
        
        <form onSubmit={handleSubmit} className="p-10 space-y-6">
          {error && (
            <motion.div 
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              className="p-4 bg-rose-50 border border-rose-100 rounded-2xl flex items-center gap-3 text-rose-600"
            >
              <AlertCircle size={18} />
              <span className="text-xs font-bold">{error}</span>
            </motion.div>
          )}

          <div className="space-y-2">
            <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">{lang === 'en' ? 'Email' : 'Email'}</label>
            <div className="relative">
              <Users className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
              <input 
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full pl-12 pr-6 py-4 bg-slate-50 border border-slate-100 rounded-2xl focus:outline-none focus:ring-4 focus:ring-blue-500/5 focus:border-blue-500 transition-all text-sm font-semibold text-slate-800 animate-fade-in"
                placeholder="name@mamathera.org"
                required
                disabled={isLoading}
              />
            </div>
          </div>
          
          <div className="space-y-2">
            <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">{t.password}</label>
            <div className="relative">
              <Lock className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
              <input 
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full pl-12 pr-6 py-4 bg-slate-50 border border-slate-100 rounded-2xl focus:outline-none focus:ring-4 focus:ring-blue-500/5 focus:border-blue-500 transition-all text-sm font-semibold text-slate-800"
                placeholder="••••••••"
                required
                disabled={isLoading}
              />
            </div>
          </div>
          
          <button 
            type="submit"
            disabled={isLoading}
            className={`w-full bg-slate-800 hover:bg-slate-900 text-white py-5 rounded-2xl font-black text-sm transition-all shadow-xl shadow-slate-800/20 active:scale-[0.98] flex items-center justify-center gap-2 ${isLoading ? 'opacity-70 cursor-not-allowed' : ''}`}
          >
            {isLoading ? (
              <>
                <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
                {lang === 'en' ? 'Signing in...' : 'Connexion...'}
              </>
            ) : (
              <>
                {t.signIn}
                <ChevronRight size={18} />
              </>
            )}
          </button>
        </form>
      </motion.div>
    </div>
  );
};

export default function App() {
  const [lang, setLang] = useState<Language>('fr');

  const toggleLanguage = (newLang: Language) => {
    setLang(newLang);
    setTimeout(() => {
      document.querySelectorAll('[data-i18n]').forEach((el) => {
        const key = el.getAttribute('data-i18n');
        if (key) {
          const text = translations[newLang][key as keyof typeof translations['en']];
          if (text) {
            el.textContent = text;
          }
        }
      });
    }, 0);
  };

  // ── Supabase Auth ──────────────────────────────────────────────────────
  const auth = useAuth();
  
  // Derive currentUser from auth profile for backward compatibility
  const currentUser: User | null = auth.profile ? {
    username: auth.profile.fullName,
    role: auth.profile.role,
    name: auth.profile.fullName,
  } : null;

  // Auth loading state (checking session on page load)
  const authLoading = auth.loading;

  // User profiles list (for user & role management in Settings)
  const [userProfiles, setUserProfiles] = useState<UserProfile[]>([]);
  const [showAddUserModal, setShowAddUserModal] = useState(false);
  const [userSearchTerm, setUserSearchTerm] = useState('');
  const [userRoleFilter, setUserRoleFilter] = useState<'all' | 'admin' | 'staff' | 'dev'>('all');
  const [newUserForm, setNewUserForm] = useState({
    fullName: '',
    email: '',
    password: '',
    role: 'staff' as 'admin' | 'staff',
  });
  const [isCreatingUser, setIsCreatingUser] = useState(false);
  const [updatingUserId, setUpdatingUserId] = useState<string | null>(null);

  const [welcomeMessage, setWelcomeMessage] = useState<string | null>(null);
  
  // Data is now fetched from Supabase via the useSupabaseData hook
  // Toast notifications provide user-facing feedback for all database operations
  const toast = useToast();
  const appEnv = getAppEnv();

  // Bilingual operation labels for toast messages
  const operationLabels: Record<string, { en: string; fr: string }> = useMemo(() => ({
    addParent: { en: 'Parent added', fr: 'Parent ajouté' },
    updateParent: { en: 'Parent updated', fr: 'Parent mis à jour' },
    deleteParent: { en: 'Parent deleted', fr: 'Parent supprimé' },
    addStudent: { en: 'Student added', fr: 'Élève ajouté(e)' },
    updateStudent: { en: 'Student updated', fr: 'Élève mis(e) à jour' },
    deleteStudent: { en: 'Student deleted', fr: 'Élève supprimé(e)' },
    addPayment: { en: 'Payment recorded', fr: 'Paiement enregistré' },
    addStaff: { en: 'Staff added', fr: 'Employé ajouté' },
    updateStaff: { en: 'Staff updated', fr: 'Employé mis à jour' },
    deleteStaff: { en: 'Staff deleted', fr: 'Employé supprimé' },
    addSalaryPayment: { en: 'Salary recorded', fr: 'Salaire enregistré' },
    addExpense: { en: 'Expense added', fr: 'Dépense ajoutée' },
    addVendorExpense: { en: 'Vendor expense added', fr: 'Charge fournisseur ajoutée' },
    updateVendorExpense: { en: 'Vendor expense updated', fr: 'Charge fournisseur mise à jour' },
    deleteVendorExpense: { en: 'Vendor expense deleted', fr: 'Charge fournisseur supprimée' },
    addTodo: { en: 'Task added', fr: 'Tâche ajoutée' },
  }), []);

  const {
    parents, setParents,
    students, setStudents,
    staff, setStaff,
    salaryPayments, setSalaryPayments,
    expenses, setExpenses,
    vendorExpenses, setVendorExpenses,
    todos, setTodos,
    loading: supabaseLoading,
    error: supabaseError,
    pendingQueueCount,
    isSyncing,
    auditLogs,
    fetchAuditLogs,
    syncOfflineQueue,
    fetchAll,
    addPayment,
    deleteStudent,
    deleteStaff,
    deleteParent,
    batchPromoteStudents,
    batchImportData,
  } = useSupabaseData({
    onMutationSuccess: (operation) => {
      const label = operationLabels[operation];
      if (label) {
        toast.success(lang === 'en' ? `✅ ${label.en}` : `✅ ${label.fr}`);
      }
    },
    onMutationError: (operation, errorMessage) => {
      const formatted = formatSupabaseError({ message: errorMessage }, lang);
      toast.error(`${formatted.title}: ${formatted.message}`);
    },
    onRetry: (attempt) => {
      toast.retrying(
        lang === 'en'
          ? `Retrying connection (attempt ${attempt})...`
          : `Nouvelle tentative de connexion (tentative ${attempt})...`
      );
    },
  });

  // Parent Directory States
  const [expandedParentId, setExpandedParentId] = useState<string | null>(null);
  const [parentSearchTerm, setParentSearchTerm] = useState('');
  const [showParentModal, setShowParentModal] = useState(false);
  const [editingParent, setEditingParent] = useState<Parent | null>(null);
  const [parentForm, setParentForm] = useState({
    fullName: '',
    primaryPhone: '',
    secondaryPhone: '',
    email: '',
    address: '',
    occupation: '',
    relationship: 'Father',
    notes: ''
  });
  const [showLinkStudentModal, setShowLinkStudentModal] = useState(false);
  const [activeLinkingParent, setActiveLinkingParent] = useState<Parent | null>(null);
  const [studentToLinkId, setStudentToLinkId] = useState<string>('');
  const [parentChildrenSortBy, setParentChildrenSortBy] = useState<'highest_balance' | 'alphabetical'>('highest_balance');

  // Notify / Payment Reminder Modal States
  const [showNotifyModal, setShowNotifyModal] = useState(false);
  const [notifyParent, setNotifyParent] = useState<Parent | null>(null);
  const [notifySelectedPhone, setNotifySelectedPhone] = useState<string>('');
  const [notifyTemplateType, setNotifyTemplateType] = useState<'polite' | 'urgent' | 'detailed'>('polite');
  const [notifyCustomText, setNotifyCustomText] = useState<string>('');
  const [copiedToast, setCopiedToast] = useState(false);

  const buildReminderText = (
    parent: Parent,
    children: Student[],
    totalOutstanding: number,
    type: 'polite' | 'urgent' | 'detailed',
    language: 'en' | 'fr'
  ) => {
    const schoolName = 'Complexe Scolaire Mama Thera';
    const overdueChildren = children.filter(c => c.totalDue > c.amountPaid);
    const childrenNames = (overdueChildren.length > 0 ? overdueChildren : children).map(c => c.name).join(', ');

    if (language === 'fr') {
      if (type === 'urgent') {
        return `*RAPPEL URGENT - ${schoolName}*\n\nCher/Chère ${parent.fullName},\n\nNous vous informons que les frais de scolarité pour (${childrenNames}) présentent un solde impayé de *${formatCurrency(totalOutstanding)}*.\n\nMerci de bien vouloir effectuer le règlement sous 48h ou de contacter le service financier de l'établissement.\n\nCordialement,\nLa Direction - ${schoolName}`;
      } else if (type === 'detailed') {
        const breakdown = (overdueChildren.length > 0 ? overdueChildren : children).map(c => `- ${c.name} (${c.grade || 'Classe'}): Reste ${formatCurrency(Math.max(0, c.totalDue - c.amountPaid))}`).join('\n');
        return `*SITUATION FINANCIÈRE DE LA FAMILLE - ${schoolName}*\n\nParent : ${parent.fullName}\n\nDétail des impayés par enfant :\n${breakdown}\n\n*TOTAL Reste à Payer : ${formatCurrency(totalOutstanding)}*\n\nMerci de contacter la comptabilité pour régulariser ces frais.`;
      } else {
        return `*RAPPEL DE SCOLARITÉ - ${schoolName}*\n\nBonjour M/Mme ${parent.fullName},\n\nSauf erreur de notre part, le paiement des frais de scolarité de ${childrenNames} présente un solde restant de *${formatCurrency(totalOutstanding)}*.\n\nNous vous prions de bien vouloir procéder au règlement dès que possible.\n\nMerci de votre confiance,\nService Comptabilité - ${schoolName}`;
      }
    } else {
      if (type === 'urgent') {
        return `*URGENT TUITION NOTICE - ${schoolName}*\n\nDear ${parent.fullName},\n\nPlease be advised that the overdue tuition balance for (${childrenNames}) is *${formatCurrency(totalOutstanding)}*.\n\nKindly complete the payment within 48 hours or contact our finance department.\n\nSincerely,\nManagement - ${schoolName}`;
      } else if (type === 'detailed') {
        const breakdown = (overdueChildren.length > 0 ? overdueChildren : children).map(c => `- ${c.name} (${c.grade || 'Grade'}): Outstanding ${formatCurrency(Math.max(0, c.totalDue - c.amountPaid))}`).join('\n');
        return `*FAMILY TUITION STATEMENT - ${schoolName}*\n\nParent: ${parent.fullName}\n\nOutstanding breakdown per child:\n${breakdown}\n\n*TOTAL OUTSTANDING BALANCE: ${formatCurrency(totalOutstanding)}*\n\nPlease reach out to the school accountant for any questions.`;
      } else {
        return `*TUITION REMINDER - ${schoolName}*\n\nDear ${parent.fullName},\n\nThis is a friendly reminder regarding the tuition balance of *${formatCurrency(totalOutstanding)}* for ${childrenNames}.\n\nWe kindly invite you to settle this balance at your earliest convenience.\n\nBest regards,\nAccounting Office - ${schoolName}`;
      }
    }
  };

  const openNotifyModal = (parent: Parent) => {
    const children = getChildrenForParent(parent);
    const totalOutstanding = getParentOutstandingBalance(parent);
    setNotifyParent(parent);
    setNotifySelectedPhone(parent.phones[0] || '');
    setNotifyTemplateType('polite');
    const text = buildReminderText(parent, children, totalOutstanding, 'polite', lang);
    setNotifyCustomText(text);
    setShowNotifyModal(true);
  };

  const handleNotifyTemplateChange = (newType: 'polite' | 'urgent' | 'detailed') => {
    setNotifyTemplateType(newType);
    if (notifyParent) {
      const children = getChildrenForParent(notifyParent);
      const totalOutstanding = getParentOutstandingBalance(notifyParent);
      const text = buildReminderText(notifyParent, children, totalOutstanding, newType, lang);
      setNotifyCustomText(text);
    }
  };

  const handleSendWhatsApp = () => {
    if (!notifySelectedPhone || !notifyCustomText) return;
    const cleanPhone = notifySelectedPhone.replace(/[^0-9]/g, '');
    const url = `https://wa.me/${cleanPhone}?text=${encodeURIComponent(notifyCustomText)}`;
    window.open(url, '_blank');
  };

  const handleSendSMS = () => {
    if (!notifySelectedPhone || !notifyCustomText) return;
    const cleanPhone = notifySelectedPhone.replace(/[^0-9+]/g, '');
    const url = `sms:${cleanPhone}?body=${encodeURIComponent(notifyCustomText)}`;
    window.location.href = url;
  };

  const handleCopyNotifyMessage = () => {
    navigator.clipboard.writeText(notifyCustomText);
    setCopiedToast(true);
    setTimeout(() => setCopiedToast(false), 3000);
  };

  // Parent Relational Helpers
  const getChildrenForParent = (parent: Parent) => {
    return students.filter(s => 
      s.parentId === parent.id || 
      (!s.parentId && s.parentName.trim().toLowerCase() === parent.fullName.trim().toLowerCase()) ||
      (s.parentEmail && parent.email && s.parentEmail.trim().toLowerCase() === parent.email.trim().toLowerCase())
    );
  };

  const getParentOutstandingBalance = (parent: Parent) => {
    const children = getChildrenForParent(parent);
    return children.reduce((sum, child) => sum + Math.max(0, child.totalDue - child.amountPaid), 0);
  };

  const getParentPaymentHistory = (parent: Parent) => {
    const children = getChildrenForParent(parent);
    const ledger: {
      receiptNumber: string;
      studentName: string;
      studentId: string;
      date: string;
      amount: number;
      academicYear?: string;
    }[] = [];

    children.forEach(child => {
      (child.payments || []).forEach((p, idx) => {
        ledger.push({
          receiptNumber: p.receiptNumber || `REC-${child.id}-${idx + 1}`,
          studentName: child.name,
          studentId: child.studentId || child.id,
          date: p.date,
          amount: p.amount,
          academicYear: p.academicYear
        });
      });
    });

    return ledger.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  };

  const handleExportParentLedgerPdf = (parent: Parent) => {
    const children = getChildrenForParent(parent);
    const totalOutstanding = getParentOutstandingBalance(parent);
    const paymentHistory = getParentPaymentHistory(parent);
    const totalPaymentsEver = paymentHistory.reduce((sum, item) => sum + item.amount, 0);

    const doc = new jsPDF({
      orientation: 'portrait',
      unit: 'mm',
      format: 'a4'
    });

    const isFr = lang === 'fr';
    const currencySuffix = ' FCFA';
    const formatPdfAmount = (val: number) => val.toLocaleString('fr-FR') + currencySuffix;

    // Header band
    doc.setFillColor(5, 150, 105); // emerald-600
    doc.rect(0, 0, 210, 28, 'F');

    doc.setTextColor(255, 255, 255);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(15);
    doc.text('COMPLEXE SCOLAIRE MAMA THERA', 14, 12);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10);
    doc.text(isFr ? 'RELEVÉ DE COMPTE FAMILIAL CONSOLIDÉ' : 'CONSOLIDATED FAMILY STATEMENT & LEDGER', 14, 20);

    // Date & Reference
    const todayStr = new Date().toLocaleDateString(isFr ? 'fr-FR' : 'en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });
    doc.setFontSize(9);
    doc.text(`Date: ${todayStr}`, 196, 12, { align: 'right' });
    doc.text(`REF: LEDGER-${parent.id.toUpperCase()}`, 196, 20, { align: 'right' });

    let y = 36;

    // Parent Info Block
    doc.setFillColor(248, 250, 252);
    doc.setDrawColor(226, 232, 240);
    doc.roundedRect(14, y, 182, 32, 3, 3, 'FD');

    doc.setTextColor(15, 23, 42);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.text(`${isFr ? 'PARENT / TUTEUR' : 'PARENT / GUARDIAN'}: ${parent.fullName}`, 18, y + 8);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.setTextColor(71, 85, 105);
    doc.text(`${isFr ? 'Lien de parenté' : 'Relationship'}: ${parent.relationship}`, 18, y + 15);
    doc.text(`${isFr ? 'Téléphone' : 'Phone'}: ${parent.phones.join(' / ')}`, 18, y + 21);
    doc.text(`${isFr ? 'Adresse' : 'Address'}: ${parent.address}`, 18, y + 27);

    doc.text(`${isFr ? 'Profession' : 'Occupation'}: ${parent.occupation}`, 115, y + 15);
    doc.text(`Email: ${parent.email || 'N/A'}`, 115, y + 21);

    y += 40;

    // Summary Financial Banner Box
    doc.setFillColor(236, 253, 245);
    doc.setDrawColor(167, 243, 208);
    doc.roundedRect(14, y, 182, 18, 3, 3, 'FD');

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.setTextColor(6, 95, 70);
    doc.text(isFr ? 'CUMUL DES PAIEMENTS EFFECTUÉS:' : 'CUMULATIVE PAYMENTS MADE:', 18, y + 8);
    doc.setFontSize(11);
    doc.text(formatPdfAmount(totalPaymentsEver), 18, y + 14);

    doc.setFontSize(9);
    doc.setTextColor(153, 27, 27);
    doc.text(isFr ? 'SOLDE RESTANT À PAYER:' : 'OUTSTANDING BALANCE:', 115, y + 8);
    doc.setFontSize(11);
    doc.text(formatPdfAmount(totalOutstanding), 115, y + 14);

    y += 24;

    // Section 1: Linked Children Table
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.setTextColor(15, 23, 42);
    doc.text(isFr ? '1. ÉLÈVES RATTACHÉS À LA FAMILLE' : '1. LINKED STUDENTS', 14, y);
    y += 5;

    doc.setFillColor(241, 245, 249);
    doc.rect(14, y, 182, 7, 'F');
    doc.setFontSize(8);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(71, 85, 105);
    doc.text(isFr ? 'MATRICULE' : 'STUDENT ID', 18, y + 5);
    doc.text(isFr ? 'NOM & PRÉNOM' : 'FULL NAME', 50, y + 5);
    doc.text(isFr ? 'CLASSE' : 'GRADE', 105, y + 5);
    doc.text(isFr ? 'TOTAL DÛ' : 'TOTAL DUE', 135, y + 5);
    doc.text(isFr ? 'RESTE À PAYER' : 'BALANCE', 165, y + 5);
    y += 7;

    doc.setFont('helvetica', 'normal');
    doc.setTextColor(15, 23, 42);

    if (children.length === 0) {
      doc.text(isFr ? 'Aucun enfant rattaché.' : 'No linked students.', 18, y + 5);
      y += 8;
    } else {
      children.forEach((child) => {
        const remaining = Math.max(0, child.totalDue - child.amountPaid);
        doc.text(child.studentId || child.id, 18, y + 5);
        doc.text(child.name.substring(0, 26), 50, y + 5);
        doc.text(child.grade || '-', 105, y + 5);
        doc.text(formatPdfAmount(child.totalDue), 135, y + 5);
        doc.text(formatPdfAmount(remaining), 165, y + 5);
        y += 6;

        doc.setDrawColor(241, 245, 249);
        doc.line(14, y, 196, y);
      });
      y += 4;
    }

    y += 6;

    if (y > 220) {
      doc.addPage();
      y = 20;
    }

    // Section 2: Payment Receipts History Table
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.setTextColor(15, 23, 42);
    doc.text(isFr ? '2. HISTORIQUE DES REÇUS DE PAIEMENT' : '2. CONSOLIDATED PAYMENT RECEIPTS', 14, y);
    y += 5;

    doc.setFillColor(241, 245, 249);
    doc.rect(14, y, 182, 7, 'F');
    doc.setFontSize(8);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(71, 85, 105);
    doc.text(isFr ? 'N° REÇU' : 'RECEIPT #', 18, y + 5);
    doc.text(isFr ? 'DATE' : 'DATE', 48, y + 5);
    doc.text(isFr ? 'ÉLÈVE' : 'STUDENT', 75, y + 5);
    doc.text(isFr ? 'ANNEÉ SCOLAIRE' : 'YEAR', 125, y + 5);
    doc.text(isFr ? 'MONTANT' : 'AMOUNT', 165, y + 5);
    y += 7;

    doc.setFont('helvetica', 'normal');
    doc.setTextColor(15, 23, 42);

    if (paymentHistory.length === 0) {
      doc.text(isFr ? 'Aucun paiement enregistré.' : 'No payment records found.', 18, y + 5);
      y += 8;
    } else {
      paymentHistory.forEach((item) => {
        if (y > 270) {
          doc.addPage();
          y = 20;
          doc.setFillColor(241, 245, 249);
          doc.rect(14, y, 182, 7, 'F');
          doc.setFontSize(8);
          doc.setFont('helvetica', 'bold');
          doc.setTextColor(71, 85, 105);
          doc.text(isFr ? 'N° REÇU' : 'RECEIPT #', 18, y + 5);
          doc.text(isFr ? 'DATE' : 'DATE', 48, y + 5);
          doc.text(isFr ? 'ÉLÈVE' : 'STUDENT', 75, y + 5);
          doc.text(isFr ? 'ANNEÉ SCOLAIRE' : 'YEAR', 125, y + 5);
          doc.text(isFr ? 'MONTANT' : 'AMOUNT', 165, y + 5);
          y += 7;
          doc.setFont('helvetica', 'normal');
          doc.setTextColor(15, 23, 42);
        }

        doc.text(item.receiptNumber || 'REC', 18, y + 5);
        doc.text(item.date || '', 48, y + 5);
        doc.text((item.studentName || '').substring(0, 24), 75, y + 5);
        doc.text(item.academicYear || '-', 125, y + 5);
        doc.text(formatPdfAmount(item.amount), 165, y + 5);
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
    doc.text(isFr ? 'CUMUL TOTAL DES PAIEMENTS ENREGISTRÉS:' : 'TOTAL CUMULATIVE PAYMENTS RECORDED:', 18, y + 5.5);
    doc.text(formatPdfAmount(totalPaymentsEver), 165, y + 5.5);

    y += 18;
    if (y > 275) {
      doc.addPage();
      y = 250;
    }
    doc.setFont('helvetica', 'italic');
    doc.setFontSize(8);
    doc.setTextColor(148, 163, 184);
    doc.text(
      isFr
        ? 'Document officiel édité électroniquement par Finance Exécutive - Complexe Scolaire Mama Thera.'
        : 'Official electronic document generated by Executive Finance - Complexe Scolaire Mama Thera.',
      105,
      y,
      { align: 'center' }
    );

    const safeName = parent.fullName.replace(/[^a-zA-Z0-9_-]/g, '_');
    doc.save(`Releve_Parent_${safeName}_${new Date().toISOString().slice(0, 10)}.pdf`);
  };

  const handleParentSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!parentForm.fullName.trim()) return;

    const phonesArr = [parentForm.primaryPhone.trim(), parentForm.secondaryPhone.trim()].filter(Boolean);

    if (editingParent) {
      setParents(prev => prev.map(p => p.id === editingParent.id ? {
        ...p,
        fullName: parentForm.fullName.trim(),
        phones: phonesArr.length > 0 ? phonesArr : ['N/A'],
        email: parentForm.email.trim() || undefined,
        address: parentForm.address.trim() || 'N/A',
        occupation: parentForm.occupation.trim() || 'N/A',
        relationship: parentForm.relationship || 'Guardian',
        notes: parentForm.notes.trim()
      } : p));
      
      setStudents(prev => prev.map(s => s.parentId === editingParent.id ? {
        ...s,
        parentName: parentForm.fullName.trim(),
        parentPhone: parentForm.primaryPhone.trim() || s.parentPhone,
        parentEmail: parentForm.email.trim() || s.parentEmail
      } : s));
    } else {
      const newParent: Parent = {
        id: `PAR${Date.now().toString().slice(-4)}`,
        fullName: parentForm.fullName.trim(),
        phones: phonesArr.length > 0 ? phonesArr : ['N/A'],
        email: parentForm.email.trim() || undefined,
        address: parentForm.address.trim() || 'N/A',
        occupation: parentForm.occupation.trim() || 'N/A',
        relationship: parentForm.relationship || 'Guardian',
        notes: parentForm.notes.trim()
      };
      setParents(prev => [newParent, ...prev]);
    }

    setShowParentModal(false);
    setEditingParent(null);
    setParentForm({ fullName: '', primaryPhone: '', secondaryPhone: '', email: '', address: '', occupation: '', relationship: 'Father', notes: '' });
  };

  const handleLinkStudentSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!activeLinkingParent || !studentToLinkId) return;

    setStudents(prev => prev.map(s => s.id === studentToLinkId ? {
      ...s,
      parentId: activeLinkingParent.id,
      parentName: activeLinkingParent.fullName,
      parentPhone: activeLinkingParent.phones[0] || s.parentPhone,
      parentEmail: activeLinkingParent.email || s.parentEmail
    } : s));

    setShowLinkStudentModal(false);
    setActiveLinkingParent(null);
    setStudentToLinkId('');
  };

  const handleUnlinkStudent = (studentId: string) => {
    setStudents(prev => prev.map(s => s.id === studentId ? {
      ...s,
      parentId: undefined
    } : s));
  };

  const handleDeleteParent = (parentId: string) => {
    if (confirm(t.confirmDeleteParent)) {
      setParents(prev => prev.filter(p => p.id !== parentId));
      setStudents(prev => prev.map(s => s.parentId === parentId ? { ...s, parentId: undefined } : s));
    }
  };

  const openEditParentModal = (parent: Parent) => {
    setEditingParent(parent);
    setParentForm({
      fullName: parent.fullName,
      primaryPhone: parent.phones[0] || '',
      secondaryPhone: parent.phones[1] || '',
      email: parent.email || '',
      address: parent.address,
      occupation: parent.occupation,
      relationship: parent.relationship,
      notes: parent.notes || ''
    });
    setShowParentModal(true);
  };

  const [searchTerm, setSearchTerm] = useState('');
  const [selectedStudent, setSelectedStudent] = useState<Student | null>(null);
  const [showPaymentForm, setShowPaymentForm] = useState(false);
  const [showStudentModal, setShowStudentModal] = useState(false);
  const [editingStudent, setEditingStudent] = useState<Student | null>(null);
  const [showSuccessToast, setShowSuccessToast] = useState(false);
  const [copied, setCopied] = useState(false);
  const [activeTab, setActiveTab] = useState<'dashboard' | 'students' | 'parents' | 'payroll' | 'expenses' | 'settings' | 'calendar' | 'notes' | 'archives' | 'audit'>('dashboard');
  const [selectedYear, setSelectedYear] = useState<string>('2026-2027');
  const [lockedYears, setLockedYears] = useState<string[]>([]);
  const [showAuditModal, setShowAuditModal] = useState(false);
  const [auditYear, setAuditYear] = useState<string | null>(null);

  const [academicYears, setAcademicYears] = useState<string[]>(['2026-2027', '2027-2028', '2028-2029']);
  const [isPromotionWizardOpen, setIsPromotionWizardOpen] = useState(false);
  const [showExcelImport, setShowExcelImport] = useState(false);

  // Classes & Sections Management
  const [availableClasses, setAvailableClasses] = useState<SchoolClass[]>(() => {
    try {
      const saved = localStorage.getItem('mama_thera_classes');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
      }
    } catch (e) {
      console.warn('Failed to load custom classes:', e);
    }
    return DEFAULT_SCHOOL_CLASSES;
  });

  const [studentGradeFilter, setStudentGradeFilter] = useState<string>('all');
  const [showAddClassModal, setShowAddClassModal] = useState<boolean>(false);
  const [newClassForm, setNewClassForm] = useState<{
    cycle: 'cycle1' | 'cycle2' | 'lycee' | 'maternelle' | 'other';
    year: string;
    section: string;
    customName: string;
  }>({
    cycle: 'cycle1',
    year: '1',
    section: 'D',
    customName: ''
  });

  // Show welcome message when auth profile loads for the first time
  const [hasShownWelcome, setHasShownWelcome] = useState(false);
  useEffect(() => {
    if (auth.profile && !hasShownWelcome) {
      setHasShownWelcome(true);
      if (auth.profile.role === 'staff') {
        setActiveTab('students');
      } else {
        setActiveTab('dashboard');
      }
      const displayName = auth.profile.fullName || auth.profile.email;
      setWelcomeMessage(lang === 'en' ? `Welcome back, ${displayName}!` : `Bon retour, ${displayName} !`);
      setTimeout(() => {
        setWelcomeMessage(null);
      }, 5000);

      // Fetch user profiles for admin
      if (auth.isAdmin) {
        auth.fetchAllProfiles().then(profiles => setUserProfiles(profiles));
      }
    }
    if (!auth.profile) {
      setHasShownWelcome(false);
    }
  }, [auth.profile]);
  const [theme, setTheme] = useState<'navy' | 'cream' | 'slate' | 'emerald' | 'bordeaux' | 'midnight'>('navy');
  const [schoolLogo, setSchoolLogo] = useState<string | null>(null);
  const [logoColor, setLogoColor] = useState<string | null>(null);
  const logoInputRef = useRef<HTMLInputElement>(null);

  // New State for Payroll & Expenses
  // staff, expenses, vendorExpenses, salaryPayments are now provided by useSupabaseData hook above
  
  const [showStaffModal, setShowStaffModal] = useState(false);
  const [showMonthlyDraftModal, setShowMonthlyDraftModal] = useState(false);
  const [selectedDraftMonth, setSelectedDraftMonth] = useState<number>(new Date().getMonth());
  const [selectedDraftYear, setSelectedDraftYear] = useState<number>(new Date().getFullYear());
  const [showExpenseModal, setShowExpenseModal] = useState(false);
  const [showVendorExpenseModal, setShowVendorExpenseModal] = useState(false);
  const [showSalaryModal, setShowSalaryModal] = useState(false);
  const [vendorExpensesTab, setVendorExpensesTab] = useState<'general' | 'vendors'>('general');
  const [generalExpenseCategoryFilter, setGeneralExpenseCategoryFilter] = useState<string>('all');
  const [generalExpenseSearch, setGeneralExpenseSearch] = useState<string>('');
  const [vendorSearch, setVendorSearch] = useState('');
  const [vendorCategoryFilter, setVendorCategoryFilter] = useState<string>('all');
  const [vendorStatusFilter, setVendorStatusFilter] = useState<string>('all');
  
  const [staffForm, setStaffForm] = useState({ name: '', position: '', salary: '', email: '', phone: '', bankDetails: '', emergencyContact: '' });
  const [staffSearchTerm, setStaffSearchTerm] = useState('');
  const [visibleBankDetails, setVisibleBankDetails] = useState<Record<string, boolean>>({});
  const [calendarDate, setCalendarDate] = useState(new Date());
  const [selectedCalendarDay, setSelectedCalendarDay] = useState<Date | null>(null);
  const [showCalendarModal, setShowCalendarModal] = useState(false);
  const [expenseForm, setExpenseForm] = useState({ category: 'Other', description: '', amount: '', date: new Date().toISOString().split('T')[0] });
  const [vendorExpenseForm, setVendorExpenseForm] = useState({ 
    vendorName: '', 
    category: 'stationery' as any, 
    amount: '', 
    dueDate: new Date().toISOString().split('T')[0], 
    paymentStatus: 'unpaid' as any, 
    amountPaid: '', 
    description: '',
    aidType: '' as any,
    beneficiaryStudentName: '',
    beneficiaryStudentGrade: ''
  });
  const [salaryForm, setSalaryForm] = useState({ staffId: '', amount: '', date: new Date().toISOString().split('T')[0] });
  
  const [editingStaff, setEditingStaff] = useState<Staff | null>(null);
  const [editingVendorExpense, setEditingVendorExpense] = useState<VendorExpense | null>(null);

  // todos are now provided by useSupabaseData hook above
  const [todoInput, setTodoInput] = useState('');
  const [showTodoSidebar, setShowTodoSidebar] = useState(false);
  const [productivitySidebarTab, setProductivitySidebarTab] = useState<'tasks' | 'ai'>('tasks');
  const [aiMessages, setAiMessages] = useState<{ sender: 'user' | 'assistant'; text: string }[]>([
    { sender: 'assistant', text: 'Hello! I am your Mama Thera Finance Assistant. How can I assist you with calculations or school statistics today?' }
  ]);
  const [aiInput, setAiInput] = useState('');
  const [isFloatingChatOpen, setIsFloatingChatOpen] = useState(false);
  const [floatingChatMessages, setFloatingChatMessages] = useState<{ sender: 'user' | 'assistant'; text: string }[]>([]);
  const [floatingChatInput, setFloatingChatInput] = useState('');

  useEffect(() => {
    if (floatingChatMessages.length === 0) {
      setFloatingChatMessages([
        {
          sender: 'assistant',
          text: lang === 'en' 
            ? 'Hello! I am your Mama Thera Finance Assistant. How can I assist you with school statistics today? You can ask me financial questions, or click one of the quick options below!' 
            : 'Bonjour ! Je suis votre assistant financier Mama Thera. Comment puis-je vous aider avec les statistiques scolaires aujourd\'hui ? Vous pouvez me poser des questions financières, ou cliquer sur l\'une des options rapides ci-dessous !'
        }
      ]);
    }
  }, [lang]);

  const [ticketStudent, setTicketStudent] = useState<Student | null>(null);

  // Sorting state for student list
  const [studentSortKey, setStudentSortKey] = useState<'name' | 'parentName' | 'balance' | 'dueDate' | null>(null);
  const [studentSortOrder, setStudentSortOrder] = useState<'asc' | 'desc'>('asc');

  const handleSort = (key: 'name' | 'parentName' | 'balance' | 'dueDate') => {
    if (studentSortKey === key) {
      setStudentSortOrder(prev => prev === 'asc' ? 'desc' : 'asc');
    } else {
      setStudentSortKey(key);
      setStudentSortOrder('asc');
    }
  };

  // Student Form State
  const [studentForm, setStudentForm] = useState({
    name: '',
    parentName: '',
    parentEmail: '',
    parentPhone: '',
    totalDue: '',
    scholarshipDiscount: '0',
    dueDate: new Date().toISOString().split('T')[0],
    academicYear: '2024-2025',
    grade: '',
    // Student Profiles & Enrollment Fields
    studentId: '',
    photo: '',
    emergencyContactName: '',
    emergencyContactRelation: '',
    emergencyContactPhone: '',
    medicalNotes: 'None',
    enrollmentDate: new Date().toISOString().split('T')[0],
    previousSchool: '',
    status: 'Active' as 'Active' | 'Graduated' | 'Left'
  });

  // State for active tab in student detailed viewer
  const [studentDetailTab, setStudentDetailTab] = useState<'general' | 'parent' | 'medical'>('general');
  // State for triggering A4 student file printout
  const [printStudentFile, setPrintStudentFile] = useState<Student | null>(null);

  // Payment Form State
  const [paymentStudentId, setPaymentStudentId] = useState('');
  const [paymentAmount, setPaymentAmount] = useState('');
  const [paymentDate, setPaymentDate] = useState(new Date().toISOString().split('T')[0]);

  const t = translations[lang];
  const today = new Date().toISOString().split('T')[0];
  const currentMonth = new Date().getMonth();

  const expenseCategoryList = useMemo(() => {
    const keys = [
      'insurance',
      'social_cases',
      'exam_bac',
      'exam_def',
      'electricity',
      'water',
      'social_events',
      'internet',
      'stationery',
      'security_maintenance',
      'machine_management',
      'taxes',
      'furniture',
      'solar_energy',
      'reforestation',
      'catering',
      'works_renovation',
      'training'
    ];
    return keys
      .map(key => ({ key, label: (t as any)[key] || key }))
      .sort((a, b) => a.label.localeCompare(b.label, lang === 'en' ? 'en' : 'fr', { sensitivity: 'base' }));
  }, [t, lang]);

  // --- Theme Logic ---
  useEffect(() => {
    const savedTheme = localStorage.getItem('school-finance-theme') as any;
    const savedLogo = localStorage.getItem('school-finance-logo');
    const savedLogoColor = localStorage.getItem('school-finance-logo-color');
    if (savedTheme) {
      if (savedTheme === 'midnight') setTheme('slate');
      else if (savedTheme === 'modern') setTheme('cream');
      else setTheme(savedTheme);
    }
    if (savedLogo) setSchoolLogo(savedLogo);
    if (savedLogoColor) setLogoColor(savedLogoColor);
  }, []);

  useEffect(() => {
    localStorage.setItem('school-finance-theme', theme);
  }, [theme]);

  // Automated effect to trigger print and clean up state
  useEffect(() => {
    if (printStudentFile) {
      const timer = setTimeout(() => {
        window.print();
        setPrintStudentFile(null);
      }, 300);
      return () => clearTimeout(timer);
    }
  }, [printStudentFile]);

  useEffect(() => {
    if (schoolLogo) {
      localStorage.setItem('school-finance-logo', schoolLogo);
    } else {
      localStorage.removeItem('school-finance-logo');
    }
    if (logoColor) {
      localStorage.setItem('school-finance-logo-color', logoColor);
    } else {
      localStorage.removeItem('school-finance-logo-color');
    }
  }, [schoolLogo, logoColor]);

  const currentTheme = useMemo(() => {
    const isCream = theme === 'cream';
    const isSlate = theme === 'slate';
    const isEmerald = theme === 'emerald';
    const isBordeaux = theme === 'bordeaux';
    const isMidnight = theme === 'midnight';

    const isDark = isSlate || isMidnight;

    return {
      bg: isMidnight 
        ? 'bg-[#090D16]' 
        : isSlate 
        ? 'bg-[#1E293B]' 
        : isEmerald 
        ? 'bg-[#F0FDF4]' 
        : isBordeaux 
        ? 'bg-[#FFF1F2]' 
        : isCream 
        ? 'bg-[#FDFBF7]' 
        : 'bg-[#F8FAFC]',

      card: isMidnight 
        ? 'bg-[#111827]' 
        : isSlate 
        ? 'bg-[#334155]' 
        : 'bg-white',

      text: isMidnight 
        ? 'text-[#F9FAFB]' 
        : isSlate 
        ? 'text-[#F8FAFC]' 
        : isEmerald 
        ? 'text-[#064E3B]' 
        : isBordeaux 
        ? 'text-[#881337]' 
        : isCream 
        ? 'text-[#1A1A1A]' 
        : 'text-slate-900',

      muted: isMidnight 
        ? 'text-[#9CA3AF]' 
        : isSlate 
        ? 'text-[#94A3B8]' 
        : isEmerald 
        ? 'text-[#047857]' 
        : isBordeaux 
        ? 'text-[#9F1239]' 
        : isCream 
        ? 'text-[#6B6659]' 
        : 'text-slate-400',

      border: isMidnight 
        ? 'border-[#1F2937]' 
        : isSlate 
        ? 'border-[#475569]' 
        : isEmerald 
        ? 'border-[#BBF7D0]' 
        : isBordeaux 
        ? 'border-[#FECDD3]' 
        : isCream 
        ? 'border-[#E5DEC9]' 
        : 'border-slate-100',

      header: logoColor || (isMidnight ? '#030712' : isSlate ? '#0F172A' : isEmerald ? '#064E3B' : isBordeaux ? '#881337' : isCream ? '#1E5E3A' : '#0F172A'),

      sidebar: isMidnight ? 'bg-[#030712]' : isSlate ? 'bg-[#1E293B]' : isEmerald ? 'bg-[#064E3B]' : isBordeaux ? 'bg-[#881337]' : isCream ? 'bg-[#1B2D1D]' : 'bg-[#0F172A]',

      accent: isMidnight ? 'amber-400' : isSlate ? 'sky-400' : isEmerald ? 'emerald-600' : isBordeaux ? 'rose-600' : isCream ? '[#1E5E3A]' : 'blue-600',

      accentBg: isMidnight ? 'bg-amber-500' : isSlate ? 'bg-sky-500' : isEmerald ? 'bg-emerald-600' : isBordeaux ? 'bg-rose-600' : isCream ? 'bg-[#1E5E3A]' : 'bg-blue-600',

      accentHover: isMidnight ? 'hover:bg-amber-600' : isSlate ? 'hover:bg-sky-600' : isEmerald ? 'hover:bg-emerald-700' : isBordeaux ? 'hover:bg-rose-700' : isCream ? 'hover:bg-[#15462B]' : 'hover:bg-blue-700',

      accentShadow: isMidnight ? 'shadow-amber-500/20' : isSlate ? 'shadow-sky-500/20' : isEmerald ? 'shadow-emerald-600/20' : isBordeaux ? 'shadow-rose-600/20' : isCream ? 'shadow-emerald-700/20' : 'shadow-blue-500/20',

      tableHeader: isDark ? 'bg-[#1E293B]/50 text-[#F8FAFC]' : isEmerald ? 'bg-[#DCFCE7] text-[#065F46]' : isBordeaux ? 'bg-[#FFE4E6] text-[#9F1239]' : isCream ? 'bg-[#F4EFE0] text-[#5C5647]' : 'bg-slate-50/50 text-slate-400',

      rowHover: isDark ? 'hover:bg-[#475569]/50' : isEmerald ? 'hover:bg-[#F0FDF4]' : isBordeaux ? 'hover:bg-[#FFF1F2]' : isCream ? 'hover:bg-[#FAF7F0]' : 'hover:bg-slate-50/80',

      input: isMidnight ? 'bg-[#111827] border-[#374151] text-white' : isSlate ? 'bg-[#1E293B] border-[#475569] text-[#F8FAFC]' : isEmerald ? 'bg-[#F0FDF4] border-[#A7F3D0] text-[#064E3B]' : isBordeaux ? 'bg-[#FFF1F2] border-[#FECDD3] text-[#881337]' : isCream ? 'bg-[#FCFAF2] border-[#DCD3B6] text-[#1A1A1A]' : 'bg-slate-50 border-slate-200 text-slate-900',

      isDark
    };
  }, [theme, logoColor]);

  // --- Calculations ---

  const getYearStats = (year: string) => {
    const filteredStudents = students.filter(s => s.academicYear === year || (!s.academicYear && year === '2024-2025'));
    const filteredExpenses = expenses.filter(e => e.academicYear === year || (!e.academicYear && year === '2024-2025'));
    const filteredVendorExpenses = vendorExpenses.filter(v => v.academicYear === year || (!v.academicYear && year === '2024-2025'));
    const filteredSalaryPayments = salaryPayments.filter(s => s.academicYear === year || (!s.academicYear && year === '2024-2025'));

    const totalRevenue = filteredStudents.reduce((acc, s) => acc + s.amountPaid, 0);

    const totalVendorExpensesPaid = filteredVendorExpenses.reduce((acc, v) => {
      if (v.paymentStatus === 'paid') {
        return acc + v.amount;
      } else if (v.paymentStatus === 'partial') {
        return acc + (v.amountPaid || 0);
      }
      return acc;
    }, 0);

    const totalExpenses = filteredExpenses.reduce((acc, e) => acc + e.amount, 0) + 
                          filteredSalaryPayments.reduce((acc, s) => acc + s.amount, 0) +
                          totalVendorExpensesPaid;

    const balance = totalRevenue - totalExpenses;

    return {
      revenue: totalRevenue,
      expenses: totalExpenses,
      balance
    };
  };

  const stats = useMemo(() => {
    const filteredStudents = students.filter(s => !selectedYear || s.academicYear === selectedYear || !s.academicYear);
    const filteredExpenses = expenses.filter(e => !selectedYear || e.academicYear === selectedYear || !e.academicYear);
    const filteredVendorExpenses = vendorExpenses.filter(v => !selectedYear || v.academicYear === selectedYear || !v.academicYear);
    const filteredSalaryPayments = salaryPayments.filter(s => !selectedYear || s.academicYear === selectedYear || !s.academicYear);

    const totalOutstanding = filteredStudents.reduce((acc, s) => {
      const discount = s.scholarshipDiscount || 0;
      const discountedTotal = s.totalDue * (1 - discount / 100);
      return acc + Math.max(0, discountedTotal - s.amountPaid);
    }, 0);
    
    const totalFees = filteredStudents.reduce((acc, s) => acc + s.amountPaid, 0);

    const totalVendorExpensesPaid = filteredVendorExpenses.reduce((acc, v) => {
      if (v.paymentStatus === 'paid') {
        return acc + v.amount;
      } else if (v.paymentStatus === 'partial') {
        return acc + (v.amountPaid || 0);
      }
      return acc;
    }, 0);

    const totalExpenses = filteredExpenses.reduce((acc, e) => acc + e.amount, 0) + 
                          filteredSalaryPayments.reduce((acc, s) => acc + s.amount, 0) +
                          totalVendorExpensesPaid;

    const totalArrears = staff.reduce((acc, s) => {
      const paidThisMonth = filteredSalaryPayments
        .filter(p => p.staffId === s.id && new Date(p.date).getMonth() === currentMonth)
        .reduce((sum, p) => sum + p.amount, 0);
      return acc + Math.max(0, s.salary - paidThisMonth);
    }, 0);

    const collectedThisMonth = filteredStudents.reduce((acc, s) => {
      const thisMonthPayments = s.payments.filter(p => {
        const payDate = new Date(p.date);
        return payDate.getMonth() === currentMonth;
      });
      return acc + thisMonthPayments.reduce((sum, p) => sum + p.amount, 0);
    }, 0);

    const lateParentsCount = filteredStudents.filter(s => {
      const discount = s.scholarshipDiscount || 0;
      const discountedTotal = s.totalDue * (1 - discount / 100);
      return (discountedTotal - s.amountPaid) > 0 && s.dueDate < today;
    }).length;

    const vendorExpensesThisMonth = filteredVendorExpenses.reduce((acc, v) => {
      const dueDateObj = new Date(v.dueDate);
      if (dueDateObj.getMonth() === currentMonth) {
        if (v.paymentStatus === 'paid') {
          return acc + v.amount;
        } else if (v.paymentStatus === 'partial') {
          return acc + (v.amountPaid || 0);
        }
      }
      return acc;
    }, 0);

    const expensesThisMonth = filteredExpenses.reduce((acc, e) => {
      const expDate = new Date(e.date);
      return expDate.getMonth() === currentMonth ? acc + e.amount : acc;
    }, 0) + filteredSalaryPayments.reduce((acc, s) => {
      const salDate = new Date(s.date);
      return salDate.getMonth() === currentMonth ? acc + s.amount : acc;
    }, 0) + vendorExpensesThisMonth;

    const enrolledStudentsCount = filteredStudents.length;

    return { 
      totalOutstanding, 
      collectedMonth: collectedThisMonth, 
      lateParentsCount,
      totalFees,
      totalExpenses,
      totalArrears,
      expensesThisMonth,
      enrolledStudentsCount
    };
  }, [students, today, currentMonth, expenses, vendorExpenses, salaryPayments, staff, selectedYear]);

  const notifications = useMemo(() => {
    const list: { id: string; type: 'due' | 'note'; message: string; studentId: string }[] = [];
    
    const relevantStudents = students.filter(s => !selectedYear || s.academicYear === selectedYear);

    relevantStudents.forEach(s => {
      const balance = s.totalDue - s.amountPaid;
      if (balance > 0) {
        // Due Date < 2 days
        const due = new Date(s.dueDate);
        const now = new Date(today);
        const diffTime = due.getTime() - now.getTime();
        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
        
        if (diffDays >= 0 && diffDays < 2) {
          list.push({
            id: `due-${s.id}`,
            type: 'due',
            message: `${s.name}: ${t.dueReminder}`,
            studentId: s.id
          });
        }

        // Late parent + note > 3 days ago + no payment update
        // We check if balance is still > 0 and s.dueDate < today
        if (diffDays < 0 && s.lastNoteDate) {
          const noteDate = new Date(s.lastNoteDate);
          const diffNoteTime = now.getTime() - noteDate.getTime();
          const diffNoteDays = Math.floor(diffNoteTime / (1000 * 60 * 60 * 24));
          
          if (diffNoteDays > 3) {
            list.push({
              id: `note-${s.id}`,
              type: 'note',
              message: `${s.name}: ${t.noteReminder}`,
              studentId: s.id
            });
          }
        }
      }
    });

    return list;
  }, [students, today, t, selectedYear]);

  const filteredStudents = useMemo(() => {
    const list = students.filter(s => 
      (!selectedYear || s.academicYear === selectedYear || !s.academicYear) &&
      (studentGradeFilter === 'all' || (s.grade && s.grade.toLowerCase() === studentGradeFilter.toLowerCase())) &&
      (s.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
       s.parentName.toLowerCase().includes(searchTerm.toLowerCase()) ||
       (s.studentId && s.studentId.toLowerCase().includes(searchTerm.toLowerCase())) ||
       (s.grade && s.grade.toLowerCase().includes(searchTerm.toLowerCase())))
    );

    if (studentSortKey) {
      list.sort((a, b) => {
        if (studentSortKey === 'name') {
          return studentSortOrder === 'asc' 
            ? a.name.localeCompare(b.name, lang) 
            : b.name.localeCompare(a.name, lang);
        } else if (studentSortKey === 'parentName') {
          return studentSortOrder === 'asc' 
            ? a.parentName.localeCompare(b.parentName, lang) 
            : b.parentName.localeCompare(a.parentName, lang);
        }

        let valueA: any;
        let valueB: any;

        if (studentSortKey === 'balance') {
          const discountA = a.scholarshipDiscount || 0;
          const discountedTotalA = a.totalDue * (1 - discountA / 100);
          valueA = discountedTotalA - a.amountPaid;

          const discountB = b.scholarshipDiscount || 0;
          const discountedTotalB = b.totalDue * (1 - discountB / 100);
          valueB = discountedTotalB - b.amountPaid;
        } else if (studentSortKey === 'dueDate') {
          valueA = a.dueDate;
          valueB = b.dueDate;
        }

        if (valueA === undefined || valueA === null) return 1;
        if (valueB === undefined || valueB === null) return -1;

        if (valueA < valueB) return studentSortOrder === 'asc' ? -1 : 1;
        if (valueA > valueB) return studentSortOrder === 'asc' ? 1 : -1;
        return 0;
      });
    }

    return list;
  }, [students, searchTerm, studentGradeFilter, selectedYear, studentSortKey, studentSortOrder, lang]);

  const filteredStaff = useMemo(() => {
    return staff.filter(s => 
      s.name.toLowerCase().includes(staffSearchTerm.toLowerCase()) ||
      s.phone.toLowerCase().includes(staffSearchTerm.toLowerCase())
    );
  }, [staff, staffSearchTerm]);

  const lateStudents = useMemo(() => {
    return students.filter(s => {
      const discount = s.scholarshipDiscount || 0;
      const discountedTotal = s.totalDue * (1 - discount / 100);
      return (!selectedYear || s.academicYear === selectedYear || !s.academicYear) &&
             (discountedTotal - s.amountPaid) > 0 && s.dueDate < today;
    });
  }, [students, today, selectedYear]);

  const chartData = useMemo(() => {
    const months = [t.jan, t.feb, t.mar, t.apr, t.may, t.jun, t.jul, t.aug, t.sep, t.oct, t.nov, t.dec];
    return months.map((month, index) => {
      const monthIncome = students.reduce((acc, s) => {
        const thisMonthPayments = s.payments.filter(p => {
          const d = new Date(p.date);
          return d.getMonth() === index && (!selectedYear || s.academicYear === selectedYear || !s.academicYear);
        });
        return acc + thisMonthPayments.reduce((sum, p) => sum + p.amount, 0);
      }, 0);

      const monthExpenses = expenses.filter(e => {
        const d = new Date(e.date);
        return d.getMonth() === index && (!selectedYear || e.academicYear === selectedYear || !e.academicYear);
      }).reduce((acc, e) => acc + e.amount, 0) + 
      salaryPayments.filter(p => {
        const d = new Date(p.date);
        return d.getMonth() === index && (!selectedYear || p.academicYear === selectedYear || !p.academicYear);
      }).reduce((acc, p) => acc + p.amount, 0);

      return {
        name: month.substring(0, 3),
        income: monthIncome,
        expenses: monthExpenses
      };
    });
  }, [students, expenses, salaryPayments, selectedYear, t]);

  const pieData = useMemo(() => {
    const filteredStudents = students.filter(s => !selectedYear || s.academicYear === selectedYear || !s.academicYear);
    const totalPaid = filteredStudents.reduce((acc, s) => acc + s.amountPaid, 0);
    const totalOutstanding = filteredStudents.reduce((acc, s) => {
      const discount = s.scholarshipDiscount || 0;
      const discountedTotal = s.totalDue * (1 - discount / 100);
      return acc + Math.max(0, discountedTotal - s.amountPaid);
    }, 0);

    return [
      { name: t.paid, value: totalPaid },
      { name: t.outstanding, value: totalOutstanding }
    ];
  }, [students, selectedYear, t]);

  const missedMonths = useMemo(() => {
    // If no staff members exist yet, do not trigger false missed-payroll warnings
    if (staff.length === 0) return [];

    const currentCalendarYear = new Date().getFullYear();
    const currentCalendarMonth = new Date().getMonth();
    const missed: number[] = [];
    
    for (let m = 0; m <= currentCalendarMonth; m++) {
      const monthPayments = salaryPayments.filter(p => {
        const payDate = new Date(p.date);
        return payDate.getFullYear() === currentCalendarYear && payDate.getMonth() === m && (!selectedYear || p.academicYear === selectedYear);
      });
      const totalPaid = monthPayments.reduce((sum, p) => sum + p.amount, 0);
      if (totalPaid === 0) {
        missed.push(m);
      }
    }
    return missed;
  }, [salaryPayments, staff.length, selectedYear]);

  const payrollWindowStatus = useMemo(() => {
    const currentDay = new Date().getDate();
    const currentCalendarYear = new Date().getFullYear();
    const currentCalendarMonth = new Date().getMonth();

    // If no staff members exist yet, payroll window alerts are inactive
    if (staff.length === 0) {
      return {
        currentDay,
        currentCalendarYear,
        currentCalendarMonth,
        totalPaidCurrentMonth: 0,
        isOverdue: false,
        isOpen: false
      };
    }

    const currentMonthPayments = salaryPayments.filter(p => {
      const payDate = new Date(p.date);
      return payDate.getFullYear() === currentCalendarYear && payDate.getMonth() === currentCalendarMonth && (!selectedYear || p.academicYear === selectedYear);
    });
    const totalPaidCurrentMonth = currentMonthPayments.reduce((sum, p) => sum + p.amount, 0);

    const isOverdue = currentDay >= 11 && totalPaidCurrentMonth === 0;
    const isOpen = currentDay >= 1 && currentDay <= 10;

    return {
      currentDay,
      currentCalendarYear,
      currentCalendarMonth,
      totalPaidCurrentMonth,
      isOverdue,
      isOpen
    };
  }, [salaryPayments, staff.length, selectedYear]);

  // --- Handlers ---

  const handleExport = () => {
    const data = lateStudents.map(s => ({
      [t.studentName]: s.name,
      [t.parentName]: s.parentName,
      [t.parentEmail]: s.parentEmail,
      [t.parentPhone]: s.parentPhone,
      [t.totalDue]: s.totalDue,
      [t.balance]: s.totalDue - s.amountPaid,
      'Due Date': s.dueDate
    }));

    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Late Payments");
    XLSX.writeFile(wb, "Late_Payments_Report.xlsx");
  };

  const handleExportAllData = () => {
    const wb = XLSX.utils.book_new();
    
    // Students
    const studentData = students.map(s => ({
      ID: s.id,
      Name: s.name,
      Parent: s.parentName,
      Email: s.parentEmail,
      Phone: s.parentPhone,
      'Total Due': s.totalDue,
      'Scholarship %': s.scholarshipDiscount || 0,
      'Amount Paid': s.amountPaid,
      'Balance': (s.totalDue * (1 - (s.scholarshipDiscount || 0) / 100)) - s.amountPaid,
      'Due Date': s.dueDate,
      'Academic Year': s.academicYear || 'N/A'
    }));
    const wsStudents = XLSX.utils.json_to_sheet(studentData);
    XLSX.utils.book_append_sheet(wb, wsStudents, "Students");

    // Staff
    const staffData = staff.map(s => ({
      ID: s.id,
      Name: s.name,
      Position: s.position,
      Salary: s.salary,
      Email: s.email,
      Phone: s.phone,
      'Academic Year': s.academicYear || 'N/A'
    }));
    const wsStaff = XLSX.utils.json_to_sheet(staffData);
    XLSX.utils.book_append_sheet(wb, wsStaff, "Staff");

    // Expenses
    const expenseData = expenses.map(e => ({
      ID: e.id,
      Category: e.category,
      Description: e.description,
      Amount: e.amount,
      Date: e.date,
      'Academic Year': e.academicYear || 'N/A'
    }));
    const wsExpenses = XLSX.utils.json_to_sheet(expenseData);
    XLSX.utils.book_append_sheet(wb, wsExpenses, "Expenses");

    // Salary Payments
    const salaryData = salaryPayments.map(p => ({
      ID: p.id,
      'Staff ID': p.staffId,
      Amount: p.amount,
      Date: p.date,
      'Academic Year': p.academicYear || 'N/A'
    }));
    const wsSalary = XLSX.utils.json_to_sheet(salaryData);
    XLSX.utils.book_append_sheet(wb, wsSalary, "Salary Payments");

    XLSX.writeFile(wb, "School_Data_Backup.xlsx");
    showToast();
  };

  const handleExportMonthlyPayrollExcel = (monthIdx: number, yr: number) => {
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
        'N°': i + 1,
        [lang === 'en' ? 'Employee Name' : 'Nom & Prénom']: s.name,
        [lang === 'en' ? 'Position' : 'Poste']: s.position,
        [lang === 'en' ? 'Base Salary (FCFA)' : 'Salaire Base (FCFA)']: s.salary,
        [lang === 'en' ? 'Paid This Month (FCFA)' : 'Versé ce Mois (FCFA)']: totalPaid,
        [lang === 'en' ? 'Remaining Balance (FCFA)' : 'Reliquat Dû (FCFA)']: balance,
        [lang === 'en' ? 'Last Payment Date' : 'Dernière Date']: lastDate,
        [lang === 'en' ? 'Status' : 'Statut']: totalPaid >= s.salary && s.salary > 0 ? (lang === 'en' ? 'Fully Paid' : 'Entièrement payé') : (totalPaid > 0 ? (lang === 'en' ? 'Partial' : 'Acompte') : (lang === 'en' ? 'Unpaid' : 'Non payé')),
        [lang === 'en' ? 'Academic Year' : 'Année Scolaire']: selectedYear || '2026-2027',
      };
    });

    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, `Paie_${monthName}`);
    XLSX.writeFile(wb, `MAMA_THERA_Bordereau_Paie_${monthName}_${yr}.xlsx`);
    showToast();
  };

  const handlePaymentSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (lockedYears.includes(selectedYear)) {
      alert(lang === 'en' ? 'This academic year is locked.' : 'Cette année académique est verrouillée.');
      return;
    }
    if (!paymentStudentId || !paymentAmount) return;

    const amount = parseFloat(paymentAmount);
    const targetStudent = students.find(s => s.id === paymentStudentId);
    const receiptNo = `REC-${Date.now().toString().slice(-6)}`;

    const newPayment = {
      date: paymentDate,
      amount,
      academicYear: targetStudent?.academicYear || selectedYear,
      receiptNumber: receiptNo,
    };

    await addPayment(paymentStudentId, newPayment);

    // Auto-generate printable PDF receipt
    if (targetStudent) {
      try {
        generatePaymentReceiptPdf({
          student: {
            ...targetStudent,
            amountPaid: targetStudent.amountPaid + amount,
          },
          payment: newPayment,
          lang,
          cashierName: currentUser?.name || 'Administration',
        });
      } catch (pdfErr) {
        console.error('PDF receipt generation error:', pdfErr);
      }
    }

    setPaymentStudentId('');
    setPaymentAmount('');
    setShowPaymentForm(false);
  };

  const handleUpdateRole = async (targetProfile: UserProfile, newRole: 'admin' | 'staff' | 'dev') => {
    if (targetProfile.role === newRole) return;
    setUpdatingUserId(targetProfile.id);
    const ok = await auth.updateUserRole(targetProfile.id, newRole);
    if (ok) {
      setUserProfiles(prev => prev.map(p => p.id === targetProfile.id ? { ...p, role: newRole } : p));
      toast.success(
        lang === 'en'
          ? `Role for ${targetProfile.fullName} updated to ${newRole === 'admin' ? 'ADMIN / PROMOTER' : newRole === 'dev' ? 'DEVELOPER' : 'STAFF / ACCOUNTANT'}`
          : `Rôle de ${targetProfile.fullName} mis à jour : ${newRole === 'admin' ? 'PROMOTRICE / ADMIN' : newRole === 'dev' ? 'DÉVELOPPEUR' : 'PERSONNEL / ÉCONOME'}`
      );
    } else {
      toast.error(lang === 'en' ? 'Failed to update role' : 'Échec de la mise à jour du rôle');
    }
    setUpdatingUserId(null);
  };

  const handleToggleRole = async (targetProfile: UserProfile) => {
    const newRole = targetProfile.role === 'admin' ? 'staff' : 'admin';
    await handleUpdateRole(targetProfile, newRole);
  };

  const handleCreateUser = async (e: FormEvent) => {
    e.preventDefault();
    if (!newUserForm.email.trim() || !newUserForm.password || !newUserForm.fullName.trim()) {
      toast.error(lang === 'en' ? 'Please fill in all fields' : 'Veuillez remplir tous les champs');
      return;
    }
    if (newUserForm.password.length < 6) {
      toast.error(lang === 'en' ? 'Password must be at least 6 characters' : 'Le mot de passe doit comporter au moins 6 caractères');
      return;
    }
    setIsCreatingUser(true);
    const res = await auth.createStaffUser(
      newUserForm.email,
      newUserForm.password,
      newUserForm.fullName,
      newUserForm.role
    );
    setIsCreatingUser(false);

    if (res.success) {
      toast.success(
        lang === 'en'
          ? `Account for ${newUserForm.fullName} created successfully!`
          : `Compte pour ${newUserForm.fullName} créé avec succès !`
      );
      setNewUserForm({ fullName: '', email: '', password: '', role: 'staff' });
      setShowAddUserModal(false);
      // Reload profiles
      const profiles = await auth.fetchAllProfiles();
      setUserProfiles(profiles);
    } else {
      toast.error(
        lang === 'en'
          ? `Error creating user: ${res.error}`
          : `Erreur lors de la création du compte : ${res.error}`
      );
    }
  };

  const handleSendPasswordReset = async (email: string) => {
    const res = await auth.sendPasswordReset(email);
    if (res.success) {
      toast.success(
        lang === 'en'
          ? `Password reset email sent to ${email}`
          : `E-mail de réinitialisation envoyé à ${email}`
      );
    } else {
      toast.error(res.error || (lang === 'en' ? 'Failed to send reset email' : 'Échec de l\'envoi de l\'e-mail'));
    }
  };

  const handleStudentSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (lockedYears.includes(selectedYear)) {
      alert(lang === 'en' ? 'This academic year is locked.' : 'Cette année académique est verrouillée.');
      return;
    }
    
    // Validation: Email is optional, but if provided, must be valid
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (studentForm.parentEmail && studentForm.parentEmail.trim() && !emailRegex.test(studentForm.parentEmail.trim())) {
      alert(t.invalidEmail);
      return;
    }

    const amount = parseFloat(studentForm.totalDue);
    if (isNaN(amount) || amount < 0) {
      alert(t.invalidAmount);
      return;
    }

    if (editingStudent) {
      setStudents(prev => prev.map(s => 
        s.id === editingStudent.id 
          ? { 
              ...s, 
              ...studentForm, 
              totalDue: amount, 
              scholarshipDiscount: parseFloat(studentForm.scholarshipDiscount) 
            } 
          : s
      ));
    } else {
      const nextIdNum = students.reduce((max, s) => {
        const num = parseInt(s.id.replace('ST', '')) || 0;
        return num > max ? num : max;
      }, 0) + 1;
      const newStudent: Student = {
        id: `ST${String(nextIdNum).padStart(3, '0')}`,
        ...studentForm,
        studentId: studentForm.studentId || `MT-2026-${String(nextIdNum).padStart(3, '0')}`,
        totalDue: amount,
        scholarshipDiscount: parseFloat(studentForm.scholarshipDiscount),
        amountPaid: 0,
        payments: []
      };
      setStudents(prev => [...prev, newStudent]);
    }

    setShowStudentModal(false);
    setEditingStudent(null);
    setStudentForm({ 
      name: '', 
      parentName: '', 
      parentEmail: '', 
      parentPhone: '', 
      totalDue: '', 
      scholarshipDiscount: '0',
      dueDate: new Date().toISOString().split('T')[0],
      academicYear: selectedYear || '2024-2025',
      grade: '',
      studentId: '',
      photo: '',
      emergencyContactName: '',
      emergencyContactRelation: '',
      emergencyContactPhone: '',
      medicalNotes: 'None',
      enrollmentDate: new Date().toISOString().split('T')[0],
      previousSchool: '',
      status: 'Active'
    });
    showToast();
  };

  const openEditModal = (student: Student) => {
    setEditingStudent(student);
    setStudentForm({
      name: student.name,
      parentName: student.parentName,
      parentEmail: student.parentEmail,
      parentPhone: student.parentPhone,
      totalDue: student.totalDue.toString(),
      scholarshipDiscount: (student.scholarshipDiscount || 0).toString(),
      dueDate: student.dueDate,
      academicYear: student.academicYear || '2024-2025',
      grade: student.grade || '',
      studentId: student.studentId || `MT-2026-${student.id.replace('ST', '')}`,
      photo: student.photo || '',
      emergencyContactName: student.emergencyContactName || '',
      emergencyContactRelation: student.emergencyContactRelation || '',
      emergencyContactPhone: student.emergencyContactPhone || '',
      medicalNotes: student.medicalNotes || 'None',
      enrollmentDate: student.enrollmentDate || new Date().toISOString().split('T')[0],
      previousSchool: student.previousSchool || '',
      status: student.status || 'Active'
    });
    setShowStudentModal(true);
  };

  const handleSaveNote = (studentId: string, note: string) => {
    setStudents(prev => prev.map(s => 
      s.id === studentId 
        ? { ...s, notes: note, lastNoteDate: today } 
        : s
    ));
    if (selectedStudent?.id === studentId) {
      setSelectedStudent({ ...selectedStudent, notes: note, lastNoteDate: today });
    }
    showToast();
  };

  const toggleFlag = (id: string) => {
    setStudents(prev => prev.map(s => s.id === id ? { ...s, flagged: !s.flagged } : s));
  };

  const handleStaffSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (lockedYears.includes(selectedYear)) {
      alert(lang === 'en' ? 'This academic year is locked.' : 'Cette année académique est verrouillée.');
      return;
    }
    const salary = parseFloat(staffForm.salary);
    if (isNaN(salary) || salary < 0) return;

    if (editingStaff) {
      setStaff(prev => prev.map(s => s.id === editingStaff.id ? { ...s, ...staffForm, salary } : s));
    } else {
      const nextIdNum = staff.reduce((max, s) => {
        const num = parseInt(s.id.replace('EMP', '')) || 0;
        return num > max ? num : max;
      }, 0) + 1;
      const newStaff: Staff = {
        id: `EMP${String(nextIdNum).padStart(3, '0')}`,
        ...staffForm,
        salary
      };
      setStaff(prev => [...prev, newStaff]);
    }
    setShowStaffModal(false);
    setEditingStaff(null);
    setStaffForm({ name: '', position: '', salary: '', email: '', phone: '', bankDetails: '', emergencyContact: '' });
    showToast();
  };

  const handleExpenseSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (lockedYears.includes(selectedYear)) {
      alert(lang === 'en' ? 'This academic year is locked.' : 'Cette année académique est verrouillée.');
      return;
    }
    const amount = parseFloat(expenseForm.amount);
    if (isNaN(amount) || amount < 0) return;

    const nextIdNum = expenses.reduce((max, e) => {
      const num = parseInt(e.id.replace('EXP', '')) || 0;
      return num > max ? num : max;
    }, 0) + 1;
    const newExpense: Expense = {
      id: `EXP${String(nextIdNum).padStart(3, '0')}`,
      ...expenseForm,
      amount
    };
    setExpenses(prev => [...prev, newExpense]);
    setShowExpenseModal(false);
    setExpenseForm({ category: 'Other', description: '', amount: '', date: new Date().toISOString().split('T')[0] });
    showToast();
  };

  const handleVendorExpenseSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (lockedYears.includes(selectedYear)) {
      alert(lang === 'en' ? 'This academic year is locked.' : 'Cette année académique est verrouillée.');
      return;
    }
    const amount = parseFloat(vendorExpenseForm.amount);
    const amountPaid = parseFloat(vendorExpenseForm.amountPaid) || 0;
    if (isNaN(amount) || amount < 0) return;

    if (editingVendorExpense) {
      setVendorExpenses(prev => prev.map(v => v.id === editingVendorExpense.id ? {
        ...v,
        vendorName: vendorExpenseForm.vendorName,
        category: vendorExpenseForm.category,
        amount,
        dueDate: vendorExpenseForm.dueDate,
        paymentStatus: vendorExpenseForm.paymentStatus,
        amountPaid: vendorExpenseForm.paymentStatus === 'paid' ? amount : (vendorExpenseForm.paymentStatus === 'unpaid' ? 0 : amountPaid),
        description: vendorExpenseForm.description,
        aidType: vendorExpenseForm.category === 'social_cases' ? vendorExpenseForm.aidType : undefined,
        beneficiaryStudentName: vendorExpenseForm.category === 'social_cases' ? vendorExpenseForm.beneficiaryStudentName : undefined,
        beneficiaryStudentGrade: vendorExpenseForm.category === 'social_cases' ? vendorExpenseForm.beneficiaryStudentGrade : undefined
      } : v));
      setEditingVendorExpense(null);
    } else {
      const nextIdNum = vendorExpenses.reduce((max, v) => {
        const num = parseInt(v.id.replace('VEXP', '')) || 0;
        return num > max ? num : max;
      }, 0) + 1;
      const newVendorExpense: VendorExpense = {
        id: `VEXP${String(nextIdNum).padStart(3, '0')}`,
        vendorName: vendorExpenseForm.vendorName,
        category: vendorExpenseForm.category,
        amount,
        dueDate: vendorExpenseForm.dueDate,
        paymentStatus: vendorExpenseForm.paymentStatus,
        amountPaid: vendorExpenseForm.paymentStatus === 'paid' ? amount : (vendorExpenseForm.paymentStatus === 'unpaid' ? 0 : amountPaid),
        description: vendorExpenseForm.description,
        academicYear: selectedYear,
        aidType: vendorExpenseForm.category === 'social_cases' ? vendorExpenseForm.aidType : undefined,
        beneficiaryStudentName: vendorExpenseForm.category === 'social_cases' ? vendorExpenseForm.beneficiaryStudentName : undefined,
        beneficiaryStudentGrade: vendorExpenseForm.category === 'social_cases' ? vendorExpenseForm.beneficiaryStudentGrade : undefined
      };
      setVendorExpenses(prev => [...prev, newVendorExpense]);
    }

    setShowVendorExpenseModal(false);
    setVendorExpenseForm({
      vendorName: '',
      category: 'stationery',
      amount: '',
      dueDate: new Date().toISOString().split('T')[0],
      paymentStatus: 'unpaid',
      amountPaid: '',
      description: '',
      aidType: '' as any,
      beneficiaryStudentName: '',
      beneficiaryStudentGrade: '',
    });
    showToast();
  };

  const handleEditVendorExpense = (v: VendorExpense) => {
    setEditingVendorExpense(v);
    setVendorExpenseForm({
      vendorName: v.vendorName,
      category: v.category,
      amount: String(v.amount),
      dueDate: v.dueDate,
      paymentStatus: v.paymentStatus,
      amountPaid: String(v.amountPaid),
      description: v.description || '',
      aidType: v.aidType || '' as any,
      beneficiaryStudentName: v.beneficiaryStudentName || '',
      beneficiaryStudentGrade: v.beneficiaryStudentGrade || ''
    });
    setShowVendorExpenseModal(true);
  };

  const handleDeleteVendorExpense = (id: string) => {
    if (lockedYears.includes(selectedYear)) {
      alert(lang === 'en' ? 'This academic year is locked.' : 'Cette année académique est verrouillée.');
      return;
    }
    setVendorExpenses(prev => prev.filter(v => v.id !== id));
    showToast();
  };

  const generateInstallmentMemo = (staffId: string, amount: number) => {
    const s = staff.find(st => st.id === staffId);
    if (!s) return;
    
    const paymentsThisMonth = salaryPayments.filter(p => p.staffId === s.id && new Date(p.date).getMonth() === currentMonth);
    const paidThisMonth = paymentsThisMonth.reduce((sum, p) => sum + p.amount, 0) + amount;
    const balance = s.salary - paidThisMonth;
    
    const memo = lang === 'en' 
      ? `Hello ${s.name}, an installment of ${formatCurrency(amount)} has been paid. Remaining balance: ${formatCurrency(balance)}.`
      : `Bonjour ${s.name}, un acompte de ${formatCurrency(amount)} a été versé. Solde restant : ${formatCurrency(balance)}.`;
    
    copyToClipboard(memo);
    showToast();
  };

  const handleSalarySubmit = (e: FormEvent) => {
    e.preventDefault();
    if (lockedYears.includes(selectedYear)) {
      alert(lang === 'en' ? 'This academic year is locked.' : 'Cette année académique est verrouillée.');
      return;
    }
    const amount = parseFloat(salaryForm.amount);
    if (isNaN(amount) || amount < 0) return;

    const nextIdNum = salaryPayments.reduce((max, p) => {
      const num = parseInt(p.id.replace('PAY', '')) || 0;
      return num > max ? num : max;
    }, 0) + 1;
    const newPayment: SalaryPayment = {
      id: `PAY${String(nextIdNum).padStart(3, '0')}`,
      ...salaryForm,
      amount,
      academicYear: selectedYear || undefined
    };
    setSalaryPayments(prev => [...prev, newPayment]);
    setShowSalaryModal(false);
    setSalaryForm({ staffId: '', amount: '', date: new Date().toISOString().split('T')[0] });
    showToast();
  };

  const handleCloseCurrentYear = () => {
    if (currentUser?.role !== 'admin' && currentUser?.role !== 'dev') {
      alert(lang === 'en' ? 'Only Promoter / Owner can close academic years.' : 'Seul le Promoteur / Propriétaire peut clôturer les années académiques.');
      return;
    }
    if (lockedYears.includes(selectedYear)) {
      alert(lang === 'en' ? 'This academic year is already locked!' : 'Cette année académique est déjà verrouillée !');
      return;
    }

    const parts = selectedYear.split('-');
    let nextYear = '';
    if (parts.length === 2) {
      const y1 = parseInt(parts[0], 10);
      const y2 = parseInt(parts[1], 10);
      if (!isNaN(y1) && !isNaN(y2)) {
        nextYear = `${y1 + 1}-${y2 + 1}`;
      }
    }
    if (!nextYear) {
      nextYear = '2025-2026';
    }

    const currentYearStudents = students.filter(s => s.academicYear === selectedYear || (!s.academicYear && selectedYear === '2024-2025'));
    let updatedStudents = [...students];

    currentYearStudents.forEach(student => {
      const discount = student.scholarshipDiscount || 0;
      const discountedTotal = student.totalDue * (1 - discount / 100);
      const balance = discountedTotal - student.amountPaid;

      if (balance > 0) {
        const existingIdx = updatedStudents.findIndex(s => s.name === student.name && s.academicYear === nextYear);
        if (existingIdx !== -1) {
          const existing = updatedStudents[existingIdx];
          updatedStudents[existingIdx] = {
            ...existing,
            totalDue: existing.totalDue + balance,
            notes: existing.notes 
              ? `${existing.notes}\nCarryover debt from ${selectedYear}: +${balance} CFA`
              : `Carryover debt from ${selectedYear}: +${balance} CFA`
          };
        } else {
          const newId = `ST_CARR_${student.id}_${nextYear.replace('-', '_')}`;
          updatedStudents.push({
            id: newId,
            name: student.name,
            parentName: student.parentName,
            parentEmail: student.parentEmail,
            parentPhone: student.parentPhone,
            totalDue: balance,
            scholarshipDiscount: 0,
            dueDate: student.dueDate,
            amountPaid: 0,
            payments: [],
            notes: `Opening Balance (Debt carried over from ${selectedYear}): ${balance} CFA`,
            academicYear: nextYear,
            grade: student.grade || ''
          });
        }
      }
    });

    setStudents(updatedStudents);
    setLockedYears(prev => [...prev, selectedYear]);

    setAcademicYears(prev => {
      if (!prev.includes(nextYear)) {
        return [...prev, nextYear];
      }
      return prev;
    });

    setAuditYear(selectedYear);
    setShowAuditModal(true);
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

  const handleAddTodo = (e: FormEvent) => {
    e.preventDefault();
    if (!todoInput.trim()) return;
    const newTodo: Todo = {
      id: Date.now().toString(),
      text: todoInput,
      completed: false
    };
    setTodos(prev => [...prev, newTodo]);
    setTodoInput('');
  };

  const handleAiQuery = (queryText: string) => {
    if (!queryText.trim()) return;
    
    const userMsg = { sender: 'user' as const, text: queryText };
    setAiMessages(prev => [...prev, userMsg]);
    setAiInput('');

    const query = queryText.toLowerCase();
    let responseText = '';

    const isFrench = lang === 'fr';

    if (query.includes('balance') || query.includes('solde') || query.includes('caisse') || query.includes('cash') || query.includes('liquidity') || query.includes('liquidit')) {
      const balance = stats.totalFees - stats.totalExpenses;
      const income = stats.collectedMonth;
      const expensesVal = stats.expensesThisMonth;
      const template = isFrench ? translations.fr.aiResponseBalance : translations.en.aiResponseBalance;
      responseText = template
        .replace('{balance}', formatCurrency(balance))
        .replace('{income}', formatCurrency(income))
        .replace('{expenses}', formatCurrency(expensesVal));
    } else if (query.includes('overdue') || query.includes('late') || query.includes('retard') || query.includes('unpaid') || query.includes('debt') || query.includes('impaye') || query.includes('dette') || query.includes('non pay')) {
      const count = stats.lateParentsCount;
      const amount = stats.totalOutstanding;
      const template = isFrench ? translations.fr.aiResponseOverdue : translations.en.aiResponseOverdue;
      responseText = template
        .replace('{count}', count.toString())
        .replace('{amount}', formatCurrency(amount));
    } else if (query.includes('expense') || query.includes('depense') || query.includes('outflow') || query.includes('sorti')) {
      const expensesVal = stats.expensesThisMonth;
      const categories = isFrench 
        ? "papeterie, électricité, eau, cas sociaux et salaires" 
        : "stationery, electricity, water, social cases, and salaries";
      const template = isFrench ? translations.fr.aiResponseExpenses : translations.en.aiResponseExpenses;
      responseText = template
        .replace('{expenses}', formatCurrency(expensesVal))
        .replace('{categories}', categories);
    } else if (query.includes('payroll') || query.includes('salary') || query.includes('salaire') || query.includes('paie') || query.includes('personnel') || query.includes('employee') || query.includes('staff')) {
      const count = staff.length;
      const totalSalaries = staff.reduce((acc, s) => acc + s.salary, 0);
      const unpaidCount = staff.filter(s => {
        const paidThisMonth = salaryPayments
          .filter(p => p.staffId === s.id && new Date(p.date).getMonth() === currentMonth)
          .reduce((sum, p) => sum + p.amount, 0);
        return paidThisMonth < s.salary;
      }).length;
      const template = isFrench ? translations.fr.aiResponsePayroll : translations.en.aiResponsePayroll;
      responseText = template
        .replace('{count}', count.toString())
        .replace('{salary}', formatCurrency(totalSalaries))
        .replace('{unpaidCount}', unpaidCount.toString());
    } else {
      responseText = isFrench ? translations.fr.aiNoData : translations.en.aiNoData;
    }

    setTimeout(() => {
      setAiMessages(prev => [...prev, { sender: 'assistant' as const, text: responseText }]);
    }, 400);
  };

  const handleFloatingAiQuery = (queryText: string) => {
    if (!queryText.trim()) return;

    const userMsg = { sender: 'user' as const, text: queryText };
    setFloatingChatMessages(prev => [...prev, userMsg]);
    setFloatingChatInput('');

    const query = queryText.toLowerCase().trim();
    let responseText = '';
    const isFrench = lang === 'fr';

    // 1. "How much tuition was collected this month?" / "Combien de frais de scolarité ont été collectés ce mois-ci ?"
    const isTuitionQuery = 
      query.includes('tuition') || 
      query.includes('collected') || 
      query.includes('scolarité') || 
      query.includes('scolarite') || 
      query.includes('collecté') || 
      query.includes('collecte');

    // 2. "Which parents still owe school fees?" / "Quels parents doivent encore des frais de scolarité ?"
    const isParentsOweQuery = 
      query.includes('parent') && (query.includes('owe') || query.includes('redevable') || query.includes('doit') || query.includes('doivent') || query.includes('dette') || query.includes('outstanding') || query.includes('impayé') || query.includes('impaye'));

    // 3. "Show all expenses for June." / "Afficher toutes les dépenses pour juin."
    const isExpensesJuneQuery = 
      (query.includes('expense') || query.includes('dépense') || query.includes('depense')) && (query.includes('june') || query.includes('juin') || query.includes('06'));

    // 4. "How much money do we currently have in cash?" / "Combien d'argent avons-nous actuellement en caisse ?"
    const isCashQuery = 
      query.includes('cash') || 
      query.includes('caisse') || 
      query.includes('liquid') || 
      query.includes('argent') || 
      query.includes('money');

    // 5. "Which students haven't paid the second installment?" / "Quels élèves n'ont pas payé la deuxième tranche ?"
    const isSecondInstallmentQuery = 
      query.includes('second') || 
      query.includes('deuxième') || 
      query.includes('deuxieme') || 
      query.includes('installment') || 
      query.includes('tranche') || 
      query.includes('versement');

    // 6. "Generate this month's financial report." / "Générer le rapport financier de ce mois-ci."
    const isReportQuery = 
      query.includes('report') || 
      query.includes('rapport') || 
      query.includes('bilan') || 
      query.includes('generate') || 
      query.includes('générer') || 
      query.includes('generer');

    if (isSecondInstallmentQuery) {
      const partialStudentsList = students.filter(s => {
        const discount = s.scholarshipDiscount || 0;
        const discountedTotal = s.totalDue * (1 - discount / 100);
        return s.amountPaid > 0 && s.amountPaid < discountedTotal;
      });

      if (partialStudentsList.length > 0) {
        if (isFrench) {
          responseText = `Les élèves suivants ont effectué un paiement partiel (premier versement) mais n'ont pas encore réglé leur deuxième versement :\n\n` +
            partialStudentsList.map(s => {
              const discount = s.scholarshipDiscount || 0;
              const discountedTotal = s.totalDue * (1 - discount / 100);
              return `• **${s.name}** (Parent : ${s.parentName}) : Payé ${formatCurrency(s.amountPaid)} sur ${formatCurrency(discountedTotal)} (Reste : ${formatCurrency(discountedTotal - s.amountPaid)})`;
            }).join('\n');
        } else {
          responseText = `The following students have made a partial payment (first installment) but have not yet paid their second installment:\n\n` +
            partialStudentsList.map(s => {
              const discount = s.scholarshipDiscount || 0;
              const discountedTotal = s.totalDue * (1 - discount / 100);
              return `• **${s.name}** (Parent: ${s.parentName}): Paid ${formatCurrency(s.amountPaid)} of ${formatCurrency(discountedTotal)} (Owes: ${formatCurrency(discountedTotal - s.amountPaid)})`;
            }).join('\n');
        }
      } else {
        responseText = isFrench 
          ? "Aucun élève n'est actuellement répertorié avec un statut de paiement partiel (tous sont soit non-payés, soit entièrement payés)."
          : "No students are currently registered with partial payment statuses (all are either unpaid or fully paid).";
      }

    } else if (isParentsOweQuery) {
      const debtors = students.filter(s => {
        const discount = s.scholarshipDiscount || 0;
        const discountedTotal = s.totalDue * (1 - discount / 100);
        return (discountedTotal - s.amountPaid) > 0;
      });

      if (debtors.length > 0) {
        if (isFrench) {
          responseText = `Voici les parents qui doivent encore des frais de scolarité :\n\n` +
            debtors.map(s => {
              const discount = s.scholarshipDiscount || 0;
              const discountedTotal = s.totalDue * (1 - discount / 100);
              const remaining = discountedTotal - s.amountPaid;
              return `• **${s.parentName}** (Élève : ${s.name}) : reste dû **${formatCurrency(remaining)}** (Date limite : ${formatDate(s.dueDate)})`;
            }).join('\n');
        } else {
          responseText = `The following parents still owe school fees:\n\n` +
            debtors.map(s => {
              const discount = s.scholarshipDiscount || 0;
              const discountedTotal = s.totalDue * (1 - discount / 100);
              const remaining = discountedTotal - s.amountPaid;
              return `• **${s.parentName}** (Student: ${s.name}): **${formatCurrency(remaining)}** outstanding (Due date: ${formatDate(s.dueDate)})`;
            }).join('\n');
        }
      } else {
        responseText = isFrench 
          ? "Excellente nouvelle ! Tous les parents sont à jour dans leurs paiements."
          : "Great news! All parents are fully up to date with their school fees.";
      }

    } else if (isExpensesJuneQuery) {
      const juneExpensesList = expenses.filter(e => {
        const d = new Date(e.date);
        return d.getMonth() === 5; // June is 5
      });
      const juneVendorExpensesList = vendorExpenses.filter(v => {
        const d = new Date(v.dueDate);
        return d.getMonth() === 5;
      });

      const totalGeneral = juneExpensesList.reduce((sum, e) => sum + e.amount, 0);
      const totalVendor = juneVendorExpensesList.reduce((sum, v) => sum + v.amount, 0);

      if (juneExpensesList.length > 0 || juneVendorExpensesList.length > 0) {
        if (isFrench) {
          responseText = `Dépenses enregistrées pour le mois de **Juin** :\n\n`;
          if (juneExpensesList.length > 0) {
            responseText += `**Dépenses Générales :**\n` + juneExpensesList.map(e => `• [${formatDate(e.date)}] ${e.category} - ${e.description} : **${formatCurrency(e.amount)}**`).join('\n') + `\n\n`;
          }
          if (juneVendorExpensesList.length > 0) {
            responseText += `**Dépenses Fournisseurs :**\n` + juneVendorExpensesList.map(v => `• [Échéance ${formatDate(v.dueDate)}] ${v.vendorName} (${v.category}) - ${v.description || ''} : **${formatCurrency(v.amount)}** (${v.paymentStatus === 'paid' ? 'Payé' : 'Non Payé'})`).join('\n') + `\n\n`;
          }
          responseText += `**Total Juin :** ${formatCurrency(totalGeneral + totalVendor)}`;
        } else {
          responseText = `Registered expenses for the month of **June**:\n\n`;
          if (juneExpensesList.length > 0) {
            responseText += `**General Expenses:**\n` + juneExpensesList.map(e => `• [${formatDate(e.date)}] ${e.category} - ${e.description}: **${formatCurrency(e.amount)}**`).join('\n') + `\n\n`;
          }
          if (juneVendorExpensesList.length > 0) {
            responseText += `**Vendor Expenses:**\n` + juneVendorExpensesList.map(v => `• [Due ${formatDate(v.dueDate)}] ${v.vendorName} (${v.category}) - ${v.description || ''}: **${formatCurrency(v.amount)}** (${v.paymentStatus})`).join('\n') + `\n\n`;
          }
          responseText += `**Total June Expenses:** ${formatCurrency(totalGeneral + totalVendor)}`;
        }
      } else {
        responseText = isFrench 
          ? "Aucune dépense n'a été enregistrée pour le mois de juin."
          : "No expenses have been recorded for the month of June.";
      }

    } else if (isTuitionQuery) {
      const currentMonth = new Date().getMonth();
      const collectedThisMonth = students.reduce((acc, s) => {
        const thisMonthPayments = s.payments.filter(p => {
          const payDate = new Date(p.date);
          return payDate.getMonth() === currentMonth;
        });
        return acc + thisMonthPayments.reduce((sum, p) => sum + p.amount, 0);
      }, 0);

      responseText = isFrench 
        ? `Le montant total des frais de scolarité collectés ce mois-ci s'élève à **${formatCurrency(collectedThisMonth)}**.`
        : `The total tuition fees collected this month is **${formatCurrency(collectedThisMonth)}**.`;

    } else if (isCashQuery) {
      const cash = stats.totalFees - stats.totalExpenses;
      responseText = isFrench 
        ? `Le solde de caisse disponible en direct est actuellement de **${formatCurrency(cash)}**.`
        : `The live cash balance currently available in our accounts is **${formatCurrency(cash)}**.`;

    } else if (isReportQuery) {
      const cash = stats.totalFees - stats.totalExpenses;
      if (isFrench) {
        responseText = `📊 **RAPPORT SCOLAIRE MENSUEL - COMPLEXE SCOLAIRE MAMA THERA**\n` +
          `--------------------------------------------------\n` +
          `• **Entrées (Frais Collectés ce Mois)** : ${formatCurrency(stats.collectedMonth)}\n` +
          `• **Sorties (Dépenses & Salaires ce Mois)** : ${formatCurrency(stats.expensesThisMonth)}\n` +
          `• **Flux de Trésorerie Net Mensuel** : ${formatCurrency(stats.collectedMonth - stats.expensesThisMonth)}\n` +
          `• **Solde de Caisse Général** : **${formatCurrency(cash)}**\n` +
          `• **Dettes Restantes à Recouvrer** : **${formatCurrency(stats.totalOutstanding)}**\n` +
          `--------------------------------------------------\n` +
          `Rapport généré automatiquement à la demande.`;
      } else {
        responseText = `📊 **MONTHLY SCHOOL FINANCIAL REPORT - MAMA THERA**\n` +
          `--------------------------------------------------\n` +
          `• **Total Inflow (Tuition Collected)**: ${formatCurrency(stats.collectedMonth)}\n` +
          `• **Total Outflow (Expenses & Salaries)**: ${formatCurrency(stats.expensesThisMonth)}\n` +
          `• **Net Monthly Cash Flow**: ${formatCurrency(stats.collectedMonth - stats.expensesThisMonth)}\n` +
          `• **Current Total Cash Balance**: **${formatCurrency(cash)}**\n` +
          `• **Outstanding Debt Receivable**: **${formatCurrency(stats.totalOutstanding)}**\n` +
          `--------------------------------------------------\n` +
          `Report compiled automatically upon query request.`;
      }

    } else {
      if (isFrench) {
        responseText = `Je n'ai pas pu analyser de données financières précises pour votre question : « ${queryText} ».\n\n` +
          `Je suis programmé pour répondre à ces requêtes spécifiques concernant l'administration de l'école :\n` +
          `• « **Combien de scolarités ont été collectées ce mois-ci ?** »\n` +
          `• « **Quels parents doivent encore des frais de scolarité ?** »\n` +
          `• « **Afficher toutes les dépenses pour juin.** »\n` +
          `• « **Combien d'argent avons-nous actuellement en caisse ?** »\n` +
          `• « **Quels élèves n'ont pas payé la deuxième tranche ?** »\n` +
          `• « **Générer le rapport financier de ce mois-ci.** »`;
      } else {
        responseText = `I couldn't find a precise match or analyze financial data for your question: "${queryText}".\n\n` +
          `I am specifically trained to answer the following school finance queries:\n` +
          `• "**How much tuition was collected this month?**"\n` +
          `• "**Which parents still owe school fees?**"\n` +
          `• "**Show all expenses for June.**"\n` +
          `• "**How much money do we currently have in cash?**"\n` +
          `• "**Which students haven't paid the second installment?**"\n` +
          `• "**Generate this month's financial report.**"`;
      }
    }

    setTimeout(() => {
      setFloatingChatMessages(prev => [...prev, { sender: 'assistant' as const, text: responseText }]);
    }, 450);
  };

  const toggleTodo = (id: string) => {
    setTodos(prev => prev.map(todo => {
      if (todo.id === id) {
        const newCompleted = !todo.completed;
        
        // Automation: if "Call Parent" is checked
        if (newCompleted && (todo.text.toLowerCase().includes('call parent') || todo.text.toLowerCase().includes('appeler parent'))) {
          // If we have a studentId linked to the todo
          if (todo.studentId) {
            handleSaveNote(todo.studentId, t.followUpCompleted);
          }
        }
        
        return { ...todo, completed: newCompleted };
      }
      return todo;
    }));
  };

  const deleteTodo = (id: string) => {
    setTodos(prev => prev.filter(t => t.id !== id));
  };

  const handleLogoUpload = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const base64 = event.target?.result as string;
      setSchoolLogo(base64);
      try {
        localStorage.setItem('school-finance-logo', base64);
      } catch (err) {
        console.warn('Failed to save logo to localStorage:', err);
      }

      // Extract color
      const img = new Image();
      img.src = base64;
      img.onload = () => {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        canvas.width = img.width;
        canvas.height = img.height;
        ctx.drawImage(img, 0, 0);
        const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
        
        let r = 0, g = 0, b = 0;
        let count = 0;
        // Sample pixels
        for (let i = 0; i < data.length; i += 40) {
          r += data[i];
          g += data[i + 1];
          b += data[i + 2];
          count++;
        }
        r = Math.floor(r / count);
        g = Math.floor(g / count);
        b = Math.floor(b / count);
        setLogoColor(`rgb(${r}, ${g}, ${b})`);
      };
    };
    reader.readAsDataURL(file);
  };

  const showToast = () => {
    setShowSuccessToast(true);
    setTimeout(() => setShowSuccessToast(false), 3000);
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const formatCurrency = (amount: any) => {
    const val = Number(amount);
    if (isNaN(val)) return '0 XOF';
    return val.toLocaleString('fr-FR').replace(/\u00a0/g, ' ') + ' XOF';
  };

  const formatDate = (dateStr: string) => {
    if (!dateStr) return '';
    const date = new Date(dateStr);
    if (isNaN(date.getTime())) return dateStr;
    return date.toLocaleDateString(lang === 'en' ? 'en-US' : 'fr-FR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric'
    });
  };

  const getGradeDisplay = (grade: string | undefined, currentLang: 'en' | 'fr' = lang) => {
    if (!grade) return 'N/A';
    const trimmed = grade.trim();
    
    // Check if found in availableClasses
    const found = availableClasses.find(c => c.id.toLowerCase() === trimmed.toLowerCase());
    if (found) {
      return currentLang === 'en' ? found.nameEn : found.nameFr;
    }
    
    // Pattern match standard codes like 1A, 1B, 1C, 2D, 7C, etc.
    const match = trimmed.match(/^(\d+)\s*([A-Za-z]+)?$/);
    if (match) {
      const yearNum = parseInt(match[1]);
      const section = (match[2] || '').toUpperCase();
      const yearLabel = currentLang === 'en'
        ? (yearNum === 1 ? '1st Year' : yearNum === 2 ? '2nd Year' : yearNum === 3 ? '3rd Year' : `${yearNum}th Year`)
        : (yearNum === 1 ? '1ère Année' : `${yearNum}ème Année`);
      return section ? `${yearLabel} ${section} (${trimmed.toUpperCase()})` : `${yearLabel} (${trimmed.toUpperCase()})`;
    }
    
    return grade;
  };

  const handleCreateClassSubmit = (e?: FormEvent) => {
    if (e) e.preventDefault();
    
    let code = '';
    let nameFr = '';
    let nameEn = '';
    
    if (newClassForm.cycle === 'other' && newClassForm.customName.trim()) {
      code = newClassForm.customName.trim();
      nameFr = newClassForm.customName.trim();
      nameEn = newClassForm.customName.trim();
    } else {
      const yearStr = newClassForm.year;
      const yearNum = parseInt(yearStr);
      const section = newClassForm.section.trim().toUpperCase() || 'A';
      code = `${yearStr}${section}`;
      
      let yearFr = '';
      let yearEn = '';
      if (!isNaN(yearNum)) {
        yearFr = yearNum === 1 ? '1ère Année' : `${yearNum}ème Année`;
        yearEn = yearNum === 1 ? '1st Year' : yearNum === 2 ? '2nd Year' : yearNum === 3 ? '3rd Year' : `${yearNum}th Year`;
      } else {
        yearFr = yearStr;
        yearEn = yearStr;
      }
      
      nameFr = `${yearFr} ${section} (${code})`;
      nameEn = `${yearEn} ${section} (${code})`;
    }
    
    // Check if class code already exists
    if (availableClasses.some(c => c.id.toLowerCase() === code.toLowerCase())) {
      toast.warning(lang === 'en' ? `Class "${code}" already exists.` : `La classe "${code}" existe déjà.`);
      setStudentForm(prev => ({ ...prev, grade: code }));
      setShowAddClassModal(false);
      return;
    }
    
    const newClass: SchoolClass = {
      id: code,
      cycle: newClassForm.cycle,
      year: newClassForm.year,
      section: newClassForm.section.toUpperCase(),
      nameFr,
      nameEn,
      isCustom: true
    };
    
    const updated = [...availableClasses, newClass];
    setAvailableClasses(updated);
    try {
      localStorage.setItem('mama_thera_classes', JSON.stringify(updated));
    } catch (err) {
      console.warn('Failed to save classes to localStorage:', err);
    }
    
    // Auto-select in student form
    setStudentForm(prev => ({ ...prev, grade: code }));
    
    toast.success(
      lang === 'en' 
        ? `Class "${code}" added successfully!` 
        : `Classe "${code}" ajoutée avec succès !`
    );
    
    setShowAddClassModal(false);
    setNewClassForm({
      cycle: 'cycle1',
      year: '1',
      section: 'D',
      customName: ''
    });
  };

  const getStatus = (student: Student) => {
    const balance = student.totalDue - student.amountPaid;
    const due = new Date(student.dueDate);
    const now = new Date(today);
    const diffTime = due.getTime() - now.getTime();
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

    if (balance <= 0) {
      return { 
        label: t.settle, 
        color: 'text-emerald-600 bg-emerald-50 border-emerald-100', 
        icon: <CheckCircle2 size={14} />,
        standing: t.goodStanding
      };
    }

    if (diffDays < 0) {
      const daysLate = Math.abs(diffDays);
      return { 
        label: `${daysLate} ${t.daysOverdue}`, 
        color: 'text-rose-600 bg-rose-50 border-rose-100 animate-badge-pulse', 
        icon: <Clock size={14} />,
        standing: t.overdue
      };
    }

    if (diffDays <= 3) {
      return { 
        label: t.dueSoon, 
        color: 'text-amber-600 bg-amber-50 border-amber-100', 
        icon: <AlertCircle size={14} />,
        standing: t.partial
      };
    }

    return { 
      label: t.partial, 
      color: 'text-blue-600 bg-blue-50 border-blue-100', 
      icon: <Calendar size={14} />,
      standing: t.partial
    };
  };

  const getDaysInMonth = (date: Date) => {
    const year = date.getFullYear();
    const month = date.getMonth();
    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);
    const days = [];
    
    // Previous month padding
    const firstDayOfWeek = firstDay.getDay(); // 0 (Sun) to 6 (Sat)
    const prevMonthLastDay = new Date(year, month, 0).getDate();
    const padding = firstDayOfWeek === 0 ? 6 : firstDayOfWeek - 1; // Adjust for Mon-Sun
    
    for (let i = padding - 1; i >= 0; i--) {
      days.push({
        date: new Date(year, month - 1, prevMonthLastDay - i),
        isCurrentMonth: false
      });
    }
    
    // Current month days
    for (let i = 1; i <= lastDay.getDate(); i++) {
      days.push({
        date: new Date(year, month, i),
        isCurrentMonth: true
      });
    }
    
    // Next month padding
    const remaining = 42 - days.length;
    for (let i = 1; i <= remaining; i++) {
      days.push({
        date: new Date(year, month + 1, i),
        isCurrentMonth: false
      });
    }
    
    return days;
  };

  const getEventsForDay = (date: Date) => {
    const dateStr = date.toISOString().split('T')[0];
    const dayEvents = [];
    
    // Student Due Dates
    const dueStudents = students.filter(s => s.dueDate === dateStr);
    if (dueStudents.length > 0) {
      dayEvents.push({ 
        type: 'due', 
        count: dueStudents.length, 
        label: `${dueStudents.length} ${t.navStudents} ${t.totalOutstanding}`,
        details: dueStudents.map(s => ({ name: s.name, amount: s.totalDue - s.amountPaid }))
      });
    }
    
    // Salary Dates (Assuming 25th of each month if not specified, or use a fixed date for demo)
    // For this app, let's say staff are paid on the 25th
    if (date.getDate() === 25) {
      dayEvents.push({ 
        type: 'salary', 
        count: staff.length, 
        label: `${staff.length} ${t.navPayroll}`,
        details: staff.map(s => ({ name: s.name, amount: s.salary }))
      });
    }
    
    // Expenses
    const dayExpenses = expenses.filter(e => e.date === dateStr);
    if (dayExpenses.length > 0) {
      dayEvents.push({ 
        type: 'expense', 
        count: dayExpenses.length, 
        label: `${dayExpenses.length} ${t.navExpenses}`,
        details: dayExpenses.map(e => ({ name: e.description || e.category, amount: e.amount }))
      });
    }
    
    return dayEvents;
  };

  const changeMonth = (offset: number) => {
    const newDate = new Date(calendarDate);
    newDate.setMonth(newDate.getMonth() + offset);
    setCalendarDate(newDate);
  };

  const handlePrint = () => {
    window.print();
  };

  const getMonthName = (monthIndex: number) => {
    const months = [t.jan, t.feb, t.mar, t.apr, t.may, t.jun, t.jul, t.aug, t.sep, t.oct, t.nov, t.dec];
    return months[monthIndex];
  };

  const getDayName = (dayIndex: number) => {
    const days = [t.mon, t.tue, t.wed, t.thu, t.fri, t.sat, t.sun];
    return days[dayIndex];
  };

  return (
    <>
      {authLoading ? (
        <div className="min-h-screen flex items-center justify-center" style={{ background: 'linear-gradient(135deg, #0C1222 0%, #111827 50%, #0F172A 100%)' }}>
          <div className="text-center">
            <div className="relative w-14 h-14 mx-auto mb-8">
              <div className="absolute inset-0 rounded-full border-2 border-white/[0.06]"></div>
              <div className="absolute inset-0 rounded-full border-2 border-emerald-500 border-t-transparent animate-spin"></div>
              <div className="absolute inset-2 rounded-full bg-emerald-500/10 flex items-center justify-center">
                <ShieldCheck size={18} className="text-emerald-400" />
              </div>
            </div>
            <h2 className="text-xl font-semibold text-white tracking-tight mb-2">{lang === 'en' ? 'Restoring Session' : 'Restauration de la session'}</h2>
            <p className="text-slate-500 text-sm font-medium">{lang === 'en' ? 'Checking authentication...' : 'Vérification de l\'authentification...'}</p>
          </div>
        </div>
      ) : !currentUser ? (
        <Login onLogin={auth.signIn} lang={lang} setLang={toggleLanguage} t={t} />
      ) : supabaseLoading ? (
        <div className="min-h-screen flex items-center justify-center" style={{ background: 'linear-gradient(135deg, #0C1222 0%, #111827 50%, #0F172A 100%)' }}>
          <div className="text-center">
            <div className="relative w-14 h-14 mx-auto mb-8">
              <div className="absolute inset-0 rounded-full border-2 border-white/[0.06]"></div>
              <div className="absolute inset-0 rounded-full border-2 border-emerald-500 border-t-transparent animate-spin"></div>
              <div className="absolute inset-2 rounded-full bg-emerald-500/10 flex items-center justify-center">
                <ShieldCheck size={18} className="text-emerald-400" />
              </div>
            </div>
            <h2 className="text-xl font-semibold text-white tracking-tight mb-2">{lang === 'en' ? 'Loading Finance Suite' : 'Chargement du Système'}</h2>
            <p className="text-slate-500 text-sm font-medium">{lang === 'en' ? 'Connecting to database' : 'Connexion à la base de données'}</p>
          </div>
        </div>
      ) : (
        <div className={`min-h-screen ${currentTheme.bg} flex font-sans ${currentTheme.text} transition-colors duration-300 theme-${theme} ${ticketStudent ? 'no-print-ticket' : ''}`}>
          {/* Environment Badge (dev/staging only) */}
          <EnvBadge env={appEnv} />
          {/* Offline Banner */}
          <OfflineBanner lang={lang} />
          {/* Toast Notifications */}
          <ToastContainer toasts={toast.toasts} onDismiss={toast.removeToast} />
          {supabaseError && (
            <div className="fixed top-0 left-0 right-0 z-50 bg-red-600 text-white text-center py-2 text-xs font-semibold flex items-center justify-center gap-3">
              <span>⚠️ {lang === 'en' ? 'Database connection issue' : 'Problème de connexion à la base'}: {supabaseError}</span>
              <button
                onClick={() => fetchAll()}
                className="px-3 py-1 bg-white/20 hover:bg-white/30 rounded-lg font-bold text-[10px] uppercase tracking-wider transition-colors"
              >
                {lang === 'en' ? 'Retry' : 'Réessayer'}
              </button>
            </div>
          )}
          
          {/* Print Header */}
      <div className="hidden print:block print-header">
        <div className="flex justify-between items-center">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">{t.title}</h1>
            <p className="text-sm text-slate-500">{t.subtitle}</p>
          </div>
          <div className="text-right">
            <h2 className="text-xl font-bold text-slate-900">{t.monthlyReport}</h2>
            <p className="text-sm text-slate-500">{formatDate(new Date().toISOString())}</p>
          </div>
        </div>
      </div>
      
      {/* --- Sidebar --- */}
      <aside className={`w-64 text-white fixed h-full z-40 hidden lg:flex flex-col transition-colors duration-300`} style={{ background: 'linear-gradient(180deg, #0C1222 0%, #111827 50%, #0F172A 100%)' }}>
        <div className="p-6 pb-4" style={{ backgroundColor: 'transparent' }}>
          <div className="flex items-center gap-3 mb-1">
            {schoolLogo ? (
              <img src={schoolLogo} alt="Logo" className="w-9 h-9 rounded-lg object-cover ring-2 ring-white/10" referrerPolicy="no-referrer" />
            ) : (
              <div className="bg-emerald-600/90 p-2 rounded-lg shadow-lg shadow-emerald-500/20">
                <ShieldCheck size={22} />
              </div>
            )}
            <div>
              <h1 className="font-bold text-base leading-tight tracking-tight" style={{ color: '#FFFFFF' }}>{t.title}</h1>
              <p className="text-[9px] uppercase tracking-[0.12em] font-semibold mt-0.5" style={{ color: 'rgba(255, 255, 255, 0.65)' }}>{t.subtitle}</p>
            </div>
          </div>
        </div>

        <div className="mx-4 mb-3 border-t border-white/[0.06]"></div>

        <nav className="flex-1 px-3 space-y-0.5 mt-1 custom-scrollbar overflow-y-auto">
          <button 
            onClick={() => setActiveTab('dashboard')}
            className={`nav-item w-full flex items-center gap-3 px-4 py-2.5 rounded-lg transition-all ${activeTab === 'dashboard' ? 'nav-item-active bg-white/[0.08] text-white shadow-sm' : 'text-white/50 hover:text-white/80 hover:bg-white/[0.04]'}`}
          >
            <LayoutDashboard size={20} />
            <span className="font-semibold text-sm" data-i18n="navDashboard">{t.navDashboard}</span>
          </button>
          
          <button 
            onClick={() => setActiveTab('students')}
            className={`nav-item w-full flex items-center gap-3 px-4 py-2.5 rounded-lg transition-all ${activeTab === 'students' ? 'nav-item-active bg-white/[0.08] text-white shadow-sm' : 'text-white/50 hover:text-white/80 hover:bg-white/[0.04]'}`}
          >
            <Users size={20} />
            <span className="font-semibold text-sm" data-i18n="navStudents">{t.navStudents}</span>
          </button>

          <button 
            onClick={() => setActiveTab('parents')}
            className={`nav-item w-full flex items-center gap-3 px-4 py-2.5 rounded-lg transition-all ${activeTab === 'parents' ? 'nav-item-active bg-white/[0.08] text-white shadow-sm' : 'text-white/50 hover:text-white/80 hover:bg-white/[0.04]'}`}
          >
            <MessageSquare size={20} />
            <span className="font-semibold text-sm" data-i18n="navParents">{t.navParents}</span>
          </button>

          <button 
            onClick={() => setActiveTab('payroll')}
            className={`nav-item w-full flex items-center gap-3 px-4 py-2.5 rounded-lg transition-all ${activeTab === 'payroll' ? 'nav-item-active bg-white/[0.08] text-white shadow-sm' : 'text-white/50 hover:text-white/80 hover:bg-white/[0.04]'}`}
          >
            <div className="flex items-center justify-between w-full gap-2">
              <div className="flex items-center gap-3 min-w-0">
                <Briefcase size={20} className="flex-shrink-0" />
                <span className="font-semibold text-sm truncate" data-i18n="payroll">{t.payroll}</span>
              </div>
              {payrollWindowStatus.isOverdue ? (
                <span className="bg-rose-700 text-white text-[8px] font-black px-1.5 py-0.5 rounded uppercase tracking-wider whitespace-nowrap shadow-sm animate-badge-pulse flex-shrink-0" data-i18n="overdue">
                  {lang === 'en' ? 'Overdue' : 'En retard'}
                </span>
              ) : payrollWindowStatus.isOpen ? (
                <span className="bg-blue-600 text-white text-[8px] font-black px-1.5 py-0.5 rounded uppercase tracking-wider whitespace-nowrap shadow-sm flex-shrink-0">
                  {lang === 'en' ? 'Open' : 'Ouverte'}
                </span>
              ) : (
                <Lock size={14} className="text-white/40 flex-shrink-0" />
              )}
            </div>
          </button>

          <button 
            onClick={() => setActiveTab('expenses')}
            className={`nav-item w-full flex items-center gap-3 px-4 py-2.5 rounded-lg transition-all ${activeTab === 'expenses' ? 'nav-item-active bg-white/[0.08] text-white shadow-sm' : 'text-white/50 hover:text-white/80 hover:bg-white/[0.04]'}`}
          >
            <Receipt size={20} />
            <span className="font-semibold text-sm" data-i18n="expenses">{t.expenses}</span>
          </button>

          <button 
            onClick={() => setActiveTab('calendar')}
            className={`nav-item w-full flex items-center gap-3 px-4 py-2.5 rounded-lg transition-all ${activeTab === 'calendar' ? 'nav-item-active bg-white/[0.08] text-white shadow-sm' : 'text-white/50 hover:text-white/80 hover:bg-white/[0.04]'}`}
          >
            <Calendar size={20} />
            <span className="font-semibold text-sm" data-i18n="navCalendar">{t.navCalendar}</span>
          </button>

          <button 
            onClick={() => setActiveTab('notes')}
            className={`nav-item w-full flex items-center gap-3 px-4 py-2.5 rounded-lg transition-all ${activeTab === 'notes' ? 'nav-item-active bg-white/[0.08] text-white shadow-sm' : 'text-white/50 hover:text-white/80 hover:bg-white/[0.04]'}`}
          >
            <StickyNote size={20} />
            <span className="font-semibold text-sm" data-i18n="notes">{t.notes}</span>
          </button>

          <button 
            onClick={() => setActiveTab('archives')}
            className={`nav-item w-full flex items-center gap-3 px-4 py-2.5 rounded-lg transition-all ${activeTab === 'archives' ? 'nav-item-active bg-white/[0.08] text-white shadow-sm' : 'text-white/50 hover:text-white/80 hover:bg-white/[0.04]'}`}
          >
            <TrendingUp size={20} />
            <span className="font-semibold text-sm" data-i18n="navArchives">{t.navArchives}</span>
          </button>

          {(currentUser?.role === 'admin' || currentUser?.role === 'dev') && (
            <>
              <button 
                onClick={() => {
                  setActiveTab('audit');
                  fetchAuditLogs();
                }}
                className={`nav-item w-full flex items-center gap-3 px-4 py-2.5 rounded-lg transition-all ${activeTab === 'audit' ? 'nav-item-active bg-white/[0.08] text-white shadow-sm' : 'text-white/50 hover:text-white/80 hover:bg-white/[0.04]'}`}
              >
                <ShieldCheck size={20} />
                <span className="font-semibold text-sm">{lang === 'en' ? 'Audit Trail' : 'Journal d\'Audit'}</span>
              </button>

              <button 
                onClick={() => setActiveTab('settings')}
                className={`nav-item w-full flex items-center gap-3 px-4 py-2.5 rounded-lg transition-all ${activeTab === 'settings' ? 'nav-item-active bg-white/[0.08] text-white shadow-sm' : 'text-white/50 hover:text-white/80 hover:bg-white/[0.04]'}`}
              >
                <Globe size={20} />
                <span className="font-semibold text-sm" data-i18n="navSettings">{t.navSettings}</span>
              </button>
            </>
          )}

          <button 
            onClick={() => setShowTodoSidebar(!showTodoSidebar)}
            className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all ${showTodoSidebar ? 'bg-amber-500 text-white shadow-lg shadow-amber-500/20' : 'text-white/40 hover:text-white hover:bg-white/5'}`}
          >
            <CheckSquare size={20} />
            <span className="font-semibold text-sm" data-i18n="productivity">{t.productivity}</span>
          </button>
          
          <div className="pt-4 pb-2 px-4">
            <p className="text-[10px] font-black text-white/20 uppercase tracking-widest" data-i18n="actions">{t.actions}</p>
          </div>

          <button 
            onClick={() => auth.signOut()}
            className="w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all text-rose-400 hover:text-rose-300 hover:bg-rose-500/10 mt-auto"
          >
            <LogOut size={20} />
            <span className="font-semibold text-sm" data-i18n="signOut">{t.signOut}</span>
          </button>

          <div className="space-y-2 pt-2">
            <button 
              onClick={() => {
                setEditingStudent(null);
                setStudentForm({ name: '', parentName: '', parentEmail: '', parentPhone: '', totalDue: '', dueDate: new Date().toISOString().split('T')[0] });
                setShowStudentModal(true);
              }}
              className="w-full flex items-center gap-3 px-4 py-3 rounded-xl bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-300 border border-emerald-500/30 transition-all font-bold text-xs"
            >
              <Plus size={18} className="text-emerald-400" />
              <span>{t.addStudent}</span>
            </button>

            <button 
              onClick={() => setShowPaymentForm(true)}
              className="w-full flex items-center gap-3 px-4 py-3 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white shadow-lg shadow-emerald-600/20 transition-all font-bold text-xs"
            >
              <DollarSign size={18} />
              <span>{t.recordPayment}</span>
            </button>
          </div>
        </nav>

        <div className="p-6 border-t border-white/5">
          <button 
            onClick={() => toggleLanguage(lang === 'en' ? 'fr' : 'en')}
            className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-xl border border-white/10 hover:bg-white/5 transition-all text-sm font-bold"
          >
            <Globe size={18} />
            {t.langToggle}
          </button>
        </div>
      </aside>

      {/* --- Main Content --- */}
      <main className={`flex-1 lg:ml-64 p-8 lg:p-12 transition-all duration-300 ${showTodoSidebar ? 'lg:mr-80' : ''}`}>
        
        {/* --- Notifications Panel --- */}
        <AnimatePresence>
          {notifications.length > 0 && (
            <motion.div 
              initial={{ opacity: 0, y: -20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="mb-8 flex gap-4 overflow-x-auto pb-2 custom-scrollbar"
            >
              {notifications.map(n => (
                <div 
                  key={n.id}
                  onClick={() => {
                    const student = students.find(s => s.id === n.studentId);
                    if (student) setSelectedStudent(student);
                  }}
                  className={`flex-shrink-0 flex items-center gap-3 px-6 py-4 rounded-2xl border cursor-pointer transition-all hover:scale-[1.02] ${n.type === 'due' ? 'bg-amber-50 border-amber-100 text-amber-700' : 'bg-rose-50 border-rose-100 text-rose-700 animate-subtle-pulse'}`}
                >
                  <Bell size={18} className={n.type === 'due' ? 'text-amber-500' : 'text-rose-500'} />
                  <span className="text-xs font-bold whitespace-nowrap">{n.message}</span>
                </div>
              ))}
            </motion.div>
          )}
        </AnimatePresence>

        {/* --- Header --- */}
        <header className="flex flex-col md:flex-row justify-between items-start md:items-center gap-6 mb-12">
          <div>
            <h2 className={`text-3xl font-bold ${currentTheme.isDark ? 'text-emerald-400' : 'text-slate-800'} tracking-tight`}>
              {activeTab === 'dashboard' ? t.dashboard : 
               activeTab === 'students' ? t.students :
               activeTab === 'parents' ? t.parents :
               activeTab === 'payroll' ? t.payroll :
               activeTab === 'expenses' ? t.expenses : 
               activeTab === 'calendar' ? t.calendar : 
               activeTab === 'archives' ? t.yearlyArchives : 
               activeTab === 'audit' ? (lang === 'en' ? 'Audit Trail' : 'Journal d\'Audit') : t.settings}
            </h2>
            <p className={`${currentTheme.muted} text-sm mt-1 flex items-center gap-2`}>
              <Calendar size={14} />
              {new Date().toLocaleDateString(lang === 'en' ? 'en-US' : 'fr-FR', { month: 'long', day: 'numeric', year: 'numeric' })}
            </p>
          </div>

          <div className="flex items-center gap-4 w-full md:w-auto no-print">
            <div className="relative">
              <select 
                value={selectedYear}
                onChange={(e) => setSelectedYear(e.target.value)}
                className={`pl-10 pr-4 py-3 ${currentTheme.card} ${currentTheme.border} border rounded-2xl shadow-sm focus:outline-none focus:ring-4 focus:ring-${currentTheme.accent}/5 focus:border-${currentTheme.accent} transition-all text-sm font-bold ${currentTheme.text} appearance-none cursor-pointer`}
              >
                <option value="">{t.allYears}</option>
                {academicYears.map(year => (
                  <option key={year} value={year}>{year}</option>
                ))}
              </select>
              <Calendar className={`absolute left-4 top-1/2 -translate-y-1/2 ${currentTheme.muted}`} size={16} />
            </div>

            {activeTab === 'students' && (
              <button 
                onClick={() => setIsPromotionWizardOpen(true)}
                className="px-4 py-3 bg-emerald-700 hover:bg-emerald-800 text-white font-bold text-xs rounded-2xl shadow-lg shadow-emerald-700/20 transition-all flex items-center gap-2"
              >
                <GraduationCap size={18} />
                <span className="hidden sm:inline uppercase tracking-widest">{lang === 'en' ? 'Promote Class' : 'Passage de Classe'}</span>
              </button>
            )}

            {/* Import Excel Button — visible on data tabs */}
            {(activeTab === 'students' || activeTab === 'parents' || activeTab === 'payroll' || activeTab === 'expenses') && (currentUser?.role === 'admin' || currentUser?.role === 'dev') && (
              <button 
                onClick={() => setShowExcelImport(true)}
                className="px-4 py-3 bg-violet-600 hover:bg-violet-700 text-white font-bold text-xs rounded-2xl shadow-lg shadow-violet-600/20 transition-all flex items-center gap-2 active:scale-[0.97]"
              >
                <FileSpreadsheet size={18} />
                <span className="hidden sm:inline uppercase tracking-widest">{lang === 'en' ? 'Import Excel' : 'Importer Excel'}</span>
              </button>
            )}

            {activeTab === 'payroll' && (
              <button 
                onClick={() => {
                  setSelectedDraftMonth(new Date().getMonth());
                  setSelectedDraftYear(new Date().getFullYear());
                  setShowMonthlyDraftModal(true);
                }}
                className="px-4 py-3 bg-emerald-700 hover:bg-emerald-800 text-white font-bold text-xs rounded-2xl shadow-lg shadow-emerald-700/20 transition-all flex items-center gap-2 active:scale-[0.97]"
                title={lang === 'en' ? 'Monthly Payroll Draft' : 'Bordereau Mensuel de Paie'}
              >
                <FileText size={18} />
                <span className="hidden sm:inline uppercase tracking-widest">{lang === 'en' ? 'Monthly Draft' : 'Bordereau Mensuel'}</span>
              </button>
            )}

            {(activeTab === 'students' || activeTab === 'payroll' || activeTab === 'archives' || activeTab === 'expenses') && (
              <button 
                onClick={() => {
                  if (activeTab === 'archives') {
                    generateMultiYearReportPdf({
                      academicYears,
                      lockedYears,
                      students,
                      expenses,
                      vendorExpenses,
                      salaryPayments,
                      lang,
                    });
                  } else if (activeTab === 'expenses') {
                    generateExpensesReportPdf({
                      expenses,
                      vendorExpenses,
                      selectedYear,
                      subTab: vendorExpensesTab,
                      lang,
                    });
                  } else {
                    handlePrint();
                  }
                }}
                className={`p-3 rounded-2xl ${currentTheme.isDark ? 'bg-emerald-900/20 text-emerald-500' : 'bg-slate-100 text-slate-600'} hover:bg-emerald-600 hover:text-white transition-all shadow-sm flex items-center gap-2`}
                title={activeTab === 'archives' ? (lang === 'en' ? 'Download Multi-Year PDF' : 'Télécharger Bilan PDF') : activeTab === 'expenses' ? (lang === 'en' ? 'Download Expenses PDF' : 'Télécharger Rapport Dépenses PDF') : t.printReport}
              >
                {(activeTab === 'archives' || activeTab === 'expenses') ? <FileText size={20} /> : <Printer size={20} />}
                <span className="hidden sm:inline font-bold text-xs uppercase tracking-widest">
                  {activeTab === 'archives' ? (lang === 'en' ? 'Multi-Year PDF' : 'Bilan PDF') : activeTab === 'expenses' ? (lang === 'en' ? 'Expenses PDF' : 'Rapport PDF') : t.printReport}
                </span>
              </button>
            )}
            {(activeTab === 'students' || activeTab === 'parents') && (
              <div className="relative flex-1 md:w-80">
                <Search className={`absolute left-4 top-1/2 -translate-y-1/2 ${currentTheme.muted}`} size={18} />
                <input 
                  type="text" 
                  placeholder={t.searchPlaceholder}
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className={`w-full pl-12 pr-4 py-3 ${currentTheme.card} ${currentTheme.border} border rounded-2xl shadow-sm focus:outline-none focus:ring-4 focus:ring-${currentTheme.accent}/5 focus:border-${currentTheme.accent} transition-all text-sm ${currentTheme.text}`}
                />
              </div>
            )}
            {activeTab === 'students' && (
              <div className="relative min-w-[170px]">
                <select
                  value={studentGradeFilter}
                  onChange={(e) => setStudentGradeFilter(e.target.value)}
                  className={`w-full pl-10 pr-4 py-3 ${currentTheme.card} ${currentTheme.border} border rounded-2xl shadow-sm focus:outline-none focus:ring-4 focus:ring-blue-500/5 focus:border-blue-500 transition-all text-xs font-bold ${currentTheme.text} appearance-none cursor-pointer`}
                >
                  <option value="all">{lang === 'en' ? 'All Classes' : 'Toutes les classes'}</option>
                  <optgroup label={lang === 'en' ? "First Cycle (1st to 6th)" : "Premier Cycle (1ère à 6ème)"}>
                    {availableClasses.filter(c => c.cycle === 'cycle1').map(c => (
                      <option key={c.id} value={c.id}>{lang === 'en' ? c.nameEn : c.nameFr}</option>
                    ))}
                  </optgroup>
                  <optgroup label={lang === 'en' ? "Second Cycle (7th to 9th)" : "Second Cycle (7ème à 9ème)"}>
                    {availableClasses.filter(c => c.cycle === 'cycle2').map(c => (
                      <option key={c.id} value={c.id}>{lang === 'en' ? c.nameEn : c.nameFr}</option>
                    ))}
                  </optgroup>
                  {availableClasses.some(c => c.cycle !== 'cycle1' && c.cycle !== 'cycle2') && (
                    <optgroup label={lang === 'en' ? "Other Classes" : "Autres Classes"}>
                      {availableClasses.filter(c => c.cycle !== 'cycle1' && c.cycle !== 'cycle2').map(c => (
                        <option key={c.id} value={c.id}>{lang === 'en' ? c.nameEn : c.nameFr}</option>
                      ))}
                    </optgroup>
                  )}
                </select>
                <Layers className={`absolute left-3.5 top-1/2 -translate-y-1/2 ${currentTheme.muted}`} size={16} />
              </div>
            )}
            {activeTab === 'dashboard' && (
              <div className="flex items-center gap-3">
                <button 
                  onClick={() => generateFinancialReportPdf({
                    students,
                    expenses,
                    vendorExpenses,
                    salaryPayments,
                    selectedYear,
                    lang
                  })}
                  className="bg-emerald-600 hover:bg-emerald-700 text-white px-5 py-3 rounded-2xl text-sm font-bold transition-all flex items-center gap-2 shadow-lg shadow-emerald-500/20 active:scale-[0.98]"
                  title={lang === 'en' ? 'Export Financial Report PDF' : 'Exporter Rapport Financier PDF'}
                >
                  <FileText size={18} />
                  <span className="hidden sm:inline">{lang === 'en' ? 'Financial Report PDF' : 'Rapport Financier PDF'}</span>
                </button>
                <button 
                  onClick={handleExport}
                  className={`${currentTheme.card} border ${currentTheme.border} ${currentTheme.text} px-5 py-3 rounded-2xl text-sm font-bold hover:bg-slate-50 transition-all flex items-center gap-2 shadow-sm`}
                >
                  <Download size={18} />
                  <span className="hidden sm:inline">{t.exportLate}</span>
                </button>
              </div>
            )}
            {activeTab === 'students' && (
              <button 
                onClick={() => {
                  setEditingStudent(null);
                  setStudentForm({ name: '', parentName: '', parentEmail: '', parentPhone: '', totalDue: '', dueDate: new Date().toISOString().split('T')[0] });
                  setShowStudentModal(true);
                }}
                className={`${currentTheme.accentBg} text-white px-5 py-3 rounded-2xl text-sm font-bold ${currentTheme.accentHover} transition-all flex items-center gap-2 shadow-lg ${currentTheme.accentShadow}`}
              >
                <Plus size={18} />
                <span className="hidden sm:inline">{t.addStudent}</span>
              </button>
            )}
          </div>
        </header>

        {/* --- Persistent Welcome Banner (No Print) --- */}
        <div className="welcome-banner mb-8 p-5 rounded-2xl relative overflow-hidden flex flex-col sm:flex-row sm:items-center justify-between gap-4 no-print shadow-md" style={{ background: 'linear-gradient(135deg, #0F172A 0%, #1E293B 100%)', border: '1px solid rgba(255,255,255,0.08)' }}>
          <div className="flex items-center gap-3.5 z-10">
            <div className="w-10 h-10 rounded-xl bg-emerald-600 flex items-center justify-center shadow-lg shadow-emerald-500/25 flex-shrink-0">
              <ShieldCheck size={20} className="text-white" />
            </div>
            <div>
              <h3 className="font-bold text-base tracking-tight" style={{ color: '#FFFFFF' }}>
                {lang === 'en' ? 'Welcome back' : 'Bon retour'}, <span style={{ color: '#34D399' }}>{currentUser?.name || currentUser?.username}</span> !
              </h3>
              <p className="text-[11px] font-medium" style={{ color: '#94A3B8' }}>
                {(currentUser?.name || currentUser?.username || '').toLowerCase().includes('mamadou')
                  ? (lang === 'en' ? 'General Manager (Full Administration & Financial Access)' : 'Gestionnaire Principal (Accès Administration & Finances)')
                  : (currentUser?.name || currentUser?.username || '').toLowerCase().includes('fanta')
                  ? (lang === 'en' ? 'School Promoter & Director (Executive Oversight)' : 'Promotrice & Directrice (Supervision Exécutive)')
                  : currentUser?.role === 'dev'
                  ? (lang === 'en' ? 'System Developer (Full Technical & Admin Access)' : 'Développeur Système (Accès Technique & Admin Total)')
                  : currentUser?.role === 'admin' 
                  ? (lang === 'en' ? 'Administrator (Full System Access)' : 'Administrateur (Accès Système Complet)')
                  : (lang === 'en' ? 'Accountant Access (Finance & Receipts)' : 'Accès Comptable (Finances & Recettes)')}
              </p>
            </div>
          </div>
          <div className="z-10 flex items-center gap-2">
            <span className={`px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-[0.08em] ${
              currentUser?.role === 'dev' ? 'bg-purple-500/20 text-purple-400 border border-purple-500/20' :
              currentUser?.role === 'admin' ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/20' : 'bg-blue-500/20 text-blue-400 border border-blue-500/20'
            }`}>
              {(currentUser?.name || currentUser?.username || '').toLowerCase().includes('mamadou')
                ? (lang === 'en' ? 'General Manager' : 'Gestionnaire Principal')
                : (currentUser?.name || currentUser?.username || '').toLowerCase().includes('fanta')
                ? (lang === 'en' ? 'Promoter' : 'Promotrice')
                : currentUser?.role === 'dev'
                ? (lang === 'en' ? 'Developer' : 'Développeur')
                : currentUser?.role === 'admin'
                ? (lang === 'en' ? 'Admin' : 'Administrateur')
                : (lang === 'en' ? 'Accountant' : 'Comptable')}
            </span>
          </div>
        </div>

        {/* --- Locked Academic Year Banner --- */}
        {lockedYears.includes(selectedYear) && (
          <div className="mb-8 flex items-center justify-between p-6 bg-rose-50 border border-rose-200 rounded-3xl text-rose-800 shadow-sm no-print">
            <div className="flex items-center gap-4">
              <div className="p-3 bg-rose-100 rounded-2xl text-rose-600">
                <Lock size={24} />
              </div>
              <div>
                <p className="font-extrabold text-lg">
                  {lang === 'en' ? 'Academic Year Locked' : 'Année Académique Verrouillée'}
                </p>
                <p className="text-xs opacity-90">
                  {lang === 'en' 
                    ? 'This academic year has been closed and archived. All records are currently in read-only mode.' 
                    : 'Cette année académique a été clôturée et archivée. Tous les dossiers sont en mode lecture seule.'}
                </p>
              </div>
            </div>
            <span className="px-4 py-1.5 bg-rose-600 text-white rounded-xl text-xs font-black uppercase tracking-wider">
              {lang === 'en' ? 'Read-Only' : 'Lecture Seule'}
            </span>
          </div>
        )}

        {/* --- Dashboard View --- */}
        {activeTab === 'dashboard' && (
          <div className="space-y-12">
            {/* Payroll Window Banner Alerts */}
            {(() => {
              const monthKeys = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
              const currentMonthName = t[monthKeys[payrollWindowStatus.currentCalendarMonth]];
              return (
                <div className="space-y-3 no-print">
                  {payrollWindowStatus.isOverdue && (
                    <div className="p-5 bg-rose-50 border border-rose-200 rounded-3xl flex items-center gap-4 text-rose-700 shadow-lg shadow-rose-500/5 animate-subtle-pulse">
                      <div className="p-2 bg-rose-100 rounded-xl text-rose-600 flex-shrink-0">
                        <AlertCircle size={20} />
                      </div>
                      <div>
                        <h4 className="font-black text-sm">
                          {lang === 'en' 
                            ? `⚠️ Payroll Window Closed: No salary payments recorded for ${currentMonthName} as of the 10th deadline.`
                            : `⚠️ Période de paie fermée : Aucun paiement de salaire enregistré pour ${currentMonthName} après la date limite du 10.`}
                        </h4>
                        <p className="text-xs text-rose-600/80 font-semibold mt-0.5">
                          {lang === 'en' 
                            ? 'High-priority action required to process current month payroll.' 
                            : 'Action prioritaire requise pour traiter la paie du mois en cours.'}
                        </p>
                      </div>
                    </div>
                  )}

                  {payrollWindowStatus.isOpen && (
                    <div className="p-5 bg-blue-50 border border-blue-200 rounded-3xl flex items-center gap-4 text-blue-700 shadow-lg shadow-blue-500/5">
                      <div className="p-2 bg-blue-100 rounded-xl text-blue-600 flex-shrink-0">
                        <Calendar size={20} />
                      </div>
                      <div>
                        <h4 className="font-black text-sm">
                          {lang === 'en' 
                            ? `ℹ️ Payroll Window Open: Please remember to start processing salary payments for ${currentMonthName}.`
                            : `ℹ️ Période de paie ouverte : Pensez à commencer à traiter les paiements de salaire pour ${currentMonthName}.`}
                        </h4>
                        <p className="text-xs text-blue-600/80 font-semibold mt-0.5">
                          {lang === 'en' 
                            ? 'The payroll window is active from the 1st to the 10th of the month.' 
                            : 'La période de paie est active du 1er au 10 du mois.'}
                        </p>
                      </div>
                    </div>
                  )}
                </div>
              );
            })()}

            {/* Missed Payroll Warning Banners */}
            {missedMonths.length > 0 && (
              <div className="space-y-3 no-print">
                {missedMonths.map(m => {
                  const monthKeys = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
                  return (
                    <div key={m} className="p-5 bg-rose-50 border border-rose-200 rounded-3xl flex items-center gap-4 text-rose-700 shadow-lg shadow-rose-500/5 animate-subtle-pulse">
                      <div className="p-2 bg-rose-100 rounded-xl text-rose-600">
                        <AlertCircle size={20} />
                      </div>
                      <div>
                        <h4 className="font-black text-sm">
                          {lang === 'en' 
                            ? `⚠️ Warning: No payroll recorded for ${t[monthKeys[m]]}` 
                            : `⚠️ Attention : Aucun paiement de salaire enregistré pour ${t[monthKeys[m]]}`}
                        </h4>
                        <p className="text-xs text-rose-600/80 font-semibold mt-0.5">
                          {lang === 'en' 
                            ? 'Immediate action required to reconcile outstanding liabilities.' 
                            : 'Action immédiate requise pour rapprocher les passifs en cours.'}
                        </p>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {/* --- Premium KPI Cards --- */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5 no-print">
              {/* Cash Balance — Hero Card (spans 2 cols) */}
              <motion.div 
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                className="card-hero sm:col-span-2 p-7 relative group"
              >
                <div className="absolute top-0 right-0 w-40 h-40 bg-gradient-to-bl from-emerald-500/[0.06] to-transparent rounded-bl-full pointer-events-none"></div>
                <div className="flex justify-between items-start mb-5">
                  <div>
                    <p className="text-[10px] font-semibold text-white/40 uppercase tracking-[0.1em] mb-2">{t.cashBalance}</p>
                    <h3 className="text-3xl sm:text-4xl font-extrabold text-white tracking-tight" style={{ fontVariantNumeric: 'tabular-nums' }}>
                      {formatCurrency(stats.totalFees - stats.totalExpenses)}
                    </h3>
                  </div>
                  <div className="p-3 rounded-xl bg-emerald-500/[0.12] text-emerald-400 border border-emerald-500/[0.08]">
                    <Coins size={22} />
                  </div>
                </div>
                <div className="flex items-center gap-3 mt-2">
                  <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-400/80 bg-emerald-500/[0.08] px-2.5 py-1 rounded-full">
                    <TrendingUp size={12} />
                    {lang === 'en' ? 'Net Liquidity' : 'Liquidité Nette'}
                  </span>
                </div>
              </motion.div>

              {/* Monthly Income Card */}
              <motion.div 
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.1 }}
                className={`card-stat p-6 flex flex-col justify-between ${currentTheme.isDark ? '!bg-slate-800/60 !border-white/[0.06]' : ''}`}
                style={{ ['--accent-primary' as string]: theme === 'cream' ? '#1E5E3A' : (theme === 'slate' ? '#38BDF8' : '#3b82f6') }}
              >
                <div className="flex justify-between items-start mb-3">
                  <div>
                    <p className={`text-[10px] font-semibold ${currentTheme.muted} uppercase tracking-[0.1em] mb-1.5`}>{t.incomeThisMonth}</p>
                    <h3 className={`text-2xl font-bold tracking-tight ${currentTheme.isDark ? 'text-white' : 'text-slate-800'}`} style={{ fontVariantNumeric: 'tabular-nums' }}>
                      {formatCurrency(stats.collectedMonth)}
                    </h3>
                  </div>
                  <div className={`p-2.5 rounded-xl ${theme === 'cream' ? 'bg-[#1E5E3A]/10 text-[#1E5E3A]' : (theme === 'slate' ? 'bg-sky-500/10 text-sky-400' : 'bg-blue-500/10 text-blue-600')}`}>
                    <TrendingUp size={18} />
                  </div>
                </div>
                <span className={`text-[10px] font-semibold ${currentTheme.muted} flex items-center gap-1.5 mt-1`}>
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
                  {lang === 'en' ? 'Monthly Inflow' : 'Entrées Mensuelles'}
                </span>
              </motion.div>

              {/* Monthly Expenses Card */}
              <motion.div 
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.2 }}
                className={`card-stat p-6 flex flex-col justify-between ${currentTheme.isDark ? '!bg-slate-800/60 !border-white/[0.06]' : ''}`}
                style={{ ['--accent-primary' as string]: '#ef4444' }}
              >
                <div className="flex justify-between items-start mb-3">
                  <div>
                    <p className={`text-[10px] font-semibold ${currentTheme.muted} uppercase tracking-[0.1em] mb-1.5`}>{t.expensesThisMonth}</p>
                    <h3 className={`text-2xl font-bold tracking-tight ${currentTheme.isDark ? 'text-white' : 'text-slate-800'}`} style={{ fontVariantNumeric: 'tabular-nums' }}>
                      {formatCurrency(stats.expensesThisMonth)}
                    </h3>
                  </div>
                  <div className={`p-2.5 rounded-xl ${theme === 'cream' ? 'bg-rose-500/10 text-rose-700' : (theme === 'slate' ? 'bg-rose-500/10 text-rose-400' : 'bg-rose-500/10 text-rose-600')}`}>
                    <TrendingDown size={18} />
                  </div>
                </div>
                <span className={`text-[10px] font-semibold ${currentTheme.muted} flex items-center gap-1.5 mt-1`}>
                  <span className="w-1.5 h-1.5 rounded-full bg-rose-500"></span>
                  {lang === 'en' ? 'Monthly Outflow' : 'Sorties Mensuelles'}
                </span>
              </motion.div>
            </div>

            {/* --- Enrolled + Quick Stats Row --- */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-5 no-print">
              <motion.div 
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                className={`card-stat p-6 ${currentTheme.isDark ? '!bg-slate-800/60 !border-white/[0.06]' : ''}`}
              >
                <div className="flex justify-between items-start mb-3">
                  <div>
                    <p className={`text-[10px] font-semibold ${currentTheme.muted} uppercase tracking-[0.1em] mb-1.5`}>{t.enrolledStudents}</p>
                    <h3 className={`text-2xl font-bold tracking-tight ${currentTheme.isDark ? 'text-white' : 'text-slate-800'}`}>
                      {stats.enrolledStudentsCount}
                    </h3>
                  </div>
                  <div className={`p-2.5 rounded-xl ${theme === 'cream' ? 'bg-[#1E5E3A]/10 text-[#1E5E3A]' : (theme === 'slate' ? 'bg-sky-500/10 text-sky-400' : 'bg-purple-500/10 text-purple-600')}`}>
                    <GraduationCap size={18} />
                  </div>
                </div>
                <span className={`text-[10px] font-semibold ${currentTheme.muted} flex items-center gap-1.5`}>
                  <span className="w-1.5 h-1.5 rounded-full bg-purple-500"></span>
                  {lang === 'en' ? 'Active Enrolled' : 'Inscriptions Actives'}
                </span>
              </motion.div>

              <motion.div 
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.1 }}
                className={`card-stat p-6 ${currentTheme.isDark ? '!bg-slate-800/60 !border-white/[0.06]' : ''}`}
              >
                <div className="flex justify-between items-start mb-3">
                  <div>
                    <p className={`text-[10px] font-semibold ${currentTheme.muted} uppercase tracking-[0.1em] mb-1.5`}>{t.lateParents}</p>
                    <h3 className={`text-2xl font-bold tracking-tight ${currentTheme.isDark ? 'text-white' : 'text-slate-800'}`}>
                      {stats.lateParentsCount}
                    </h3>
                  </div>
                  <div className="p-2.5 rounded-xl bg-amber-500/10 text-amber-600">
                    <Clock size={18} />
                  </div>
                </div>
                <span className={`text-[10px] font-semibold ${currentTheme.muted} flex items-center gap-1.5`}>
                  <span className="w-1.5 h-1.5 rounded-full bg-amber-500"></span>
                  {lang === 'en' ? 'Action Required' : 'Action Requise'}
                </span>
              </motion.div>

              <motion.div 
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.2 }}
                className={`card-stat p-6 ${currentTheme.isDark ? '!bg-slate-800/60 !border-white/[0.06]' : ''}`}
                style={{ ['--accent-primary' as string]: '#ef4444' }}
              >
                <div className="flex justify-between items-start mb-3">
                  <div>
                    <p className={`text-[10px] font-semibold ${currentTheme.muted} uppercase tracking-[0.1em] mb-1.5`}>{t.totalArrears}</p>
                    <h3 className="text-2xl font-bold tracking-tight text-rose-600" style={{ fontVariantNumeric: 'tabular-nums' }}>
                      {formatCurrency(stats.totalArrears)}
                    </h3>
                  </div>
                  <div className="p-2.5 rounded-xl bg-rose-500/10 text-rose-600">
                    <AlertCircle size={18} />
                  </div>
                </div>
                <span className={`text-[10px] font-semibold ${currentTheme.muted} flex items-center gap-1.5`}>
                  <span className="w-1.5 h-1.5 rounded-full bg-rose-500"></span>
                  {lang === 'en' ? 'Unpaid Installments' : 'Acomptes Impayés'}
                </span>
              </motion.div>
            </div>

            {/* --- Summary Cards --- */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-5">
              <motion.div 
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                className={`card-elevated p-6 ${currentTheme.isDark ? '!bg-slate-800/60 !border-white/[0.06]' : ''}`}
              >
                <p className={`text-[10px] font-semibold ${currentTheme.muted} uppercase tracking-[0.1em] mb-2`}>{t.totalOutstanding}</p>
                <h3 className={`text-3xl font-bold tracking-tight ${currentTheme.isDark ? 'text-white' : 'text-slate-800'}`} style={{ fontVariantNumeric: 'tabular-nums' }}>{formatCurrency(stats.totalOutstanding)}</h3>
                <div className="mt-4 flex items-center gap-2 text-rose-500 text-xs font-semibold">
                  <TrendingUp size={13} className="rotate-180" />
                  <span>{lang === 'en' ? '+12% vs last month' : '+12% vs mois dernier'}</span>
                </div>
              </motion.div>

              <motion.div 
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.1 }}
                className={`card-elevated p-6 ${currentTheme.isDark ? '!bg-slate-800/60 !border-white/[0.06]' : ''}`}
              >
                <p className={`text-[10px] font-semibold ${currentTheme.muted} uppercase tracking-[0.1em] mb-2`}>{t.collectedMonth}</p>
                <h3 className={`text-3xl font-bold tracking-tight ${currentTheme.isDark ? 'text-white' : 'text-slate-800'}`} style={{ fontVariantNumeric: 'tabular-nums' }}>{formatCurrency(stats.collectedMonth)}</h3>
                <div className="mt-4 flex items-center gap-2 text-emerald-500 text-xs font-semibold">
                  <TrendingUp size={13} />
                  <span>{lang === 'en' ? '+8% target reached' : '+8% objectif atteint'}</span>
                </div>
              </motion.div>

              <motion.div 
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.2 }}
                className={`card-elevated p-6 ${currentTheme.isDark ? '!bg-slate-800/60 !border-white/[0.06]' : ''}`}
              >
                <p className={`text-[10px] font-semibold ${currentTheme.muted} uppercase tracking-[0.1em] mb-2`}>{t.lateParents}</p>
                <h3 className={`text-3xl font-bold tracking-tight ${currentTheme.isDark ? 'text-white' : 'text-slate-800'}`}>{stats.lateParentsCount}</h3>
                <div className="mt-4 flex items-center gap-2 text-amber-500 text-xs font-semibold">
                  <Clock size={13} />
                  <span>{lang === 'en' ? 'Action required' : 'Action requise'}</span>
                </div>
              </motion.div>

              <motion.div 
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.3 }}
                className={`card-elevated p-6 ${currentTheme.isDark ? '!bg-slate-800/60 !border-white/[0.06]' : ''}`}
              >
                <p className={`text-[10px] font-semibold ${currentTheme.muted} uppercase tracking-[0.1em] mb-2`}>{t.totalArrears}</p>
                <h3 className="text-3xl font-bold tracking-tight text-rose-600" style={{ fontVariantNumeric: 'tabular-nums' }}>{formatCurrency(stats.totalArrears)}</h3>
                <div className="mt-4 flex items-center gap-2 text-rose-500 text-xs font-semibold">
                  <AlertCircle size={13} />
                  <span>{lang === 'en' ? 'Unpaid installments' : 'Acomptes impayés'}</span>
                </div>
              </motion.div>
            </div>

            {/* --- Analytics Section --- */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <motion.div 
                initial={{ opacity: 0, scale: 0.98 }}
                animate={{ opacity: 1, scale: 1 }}
                className={`card-elevated p-6 ${currentTheme.isDark ? '!bg-slate-800/60 !border-white/[0.06]' : ''}`}
              >
                <div className="flex items-center justify-between mb-6">
                  <h3 className={`text-sm font-semibold ${currentTheme.isDark ? 'text-white' : 'text-slate-800'} tracking-tight`}>{t.incomeVsExpenses}</h3>
                  <div className={`p-2 ${currentTheme.isDark ? 'bg-white/[0.06] text-white/60' : 'bg-slate-100 text-slate-500'} rounded-lg`}>
                    <TrendingUp size={16} />
                  </div>
                </div>
                <div className="h-80 w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={chartData}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={currentTheme.isDark ? '#064e3b' : '#f1f5f9'} />
                      <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fontSize: 12, fontWeight: 600, fill: currentTheme.isDark ? '#10b981' : '#64748b' }} />
                      <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 12, fontWeight: 600, fill: currentTheme.isDark ? '#10b981' : '#64748b' }} />
                      <Tooltip 
                        contentStyle={{ backgroundColor: currentTheme.isDark ? '#1e1e1e' : '#fff', borderRadius: '16px', border: 'none', boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)' }}
                        itemStyle={{ fontSize: '12px', fontWeight: 'bold' }}
                      />
                      <RechartsLegend iconType="circle" wrapperStyle={{ paddingTop: '20px', fontSize: '12px', fontWeight: 'bold' }} />
                      <Bar dataKey="income" name={t.income} fill={currentTheme.isDark ? '#10b981' : '#3b82f6'} radius={[4, 4, 0, 0]} />
                      <Bar dataKey="expenses" name={t.expenses} fill={currentTheme.isDark ? '#ef4444' : '#f43f5e'} radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </motion.div>

              <motion.div 
                initial={{ opacity: 0, scale: 0.98 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ delay: 0.1 }}
                className={`card-elevated p-6 ${currentTheme.isDark ? '!bg-slate-800/60 !border-white/[0.06]' : ''}`}
              >
                <div className="flex items-center justify-between mb-6">
                  <h3 className={`text-sm font-semibold ${currentTheme.isDark ? 'text-white' : 'text-slate-800'} tracking-tight`}>{t.feeStatus}</h3>
                  <div className={`p-2 ${currentTheme.isDark ? 'bg-white/[0.06] text-white/60' : 'bg-slate-100 text-slate-500'} rounded-lg`}>
                    <PieChart size={16} />
                  </div>
                </div>
                <div className="h-80 w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <RePieChart>
                      <Pie
                        data={pieData}
                        cx="50%"
                        cy="50%"
                        innerRadius={60}
                        outerRadius={100}
                        paddingAngle={8}
                        dataKey="value"
                      >
                        <Cell fill={currentTheme.isDark ? '#10b981' : '#3b82f6'} />
                        <Cell fill={currentTheme.isDark ? '#ef4444' : '#f43f5e'} />
                      </Pie>
                      <Tooltip 
                        contentStyle={{ backgroundColor: currentTheme.isDark ? '#1e1e1e' : '#fff', borderRadius: '16px', border: 'none', boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)' }}
                        itemStyle={{ fontSize: '12px', fontWeight: 'bold' }}
                      />
                      <RechartsLegend verticalAlign="bottom" height={36} iconType="circle" wrapperStyle={{ fontSize: '12px', fontWeight: 'bold' }} />
                    </RePieChart>
                  </ResponsiveContainer>
                </div>
              </motion.div>
            </div>

            {/* --- Late Payments List --- */}
            <div className={`card-elevated overflow-hidden ${currentTheme.isDark ? '!bg-slate-800/60 !border-white/[0.06]' : ''}`}>
              <div className={`px-6 py-5 border-b ${currentTheme.isDark ? 'border-white/[0.06]' : currentTheme.border} flex justify-between items-center`}>
                <h3 className={`text-sm font-semibold ${currentTheme.isDark ? 'text-white' : 'text-slate-800'} tracking-tight`}>{t.lateParents}</h3>
                <span className="bg-rose-500/10 text-rose-600 px-3 py-1 rounded-full text-[10px] font-semibold uppercase tracking-[0.08em]">
                  Urgent
                </span>
              </div>

              {lateStudents.length > 0 ? (
                <div className={`divide-y ${currentTheme.border}`}>
                  {lateStudents.map(s => {
                    const discount = s.scholarshipDiscount || 0;
                    const discountedTotal = s.totalDue * (1 - discount / 100);
                    const balance = discountedTotal - s.amountPaid;
                    return (
                      <div 
                        key={s.id} 
                        onClick={() => setSelectedStudent(s)}
                        className={`p-6 ${currentTheme.rowHover} transition-all cursor-pointer flex items-center justify-between group`}
                      >
                        <div className="flex items-center gap-4">
                          <div className={`w-12 h-12 rounded-2xl ${currentTheme.isDark ? 'bg-emerald-900/20 text-emerald-500' : 'bg-slate-100 text-slate-400'} flex items-center justify-center font-bold group-hover:bg-blue-600 group-hover:text-white transition-all`}>
                            {s.name.charAt(0)}
                          </div>
                          <div>
                            <h4 className={`font-bold ${currentTheme.isDark ? 'text-emerald-500' : 'text-slate-800'}`}>{s.name}</h4>
                            <p className={`text-xs ${currentTheme.muted} font-medium`}>{s.parentName}</p>
                          </div>
                        </div>
                        <div className="text-right">
                          <p className="text-sm font-black text-rose-600">{formatCurrency(balance)}</p>
                          <p className={`text-[10px] ${currentTheme.muted} font-bold uppercase tracking-widest`}>{t.balance}</p>
                        </div>
                        <ChevronRight className={`${currentTheme.muted} group-hover:text-blue-600 group-hover:translate-x-1 transition-all`} size={20} />
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="p-20 flex flex-col items-center justify-center text-center">
                  <div className="w-20 h-20 rounded-full bg-emerald-50 flex items-center justify-center text-emerald-500 mb-6">
                    <CheckCircle2 size={40} />
                  </div>
                  <h4 className={`text-xl font-bold ${currentTheme.isDark ? 'text-emerald-400' : 'text-slate-800'} mb-2`}>{t.allUpToDate}</h4>
                  <p className={`${currentTheme.muted} max-w-xs mx-auto text-sm`}>Great job! All accounts are currently settled or within their grace period.</p>
                </div>
              )}
            </div>

            {/* --- Cash Flow Summary --- */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
              <motion.div 
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                className={`${currentTheme.card} p-8 rounded-[2rem] border ${currentTheme.border} shadow-xl shadow-slate-200/50`}
              >
                <div className="flex items-center gap-4 mb-8">
                  <div className="p-3 bg-emerald-100 text-emerald-600 rounded-2xl">
                    <PieChart size={24} />
                  </div>
                  <h3 className={`text-xl font-bold ${currentTheme.isDark ? 'text-emerald-400' : 'text-slate-800'}`}>{lang === 'en' ? 'Cash Flow Summary' : 'Résumé du Flux de Trésorerie'}</h3>
                </div>

                <div className="space-y-6">
                  <div className="flex justify-between items-center">
                    <span className={currentTheme.muted}>{t.totalFeesCollected}</span>
                    <span className={`font-bold ${currentTheme.isDark ? 'text-emerald-400' : 'text-slate-800'}`}>{formatCurrency(stats.totalFees)}</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className={currentTheme.muted}>{t.totalExpensesPaid}</span>
                    <span className="font-bold text-rose-500">-{formatCurrency(stats.totalExpenses)}</span>
                  </div>
                  <div className={`pt-6 border-t ${currentTheme.border} flex justify-between items-center`}>
                    <span className={`font-black uppercase tracking-widest text-xs ${currentTheme.isDark ? 'text-emerald-400' : 'text-slate-800'}`}>{lang === 'en' ? 'Net Cash Flow' : 'Flux de Trésorerie Net'}</span>
                    <span className={`text-2xl font-black ${stats.totalFees - stats.totalExpenses >= 0 ? 'text-emerald-500' : 'text-rose-500'}`}>
                      {formatCurrency(stats.totalFees - stats.totalExpenses)}
                    </span>
                  </div>
                </div>
              </motion.div>

              <motion.div 
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ delay: 0.1 }}
                className={`${currentTheme.card} p-8 rounded-[2rem] border ${currentTheme.border} shadow-xl shadow-slate-200/50 flex flex-col justify-center items-center text-center`}
              >
                <div className={`w-20 h-20 rounded-full ${stats.totalFees - stats.totalExpenses >= 0 ? 'bg-emerald-100 text-emerald-600' : 'bg-rose-100 text-rose-600'} flex items-center justify-center mb-6`}>
                  <Wallet size={40} />
                </div>
                <h4 className={`text-lg font-bold ${currentTheme.isDark ? 'text-emerald-400' : 'text-slate-800'} mb-2`}>
                  {stats.totalFees - stats.totalExpenses >= 0 ? (lang === 'en' ? 'Healthy Balance' : 'Solde Sain') : (lang === 'en' ? 'Deficit Warning' : 'Alerte de Déficit')}
                </h4>
                <p className={`${currentTheme.muted} text-sm max-w-[250px]`}>
                  {stats.totalFees - stats.totalExpenses >= 0 
                    ? (lang === 'en' ? 'Your school is currently operating with a positive cash flow.' : 'Votre école fonctionne actuellement avec un flux de trésorerie positif.')
                    : (lang === 'en' ? 'Expenses are exceeding income. Review your spending.' : 'Les dépenses dépassent les revenus. Revoyez vos dépenses.')}
                </p>
              </motion.div>
            </div>
          </div>
        )}

        {/* --- Students View --- */}
        {activeTab === 'students' && (
          <div className="space-y-8">
            {/* Print Summary */}
            <div className="hidden print:block mb-8 p-6 bg-slate-50 border-2 border-slate-200 rounded-2xl">
              <div className="flex justify-around text-center">
                <div>
                  <p className="text-[10px] font-black uppercase tracking-widest text-slate-500 mb-1">{t.totalCollected}</p>
                  <p className="text-xl font-black text-emerald-600">{formatCurrency(stats.totalCollected)}</p>
                </div>
                <div className="w-px h-10 bg-slate-200"></div>
                <div>
                  <p className="text-[10px] font-black uppercase tracking-widest text-slate-500 mb-1">{t.totalOutstanding}</p>
                  <p className="text-xl font-black text-rose-600">{formatCurrency(stats.totalOutstanding)}</p>
                </div>
              </div>
            </div>

            <div className={`${currentTheme.card} rounded-[2.5rem] border ${currentTheme.border} shadow-2xl shadow-slate-200/50 overflow-hidden`}>
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className={`${currentTheme.isDark ? 'bg-emerald-900/20' : 'bg-slate-50/50'} ${currentTheme.muted} text-[10px] font-black uppercase tracking-[0.2em]`}>
                    <th 
                      onClick={() => handleSort('name')}
                      className={`px-8 py-6 cursor-pointer ${currentTheme.isDark ? 'hover:bg-emerald-900/10' : 'hover:bg-slate-100'} transition-all group/sort select-none`}
                    >
                      <div className="flex items-center gap-2">
                        <span>{t.studentName}</span>
                        {studentSortKey === 'name' ? (
                          studentSortOrder === 'asc' ? <ArrowUp size={12} className="text-blue-500 flex-shrink-0" /> : <ArrowDown size={12} className="text-blue-500 flex-shrink-0" />
                        ) : (
                          <ArrowUpDown size={12} className="opacity-35 group-hover/sort:opacity-100 transition-opacity flex-shrink-0" />
                        )}
                      </div>
                    </th>
                    <th 
                      onClick={() => handleSort('parentName')}
                      className={`px-8 py-6 cursor-pointer ${currentTheme.isDark ? 'hover:bg-emerald-900/10' : 'hover:bg-slate-100'} transition-all group/sort select-none`}
                    >
                      <div className="flex items-center gap-2">
                        <span>{t.parentName}</span>
                        {studentSortKey === 'parentName' ? (
                          studentSortOrder === 'asc' ? <ArrowUp size={12} className="text-blue-500 flex-shrink-0" /> : <ArrowDown size={12} className="text-blue-500 flex-shrink-0" />
                        ) : (
                          <ArrowUpDown size={12} className="opacity-35 group-hover/sort:opacity-100 transition-opacity flex-shrink-0" />
                        )}
                      </div>
                    </th>
                    <th className="px-8 py-6 select-none">{t.totalDue}</th>
                    <th 
                      onClick={() => handleSort('balance')}
                      className={`px-8 py-6 cursor-pointer ${currentTheme.isDark ? 'hover:bg-emerald-900/10' : 'hover:bg-slate-100'} transition-all group/sort select-none`}
                    >
                      <div className="flex items-center gap-2">
                        <span>{t.balance}</span>
                        {studentSortKey === 'balance' ? (
                          studentSortOrder === 'asc' ? <ArrowUp size={12} className="text-blue-500 flex-shrink-0" /> : <ArrowDown size={12} className="text-blue-500 flex-shrink-0" />
                        ) : (
                          <ArrowUpDown size={12} className="opacity-35 group-hover/sort:opacity-100 transition-opacity flex-shrink-0" />
                        )}
                      </div>
                    </th>
                    <th 
                      onClick={() => handleSort('dueDate')}
                      className={`px-8 py-6 cursor-pointer ${currentTheme.isDark ? 'hover:bg-emerald-900/10' : 'hover:bg-slate-100'} transition-all group/sort select-none`}
                    >
                      <div className="flex items-center gap-2">
                        <span>{t.status} / {t.dueDate}</span>
                        {studentSortKey === 'dueDate' ? (
                          studentSortOrder === 'asc' ? <ArrowUp size={12} className="text-blue-500 flex-shrink-0" /> : <ArrowDown size={12} className="text-blue-500 flex-shrink-0" />
                        ) : (
                          <ArrowUpDown size={12} className="opacity-35 group-hover/sort:opacity-100 transition-opacity flex-shrink-0" />
                        )}
                      </div>
                    </th>
                    <th className="px-8 py-6 text-right select-none">Actions</th>
                  </tr>
                </thead>
                <tbody className={`divide-y ${currentTheme.border}`}>
                  {filteredStudents.map((student) => {
                    const discount = student.scholarshipDiscount || 0;
                    const discountedTotal = student.totalDue * (1 - discount / 100);
                    const balance = discountedTotal - student.amountPaid;
                    const status = getStatus(student);

                    // Highlighting Logic
                    const dueDate = new Date(student.dueDate);
                    const now = new Date(today);
                    const diffTime = dueDate.getTime() - now.getTime();
                    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

                    let highlightClasses = "";
                    if (balance > 0) {
                      if (diffDays < -30) {
                        highlightClasses = currentTheme.isDark ? 'bg-rose-900/10' : 'bg-rose-50/50';
                      } else if (diffDays >= 0 && diffDays <= 2) {
                        highlightClasses = 'border-l-4 border-l-amber-400';
                      }
                    }
                    if (student.flagged) {
                      highlightClasses = currentTheme.isDark ? 'bg-amber-900/10' : 'bg-amber-50/50';
                    }

                    return (
                      <tr 
                        key={student.id} 
                        className={`${currentTheme.rowHover} transition-all group ${highlightClasses}`}
                      >
                        <td className="px-8 py-6">
                          <div className="flex items-center gap-4">
                            <button 
                              onClick={() => toggleFlag(student.id)}
                              className={`transition-colors ${student.flagged ? 'text-amber-500' : currentTheme.muted + ' hover:text-amber-400'}`}
                            >
                              <Flag size={16} fill={student.flagged ? 'currentColor' : 'none'} />
                            </button>
                            <div 
                              className="flex items-center gap-4 cursor-pointer"
                              onClick={() => setSelectedStudent(student)}
                            >
                              <div className={`w-10 h-10 rounded-xl ${currentTheme.isDark ? 'bg-emerald-900/20 text-emerald-500' : 'bg-slate-100 text-slate-400'} font-bold text-xs group-hover:bg-blue-600 group-hover:text-white transition-all flex items-center justify-center`}>
                                {student.name.split(' ').map(n => n[0]).join('')}
                              </div>
                              <div>
                                <span className={`block font-bold ${currentTheme.isDark ? 'text-emerald-500' : 'text-slate-800'} text-sm`}>
                                  <HighlightText text={student.name} highlight={searchTerm} />
                                </span>
                                <div className="flex items-center gap-2 mt-0.5">
                                  <span className={`text-[10px] ${currentTheme.muted} font-bold tracking-widest uppercase`}>{student.id}</span>
                                  {student.grade && (
                                    <span className="inline-block px-1.5 py-0.5 bg-blue-50 text-blue-600 rounded-md text-[9px] font-extrabold uppercase tracking-wider">
                                      {getGradeDisplay(student.grade, lang)}
                                    </span>
                                  )}
                                </div>
                              </div>
                            </div>
                          </div>
                        </td>
                        <td className="px-8 py-6">
                          <div className="flex flex-col">
                            <span className={`text-sm ${currentTheme.isDark ? 'text-emerald-500' : 'text-slate-600'} font-semibold`}>
                              <HighlightText text={student.parentName} highlight={searchTerm} />
                            </span>
                            <span className={`text-xs ${currentTheme.muted}`}>{student.parentEmail || student.parentPhone || '—'}</span>
                          </div>
                        </td>
                        <td className={`px-8 py-6 text-sm font-bold ${currentTheme.muted}`}>
                          <div className="flex flex-col">
                            <span>{formatCurrency(student.totalDue)}</span>
                            {student.scholarshipDiscount > 0 && (
                              <span className="text-[10px] text-emerald-500 font-black uppercase tracking-widest">-{student.scholarshipDiscount}% {t.scholarship}</span>
                            )}
                          </div>
                        </td>
                        <td className={`px-8 py-6 text-sm font-black ${currentTheme.isDark ? 'text-emerald-400' : 'text-slate-800'}`}>
                          {formatCurrency(balance)}
                        </td>
                        <td className="px-8 py-6">
                          <div className="flex flex-col gap-1 items-start">
                            <div className={`inline-flex items-center gap-2 px-4 py-1.5 rounded-full text-[10px] font-black uppercase tracking-widest border ${status.color}`}>
                              {status.icon}
                              {status.label}
                            </div>
                            <span className={`text-[10px] ${currentTheme.muted} font-bold mt-1 uppercase tracking-wider`}>
                              {t.dueDate}: {formatDate(student.dueDate)}
                            </span>
                          </div>
                        </td>
                        <td className="px-8 py-6 text-right flex justify-end gap-2">
                          <button 
                            onClick={() => openEditModal(student)}
                            className={`p-2 ${currentTheme.muted} hover:text-blue-600 hover:bg-blue-50 rounded-xl transition-all`}
                            title={lang === 'en' ? 'Edit Student' : 'Modifier l\'élève'}
                          >
                            <FileText size={18} />
                          </button>
                          {balance > 0 && diffDays <= -60 && (
                            <button 
                              onClick={() => setTicketStudent(student)}
                              className="p-2 text-rose-500 hover:text-rose-600 hover:bg-rose-50 rounded-xl transition-all"
                              title={lang === 'en' ? 'Print Late Payment Ticket' : 'Imprimer le ticket de retard'}
                            >
                              <Printer size={18} />
                            </button>
                          )}
                          <button 
                            onClick={() => {
                              const confirmMsg = lang === 'en' 
                                ? `Are you sure you want to delete student "${student.name}"? This will also remove their payment records.` 
                                : `Êtes-vous sûr de vouloir supprimer l'élève "${student.name}" ? Cela supprimera également ses reçus et paiements.`;
                              if (confirm(confirmMsg)) {
                                deleteStudent(student.id);
                              }
                            }}
                            className="p-2 text-rose-500 hover:text-rose-700 hover:bg-rose-50 dark:hover:bg-rose-950/20 rounded-xl transition-all"
                            title={lang === 'en' ? 'Delete Student' : 'Supprimer l\'élève'}
                          >
                            <Trash2 size={18} />
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            
            {/* Legend */}
            <div className={`px-8 py-4 border-t ${currentTheme.border} ${currentTheme.isDark ? 'bg-emerald-900/10' : 'bg-slate-50/30'} flex flex-wrap gap-6 items-center`}>
              <span className={`text-[10px] font-black uppercase tracking-widest ${currentTheme.muted}`}>{t.legend}:</span>
              <div className="flex items-center gap-2">
                <div className={`w-3 h-3 rounded-sm ${currentTheme.isDark ? 'bg-rose-900/30' : 'bg-rose-100'} border border-rose-200`}></div>
                <span className={`text-[10px] font-bold ${currentTheme.muted}`}>{t.overdue30}</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 rounded-sm border-l-2 border-l-amber-400 bg-transparent"></div>
                <span className={`text-[10px] font-bold ${currentTheme.muted}`}>{t.due48}</span>
              </div>
              <div className="flex items-center gap-2">
                <div className={`w-3 h-3 rounded-sm ${currentTheme.isDark ? 'bg-amber-900/30' : 'bg-amber-100'} border border-amber-200`}></div>
                <span className={`text-[10px] font-bold ${currentTheme.muted}`}>{t.flaggedLabel}</span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* --- Centralized Parent Directory View --- */}
        {activeTab === 'parents' && (
          <div className="space-y-8">
            {/* Header & Search Bar */}
            <div className={`p-8 rounded-[2rem] ${currentTheme.card} border ${currentTheme.border} shadow-xl shadow-slate-200/50 flex flex-col md:flex-row md:items-center justify-between gap-6`}>
              <div className="space-y-1">
                <div className="flex items-center gap-3">
                  <div className={`p-3 rounded-2xl ${currentTheme.isDark ? 'bg-emerald-900/30 text-emerald-400' : 'bg-emerald-50 text-emerald-600'}`}>
                    <Users size={24} />
                  </div>
                  <div>
                    <h3 className={`text-2xl font-black ${currentTheme.isDark ? 'text-white' : 'text-slate-900'}`}>
                      {t.parentGuardian}
                    </h3>
                    <p className={`text-xs ${currentTheme.muted}`}>
                      {t.parentDirectorySubtitle}
                    </p>
                  </div>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-4">
                {/* Search Bar */}
                <div className="relative min-w-[280px] sm:min-w-[340px]">
                  <Search className={`absolute left-4 top-1/2 -translate-y-1/2 ${currentTheme.muted}`} size={18} />
                  <input
                    type="text"
                    value={parentSearchTerm}
                    onChange={(e) => setParentSearchTerm(e.target.value)}
                    placeholder={t.searchParentsPlaceholder}
                    className={`w-full pl-11 pr-4 py-3 text-xs font-semibold rounded-2xl border ${currentTheme.border} ${currentTheme.isDark ? 'bg-slate-900 text-white' : 'bg-slate-50 text-slate-800'} focus:outline-none focus:ring-2 focus:ring-emerald-500/20 transition-all`}
                  />
                  {parentSearchTerm && (
                    <button
                      onClick={() => setParentSearchTerm('')}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                    >
                      <X size={14} />
                    </button>
                  )}
                </div>

                {/* Add Parent Button */}
                <button
                  onClick={() => {
                    setEditingParent(null);
                    setParentForm({
                      fullName: '',
                      primaryPhone: '',
                      secondaryPhone: '',
                      email: '',
                      address: '',
                      occupation: '',
                      relationship: 'Father',
                      notes: ''
                    });
                    setShowParentModal(true);
                  }}
                  className="px-5 py-3 rounded-2xl bg-emerald-600 text-white font-bold text-xs hover:bg-emerald-700 shadow-lg shadow-emerald-600/20 transition-all flex items-center gap-2"
                >
                  <Plus size={16} />
                  <span>{t.addParent}</span>
                </button>
              </div>
            </div>

            {/* Parent Directory Cards Grid */}
            <div className="space-y-6">
              {parents.filter(p => {
                const search = parentSearchTerm.toLowerCase().trim();
                if (!search) return true;
                const children = getChildrenForParent(p);
                const hasMatchingChild = children.some(c => c.name.toLowerCase().includes(search) || (c.studentId && c.studentId.toLowerCase().includes(search)) || c.id.toLowerCase().includes(search));
                return p.fullName.toLowerCase().includes(search) ||
                  p.occupation.toLowerCase().includes(search) ||
                  p.address.toLowerCase().includes(search) ||
                  p.relationship.toLowerCase().includes(search) ||
                  p.phones.some(ph => ph.includes(search)) ||
                  (p.email && p.email.toLowerCase().includes(search)) ||
                  hasMatchingChild;
              }).length === 0 ? (
                <div className={`p-12 text-center rounded-[2rem] ${currentTheme.card} border ${currentTheme.border}`}>
                  <Users size={48} className="mx-auto mb-4 text-slate-300" />
                  <p className={`text-sm font-bold ${currentTheme.muted}`}>
                    {lang === 'en' ? 'No parent profiles found matching your search.' : 'Aucun profil parent trouvé pour votre recherche.'}
                  </p>
                </div>
              ) : (
                parents.filter(p => {
                  const search = parentSearchTerm.toLowerCase().trim();
                  if (!search) return true;
                  const children = getChildrenForParent(p);
                  const hasMatchingChild = children.some(c => c.name.toLowerCase().includes(search) || (c.studentId && c.studentId.toLowerCase().includes(search)) || c.id.toLowerCase().includes(search));
                  return p.fullName.toLowerCase().includes(search) ||
                    p.occupation.toLowerCase().includes(search) ||
                    p.address.toLowerCase().includes(search) ||
                    p.relationship.toLowerCase().includes(search) ||
                    p.phones.some(ph => ph.includes(search)) ||
                    (p.email && p.email.toLowerCase().includes(search)) ||
                    hasMatchingChild;
                }).map((parent) => {
                  const children = getChildrenForParent(parent);
                  const totalOutstanding = getParentOutstandingBalance(parent);
                  const paymentHistory = getParentPaymentHistory(parent);
                  const totalPaymentsEver = paymentHistory.reduce((sum, item) => sum + item.amount, 0);
                  const isExpanded = expandedParentId === parent.id;

                  return (
                    <motion.div
                      key={parent.id}
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      className={`${currentTheme.card} rounded-[2rem] border ${currentTheme.border} shadow-xl shadow-slate-200/50 overflow-hidden transition-all`}
                    >
                      {/* Main Card Header Bar */}
                      <div className="p-6 flex flex-col lg:flex-row lg:items-center justify-between gap-6 cursor-pointer hover:bg-slate-500/5 transition-colors" onClick={() => setExpandedParentId(isExpanded ? null : parent.id)}>
                        <div className="flex items-center gap-4">
                          <div className={`w-14 h-14 rounded-2xl flex items-center justify-center text-lg font-black ${currentTheme.isDark ? 'bg-emerald-900/30 text-emerald-400' : 'bg-slate-100 text-slate-700'}`}>
                            {parent.fullName.charAt(0).toUpperCase()}
                          </div>
                          <div>
                            <div className="flex items-center gap-2 flex-wrap">
                              <h4 className={`text-lg font-black ${currentTheme.isDark ? 'text-white' : 'text-slate-900'}`}>
                                <HighlightText text={parent.fullName} highlight={parentSearchTerm} />
                              </h4>
                              <span className="px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-wider bg-slate-200/60 dark:bg-slate-800 text-slate-600 dark:text-slate-300">
                                {t[parent.relationship.toLowerCase() as keyof typeof t] || parent.relationship}
                              </span>
                            </div>
                            <div className="flex items-center gap-4 text-xs mt-1 text-slate-500 flex-wrap">
                              <span className="flex items-center gap-1 font-semibold">
                                <Briefcase size={14} className="text-slate-400" />
                                {parent.occupation || 'N/A'}
                              </span>
                              <span className="flex items-center gap-1 font-semibold">
                                <MapPin size={14} className="text-slate-400" />
                                {parent.address || 'N/A'}
                              </span>
                            </div>
                          </div>
                        </div>

                        {/* Right Summary Metrics & Actions */}
                        <div className="flex items-center gap-4 flex-wrap justify-between lg:justify-end" onClick={(e) => e.stopPropagation()}>
                          {/* Children Count Pill */}
                          <div className="flex flex-col items-start lg:items-end">
                            <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">{t.listOfChildren}</span>
                            <span className="text-sm font-bold text-slate-700 dark:text-slate-300 flex items-center gap-1">
                              <Users size={14} className="text-emerald-500" />
                              {children.length} {t.studentsCountLabel}
                            </span>
                          </div>

                          {/* Family Balance Badge (Highlighted in Red if overdue with direct Notify button) */}
                          <div className="flex flex-col items-start lg:items-end">
                            <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">{t.totalOutstandingBalance}</span>
                            {totalOutstanding > 0 ? (
                              <div className="flex items-center gap-2 mt-1">
                                <span className="px-3 py-1.5 rounded-xl bg-rose-500/10 text-rose-600 border border-rose-200 font-black text-sm flex items-center gap-1 animate-pulse">
                                  <AlertCircle size={14} />
                                  {formatCurrency(totalOutstanding)}
                                </span>
                                <button
                                  title={t.sendReminder}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    openNotifyModal(parent);
                                  }}
                                  className="px-3 py-1.5 rounded-xl bg-amber-500 hover:bg-amber-600 text-white font-bold text-xs shadow-md shadow-amber-500/20 flex items-center gap-1.5 transition-all active:scale-95"
                                >
                                  <Bell size={14} />
                                  <span>{t.notify}</span>
                                </button>
                              </div>
                            ) : (
                              <span className="px-3 py-1.5 rounded-xl bg-emerald-500/10 text-emerald-600 border border-emerald-200 font-bold text-xs flex items-center gap-1 mt-1">
                                <CheckCircle2 size={14} />
                                0 {t.currency} ({t.settle})
                              </span>
                            )}
                          </div>

                          {/* Quick Actions */}
                          <div className="flex items-center gap-2">
                            <button
                              title={t.linkStudent}
                              onClick={(e) => {
                                e.stopPropagation();
                                setActiveLinkingParent(parent);
                                setStudentToLinkId('');
                                setShowLinkStudentModal(true);
                              }}
                              className="p-2.5 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-100 transition-all font-bold text-xs flex items-center gap-1"
                            >
                              <UserPlus size={16} />
                              <span className="hidden sm:inline">{t.linkStudent}</span>
                            </button>

                            <button
                              title={t.editParent}
                              onClick={(e) => {
                                e.stopPropagation();
                                openEditParentModal(parent);
                              }}
                              className="p-2.5 rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200 transition-all"
                            >
                              <Edit2 size={16} />
                            </button>

                            <button
                              title={lang === 'en' ? 'Delete Parent' : 'Supprimer Parent'}
                              onClick={(e) => {
                                e.stopPropagation();
                                handleDeleteParent(parent.id);
                              }}
                              className="p-2.5 rounded-xl bg-rose-50 dark:bg-rose-950/40 text-rose-600 hover:bg-rose-100 transition-all"
                            >
                              <Trash2 size={16} />
                            </button>

                            <button
                              onClick={() => setExpandedParentId(isExpanded ? null : parent.id)}
                              className="p-2.5 rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200 transition-all"
                            >
                              {isExpanded ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
                            </button>
                          </div>
                        </div>
                      </div>

                      {/* Expandable Details Container */}
                      <AnimatePresence>
                        {isExpanded && (
                          <motion.div
                            initial={{ height: 0, opacity: 0 }}
                            animate={{ height: 'auto', opacity: 1 }}
                            exit={{ height: 0, opacity: 0 }}
                            className={`border-t ${currentTheme.border} p-6 lg:p-8 bg-slate-50/50 dark:bg-slate-900/30 space-y-8`}
                          >
                            {/* Summary Banner Row: Sum of all payments ever made by parent across all children */}
                            <div className="p-5 rounded-2xl bg-gradient-to-r from-emerald-600 to-teal-700 text-white shadow-lg shadow-emerald-600/20 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                              <div className="flex items-center gap-3">
                                <div className="p-3 rounded-xl bg-white/10 backdrop-blur-md">
                                  <CreditCard size={22} className="text-emerald-200" />
                                </div>
                                <div>
                                  <p className="text-[10px] font-black uppercase tracking-widest text-emerald-200">
                                    {t.totalPaymentsAllChildren}
                                  </p>
                                  <p className="text-xs font-medium text-emerald-50/90">
                                    {lang === 'en'
                                      ? `Cumulative sum of all payments ever made by ${parent.fullName} across all registered children`
                                      : `Cumul total de tous les paiements effectués par ${parent.fullName} pour l'ensemble des enfants rattachés`}
                                  </p>
                                </div>
                              </div>
                              <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4 border-t sm:border-t-0 border-white/10 pt-3 sm:pt-0">
                                <div className="text-left sm:text-right">
                                  <span className="text-[10px] uppercase font-bold text-emerald-200 block sm:hidden">{t.amountPaid}</span>
                                  <span className="text-xl sm:text-2xl font-black text-white font-mono tracking-tight block">
                                    {formatCurrency(totalPaymentsEver)}
                                  </span>
                                </div>
                                <button
                                  type="button"
                                  onClick={() => handleExportParentLedgerPdf(parent)}
                                  className="px-4 py-2.5 rounded-xl bg-white text-emerald-900 hover:bg-emerald-50 font-black text-xs shadow-md flex items-center gap-2 transition-all active:scale-95"
                                >
                                  <Download size={16} className="text-emerald-600" />
                                  <span>{t.downloadLedger}</span>
                                </button>
                              </div>
                            </div>

                            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                              {/* Column 1: Contact, Employment & Residence Details */}
                              <div className="space-y-6 bg-white dark:bg-slate-900 p-6 rounded-2xl border border-slate-200/60 dark:border-slate-800 shadow-sm">
                                <h5 className="text-xs font-black uppercase tracking-widest text-emerald-600 dark:text-emerald-400 flex items-center gap-2">
                                  <UserCheck size={16} />
                                  {t.parentDetails} & {t.contactCard}
                                </h5>

                                <div className="space-y-4 text-xs">
                                  <div className="flex items-center gap-3">
                                    <Phone size={16} className="text-slate-400" />
                                    <div>
                                      <p className="font-bold text-slate-400 uppercase text-[9px]">{t.primaryPhone}</p>
                                      <p className="font-bold text-slate-800 dark:text-slate-200">{parent.phones[0] || 'N/A'}</p>
                                    </div>
                                  </div>

                                  {parent.phones[1] && (
                                    <div className="flex items-center gap-3">
                                      <Phone size={16} className="text-slate-400" />
                                      <div>
                                        <p className="font-bold text-slate-400 uppercase text-[9px]">{t.secondaryPhone}</p>
                                        <p className="font-bold text-slate-800 dark:text-slate-200">{parent.phones[1]}</p>
                                      </div>
                                    </div>
                                  )}

                                  {parent.email && (
                                    <div className="flex items-center gap-3">
                                      <Mail size={16} className="text-slate-400" />
                                      <div>
                                        <p className="font-bold text-slate-400 uppercase text-[9px]">{t.email}</p>
                                        <p className="font-bold text-slate-800 dark:text-slate-200">{parent.email}</p>
                                      </div>
                                    </div>
                                  )}

                                  <div className="flex items-center gap-3">
                                    <MapPin size={16} className="text-slate-400" />
                                    <div>
                                      <p className="font-bold text-slate-400 uppercase text-[9px]">{t.address}</p>
                                      <p className="font-bold text-slate-800 dark:text-slate-200">{parent.address}</p>
                                    </div>
                                  </div>

                                  <div className="flex items-center gap-3">
                                    <Briefcase size={16} className="text-slate-400" />
                                    <div>
                                      <p className="font-bold text-slate-400 uppercase text-[9px]">{t.occupation}</p>
                                      <p className="font-bold text-slate-800 dark:text-slate-200">{parent.occupation}</p>
                                    </div>
                                  </div>

                                  {parent.notes && (
                                    <div className="flex items-start gap-3 pt-2 border-t border-slate-100 dark:border-slate-800">
                                      <FileText size={16} className="text-slate-400 mt-0.5" />
                                      <div>
                                        <p className="font-bold text-slate-400 uppercase text-[9px]">{t.accountingNotes}</p>
                                        <p className="italic text-slate-600 dark:text-slate-400">{parent.notes}</p>
                                      </div>
                                    </div>
                                  )}
                                </div>
                              </div>

                              {/* Column 2: Connected Children List */}
                              <div className="space-y-6 bg-white dark:bg-slate-900 p-6 rounded-2xl border border-slate-200/60 dark:border-slate-800 shadow-sm">
                                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                                  <h5 className="text-xs font-black uppercase tracking-widest text-emerald-600 dark:text-emerald-400 flex items-center gap-2">
                                    <Users size={16} />
                                    {t.listOfChildren} ({children.length})
                                  </h5>

                                  <div className="flex items-center gap-2 flex-wrap">
                                    {children.length > 1 && (
                                      <div className="flex items-center gap-1 bg-slate-100 dark:bg-slate-800 p-1 rounded-xl text-xs">
                                        <span className="text-[10px] font-bold text-slate-400 pl-1 hidden sm:inline">{t.sortByLabel}</span>
                                        <button
                                          type="button"
                                          onClick={() => setParentChildrenSortBy('highest_balance')}
                                          className={`px-2.5 py-1 rounded-lg font-bold text-[10px] transition-all flex items-center gap-1 ${
                                            parentChildrenSortBy === 'highest_balance'
                                              ? 'bg-emerald-600 text-white shadow-xs'
                                              : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                                          }`}
                                          title={t.sortHighestBalance}
                                        >
                                          <ArrowUpDown size={12} />
                                          <span>{t.sortHighestBalance}</span>
                                        </button>
                                        <button
                                          type="button"
                                          onClick={() => setParentChildrenSortBy('alphabetical')}
                                          className={`px-2.5 py-1 rounded-lg font-bold text-[10px] transition-all flex items-center gap-1 ${
                                            parentChildrenSortBy === 'alphabetical'
                                              ? 'bg-emerald-600 text-white shadow-xs'
                                              : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                                          }`}
                                          title={t.sortAlphabetical}
                                        >
                                          <span>{t.sortAlphabetical}</span>
                                        </button>
                                      </div>
                                    )}

                                    <button
                                      onClick={() => {
                                        setActiveLinkingParent(parent);
                                        setStudentToLinkId('');
                                        setShowLinkStudentModal(true);
                                      }}
                                      className="px-3 py-1.5 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-100 text-xs font-bold flex items-center gap-1 transition-all"
                                    >
                                      <Plus size={14} />
                                      {t.linkStudent}
                                    </button>
                                  </div>
                                </div>

                                {children.length === 0 ? (
                                  <div className="p-8 text-center bg-slate-50 dark:bg-slate-800/40 rounded-xl border border-dashed border-slate-200 dark:border-slate-700">
                                    <p className="text-xs text-slate-400 font-semibold mb-3">{t.noChildrenLinked}</p>
                                    <button
                                      onClick={() => {
                                        setActiveLinkingParent(parent);
                                        setStudentToLinkId('');
                                        setShowLinkStudentModal(true);
                                      }}
                                      className="px-4 py-2 rounded-xl bg-emerald-600 text-white font-bold text-xs"
                                    >
                                      {t.linkStudent}
                                    </button>
                                  </div>
                                ) : (
                                  <div className="space-y-3">
                                    {[...children]
                                      .sort((a, b) => {
                                        if (parentChildrenSortBy === 'highest_balance') {
                                          const balA = Math.max(0, a.totalDue - a.amountPaid);
                                          const balB = Math.max(0, b.totalDue - b.amountPaid);
                                          if (balB !== balA) return balB - balA;
                                          return a.name.localeCompare(b.name);
                                        } else {
                                          return a.name.localeCompare(b.name);
                                        }
                                      })
                                      .map((child) => {
                                      const remaining = Math.max(0, child.totalDue - child.amountPaid);
                                      return (
                                        <div
                                          key={child.id}
                                          className="p-4 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200/60 dark:border-slate-700/60 flex items-center justify-between gap-4 hover:border-emerald-500/40 transition-all"
                                        >
                                          <div>
                                            <div className="flex items-center gap-2">
                                              <span className="font-bold text-sm text-slate-900 dark:text-white">
                                                {child.name}
                                              </span>
                                              <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-300">
                                                {child.studentId || child.id}
                                              </span>
                                              {child.grade && (
                                                <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-100 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-300">
                                                  {child.grade}
                                                </span>
                                              )}
                                            </div>

                                            <div className="text-[11px] text-slate-500 mt-1 flex items-center gap-3">
                                              <span>{t.totalDue}: <strong className="text-slate-700 dark:text-slate-300">{formatCurrency(child.totalDue)}</strong></span>
                                              <span>•</span>
                                              <span>
                                                {t.balance}:{' '}
                                                <strong className={remaining > 0 ? 'text-rose-600 font-black' : 'text-emerald-600 font-bold'}>
                                                  {formatCurrency(remaining)}
                                                </strong>
                                              </span>
                                            </div>
                                          </div>

                                          <div className="flex items-center gap-2">
                                            {/* Quick Link Navigation to Student Profile */}
                                            <button
                                              onClick={() => setSelectedStudent(child)}
                                              title={t.studentDetails}
                                              className="px-3 py-1.5 rounded-xl bg-blue-50 dark:bg-blue-950/40 text-blue-600 dark:text-blue-400 hover:bg-blue-100 text-xs font-bold flex items-center gap-1"
                                            >
                                              <span>{t.studentDetails}</span>
                                              <ChevronRight size={14} />
                                            </button>

                                            {/* Unlink Student */}
                                            <button
                                              onClick={() => handleUnlinkStudent(child.id)}
                                              title={t.unlinkStudent}
                                              className="p-1.5 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/40 transition-colors"
                                            >
                                              <Unlink size={14} />
                                            </button>
                                          </div>
                                        </div>
                                      );
                                    })}
                                  </div>
                                )}
                              </div>
                            </div>

                            {/* Consolidated Ledger / Payment History Table */}
                            <div className="bg-white dark:bg-slate-900 p-6 rounded-2xl border border-slate-200/60 dark:border-slate-800 shadow-sm space-y-4">
                              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                                <h5 className="text-xs font-black uppercase tracking-widest text-emerald-600 dark:text-emerald-400 flex items-center gap-2">
                                  <Receipt size={16} />
                                  {t.paymentHistory} ({lang === 'en' ? 'Consolidated Family Ledger' : 'Livre-Journal Familial Consolidé'})
                                </h5>
                                <button
                                  type="button"
                                  onClick={() => handleExportParentLedgerPdf(parent)}
                                  className="px-3 py-1.5 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-100 font-bold text-xs flex items-center gap-1.5 border border-emerald-200/50 dark:border-emerald-800/50 transition-all self-start sm:self-auto"
                                >
                                  <Download size={14} />
                                  <span>{t.downloadLedger}</span>
                                </button>
                              </div>

                              {paymentHistory.length === 0 ? (
                                <p className="text-xs text-slate-400 italic py-4 text-center">
                                  {lang === 'en' ? 'No historical receipts found across connected children.' : 'Aucun reçu historique trouvé pour les enfants rattachés.'}
                                </p>
                              ) : (
                                <div className="overflow-x-auto">
                                  <table className="w-full text-left border-collapse text-xs">
                                    <thead>
                                      <tr className="border-b border-slate-200 dark:border-slate-800 text-[10px] font-black uppercase tracking-widest text-slate-400">
                                        <th className="py-2.5 px-3">{t.receiptNo}</th>
                                        <th className="py-2.5 px-3">{t.studentName}</th>
                                        <th className="py-2.5 px-3">{t.date}</th>
                                        <th className="py-2.5 px-3">{t.amount}</th>
                                        <th className="py-2.5 px-3">{t.academicYear || 'Year'}</th>
                                      </tr>
                                    </thead>
                                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                                      {paymentHistory.map((item, idx) => (
                                        <tr key={idx} className="hover:bg-slate-50 dark:hover:bg-slate-800/40 transition-colors">
                                          <td className="py-2.5 px-3 font-mono font-bold text-emerald-600 dark:text-emerald-400">
                                            {item.receiptNumber}
                                          </td>
                                          <td className="py-2.5 px-3 font-bold text-slate-800 dark:text-slate-200">
                                            {item.studentName} <span className="text-[10px] font-normal text-slate-400">({item.studentId})</span>
                                          </td>
                                          <td className="py-2.5 px-3 text-slate-600 dark:text-slate-400">
                                            {item.date}
                                          </td>
                                          <td className="py-2.5 px-3 font-black text-slate-900 dark:text-white">
                                            {formatCurrency(item.amount)}
                                          </td>
                                          <td className="py-2.5 px-3 text-slate-500">
                                            {item.academicYear || selectedYear}
                                          </td>
                                        </tr>
                                      ))}
                                    </tbody>
                                    <tfoot className="border-t-2 border-emerald-500/30 bg-emerald-50/70 dark:bg-emerald-950/40 font-bold">
                                      <tr>
                                        <td colSpan={3} className="py-3 px-3 font-black text-slate-800 dark:text-slate-200 uppercase text-[10px] tracking-wider">
                                          {t.totalPaymentsAllChildren}
                                        </td>
                                        <td className="py-3 px-3 font-black text-emerald-700 dark:text-emerald-400 text-sm font-mono">
                                          {formatCurrency(totalPaymentsEver)}
                                        </td>
                                        <td className="py-3 px-3 text-[10px] text-slate-500 dark:text-slate-400 font-semibold">
                                          {paymentHistory.length} {lang === 'en' ? 'receipt(s)' : 'reçu(s)'}
                                        </td>
                                      </tr>
                                    </tfoot>
                                  </table>
                                </div>
                              )}
                            </div>
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </motion.div>
                  );
                })
              )}
            </div>
          </div>
        )}

        {/* --- Payroll View --- */}
        {activeTab === 'payroll' && (
          <div className="space-y-8">
            {/* Print Summary */}
            <div className="hidden print:block mb-8 p-6 bg-slate-50 border-2 border-slate-200 rounded-2xl">
              <h4 className="text-sm font-black uppercase tracking-widest text-slate-800 mb-4">{t.payroll} - {getMonthName(currentMonth)}</h4>
              <div className="grid grid-cols-4 gap-4 text-[10px] font-black uppercase tracking-widest text-slate-500 border-b border-slate-200 pb-2">
                <span>{t.staffName}</span>
                <span>{t.monthlySalary}</span>
                <span>{t.installment}</span>
                <span>{t.remainingBalance}</span>
              </div>
              <div className="divide-y divide-slate-100">
                {staff.map(s => {
                  const paymentsThisMonth = salaryPayments.filter(p => p.staffId === s.id && new Date(p.date).getMonth() === currentMonth);
                  const paidThisMonth = paymentsThisMonth.reduce((sum, p) => sum + p.amount, 0);
                  const balance = s.salary - paidThisMonth;
                  return (
                    <div key={s.id} className="grid grid-cols-4 gap-4 py-3 text-xs">
                      <span className="font-bold text-slate-800">{s.name}</span>
                      <span className="text-slate-600">{formatCurrency(s.salary)}</span>
                      <span className="text-emerald-600 font-bold">{formatCurrency(paidThisMonth)}</span>
                      <span className={balance > 0 ? "text-rose-600 font-bold" : "text-slate-400"}>{formatCurrency(balance)}</span>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* 12-Month Payroll Summary Grid */}
            <div className={`${currentTheme.card} p-8 rounded-[2rem] border ${currentTheme.border} shadow-xl shadow-slate-200/50 no-print`}>
              <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-6">
                <div>
                  <h4 className={`text-lg font-black ${currentTheme.isDark ? 'text-emerald-400' : 'text-slate-800'}`}>
                    {lang === 'en' ? 'Automatic Payroll Audit' : 'Audit Automatique de la Paie'}
                  </h4>
                  <p className={`text-xs ${currentTheme.muted} mt-1`}>
                    {lang === 'en' 
                      ? '12-month payroll tracking for the current calendar year' 
                      : "Suivi de la paie sur 12 mois pour l'année civile en cours"}
                  </p>
                </div>
                <div className="flex flex-wrap gap-4 text-[10px] font-black uppercase tracking-widest">
                  <div className="flex items-center gap-1.5">
                    <div className="w-2.5 h-2.5 rounded-full bg-emerald-500"></div>
                    <span className={currentTheme.muted}>{lang === 'en' ? 'Full Payment' : 'Paiement Complet'}</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <div className="w-2.5 h-2.5 rounded-full bg-amber-500"></div>
                    <span className={currentTheme.muted}>{lang === 'en' ? 'Partial' : 'Acompte'}</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <div className="w-2.5 h-2.5 rounded-full bg-rose-500 animate-pulse"></div>
                    <span className={currentTheme.muted}>{lang === 'en' ? 'Missing' : 'Manquant'}</span>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-12 gap-4">
                {['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'].map((monthKey, index) => {
                  const currentCalendarYear = new Date().getFullYear();
                  const currentCalendarMonth = new Date().getMonth();
                  const isFuture = index > currentCalendarMonth;
                  const monthName = t[monthKey];

                  // calculate payroll status for this month
                  const monthPayments = salaryPayments.filter(p => {
                    const payDate = new Date(p.date);
                    return payDate.getFullYear() === currentCalendarYear && payDate.getMonth() === index;
                  });
                  const totalPaid = monthPayments.reduce((sum, p) => sum + p.amount, 0);
                  const totalExpected = staff.reduce((sum, s) => sum + s.salary, 0);

                  let boxClass = "";
                  let statusText = "";
                  
                  if (isFuture) {
                    boxClass = `${currentTheme.isDark ? 'bg-emerald-950/10 border-emerald-950/20 text-emerald-900/50' : 'bg-slate-50 border-slate-100 text-slate-300'}`;
                    statusText = lang === 'en' ? 'Scheduled' : 'Planifié';
                  } else if (totalPaid === 0) {
                    boxClass = "bg-rose-500 text-white border-rose-600 animate-pulse shadow-lg shadow-rose-500/20";
                    statusText = lang === 'en' ? 'Unpaid' : 'Non payé';
                  } else if (totalPaid >= totalExpected) {
                    boxClass = "bg-emerald-500 text-white border-emerald-600 shadow-lg shadow-emerald-500/20";
                    statusText = lang === 'en' ? 'Fully Paid' : 'Payé';
                  } else {
                    boxClass = "bg-amber-500 text-white border-amber-600 shadow-lg shadow-amber-500/20";
                    statusText = lang === 'en' ? 'Partial' : 'Acompte';
                  }

                  return (
                    <div 
                      key={index} 
                      onClick={() => {
                        setSelectedDraftMonth(index);
                        setSelectedDraftYear(currentCalendarYear);
                        setShowMonthlyDraftModal(true);
                      }}
                      className={`${boxClass} p-4 rounded-2xl border flex flex-col items-center justify-center text-center transition-all hover:scale-[1.05] cursor-pointer shadow-sm`}
                      title={lang === 'en' ? `Click to view ${monthName} payroll draft` : `Cliquer pour voir le bordereau de ${monthName}`}
                    >
                      <span className="text-xs font-black uppercase tracking-wider">{monthName.substring(0, 3)}</span>
                      <span className="text-[9px] font-bold opacity-85 mt-1.5">{statusText}</span>
                      {totalPaid > 0 && (
                        <span className="text-[8px] font-mono mt-1 font-bold opacity-75">{formatCurrency(totalPaid)}</span>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-6 no-print">
              <div>
                <h3 className={`text-2xl font-bold ${currentTheme.isDark ? 'text-emerald-400' : 'text-slate-800'}`}>{t.staffDirectory}</h3>
                <p className={`text-sm ${currentTheme.muted}`}>{lang === 'en' ? 'Manage employee profiles and payroll' : 'Gérer les profils des employés et la paie'}</p>
              </div>
              <div className="flex flex-col sm:flex-row gap-4 w-full md:w-auto">
                <div className="relative flex-1 sm:w-80">
                  <Search className={`absolute left-4 top-1/2 -translate-y-1/2 ${currentTheme.muted}`} size={18} />
                  <input 
                    type="text" 
                    placeholder={t.staffSearchPlaceholder}
                    value={staffSearchTerm}
                    onChange={(e) => setStaffSearchTerm(e.target.value)}
                    className={`w-full pl-12 pr-6 py-3 ${currentTheme.card} border ${currentTheme.border} rounded-2xl focus:outline-none focus:ring-4 focus:ring-blue-500/5 focus:border-blue-500 transition-all text-sm font-semibold ${currentTheme.isDark ? 'text-emerald-500' : 'text-slate-800'}`}
                  />
                </div>
                <button 
                  onClick={() => {
                    setSelectedDraftMonth(new Date().getMonth());
                    setSelectedDraftYear(new Date().getFullYear());
                    setShowMonthlyDraftModal(true);
                  }}
                  className="px-5 py-3 rounded-2xl border border-emerald-600/30 text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-950/20 text-xs font-bold transition-all flex items-center gap-2"
                  title={lang === 'en' ? 'Open Monthly Payroll Draft' : 'Ouvrir le Bordereau Mensuel'}
                >
                  <FileText size={16} />
                  <span>{lang === 'en' ? 'Monthly Draft' : 'Bordereau Mensuel'}</span>
                </button>
                <button 
                  onClick={() => {
                    setEditingStaff(null);
                    setStaffForm({ name: '', position: '', salary: '', email: '', phone: '', bankDetails: '', emergencyContact: '' });
                    setShowStaffModal(true);
                  }}
                  className={`${currentTheme.accentBg} text-white px-6 py-3 rounded-2xl text-sm font-bold ${currentTheme.accentHover} transition-all flex items-center gap-2 shadow-lg ${currentTheme.accentShadow}`}
                >
                  <Plus size={18} />
                  {t.addStaff}
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
              {filteredStaff.map(s => {
                const paymentsThisMonth = salaryPayments.filter(p => p.staffId === s.id && new Date(p.date).getMonth() === currentMonth);
                const paidThisMonth = paymentsThisMonth.reduce((sum, p) => sum + p.amount, 0);
                const balance = s.salary - paidThisMonth;
                const payDatePassed = new Date().getDate() > 25;
                
                let statusColor = "";
                let statusLabel = "";
                
                if (paidThisMonth === 0) {
                  if (payDatePassed) {
                    statusColor = "bg-rose-500 text-white shadow-lg shadow-rose-500/40 border-rose-600";
                    statusLabel = t.unpaid;
                  } else {
                    statusColor = `${currentTheme.card} border ${currentTheme.border}`;
                    statusLabel = t.unpaid;
                  }
                } else if (balance > 0) {
                  statusColor = "bg-amber-400 text-white shadow-lg shadow-amber-400/40 border-amber-500";
                  statusLabel = t.partialPaid;
                } else {
                  statusColor = "bg-emerald-500 text-white shadow-lg shadow-emerald-500/40 border-emerald-600";
                  statusLabel = t.fullyPaid;
                }

                const isBankVisible = visibleBankDetails[s.id];

                return (
                  <motion.div 
                    key={s.id}
                    initial={{ opacity: 0, scale: 0.95 }}
                    animate={{ opacity: 1, scale: 1 }}
                    className={`${statusColor} p-8 rounded-[2rem] border transition-all group relative`}
                  >
                    <div className="flex items-start justify-between mb-6">
                      <div className="flex items-center gap-4">
                        <div className={`w-14 h-14 rounded-2xl ${paidThisMonth > 0 || payDatePassed ? 'bg-white/20 text-white' : (currentTheme.isDark ? 'bg-emerald-900/20 text-emerald-500' : 'bg-slate-100 text-slate-400')} flex items-center justify-center font-bold text-xl`}>
                          {s.name.charAt(0)}
                        </div>
                        <div>
                          <h4 className={`font-bold ${paidThisMonth > 0 || payDatePassed ? 'text-white' : (currentTheme.isDark ? 'text-emerald-500' : 'text-slate-800')}`}>
                            <HighlightText text={s.name} highlight={staffSearchTerm} />
                          </h4>
                          <p className={`text-xs ${paidThisMonth > 0 || payDatePassed ? 'text-white/70' : currentTheme.muted} font-bold uppercase tracking-widest`}>{s.position}</p>
                        </div>
                      </div>
                      <div className="flex gap-2">
                        <a 
                          href={`tel:${s.phone}`}
                          className={`p-2 rounded-xl ${paidThisMonth > 0 || payDatePassed ? 'bg-white/20 text-white hover:bg-white/30' : 'bg-slate-50 text-slate-400 hover:text-blue-600'} transition-all`}
                        >
                          <Phone size={16} />
                        </a>
                        <a 
                          href={`mailto:${s.email}`}
                          className={`p-2 rounded-xl ${paidThisMonth > 0 || payDatePassed ? 'bg-white/20 text-white hover:bg-white/30' : 'bg-slate-50 text-slate-400 hover:text-blue-600'} transition-all`}
                        >
                          <Mail size={16} />
                        </a>
                      </div>
                    </div>
                    
                    <div className="space-y-4">
                      <div className="flex justify-between items-center">
                        <span className={paidThisMonth > 0 || payDatePassed ? 'text-white/70' : currentTheme.muted}>{t.monthlySalary}</span>
                        <span className={`font-bold ${paidThisMonth > 0 || payDatePassed ? 'text-white' : (currentTheme.isDark ? 'text-emerald-400' : 'text-slate-800')}`}>{formatCurrency(s.salary)}</span>
                      </div>
                      
                      {/* Contact Details */}
                      <div className={`pt-4 border-t ${paidThisMonth > 0 || payDatePassed ? 'border-white/10' : currentTheme.border} space-y-3`}>
                        <div className="flex items-center gap-3 text-xs">
                          <Phone size={14} className={paidThisMonth > 0 || payDatePassed ? 'text-white/50' : currentTheme.muted} />
                          <span className={paidThisMonth > 0 || payDatePassed ? 'text-white/80' : 'text-slate-600'}>
                            <HighlightText text={s.phone} highlight={staffSearchTerm} />
                          </span>
                        </div>
                        <div className="flex items-center gap-3 text-xs">
                          <Mail size={14} className={paidThisMonth > 0 || payDatePassed ? 'text-white/50' : currentTheme.muted} />
                          <span className={paidThisMonth > 0 || payDatePassed ? 'text-white/80' : 'text-slate-600'}>{s.email}</span>
                        </div>
                        <div className="flex items-center gap-3 text-xs">
                          <AlertCircle size={14} className={paidThisMonth > 0 || payDatePassed ? 'text-white/50' : currentTheme.muted} />
                          <span className={paidThisMonth > 0 || payDatePassed ? 'text-white/80' : 'text-slate-600'}>
                            <span className="font-bold mr-1">{t.emergencyContact}:</span> {s.emergencyContact}
                          </span>
                        </div>
                      </div>

                      {/* Bank Details with Privacy Toggle */}
                      <div className={`p-4 rounded-2xl ${paidThisMonth > 0 || payDatePassed ? 'bg-white/10' : (currentTheme.isDark ? 'bg-emerald-900/10' : 'bg-slate-50')} border ${paidThisMonth > 0 || payDatePassed ? 'border-white/10' : currentTheme.border}`}>
                        <div className="flex justify-between items-center mb-2">
                          <span className={`text-[10px] font-black uppercase tracking-widest ${paidThisMonth > 0 || payDatePassed ? 'text-white/50' : currentTheme.muted}`}>{t.bankDetails}</span>
                          <button 
                            onClick={() => setVisibleBankDetails(prev => ({ ...prev, [s.id]: !prev[s.id] }))}
                            className={`p-1 rounded-lg ${paidThisMonth > 0 || payDatePassed ? 'hover:bg-white/10 text-white/50' : 'hover:bg-slate-200 text-slate-400'} transition-all`}
                            title={isBankVisible ? t.hideBankDetails : t.showBankDetails}
                          >
                            <Globe size={14} />
                          </button>
                        </div>
                        <p className={`text-xs font-mono font-bold ${paidThisMonth > 0 || payDatePassed ? 'text-white' : 'text-slate-700'}`}>
                          {isBankVisible ? s.bankDetails : '•••• •••• •••• •••• ••••'}
                        </p>
                      </div>

                      {paidThisMonth > 0 && (
                        <div className="flex justify-between items-center">
                          <span className={paidThisMonth > 0 || payDatePassed ? 'text-white/70' : currentTheme.muted}>{t.installment}</span>
                          <span className="font-bold text-white">{formatCurrency(paidThisMonth)}</span>
                        </div>
                      )}

                      {balance > 0 && (
                        <div className="flex justify-between items-center pt-2 border-t border-white/20">
                          <span className={paidThisMonth > 0 || payDatePassed ? 'text-white/70' : currentTheme.muted}>{t.remainingBalance}</span>
                          <span className={`font-black ${paidThisMonth > 0 || payDatePassed ? 'text-white' : 'text-rose-600'}`}>{formatCurrency(balance)}</span>
                        </div>
                      )}

                      {/* Ledger View (Mini) */}
                      {paymentsThisMonth.length > 0 && (
                        <div className="mt-4 pt-4 border-t border-white/10 space-y-2">
                          <p className={`text-[10px] font-black uppercase tracking-widest ${paidThisMonth > 0 || payDatePassed ? 'text-white/50' : currentTheme.muted}`}>{lang === 'en' ? 'Payment History' : 'Historique des Paiements'}</p>
                          {paymentsThisMonth.map(p => (
                            <div key={p.id} className="flex justify-between text-[10px] font-bold">
                              <span className={paidThisMonth > 0 || payDatePassed ? 'text-white/60' : currentTheme.muted}>{p.date}</span>
                              <span className={paidThisMonth > 0 || payDatePassed ? 'text-white' : 'text-emerald-600'}>{formatCurrency(p.amount)}</span>
                            </div>
                          ))}
                        </div>
                      )}

                      <div className={`pt-4 border-t ${paidThisMonth > 0 || payDatePassed ? 'border-white/20' : currentTheme.border} flex gap-2`}>
                        <button 
                          onClick={() => openEditStaffModal(s)}
                          className={`flex-1 py-2 rounded-xl border ${paidThisMonth > 0 || payDatePassed ? 'border-white/30 text-white hover:bg-white/10' : 'border-slate-100 text-slate-600 hover:bg-slate-50'} text-xs font-bold transition-all`}
                        >
                          {t.edit}
                        </button>
                        {balance > 0 && (
                          <button 
                            onClick={() => {
                              setSalaryForm({ ...salaryForm, staffId: s.id, amount: balance.toString() });
                              setShowSalaryModal(true);
                            }}
                            className={`flex-1 py-2 rounded-xl ${paidThisMonth > 0 || payDatePassed ? 'bg-white text-slate-800 hover:bg-white/90' : `${currentTheme.accentBg} text-white ${currentTheme.accentHover}`} text-xs font-bold transition-all shadow-md`}
                          >
                            {t.recordSalary}
                          </button>
                        )}
                        <button 
                          onClick={() => {
                            const confirmMsg = lang === 'en' 
                              ? `Are you sure you want to delete staff member "${s.name}"?` 
                              : `Êtes-vous sûr de vouloir supprimer l'employé(e) "${s.name}" ?`;
                            if (confirm(confirmMsg)) {
                              deleteStaff(s.id);
                            }
                          }}
                          className={`p-2 rounded-xl border ${paidThisMonth > 0 || payDatePassed ? 'border-white/30 text-white hover:bg-rose-500/30' : 'border-rose-100 text-rose-500 hover:bg-rose-50'} text-xs font-bold transition-all`}
                          title={lang === 'en' ? 'Delete Staff Member' : 'Supprimer l\'employé'}
                        >
                          <Trash2 size={16} />
                        </button>
                      </div>
                    </div>

                    <div className="absolute top-4 right-4">
                      <span className={`text-[8px] font-black uppercase tracking-widest px-2 py-1 rounded-full ${paidThisMonth > 0 || payDatePassed ? 'bg-white/20 text-white' : 'bg-slate-100 text-slate-400'}`}>
                        {statusLabel}
                      </span>
                    </div>
                  </motion.div>
                );
              })}
            </div>

            {/* Salary History */}
            <div className={`${currentTheme.card} rounded-[2rem] border ${currentTheme.border} shadow-xl shadow-slate-200/50 overflow-hidden`}>
              <div className="p-8 border-b border-slate-100">
                <h3 className={`text-xl font-bold ${currentTheme.isDark ? 'text-emerald-400' : 'text-slate-800'}`}>{t.payrollHistory}</h3>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className={`${currentTheme.isDark ? 'bg-emerald-900/20' : 'bg-slate-50/50'} ${currentTheme.muted} text-[10px] font-black uppercase tracking-[0.2em]`}>
                      <th className="px-8 py-6">{t.staffName}</th>
                      <th className="px-8 py-6">{t.date}</th>
                      <th className="px-8 py-6">{t.amount}</th>
                      <th className="px-8 py-6 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className={`divide-y ${currentTheme.border}`}>
                    {salaryPayments.length > 0 ? salaryPayments.map(p => {
                      const staffMember = staff.find(s => s.id === p.staffId);
                      return (
                        <tr key={p.id} className={`${currentTheme.rowHover} transition-all`}>
                          <td className="px-8 py-6">
                            <span className={`font-bold ${currentTheme.isDark ? 'text-emerald-500' : 'text-slate-800'}`}>{staffMember?.name || 'Unknown'}</span>
                          </td>
                          <td className="px-8 py-6">
                            <span className={`text-sm ${currentTheme.muted}`}>{p.date}</span>
                          </td>
                          <td className="px-8 py-6">
                            <span className="text-sm font-black text-emerald-600">{formatCurrency(p.amount)}</span>
                          </td>
                          <td className="px-8 py-6 text-right">
                            {staffMember && (
                              <button
                                onClick={() => generateStaffPayslipPdf({ staffMember, payment: p, lang })}
                                className="px-3 py-1.5 bg-slate-800 hover:bg-slate-900 text-white rounded-xl text-xs font-bold transition-all shadow-sm flex items-center gap-1.5 ml-auto active:scale-95"
                                title={lang === 'en' ? 'Download Payslip PDF' : 'Télécharger Bulletin de Paie'}
                              >
                                📄 {lang === 'en' ? 'Payslip' : 'Bulletin'}
                              </button>
                            )}
                          </td>
                        </tr>
                      );
                    }) : (
                      <tr>
                        <td colSpan={4} className="px-8 py-12 text-center text-slate-400 italic">No payments recorded yet</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

      {/* --- Expenses View (Unified General Expenses) --- */}
        {activeTab === 'expenses' && (
          <div className="space-y-8">
            {/* Print-Only Official Header */}
            <div className="hidden print:block mb-6 p-6 bg-rose-700 text-white rounded-2xl">
              <div className="flex justify-between items-center">
                <div>
                  <h1 className="text-2xl font-black">COMPLEXE SCOLAIRE MAMA THERA</h1>
                  <p className="text-sm opacity-90">
                    {lang === 'en' 
                      ? `GENERAL OPERATING EXPENSES REPORT — ${selectedYear}` 
                      : `RAPPORT DES DÉPENSES GÉNÉRALES & CHARGES D'EXPLOITATION — ${selectedYear}`}
                    {vendorCategoryFilter !== 'all' && (
                      <span className="ml-2 px-2 py-0.5 bg-white/20 rounded font-bold">
                        [{lang === 'en' ? `Category: ${t[vendorCategoryFilter] || vendorCategoryFilter}` : `Catégorie : ${t[vendorCategoryFilter] || vendorCategoryFilter}`}]
                      </span>
                    )}
                  </p>
                </div>
                <div className="text-right text-xs opacity-90">
                  <p>Bamako, Mali</p>
                  <p>{new Date().toLocaleDateString(lang === 'en' ? 'en-US' : 'fr-FR', { year: 'numeric', month: 'long', day: 'numeric' })}</p>
                </div>
              </div>
            </div>

            <div className="space-y-8">
              {/* Summary Cards */}
              {(() => {
                const academicYearVendorExpenses = vendorExpenses.filter(v => !selectedYear || !v.academicYear || v.academicYear === selectedYear);
                const totalVendorAmount = academicYearVendorExpenses.reduce((sum, v) => sum + v.amount, 0);
                const totalVendorPaid = academicYearVendorExpenses.reduce((sum, v) => {
                  if (v.paymentStatus === 'paid') return sum + v.amount;
                  if (v.paymentStatus === 'partial') return sum + (v.amountPaid || 0);
                  return sum;
                }, 0);
                const totalVendorOutstanding = academicYearVendorExpenses.reduce((sum, v) => {
                  if (v.paymentStatus === 'paid') return sum;
                  if (v.paymentStatus === 'partial') return sum + Math.max(0, v.amount - (v.amountPaid || 0));
                  return sum + v.amount;
                }, 0);
                const overdueVendorCount = academicYearVendorExpenses.filter(v => v.paymentStatus === 'unpaid' && v.dueDate < today).length;

                const filteredVendorExpensesList = vendorExpenses.filter(v => {
                  if (selectedYear && v.academicYear && v.academicYear !== selectedYear) return false;
                  const matchesSearch = v.vendorName.toLowerCase().includes(vendorSearch.toLowerCase()) || 
                                        (v.description || '').toLowerCase().includes(vendorSearch.toLowerCase());
                  if (!matchesSearch) return false;
                  if (vendorCategoryFilter !== 'all' && v.category !== vendorCategoryFilter) return false;
                  if (vendorStatusFilter !== 'all' && v.paymentStatus !== vendorStatusFilter) return false;
                  return true;
                });

                return (
                  <>
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                      <h3 className={`text-2xl font-bold tracking-tight ${currentTheme.isDark ? 'text-emerald-400' : 'text-slate-800'}`}>{t.generalExpenses}</h3>
                      <div className="flex items-center gap-3 no-print">
                        <button
                          onClick={() => generateExpensesReportPdf({
                            expenses,
                            vendorExpenses,
                            selectedYear,
                            subTab: 'vendors',
                            selectedCategory: vendorCategoryFilter,
                            selectedStatus: vendorStatusFilter,
                            searchQuery: vendorSearch,
                            lang,
                          })}
                          className="px-4 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold transition-all shadow-md shadow-emerald-600/20 flex items-center gap-2 active:scale-95"
                          title={lang === 'en' ? 'Download Expenses PDF Report (Filtered)' : 'Télécharger le Rapport des Dépenses en PDF (Filtré)'}
                        >
                          <FileText size={16} />
                          <span>{lang === 'en' ? 'Export PDF' : 'Exporter PDF'}</span>
                        </button>
                        <button
                          onClick={handlePrint}
                          className={`p-2.5 rounded-xl border ${currentTheme.border} ${currentTheme.card} ${currentTheme.text} hover:bg-slate-50 transition-all flex items-center gap-1.5 text-xs font-bold shadow-sm active:scale-95`}
                          title={t.printReport}
                        >
                          <Printer size={16} />
                          <span className="hidden sm:inline">{lang === 'en' ? 'Print' : 'Imprimer'}</span>
                        </button>
                        <button 
                          onClick={() => {
                            setEditingVendorExpense(null);
                            setVendorExpenseForm({
                              vendorName: '',
                              category: 'stationery',
                              amount: '',
                              dueDate: new Date().toISOString().split('T')[0],
                              paymentStatus: 'unpaid',
                              amountPaid: '',
                              description: '',
                              aidType: '' as any,
                              beneficiaryStudentName: '',
                              beneficiaryStudentGrade: '',
                            });
                            setShowVendorExpenseModal(true);
                          }}
                          className={`${currentTheme.isDark ? 'bg-emerald-600 hover:bg-emerald-700' : 'bg-blue-600 hover:bg-blue-700'} text-white px-5 py-2.5 rounded-xl text-xs font-bold transition-all flex items-center gap-2 shadow-lg`}
                        >
                          <Plus size={16} />
                          {t.addVendorExpense}
                        </button>
                      </div>
                    </div>

                    {/* Overdue Alert Banner if active overdue items exist */}
                    {overdueVendorCount > 0 && (
                      <div className="bg-rose-50 border border-rose-200 text-rose-800 p-6 rounded-3xl flex items-center gap-4 animate-pulse">
                        <AlertCircle size={28} className="text-rose-600 flex-shrink-0" />
                        <div>
                          <h4 className="font-bold text-base">
                            {lang === 'en' ? `${overdueVendorCount} Overdue Payments Detected!` : `${overdueVendorCount} Paiements en retard détectés !`}
                          </h4>
                          <p className="text-sm opacity-90">{t.overdueWarning}</p>
                        </div>
                      </div>
                    )}

                    <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
                      <div className={`${currentTheme.card} p-6 rounded-[2rem] border ${currentTheme.border} shadow-md`}>
                        <p className={`text-[10px] font-bold uppercase tracking-widest mb-1 ${currentTheme.muted}`}>{t.totalVendorBills}</p>
                        <h4 className={`text-2xl font-black ${currentTheme.isDark ? 'text-white' : 'text-slate-800'}`}>{formatCurrency(totalVendorAmount)}</h4>
                      </div>
                      <div className="bg-emerald-50/50 p-6 rounded-[2rem] border border-emerald-100 shadow-sm">
                        <p className="text-[10px] font-bold uppercase tracking-widest mb-1 text-emerald-600">{t.paidPortions}</p>
                        <h4 className="text-2xl font-black text-emerald-700">{formatCurrency(totalVendorPaid)}</h4>
                      </div>
                      <div className="bg-amber-50/50 p-6 rounded-[2rem] border border-amber-100 shadow-sm">
                        <p className="text-[10px] font-bold uppercase tracking-widest mb-1 text-amber-600">{t.outstandingBalanceVendor}</p>
                        <h4 className="text-2xl font-black text-amber-700">{formatCurrency(totalVendorOutstanding)}</h4>
                      </div>
                      <div className={`${overdueVendorCount > 0 ? 'bg-rose-100 border-rose-200' : 'bg-slate-50 border-slate-100'} p-6 rounded-[2rem] border shadow-sm transition-all`}>
                        <p className={`text-[10px] font-bold uppercase tracking-widest mb-1 ${overdueVendorCount > 0 ? 'text-rose-600' : 'text-slate-500'}`}>{t.overdueUnpaid}</p>
                        <h4 className={`text-2xl font-black ${overdueVendorCount > 0 ? 'text-rose-700' : 'text-slate-700'}`}>{overdueVendorCount} {t.billsCountLabel}</h4>
                      </div>
                    </div>

                    {/* Search & Filters */}
                    <div className={`${currentTheme.card} p-6 rounded-3xl border ${currentTheme.border} shadow-sm flex flex-col md:flex-row gap-4 items-center justify-between no-print`}>
                      <div className="relative w-full md:w-80">
                        <Search size={16} className={`absolute left-4 top-1/2 -translate-y-1/2 ${currentTheme.muted}`} />
                        <input 
                          type="text" 
                          placeholder={lang === 'en' ? "Search expenses..." : "Rechercher dépenses..."}
                          value={vendorSearch}
                          onChange={(e) => setVendorSearch(e.target.value)}
                          className={`w-full pl-11 pr-4 py-3 rounded-xl border text-sm focus:outline-none ${currentTheme.input}`}
                        />
                      </div>
                      <div className="flex flex-wrap gap-4 w-full md:w-auto">
                        {/* Category Filter */}
                        <div className="flex items-center gap-2">
                          <span className={`text-xs ${currentTheme.muted}`}>{t.category}:</span>
                          <select 
                            value={vendorCategoryFilter}
                            onChange={(e) => setVendorCategoryFilter(e.target.value)}
                            className={`px-3 py-2 rounded-xl border text-xs focus:outline-none ${currentTheme.input}`}
                          >
                            <option value="all">{lang === 'en' ? "All Categories" : "Toutes catégories"}</option>
                            {expenseCategoryList.map(item => (
                              <option key={item.key} value={item.key}>{item.label}</option>
                            ))}
                          </select>
                        </div>
                        {/* Status Filter */}
                        <div className="flex items-center gap-2">
                          <span className={`text-xs ${currentTheme.muted}`}>{t.paymentStatus}:</span>
                          <select 
                            value={vendorStatusFilter}
                            onChange={(e) => setVendorStatusFilter(e.target.value)}
                            className={`px-3 py-2 rounded-xl border text-xs focus:outline-none ${currentTheme.input}`}
                          >
                            <option value="all">{lang === 'en' ? "All Statuses" : "Tous statuts"}</option>
                            <option value="paid">{t.fullyPaid}</option>
                            <option value="partial">{t.partialPaid}</option>
                            <option value="unpaid">{t.unpaid}</option>
                          </select>
                        </div>
                      </div>
                    </div>

                    {/* Expenses Table */}
                    <div className={`${currentTheme.card} rounded-[2rem] border ${currentTheme.border} shadow-xl overflow-hidden`}>
                      <div className="overflow-x-auto">
                        <table className="w-full text-left border-collapse">
                          <thead>
                            <tr className={`${currentTheme.tableHeader} text-[10px] font-black uppercase tracking-[0.2em]`}>
                              <th className="px-8 py-6">{t.category}</th>
                              <th className="px-8 py-6">{t.vendorName}</th>
                              <th className="px-8 py-6 text-right">{t.amount}</th>
                              <th className="px-8 py-6 text-right">{t.amountPaid}</th>
                              <th className="px-8 py-6">{lang === 'en' ? "Due Date" : "Date d'échéance"}</th>
                              <th className="px-8 py-6">{t.paymentStatus}</th>
                              <th className="px-8 py-6 text-right no-print">{lang === 'en' ? "Actions" : "Actions"}</th>
                            </tr>
                          </thead>
                          <tbody className={`divide-y ${currentTheme.border}`}>
                            {(() => {
                              const list = filteredVendorExpensesList;
                              if (list.length === 0) {
                                return (
                                  <tr>
                                    <td colSpan={7} className="px-8 py-16 text-center text-slate-400 italic">
                                      {lang === 'en' ? "No expenses found matching the selected filter" : "Aucune dépense trouvée pour ce filtre"}
                                    </td>
                                  </tr>
                                );
                              }
                              return list.map(v => {
                                const isOverdue = v.paymentStatus === 'unpaid' && v.dueDate < today;
                                const categoryIcon = (() => {
                                  switch (v.category) {
                                    case 'stationery': return <BookOpen size={14} className="text-purple-500" />;
                                    case 'solar_energy': return <Sun size={14} className="text-amber-500" />;
                                    case 'electricity': return <Zap size={14} className="text-yellow-500" />;
                                    case 'water': return <Droplet size={14} className="text-sky-500" />;
                                    case 'taxes': return <Landmark size={14} className="text-rose-500" />;
                                    case 'insurance': return <ShieldCheck size={14} className="text-blue-500" />;
                                    case 'security_maintenance':
                                    case 'security_guarding':
                                    case 'facility_maintenance': return <Shield size={14} className="text-emerald-600" />;
                                    case 'works_renovation': return <Hammer size={14} className="text-amber-600" />;
                                    case 'machine_management': return <Cpu size={14} className="text-teal-500" />;
                                    case 'reforestation': return <Sprout size={14} className="text-emerald-500" />;
                                    case 'catering': return <Utensils size={14} className="text-orange-500" />;
                                    case 'training': return <Award size={14} className="text-emerald-500" />;
                                    case 'social_events': return <Sparkles size={14} className="text-pink-500" />;
                                    case 'exam_def': return <GraduationCap size={14} className="text-indigo-600" />;
                                    case 'exam_bac': return <GraduationCap size={14} className="text-violet-600" />;
                                    case 'internet': return <Wifi size={14} className="text-cyan-500" />;
                                    case 'furniture': return <FileText size={14} className="text-amber-600" />;
                                    case 'social_cases': return <Heart size={14} className="text-rose-500 fill-rose-500/10" />;
                                    default: return <Receipt size={14} className="text-slate-500" />;
                                  }
                                })();

                                return (
                                  <tr key={v.id} className={`${currentTheme.rowHover} transition-all ${isOverdue ? 'bg-rose-50/10 hover:bg-rose-50/20' : ''}`}>
                                    <td className="px-8 py-6">
                                      <span className="inline-flex items-center gap-2 px-3 py-1 bg-slate-100 rounded-full text-[10px] font-black uppercase tracking-widest text-slate-700">
                                        {categoryIcon}
                                        {t[v.category] || v.category}
                                      </span>
                                    </td>
                                    <td className="px-8 py-6">
                                      <div className="flex flex-col">
                                        <span className={`text-sm font-bold ${currentTheme.isDark ? 'text-white' : 'text-slate-800'}`}>{v.vendorName}</span>
                                        {v.category === 'social_cases' && (
                                          <div className="mt-1 flex flex-wrap items-center gap-2 text-xs">
                                            {v.aidType && (
                                              <span className="inline-block px-2 py-0.5 bg-rose-50 dark:bg-rose-950/40 text-rose-600 dark:text-rose-400 font-extrabold rounded-md text-[10px] tracking-wider uppercase">
                                                ❤️ {t[v.aidType] || v.aidType}
                                              </span>
                                            )}
                                            {v.beneficiaryStudentName && (
                                              <span className={`${currentTheme.muted} font-medium`}>
                                                {lang === 'en' ? 'Student: ' : 'Élève : '}<strong>{v.beneficiaryStudentName}</strong>
                                                {v.beneficiaryStudentGrade && ` (${getGradeDisplay(v.beneficiaryStudentGrade, lang)})`}
                                              </span>
                                            )}
                                          </div>
                                        )}
                                        {v.description && <span className={`text-xs ${currentTheme.muted} mt-0.5`}>{v.description}</span>}
                                      </div>
                                    </td>
                                    <td className="px-8 py-6 text-right">
                                      <span className={`text-sm font-black ${currentTheme.isDark ? 'text-[#E2E8F0]' : 'text-slate-700'}`}>{formatCurrency(v.amount)}</span>
                                    </td>
                                    <td className="px-8 py-6 text-right">
                                      <span className="text-sm text-slate-500">{formatCurrency(v.amountPaid || 0)}</span>
                                    </td>
                                    <td className="px-8 py-6">
                                      <span className={`text-sm font-bold flex items-center gap-1.5 ${isOverdue ? 'text-rose-600 font-extrabold' : (currentTheme.isDark ? 'text-[#CBD5E1]' : 'text-slate-600')}`}>
                                        {isOverdue && <AlertCircle size={14} className="animate-bounce" />}
                                        {v.dueDate}
                                        {isOverdue && <span className="text-[10px] uppercase font-black tracking-widest ml-1">{lang === 'en' ? 'OVERDUE' : 'EN RETARD'}</span>}
                                      </span>
                                    </td>
                                    <td className="px-8 py-6">
                                      {v.paymentStatus === 'paid' && (
                                        <span className="px-3 py-1 bg-emerald-50 text-emerald-700 border border-emerald-100 rounded-full text-[10px] font-black uppercase tracking-widest">
                                          {t.fullyPaid}
                                        </span>
                                      )}
                                      {v.paymentStatus === 'partial' && (
                                        <span className="px-3 py-1 bg-amber-50 text-amber-700 border border-amber-100 rounded-full text-[10px] font-black uppercase tracking-widest">
                                          {t.partialPaid}
                                        </span>
                                      )}
                                      {v.paymentStatus === 'unpaid' && (
                                        <span className={`px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-widest border ${isOverdue ? 'bg-rose-500 text-white border-rose-600 animate-pulse' : 'bg-rose-50 text-rose-700 border-rose-100'}`}>
                                          {t.unpaid}
                                        </span>
                                      )}
                                    </td>
                                    <td className="px-8 py-6 text-right no-print">
                                      <div className="flex justify-end gap-3">
                                        <button 
                                          onClick={() => {
                                            setEditingVendorExpense(v);
                                            setVendorExpenseForm({
                                              vendorName: v.vendorName,
                                              category: v.category,
                                              amount: v.amount.toString(),
                                              dueDate: v.dueDate,
                                              paymentStatus: v.paymentStatus,
                                              amountPaid: (v.amountPaid || 0).toString(),
                                              description: v.description || '',
                                              aidType: v.aidType || '' as any,
                                              beneficiaryStudentName: v.beneficiaryStudentName || '',
                                              beneficiaryStudentGrade: v.beneficiaryStudentGrade || '',
                                            });
                                            setShowVendorExpenseModal(true);
                                          }}
                                          className="p-2 text-slate-400 hover:text-blue-600 hover:bg-slate-50 rounded-xl transition-all"
                                          title={lang === 'en' ? "Edit Expense" : "Modifier la dépense"}
                                        >
                                          <FileText size={16} />
                                        </button>
                                        <button 
                                          onClick={() => {
                                            const confirmMsg = lang === 'en'
                                              ? `Are you sure you want to delete this expense for "${v.vendorName}"?`
                                              : `Êtes-vous sûr de vouloir supprimer cette dépense pour "${v.vendorName}" ?`;
                                            if (confirm(confirmMsg)) {
                                              handleDeleteVendorExpense(v.id);
                                            }
                                          }}
                                          className="p-2 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-xl transition-all"
                                          title={lang === 'en' ? "Delete Expense" : "Supprimer la dépense"}
                                        >
                                          <Trash2 size={16} />
                                        </button>
                                      </div>
                                    </td>
                                  </tr>
                                );
                              });
                            })()}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  </>
                );
              })()}
            </div>
          </div>
        )}

        {/* --- Calendar View --- */}
        {activeTab === 'calendar' && (
          <div className="space-y-8">
            <div className="flex justify-between items-center no-print">
              <div className="flex items-center gap-4">
                <button 
                  onClick={() => changeMonth(-1)}
                  className={`p-2 rounded-xl ${currentTheme.isDark ? 'bg-emerald-900/20 text-emerald-500' : 'bg-slate-100 text-slate-600'} hover:bg-blue-600 hover:text-white transition-all`}
                >
                  <ChevronLeft size={20} />
                </button>
                <h3 className={`text-2xl font-bold ${currentTheme.isDark ? 'text-emerald-400' : 'text-slate-800'} min-w-[200px] text-center`}>
                  {getMonthName(calendarDate.getMonth())} {calendarDate.getFullYear()}
                </h3>
                <button 
                  onClick={() => changeMonth(1)}
                  className={`p-2 rounded-xl ${currentTheme.isDark ? 'bg-emerald-900/20 text-emerald-500' : 'bg-slate-100 text-slate-600'} hover:bg-blue-600 hover:text-white transition-all`}
                >
                  <ChevronRight size={20} />
                </button>
              </div>
              <button 
                onClick={() => setCalendarDate(new Date())}
                className={`px-6 py-2 rounded-xl border ${currentTheme.border} ${currentTheme.muted} font-bold text-sm hover:bg-slate-50 transition-all`}
              >
                {t.today}
              </button>
            </div>

            <div className={`${currentTheme.card} rounded-[2.5rem] border ${currentTheme.border} shadow-xl overflow-hidden`}>
              <div className={`grid grid-cols-7 border-b ${currentTheme.border} ${currentTheme.isDark ? 'bg-emerald-900/20' : 'bg-slate-50/50'}`}>
                {[0, 1, 2, 3, 4, 5, 6].map(i => (
                  <div key={i} className={`py-4 text-center text-[10px] font-black uppercase tracking-widest ${currentTheme.muted}`}>
                    {getDayName(i)}
                  </div>
                ))}
              </div>
              <div className="grid grid-cols-7">
                {getDaysInMonth(calendarDate).map((day, i) => {
                  const events = getEventsForDay(day.date);
                  const isToday = day.date.toDateString() === new Date().toDateString();
                  
                  return (
                    <div 
                      key={i}
                      onClick={() => {
                        setSelectedCalendarDay(day.date);
                        setShowCalendarModal(true);
                      }}
                      className={`min-h-[120px] p-4 border-b border-r ${currentTheme.border} cursor-pointer hover:bg-blue-50/30 transition-all relative ${!day.isCurrentMonth ? 'opacity-30' : ''}`}
                    >
                      <span className={`text-sm font-bold ${isToday ? 'bg-blue-600 text-white w-7 h-7 flex items-center justify-center rounded-full' : (currentTheme.isDark ? 'text-emerald-500' : 'text-slate-800')}`}>
                        {day.date.getDate()}
                      </span>
                      
                      <div className="mt-2 space-y-1">
                        {events.map((event, idx) => (
                          <div 
                            key={idx}
                            className={`flex items-center gap-1.5 px-2 py-1 rounded-lg text-[8px] font-black uppercase tracking-widest ${
                              event.type === 'due' ? 'bg-rose-100 text-rose-600' :
                              event.type === 'salary' ? 'bg-emerald-100 text-emerald-600' :
                              'bg-blue-100 text-blue-600'
                            }`}
                          >
                            <div className={`w-1.5 h-1.5 rounded-full ${
                              event.type === 'due' ? 'bg-rose-500' :
                              event.type === 'salary' ? 'bg-emerald-500' :
                              'bg-blue-500'
                            }`} />
                            {event.count}
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}

        {/* --- Notes View --- */}
        {activeTab === 'notes' && (
          <div className="max-w-4xl space-y-8">
            <div className={`${currentTheme.card} p-10 rounded-[2.5rem] border ${currentTheme.border} shadow-xl shadow-slate-200/50`}>
              <div className="flex items-center gap-4 mb-8">
                <div className={`p-4 ${currentTheme.isDark ? 'bg-emerald-900/20 text-emerald-500' : 'bg-slate-100 text-slate-600'} rounded-3xl`}>
                  <StickyNote size={32} />
                </div>
                <div>
                  <h3 className={`text-2xl font-black ${currentTheme.isDark ? 'text-emerald-400' : 'text-slate-800'}`}>{t.notes}</h3>
                  <p className={currentTheme.muted}>{lang === 'en' ? 'Manage your personal accounting notes' : 'Gérez vos notes comptables personnelles'}</p>
                </div>
              </div>
              
              <div className="space-y-6">
                <form onSubmit={handleAddTodo} className="flex gap-4">
                  <input 
                    type="text"
                    value={todoInput}
                    onChange={(e) => setTodoInput(e.target.value)}
                    placeholder={t.taskPlaceholder}
                    className={`flex-1 px-6 py-4 ${currentTheme.isDark ? 'bg-emerald-900/10' : 'bg-slate-50'} border ${currentTheme.border} rounded-2xl focus:outline-none focus:ring-4 focus:ring-blue-500/5 focus:border-blue-500 transition-all text-sm font-semibold ${currentTheme.isDark ? 'text-emerald-500' : 'text-slate-800'}`}
                  />
                  <button 
                    type="submit"
                    className="bg-blue-600 hover:bg-blue-700 text-white px-8 py-4 rounded-2xl font-black text-sm transition-all flex items-center gap-2 shadow-lg shadow-blue-500/20"
                  >
                    <Plus size={20} />
                    {t.addTask}
                  </button>
                </form>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {todos.map(todo => (
                    <motion.div 
                      layout
                      key={todo.id}
                      className={`p-6 rounded-3xl border ${currentTheme.border} ${currentTheme.card} shadow-sm flex items-center justify-between group`}
                    >
                      <div className="flex items-center gap-4">
                        <button 
                          onClick={() => toggleTodo(todo.id)}
                          className={`w-6 h-6 rounded-lg border-2 flex items-center justify-center transition-all ${todo.completed ? 'bg-emerald-500 border-emerald-500 text-white' : 'border-slate-200 hover:border-blue-400'}`}
                        >
                          {todo.completed && <CheckCircle2 size={14} />}
                        </button>
                        <span className={`text-sm font-bold ${todo.completed ? 'line-through text-slate-300' : (currentTheme.isDark ? 'text-emerald-500' : 'text-slate-700')}`}>
                          {todo.text}
                        </span>
                      </div>
                      <button 
                        onClick={() => deleteTodo(todo.id)}
                        className="p-2 text-rose-400 hover:bg-rose-50 rounded-xl transition-all opacity-0 group-hover:opacity-100"
                      >
                        <Trash2 size={18} />
                      </button>
                    </motion.div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* --- Audit Trail View --- */}
        {activeTab === 'audit' && (
          <div className="space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div>
                <h2 className="text-xl font-black tracking-tight flex items-center gap-2">
                  <ShieldCheck className="text-emerald-500" size={24} />
                  <span>{lang === 'en' ? 'System Audit Trail & Security Logs' : 'Journal d\'Audit & Sécurité Système'}</span>
                </h2>
                <p className={`text-xs ${currentTheme.muted} mt-1`}>
                  {lang === 'en' 
                    ? 'Tamper-evident activity log tracking payments, expenses, and staff actions in Bamako.' 
                    : 'Registre d\'activités sécurisé traçant les paiements, dépenses et actions des caissiers.'}
                </p>
              </div>
              <button
                onClick={() => fetchAuditLogs()}
                className="px-4 py-2 bg-slate-800 hover:bg-slate-900 text-white rounded-xl text-xs font-bold transition-all shadow-sm flex items-center gap-2 self-start sm:self-auto active:scale-95"
              >
                <span>{lang === 'en' ? 'Refresh Logs' : 'Actualiser le Journal'}</span>
              </button>
            </div>

            <div className={`${currentTheme.card} border ${currentTheme.border} rounded-2xl overflow-hidden shadow-sm`}>
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className={`${currentTheme.isDark ? 'bg-emerald-900/20' : 'bg-slate-50/50'} ${currentTheme.muted} text-[10px] font-black uppercase tracking-[0.2em]`}>
                      <th className="px-6 py-4">{lang === 'en' ? 'Timestamp' : 'Horodatage'}</th>
                      <th className="px-6 py-4">{lang === 'en' ? 'Staff User' : 'Utilisateur / Caissier'}</th>
                      <th className="px-6 py-4">{lang === 'en' ? 'Action' : 'Action'}</th>
                      <th className="px-6 py-4">{lang === 'en' ? 'Details' : 'Détails de l\'Opération'}</th>
                    </tr>
                  </thead>
                  <tbody className={`divide-y ${currentTheme.border}`}>
                    {auditLogs.length > 0 ? (
                      auditLogs.map((log) => {
                        const isPayment = log.action === 'RECORD_PAYMENT';
                        const isExpense = log.action === 'ADD_EXPENSE' || log.action === 'ADD_VENDOR_EXPENSE';
                        const isDelete = log.action.includes('DELETE');

                        const badgeColor = isPayment
                          ? 'bg-emerald-500/10 text-emerald-600 border-emerald-500/20'
                          : isExpense
                          ? 'bg-amber-500/10 text-amber-600 border-amber-500/20'
                          : isDelete
                          ? 'bg-rose-500/10 text-rose-600 border-rose-500/20'
                          : 'bg-blue-500/10 text-blue-600 border-blue-500/20';

                        return (
                          <tr key={log.id} className={`${currentTheme.rowHover} transition-all`}>
                            <td className="px-6 py-4 whitespace-nowrap">
                              <span className={`text-xs font-mono ${currentTheme.muted}`}>
                                {new Date(log.createdAt).toLocaleString(lang === 'fr' ? 'fr-FR' : 'en-US')}
                              </span>
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap">
                              <div className="flex flex-col">
                                <span className={`text-xs font-bold ${currentTheme.text}`}>{log.userName || 'Staff'}</span>
                                <span className="text-[10px] text-slate-400 font-mono">{log.userEmail}</span>
                              </div>
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap">
                              <span className={`text-[10px] font-black tracking-wider uppercase px-2.5 py-1 rounded-full border ${badgeColor}`}>
                                {log.action}
                              </span>
                            </td>
                            <td className="px-6 py-4">
                              <span className={`text-xs font-medium ${currentTheme.text}`}>{log.details || '—'}</span>
                            </td>
                          </tr>
                        );
                      })
                    ) : (
                      <tr>
                        <td colSpan={4} className="px-6 py-12 text-center text-slate-400 italic">
                          {lang === 'en' ? 'No audit log entries recorded yet.' : 'Aucune entrée dans le journal d\'audit.'}
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* --- Settings View --- */}
        {activeTab === 'settings' && (
          <div className="max-w-2xl space-y-8">
            <div className={`${currentTheme.card} p-10 rounded-[2.5rem] border ${currentTheme.border} shadow-xl shadow-slate-200/50`}>
              <h3 className={`text-xl font-bold ${currentTheme.isDark ? 'text-emerald-400' : 'text-slate-800'} mb-8`}>Localization & Preferences</h3>
              <div className="space-y-6">
                <div className={`flex items-center justify-between p-6 ${currentTheme.isDark ? 'bg-emerald-900/10' : 'bg-slate-50'} rounded-3xl`}>
                  <div className="flex items-center gap-4">
                    <div className={`p-3 ${currentTheme.card} rounded-2xl text-blue-600 shadow-sm`}>
                      <Globe size={20} />
                    </div>
                    <div>
                      <p className={`font-bold ${currentTheme.isDark ? 'text-emerald-500' : 'text-slate-800'}`}>{lang === 'en' ? 'System Language' : 'Langue du Système'}</p>
                      <p className={`text-xs ${currentTheme.muted}`}>{lang === 'en' ? 'Change the interface language' : 'Changer la langue de l\'interface'}</p>
                    </div>
                  </div>
                  <button 
                    onClick={() => toggleLanguage(lang === 'en' ? 'fr' : 'en')}
                    className={`px-6 py-2 ${currentTheme.card} border ${currentTheme.border} rounded-xl text-sm font-bold ${currentTheme.isDark ? 'text-emerald-500' : 'text-slate-700'} hover:bg-slate-50 transition-all`}
                  >
                    {lang === 'en' ? 'English' : 'Français'}
                  </button>
                </div>
                
                <div className={`flex items-center justify-between p-6 ${currentTheme.isDark ? 'bg-emerald-900/10' : 'bg-slate-50'} rounded-3xl`}>
                  <div className="flex items-center gap-4">
                    <div className={`p-3 ${currentTheme.card} rounded-2xl text-emerald-600 shadow-sm`}>
                      <DollarSign size={20} />
                    </div>
                    <div>
                      <p className={`font-bold ${currentTheme.isDark ? 'text-emerald-500' : 'text-slate-800'}`}>Currency Format</p>
                      <p className={`text-xs ${currentTheme.muted}`}>Current: {t.currency}</p>
                    </div>
                  </div>
                  <span className={`text-xs font-black ${currentTheme.muted} uppercase tracking-widest`}>Auto-detected</span>
                </div>

                {/* Theme Selection */}
                <div className="space-y-4 pt-4 border-t border-slate-100">
                  <h4 className={`text-sm font-black ${currentTheme.muted} uppercase tracking-widest`}>{t.themeSettings}</h4>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
                    {[
                      { id: 'navy', label: t.corporateNavy, color: 'bg-[#0f172a]' },
                      { id: 'emerald', label: t.emeraldGreen, color: 'bg-[#064E3B]' },
                      { id: 'cream', label: t.warmCreamLedger, color: 'bg-[#FDFBF7]' },
                      { id: 'bordeaux', label: t.bordeauxRed, color: 'bg-[#881337]' },
                      { id: 'slate', label: t.slateSlate, color: 'bg-[#1E293B]' },
                      { id: 'midnight', label: t.midnightDark, color: 'bg-[#030712]' }
                    ].map((tOption) => (
                      <button
                        key={tOption.id}
                        onClick={() => setTheme(tOption.id as any)}
                        className={`p-4 rounded-2xl border-2 transition-all flex flex-col items-center gap-3 ${
                          theme === tOption.id 
                            ? 'border-emerald-600 bg-emerald-500/10 shadow-md ring-2 ring-emerald-500/30' 
                            : `${currentTheme.border} ${currentTheme.isDark ? 'hover:bg-emerald-900/10' : 'hover:bg-slate-50'}`
                        }`}
                      >
                        <div className={`w-10 h-10 rounded-full ${tOption.color} border border-slate-200 shadow-inner flex items-center justify-center`}>
                          {theme === tOption.id && <span className="text-white text-xs">✓</span>}
                        </div>
                        <span className={`text-xs font-bold ${currentTheme.isDark ? 'text-emerald-500' : 'text-slate-800'} text-center`}>{tOption.label}</span>
                      </button>
                    ))}
                  </div>
                </div>

                {/* Logo Upload */}
                <div className={`space-y-4 pt-4 border-t ${currentTheme.border}`}>
                  <h4 className={`text-sm font-black ${currentTheme.muted} uppercase tracking-widest`}>{t.uploadLogo}</h4>
                  <div className="flex items-center gap-6">
                    <div 
                      onClick={() => logoInputRef.current?.click()}
                      className={`w-24 h-24 rounded-3xl border-2 border-dashed ${currentTheme.border} flex flex-col items-center justify-center cursor-pointer hover:border-blue-400 transition-all overflow-hidden relative group`}
                    >
                      {schoolLogo ? (
                        <>
                          <img src={schoolLogo} alt="Logo" className="w-full h-full object-contain p-2" />
                          <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                            <UploadCloud size={20} className="text-white" />
                          </div>
                        </>
                      ) : (
                        <>
                          <UploadCloud size={24} className={currentTheme.muted} />
                          <span className={`text-[10px] ${currentTheme.muted} mt-2 font-bold`}>Upload</span>
                        </>
                      )}
                    </div>
                    <div className="flex-1">
                      <p className={`text-sm font-bold ${currentTheme.isDark ? 'text-emerald-500' : 'text-slate-800'}`}>{t.logoAccentColor}</p>
                      <p className={`text-xs ${currentTheme.muted} mb-4`}>{t.headerSync}</p>
                      {logoColor && (
                        <div className="flex items-center gap-3">
                          <div 
                            className="w-8 h-8 rounded-lg border border-white/20 shadow-sm" 
                            style={{ backgroundColor: logoColor }}
                          />
                          <span className={`text-xs font-mono font-bold ${currentTheme.muted}`}>{logoColor.toUpperCase()}</span>
                          <button 
                            onClick={() => { setSchoolLogo(null); setLogoColor(null); }}
                            className="text-xs text-rose-500 font-bold hover:underline"
                          >
                            Reset
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                  <input 
                    type="file" 
                    ref={logoInputRef}
                    onChange={handleLogoUpload}
                    accept="image/*"
                    className="hidden"
                  />
                </div>

                {/* Backup & Export */}
                <div className={`space-y-4 pt-8 border-t ${currentTheme.border}`}>
                  <h4 className={`text-sm font-black ${currentTheme.muted} uppercase tracking-widest`}>{t.backupSettings}</h4>
                  <div className={`p-8 ${currentTheme.isDark ? 'bg-emerald-900/10' : 'bg-slate-50'} rounded-[2.5rem] border ${currentTheme.border} flex flex-col md:flex-row items-center justify-between gap-6`}>
                    <div className="flex items-center gap-4">
                      <div className={`p-4 ${currentTheme.card} rounded-3xl text-blue-600 shadow-lg`}>
                        <UploadCloud size={32} />
                      </div>
                      <div>
                        <p className={`text-lg font-black ${currentTheme.isDark ? 'text-emerald-500' : 'text-slate-800'}`}>{t.exportData}</p>
                        <p className={`text-xs ${currentTheme.muted}`}>{lang === 'en' ? 'Download a full backup of your school data in Excel format.' : 'Téléchargez une sauvegarde complète de vos données scolaires au format Excel.'}</p>
                      </div>
                    </div>
                    <button 
                      onClick={handleExportAllData}
                      className="bg-slate-800 hover:bg-slate-900 text-white px-8 py-4 rounded-2xl font-black text-sm transition-all flex items-center gap-2 shadow-xl shadow-slate-800/20 active:scale-[0.98]"
                    >
                      <Download size={20} />
                      {t.exportData}
                    </button>
                  </div>
                </div>
                {/* Classes & Sections Configuration Card */}
                <div className={`space-y-4 pt-8 border-t ${currentTheme.border}`}>
                  <div className="flex items-center justify-between">
                    <div>
                      <h4 className={`text-base font-black ${currentTheme.isDark ? 'text-emerald-400' : 'text-slate-800'} flex items-center gap-2`}>
                        <Layers size={20} className="text-blue-500" />
                        {lang === 'en' ? 'Classes & Grade Levels Management' : 'Gestion des Classes & Niveaux Scolaires'}
                      </h4>
                      <p className={`text-xs ${currentTheme.muted} mt-0.5`}>
                        {lang === 'en' 
                          ? 'Add sections (1A, 1B, 1C, 1D, 2A, 7B...) or custom grades across school cycles.' 
                          : 'Ajoutez des sections (1A, 1B, 1C, 1D, 2A, 7B...) ou classes personnalisées par cycle.'}
                      </p>
                    </div>
                    <button
                      onClick={() => setShowAddClassModal(true)}
                      className="px-4 py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs rounded-xl shadow-md transition-all flex items-center gap-1.5 active:scale-95"
                    >
                      <Plus size={14} />
                      <span>{lang === 'en' ? 'Add Class / Section' : 'Ajouter une classe'}</span>
                    </button>
                  </div>

                  <div className={`p-6 rounded-[2rem] border ${currentTheme.border} ${currentTheme.isDark ? 'bg-emerald-900/10' : 'bg-slate-50'} space-y-4`}>
                    <div>
                      <div className="flex items-center justify-between mb-2">
                        <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">
                          {lang === 'en' ? 'First Cycle (1st to 6th Year)' : 'Premier Cycle (1ère à 6ème Année)'}
                        </p>
                        <span className="text-[10px] font-bold text-slate-400">
                          {availableClasses.filter(c => c.cycle === 'cycle1').length} {lang === 'en' ? 'classes' : 'classes'}
                        </span>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {availableClasses.filter(c => c.cycle === 'cycle1').map(c => (
                          <span key={c.id} className="px-3 py-1 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs font-bold text-slate-800 dark:text-emerald-400 shadow-sm flex items-center gap-1.5">
                            <span>{c.id}</span>
                            <span className="text-[10px] text-slate-400 font-normal">({c.section})</span>
                          </span>
                        ))}
                      </div>
                    </div>

                    <div className="pt-3 border-t border-slate-200/50 dark:border-slate-800">
                      <div className="flex items-center justify-between mb-2">
                        <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">
                          {lang === 'en' ? 'Second Cycle (7th to 9th Year)' : 'Second Cycle (7ème à 9ème Année)'}
                        </p>
                        <span className="text-[10px] font-bold text-slate-400">
                          {availableClasses.filter(c => c.cycle === 'cycle2').length} {lang === 'en' ? 'classes' : 'classes'}
                        </span>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {availableClasses.filter(c => c.cycle === 'cycle2').map(c => (
                          <span key={c.id} className="px-3 py-1 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs font-bold text-slate-800 dark:text-emerald-400 shadow-sm flex items-center gap-1.5">
                            <span>{c.id}</span>
                            <span className="text-[10px] text-slate-400 font-normal">({c.section})</span>
                          </span>
                        ))}
                      </div>
                    </div>

                    {availableClasses.some(c => c.cycle !== 'cycle1' && c.cycle !== 'cycle2') && (
                      <div className="pt-3 border-t border-slate-200/50 dark:border-slate-800">
                        <div className="flex items-center justify-between mb-2">
                          <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">
                            {lang === 'en' ? 'Other & Custom Classes' : 'Autres & Classes Personnalisées'}
                          </p>
                          <span className="text-[10px] font-bold text-slate-400">
                            {availableClasses.filter(c => c.cycle !== 'cycle1' && c.cycle !== 'cycle2').length}
                          </span>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          {availableClasses.filter(c => c.cycle !== 'cycle1' && c.cycle !== 'cycle2').map(c => (
                            <span key={c.id} className="px-3 py-1 bg-blue-50 dark:bg-blue-900/30 border border-blue-200 dark:border-blue-800 rounded-xl text-xs font-bold text-blue-700 dark:text-blue-300 shadow-sm flex items-center gap-1.5">
                              <span>{c.id}</span>
                            </span>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                {/* User & Role Management (Exclusive to Admin / Promoter / Dev settings) */}
                <div className={`space-y-6 pt-8 border-t ${currentTheme.border}`}>
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                    <div>
                      <h4 className={`text-base font-black ${currentTheme.isDark ? 'text-emerald-400' : 'text-slate-800'} flex items-center gap-2`}>
                        <ShieldCheck size={20} className="text-emerald-500" />
                        {lang === 'en' ? 'Staff Access & Role Management' : 'Gestion des Rôles & Accès du Personnel'}
                      </h4>
                      <p className={`text-xs ${currentTheme.muted} mt-0.5`}>
                        {lang === 'en' 
                          ? 'Assign or adjust permissions for administrators, general managers, and accountants.' 
                          : 'Gérez et modifiez les autorisations de la direction, des gestionnaires et des économes.'}
                      </p>
                    </div>
                    
                    <div className="flex items-center gap-2">
                      <button 
                        onClick={() => auth.fetchAllProfiles().then(profiles => setUserProfiles(profiles))}
                        className={`p-2.5 rounded-xl border ${currentTheme.border} ${currentTheme.card} ${currentTheme.isDark ? 'text-emerald-400 hover:text-emerald-300 hover:bg-white/5' : 'text-slate-600 hover:text-slate-900 hover:bg-slate-50'} transition-all text-xs font-bold flex items-center gap-1.5 shadow-sm`}
                        title={lang === 'en' ? 'Refresh user list' : 'Actualiser la liste'}
                      >
                        <span>↻</span>
                        <span className="hidden sm:inline">{lang === 'en' ? 'Refresh' : 'Actualiser'}</span>
                      </button>

                      <button
                        onClick={() => {
                          setNewUserForm({ fullName: '', email: '', password: '', role: 'staff' });
                          setShowAddUserModal(true);
                        }}
                        className="bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-2.5 rounded-xl text-xs font-black transition-all flex items-center gap-2 shadow-lg shadow-emerald-600/20 active:scale-95"
                      >
                        <UserPlus size={16} />
                        <span>{lang === 'en' ? '+ Add Staff Account' : '+ Ajouter un Compte'}</span>
                      </button>
                    </div>
                  </div>

                  {/* Role Definitions & Stats Banner */}
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div className={`p-4 rounded-2xl border ${currentTheme.border} ${currentTheme.isDark ? 'bg-emerald-950/20 border-emerald-500/30' : 'bg-emerald-50/70 border-emerald-200'}`}>
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-[10px] font-black uppercase tracking-wider text-emerald-600 dark:text-emerald-400 flex items-center gap-1.5">
                          <span>👑</span> {lang === 'en' ? 'Promoter & Admins' : 'Promotrice & Direction'}
                        </span>
                        <span className="text-xs font-black bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 px-2 py-0.5 rounded-full">
                          {userProfiles.filter(p => p.role === 'admin').length}
                        </span>
                      </div>
                      <p className={`text-[11px] ${currentTheme.isDark ? 'text-emerald-300/80' : 'text-emerald-800'}`}>
                        {lang === 'en' ? 'Full control, fee policy, closing school years & role assignment.' : 'Accès total, politique tarifaire, clôture annuelle & gestion des rôles.'}
                      </p>
                    </div>

                    <div className={`p-4 rounded-2xl border ${currentTheme.border} ${currentTheme.isDark ? 'bg-blue-950/20 border-blue-500/30' : 'bg-blue-50/70 border-blue-200'}`}>
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-[10px] font-black uppercase tracking-wider text-blue-600 dark:text-blue-400 flex items-center gap-1.5">
                          <span>💼</span> {lang === 'en' ? 'Staff & Accountants' : 'Personnel & Économes'}
                        </span>
                        <span className="text-xs font-black bg-blue-500/20 text-blue-600 dark:text-blue-400 px-2 py-0.5 rounded-full">
                          {userProfiles.filter(p => p.role === 'staff').length}
                        </span>
                      </div>
                      <p className={`text-[11px] ${currentTheme.isDark ? 'text-blue-300/80' : 'text-blue-800'}`}>
                        {lang === 'en' ? 'Student enrollment, payment receipts, payroll & daily expenses.' : 'Inscriptions, encaissements, reçus de scolarité & dépenses.'}
                      </p>
                    </div>

                    <div className={`p-4 rounded-2xl border ${currentTheme.border} ${currentTheme.isDark ? 'bg-purple-950/20 border-purple-500/30' : 'bg-purple-50/70 border-purple-200'}`}>
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-[10px] font-black uppercase tracking-wider text-purple-600 dark:text-purple-400 flex items-center gap-1.5">
                          <span>⚡</span> {lang === 'en' ? 'Engineering (Dev)' : 'Développeur (Dev)'}
                        </span>
                        <span className="text-xs font-black bg-purple-500/20 text-purple-600 dark:text-purple-400 px-2 py-0.5 rounded-full">
                          {userProfiles.filter(p => p.role === 'dev').length}
                        </span>
                      </div>
                      <p className={`text-[11px] ${currentTheme.isDark ? 'text-purple-300/80' : 'text-purple-800'}`}>
                        {lang === 'en' ? 'Technical system maintenance and database migrations.' : 'Maintenance technique, sécurité et synchronisation réseau.'}
                      </p>
                    </div>
                  </div>

                  {/* Filter & Search Bar */}
                  <div className="flex flex-col sm:flex-row gap-3">
                    <div className="relative flex-1">
                      <input 
                        type="text"
                        value={userSearchTerm}
                        onChange={(e) => setUserSearchTerm(e.target.value)}
                        placeholder={lang === 'en' ? 'Search by name or email...' : 'Rechercher par nom ou email...'}
                        className={`w-full pl-10 pr-4 py-2.5 rounded-xl border ${currentTheme.border} ${currentTheme.isDark ? 'bg-white/5 text-white' : 'bg-slate-50 text-slate-800'} text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-emerald-500/30`}
                      />
                      <Users size={15} className={`absolute left-3.5 top-1/2 -translate-y-1/2 ${currentTheme.muted}`} />
                    </div>

                    <div className="flex items-center gap-1 p-1 bg-white/5 rounded-xl border border-white/10 self-start">
                      {[
                        { id: 'all', label: lang === 'en' ? 'All' : 'Tous' },
                        { id: 'admin', label: lang === 'en' ? 'Admins' : 'Admins' },
                        { id: 'staff', label: lang === 'en' ? 'Staff' : 'Personnel' },
                      ].map((tab) => (
                        <button
                          key={tab.id}
                          onClick={() => setUserRoleFilter(tab.id as any)}
                          className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                            userRoleFilter === tab.id
                              ? 'bg-emerald-600 text-white shadow-sm'
                              : `${currentTheme.muted} hover:text-white`
                          }`}
                        >
                          {tab.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Registered Users Cards */}
                  <div className="space-y-3">
                    {userProfiles
                      .filter(p => {
                        const matchesSearch = !userSearchTerm || 
                          p.fullName.toLowerCase().includes(userSearchTerm.toLowerCase()) || 
                          p.email.toLowerCase().includes(userSearchTerm.toLowerCase());
                        const matchesRole = userRoleFilter === 'all' || p.role === userRoleFilter;
                        return matchesSearch && matchesRole;
                      })
                      .length === 0 ? (
                      <div className={`text-xs ${currentTheme.muted} italic p-8 rounded-2xl text-center border ${currentTheme.border} ${currentTheme.card}`}>
                        {lang === 'en' ? 'No users matching your search.' : 'Aucun utilisateur ne correspond à votre recherche.'}
                      </div>
                    ) : (
                      userProfiles
                        .filter(p => {
                          const matchesSearch = !userSearchTerm || 
                            p.fullName.toLowerCase().includes(userSearchTerm.toLowerCase()) || 
                            p.email.toLowerCase().includes(userSearchTerm.toLowerCase());
                          const matchesRole = userRoleFilter === 'all' || p.role === userRoleFilter;
                          return matchesSearch && matchesRole;
                        })
                        .map(profile => {
                          const isCurrentUser = auth.profile?.id === profile.id;
                          const isDev = profile.role === 'dev';
                          const isAdmin = profile.role === 'admin';
                          const isStaff = profile.role === 'staff';

                          return (
                            <div 
                              key={profile.id} 
                              className={`flex flex-col md:flex-row md:items-center justify-between p-5 ${currentTheme.card} border ${
                                isCurrentUser ? 'border-emerald-500/40 ring-1 ring-emerald-500/20' : currentTheme.border
                              } rounded-2xl gap-4 shadow-sm transition-all hover:border-emerald-500/30`}
                            >
                              <div className="flex items-center gap-4">
                                <div className={`w-12 h-12 rounded-2xl flex items-center justify-center text-white font-black text-sm shadow-md flex-shrink-0 ${
                                  isDev ? 'bg-purple-600 shadow-purple-500/20' :
                                  isAdmin ? 'bg-emerald-600 shadow-emerald-500/20' : 
                                  'bg-blue-600 shadow-blue-500/20'
                                }`}>
                                  {profile.fullName.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase()}
                                </div>
                                <div className="min-w-0">
                                  <div className="flex items-center gap-2 flex-wrap">
                                    <p className={`text-sm font-bold truncate ${currentTheme.isDark ? 'text-white' : 'text-slate-900'}`}>
                                      {profile.fullName}
                                    </p>
                                    {isCurrentUser && (
                                      <span className="px-2 py-0.5 rounded-full text-[9px] font-black uppercase tracking-wider bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
                                        {lang === 'en' ? 'You' : 'Vous (Actif)'}
                                      </span>
                                    )}
                                    <span className={`px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider flex items-center gap-1 ${
                                      isDev 
                                        ? 'bg-purple-500/20 text-purple-400 border border-purple-500/30' 
                                        : isAdmin 
                                        ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30' 
                                        : 'bg-blue-500/20 text-blue-400 border border-blue-500/30'
                                    }`}>
                                      {isDev && <span>⚡</span>}
                                      {isAdmin && <span>👑</span>}
                                      {isStaff && <span>💼</span>}
                                      {isDev 
                                        ? (lang === 'en' ? 'Developer' : 'Développeur')
                                        : isAdmin 
                                        ? (lang === 'en' ? 'Promoter / Admin' : 'Promotrice / Admin') 
                                        : (lang === 'en' ? 'Staff / Accountant' : 'Personnel / Économe')}
                                    </span>
                                  </div>
                                  <p className={`text-xs ${currentTheme.muted} mt-0.5`}>{profile.email}</p>
                                </div>
                              </div>

                              <div className="flex items-center gap-2.5 self-end md:self-auto flex-wrap">
                                {/* Role Selector Dropdown */}
                                {!isDev && (
                                  <div className="flex items-center gap-1.5">
                                    <label className={`text-[10px] font-bold ${currentTheme.muted} hidden sm:inline`}>
                                      {lang === 'en' ? 'Role:' : 'Rôle :'}
                                    </label>
                                    <select
                                      value={profile.role}
                                      disabled={updatingUserId === profile.id}
                                      onChange={(e) => handleUpdateRole(profile, e.target.value as any)}
                                      className={`px-3 py-2 rounded-xl text-xs font-bold border transition-all cursor-pointer ${
                                        isAdmin
                                          ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-500 hover:bg-emerald-500/20'
                                          : 'bg-blue-500/10 border-blue-500/30 text-blue-500 hover:bg-blue-500/20'
                                      } ${updatingUserId === profile.id ? 'opacity-50 cursor-wait' : ''}`}
                                    >
                                      <option value="admin" className="bg-slate-800 text-white">
                                        👑 {lang === 'en' ? 'Promoter / Admin (Full)' : 'Promotrice / Admin (Complet)'}
                                      </option>
                                      <option value="staff" className="bg-slate-800 text-white">
                                        💼 {lang === 'en' ? 'Staff / Accountant' : 'Personnel / Économe'}
                                      </option>
                                    </select>
                                  </div>
                                )}

                                {/* Password Reset Button */}
                                <button
                                  onClick={() => handleSendPasswordReset(profile.email)}
                                  className="px-3 py-2 bg-slate-800 hover:bg-slate-900 text-white rounded-xl text-xs font-bold transition-all shadow-sm active:scale-95 flex items-center gap-1.5 border border-white/10"
                                  title={lang === 'en' ? 'Send Password Reset Email' : 'Envoyer e-mail de réinitialisation du mot de passe'}
                                >
                                  <span>🔑</span>
                                  <span>{lang === 'en' ? 'Reset Pass' : 'Réinit. MDP'}</span>
                                </button>
                              </div>
                            </div>
                          );
                        })
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* --- Yearly Comparison & Archives View --- */}
        {activeTab === 'archives' && (
          <div className="space-y-12 animate-fade-in">
            {/* Print-Only Official Header */}
            <div className="hidden print:block mb-6 p-6 bg-emerald-700 text-white rounded-2xl">
              <div className="flex justify-between items-center">
                <div>
                  <h1 className="text-2xl font-black">COMPLEXE SCOLAIRE MAMA THERA</h1>
                  <p className="text-sm opacity-90">{lang === 'en' ? 'MULTI-YEAR FINANCIAL COMPARISON & ARCHIVES' : 'BILAN MULTI-ANNUEL & ARCHIVES FINANCIÈRES'}</p>
                </div>
                <div className="text-right text-xs opacity-90">
                  <p>Bamako, Mali</p>
                  <p>{new Date().toLocaleDateString(lang === 'en' ? 'en-US' : 'fr-FR', { year: 'numeric', month: 'long', day: 'numeric' })}</p>
                </div>
              </div>
            </div>

            {/* Grid for annual aggregates & multi-year chart */}
            <div className="grid grid-cols-1 xl:grid-cols-2 gap-12">
              {/* Aggregation Table Card */}
              <div className={`${currentTheme.card} p-8 rounded-[2.5rem] border ${currentTheme.border} shadow-xl shadow-slate-200/50`}>
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-8">
                  <div>
                    <h3 className={`text-xl font-bold ${currentTheme.isDark ? 'text-emerald-400' : 'text-slate-800'}`}>
                      {t.annualAggregation}
                    </h3>
                    <p className={`text-xs ${currentTheme.muted} mt-1`}>
                      {lang === 'en' ? 'Summary of all recorded financial years' : 'Résumé de toutes les années financières enregistrées'}
                    </p>
                  </div>
                  <div className="flex items-center gap-3 no-print">
                    <button
                      onClick={() => generateMultiYearReportPdf({
                        academicYears,
                        lockedYears,
                        students,
                        expenses,
                        vendorExpenses,
                        salaryPayments,
                        lang,
                      })}
                      className="px-4 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold transition-all shadow-md shadow-emerald-600/20 flex items-center gap-2 active:scale-95"
                      title={lang === 'en' ? 'Download Multi-Year PDF Report' : 'Télécharger le Bilan Multi-Annuel en PDF'}
                    >
                      <FileText size={16} />
                      <span>{lang === 'en' ? 'Export PDF Report' : 'Exporter Bilan PDF'}</span>
                    </button>
                    <button
                      onClick={handlePrint}
                      className={`p-2.5 rounded-xl border ${currentTheme.border} ${currentTheme.card} ${currentTheme.text} hover:bg-slate-50 transition-all flex items-center gap-1.5 text-xs font-bold shadow-sm active:scale-95`}
                      title={t.printReport}
                    >
                      <Printer size={16} />
                      <span className="hidden sm:inline">{lang === 'en' ? 'Print' : 'Imprimer'}</span>
                    </button>
                  </div>
                </div>

                <div className="overflow-x-auto rounded-3xl border border-slate-100 dark:border-slate-800">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className={`${currentTheme.isDark ? 'bg-slate-800/50 text-slate-300' : 'bg-slate-50 text-slate-600'} text-xs font-black uppercase tracking-wider`}>
                        <th className="px-6 py-4">{t.schoolYear}</th>
                        <th className="px-6 py-4 text-right">{t.totalRevenueArchive}</th>
                        <th className="px-6 py-4 text-right">{t.totalExpensesArchive}</th>
                        <th className="px-6 py-4 text-right">{t.netBalanceArchive}</th>
                        <th className="px-6 py-4 text-center">{lang === 'en' ? 'Status' : 'Statut'}</th>
                      </tr>
                    </thead>
                    <tbody className={`divide-y ${currentTheme.isDark ? 'divide-slate-800' : 'divide-slate-100'} text-sm`}>
                      {academicYears.map(year => {
                        const { revenue, expenses, balance } = getYearStats(year);
                        const isLocked = lockedYears.includes(year);
                        return (
                          <tr key={year} className={`${currentTheme.isDark ? 'hover:bg-slate-800/30' : 'hover:bg-slate-50/50'} transition-all`}>
                            <td className="px-6 py-4 font-bold">{year}</td>
                            <td className="px-6 py-4 text-right font-semibold text-emerald-600">
                              {formatCurrency(revenue)}
                            </td>
                            <td className="px-6 py-4 text-right font-semibold text-rose-600">
                              {formatCurrency(expenses)}
                            </td>
                            <td className={`px-6 py-4 text-right font-black ${balance >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
                              {formatCurrency(balance)}
                            </td>
                            <td className="px-6 py-4 text-center">
                              {isLocked ? (
                                <span className="inline-flex items-center gap-1.5 px-3 py-1 bg-rose-50 text-rose-700 text-xs font-black rounded-full uppercase tracking-wider border border-rose-200">
                                  <Lock size={10} />
                                  {t.lockedTag}
                                </span>
                              ) : (
                                <span className="inline-flex items-center gap-1.5 px-3 py-1 bg-emerald-50 text-emerald-700 text-xs font-black rounded-full uppercase tracking-wider border border-emerald-200">
                                  <span className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-pulse" />
                                  {lang === 'en' ? 'Active' : 'Actuelle'}
                                </span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Multi-Year Comparative Chart Card */}
              <div className={`${currentTheme.card} p-8 rounded-[2.5rem] border ${currentTheme.border} shadow-xl shadow-slate-200/50`}>
                <div className="mb-8">
                  <h3 className={`text-xl font-bold ${currentTheme.isDark ? 'text-emerald-400' : 'text-slate-800'}`}>
                    {t.revenueVsExpenses}
                  </h3>
                  <p className={`text-xs ${currentTheme.muted} mt-1`}>
                    {lang === 'en' ? 'Visual overview of multi-year school performance' : 'Aperçu visuel de la performance scolaire sur plusieurs années'}
                  </p>
                </div>

                <div className="h-[320px] w-full flex items-center justify-center">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart
                      data={academicYears.map(year => {
                        const { revenue, expenses } = getYearStats(year);
                        return {
                          name: year,
                          [lang === 'en' ? 'Revenue' : 'Recettes']: revenue,
                          [lang === 'en' ? 'Expenses' : 'Dépenses']: expenses
                        };
                      })}
                      margin={{ top: 20, right: 30, left: 20, bottom: 5 }}
                    >
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={currentTheme.isDark ? "#334155" : "#E2E8F0"} />
                      <XAxis dataKey="name" stroke={currentTheme.isDark ? "#94A3B8" : "#64748B"} />
                      <YAxis stroke={currentTheme.isDark ? "#94A3B8" : "#64748B"} tickFormatter={(val) => `${val / 1000}k`} />
                      <Tooltip 
                        contentStyle={{ 
                          backgroundColor: currentTheme.isDark ? '#1E293B' : '#FFFFFF', 
                          borderColor: currentTheme.isDark ? '#475569' : '#E2E8F0',
                          borderRadius: '16px',
                          color: currentTheme.isDark ? '#F8FAFC' : '#0F172A'
                        }}
                        formatter={(value: any) => [formatCurrency(Number(value)), '']}
                      />
                      <RechartsLegend />
                      <Bar dataKey={lang === 'en' ? 'Revenue' : 'Recettes'} fill="#10B981" radius={[8, 8, 0, 0]} />
                      <Bar dataKey={lang === 'en' ? 'Expenses' : 'Dépenses'} fill="#EF4444" radius={[8, 8, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </div>

            {/* Ibrahim / Admin - Close Out Current Year Section */}
            {(currentUser?.role === 'admin' || currentUser?.role === 'dev') && (
              <div className={`${currentTheme.card} p-10 rounded-[2.5rem] border-2 border-rose-100 dark:border-rose-950/50 bg-rose-50/20 shadow-xl shadow-rose-100/10 no-print`}>
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-8">
                  <div className="space-y-3 max-w-2xl">
                    <div className="inline-flex items-center gap-2 px-4 py-1.5 bg-rose-50 text-rose-700 text-xs font-black rounded-full uppercase tracking-wider border border-rose-200">
                      <Lock size={12} />
                      {lang === 'en' ? 'Admin Controller' : 'Contrôleur Admin'}
                    </div>
                    <h3 className={`text-2xl font-black text-rose-950 dark:text-rose-400`}>
                      {lang === 'en' ? 'Close Active School Year' : "Clôturer l'Année Scolaire Active"}
                    </h3>
                    <p className={`text-sm text-rose-800 dark:text-rose-300`}>
                      {lang === 'en' 
                        ? `Locking the year '${selectedYear}' will freeze all transactions, payroll, expenses, and student fees for this period. Outstanding parent balances (reliquats) will carry over as opening balances into the next year.`
                        : `Le verrouillage de l'année '${selectedYear}' gèlera toutes les transactions, salaires, dépenses et frais scolaires pour cette période. Les arriérés de paiement des parents (reliquats) seront automatiquement reportés comme soldes d'ouverture dans l'année suivante.`}
                    </p>
                    <ul className="text-xs text-rose-700 space-y-1 list-disc pl-5">
                      <li>
                        {lang === 'en' 
                          ? 'Lock all records for the current year, making them read-only.'
                          : 'Verrouiller tous les enregistrements de l\'année en cours (lecture seule).'}
                      </li>
                      <li>
                        {lang === 'en'
                          ? 'Carry over debts (outstanding parent balances) to the next academic year.'
                          : 'Reporter les dettes impayées des parents en solde d\'ouverture pour l\'année suivante.'}
                      </li>
                      <li>
                        {lang === 'en'
                          ? 'Generate a final, downloadable certified accounting audit report.'
                          : 'Générer un bilan comptable annuel certifié téléchargeable et imprimable.'}
                      </li>
                    </ul>
                  </div>

                  <div className="flex-shrink-0">
                    {lockedYears.includes(selectedYear) ? (
                      <div className="flex flex-col items-center gap-3">
                        <span className="px-6 py-4 bg-rose-100 text-rose-800 font-extrabold rounded-3xl text-sm flex items-center gap-2 border border-rose-200">
                          <CheckCircle2 size={18} />
                          {lang === 'en' ? 'Year is Closed & Archived' : 'Cette Année est Clôturée & Archivée'}
                        </span>
                        <button
                          onClick={() => {
                            setAuditYear(selectedYear);
                            setShowAuditModal(true);
                          }}
                          className={`text-xs font-bold text-slate-600 hover:text-slate-800 hover:underline flex items-center gap-1.5`}
                        >
                          <Printer size={12} />
                          {lang === 'en' ? 'View/Print Final Audit' : 'Voir/Imprimer le Bilan Final'}
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={() => {
                          if (confirm(lang === 'en' 
                            ? `Are you sure you want to CLOSE the active year ${selectedYear}? This action locks the year's data and carries over parent debts.` 
                            : `Êtes-vous sûr de vouloir CLÔTURER l'année active ${selectedYear} ? Cette action verrouille les données de l'année et reporte les arriérés de paiement des parents.`)) {
                            handleCloseCurrentYear();
                          }
                        }}
                        className="bg-rose-600 hover:bg-rose-700 text-white font-extrabold px-8 py-5 rounded-3xl text-sm transition-all flex items-center gap-3 shadow-xl shadow-rose-600/30 active:scale-[0.98]"
                      >
                        <Lock size={18} />
                        {t.closeYear}
                      </button>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
      </main>

      {/* --- Parent Profile Modal --- */}
      <AnimatePresence>
        {selectedStudent && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setSelectedStudent(null)}
              className="absolute inset-0 bg-slate-900/60 backdrop-blur-md"
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.9, y: 40 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 40 }}
              className={`relative ${currentTheme.card} w-full max-w-xl rounded-[3rem] shadow-2xl border ${currentTheme.border} overflow-hidden`}
            >
              {/* Header Banner */}
              <div className="h-24 relative" style={{ backgroundColor: currentTheme.header }}>
                <button 
                  onClick={() => setSelectedStudent(null)}
                  className="absolute top-6 right-6 p-2 bg-white/10 hover:bg-white/20 text-white rounded-2xl transition-all"
                >
                  <X size={20} />
                </button>
              </div>

              {/* Body Content */}
              <div className="px-10 pb-10 pt-4 space-y-6 max-h-[80vh] overflow-y-auto custom-scrollbar">
                {/* --- Student Card Layout --- */}
                <div className={`flex flex-col sm:flex-row items-center gap-6 p-6 rounded-[2.5rem] border ${currentTheme.border} ${currentTheme.isDark ? 'bg-emerald-900/5' : 'bg-slate-50/50'}`}>
                  {/* Photo Placeholder / Image */}
                  <div className={`w-28 h-28 flex-shrink-0 border-2 ${currentTheme.border} rounded-[2rem] overflow-hidden bg-slate-100 flex items-center justify-center relative shadow-inner`}>
                    {selectedStudent.photo ? (
                      <img 
                        src={selectedStudent.photo} 
                        alt={selectedStudent.name} 
                        className="w-full h-full object-cover" 
                        referrerPolicy="no-referrer"
                      />
                    ) : (
                      <div className="text-center">
                        <Users size={32} className="text-slate-400 mx-auto mb-1" />
                        <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest">PHOTO</span>
                      </div>
                    )}
                  </div>

                  {/* Student Essential Text Details */}
                  <div className="flex-1 text-center sm:text-left space-y-2">
                    <div>
                      <span className={`text-[10px] ${currentTheme.muted} font-black uppercase tracking-widest font-mono`}>
                        ID: {selectedStudent.studentId || `MT-2026-${selectedStudent.id.replace('ST', '')}`}
                      </span>
                      <h3 className={`text-2xl font-black ${currentTheme.isDark ? 'text-emerald-400' : 'text-slate-800'} tracking-tight`}>
                        {selectedStudent.name}
                      </h3>
                    </div>

                    <div className="flex flex-wrap items-center justify-center sm:justify-start gap-3">
                      <span className="inline-block px-3 py-1 bg-blue-50 text-blue-600 rounded-xl text-xs font-black uppercase tracking-wider">
                        {getGradeDisplay(selectedStudent.grade, lang)}
                      </span>

                      {/* Status badge: Green for Active, Blue for Graduated, Grey for Left */}
                      {(() => {
                        const statusVal = selectedStudent.status || 'Active';
                        let badgeColors = 'text-emerald-700 bg-emerald-50 border-emerald-100';
                        if (statusVal === 'Graduated') badgeColors = 'text-blue-700 bg-blue-50 border-blue-100';
                        if (statusVal === 'Left') badgeColors = 'text-slate-500 bg-slate-100 border-slate-200';
                        return (
                          <span className={`inline-block px-3 py-1 rounded-xl text-xs font-black uppercase tracking-wider border ${badgeColors}`}>
                            {statusVal}
                          </span>
                        );
                      })()}
                    </div>
                  </div>
                </div>

                {/* --- Custom Tab Bar --- */}
                <div className="flex border-b border-slate-100 no-print gap-2">
                  <button
                    onClick={() => setStudentDetailTab('general')}
                    className={`flex-1 pb-3 text-xs font-black uppercase tracking-wider transition-all border-b-2 text-center ${
                      studentDetailTab === 'general'
                        ? 'border-blue-600 text-blue-600'
                        : `${currentTheme.muted} border-transparent hover:text-slate-600`
                    }`}
                  >
                    {lang === 'en' ? 'General Info' : 'Infos Générales'}
                  </button>
                  <button
                    onClick={() => setStudentDetailTab('parent')}
                    className={`flex-1 pb-3 text-xs font-black uppercase tracking-wider transition-all border-b-2 text-center ${
                      studentDetailTab === 'parent'
                        ? 'border-blue-600 text-blue-600'
                        : `${currentTheme.muted} border-transparent hover:text-slate-600`
                    }`}
                  >
                    {lang === 'en' ? 'Parent & emergency' : 'Parent & Urgence'}
                  </button>
                  <button
                    onClick={() => setStudentDetailTab('medical')}
                    className={`flex-1 pb-3 text-xs font-black uppercase tracking-wider transition-all border-b-2 text-center ${
                      studentDetailTab === 'medical'
                        ? 'border-blue-600 text-blue-600'
                        : `${currentTheme.muted} border-transparent hover:text-slate-600`
                    }`}
                  >
                    {lang === 'en' ? 'Medical / History' : 'Médical & Historique'}
                  </button>
                </div>

                {/* --- Tab Panel Contents --- */}
                <div className="space-y-4">
                  {studentDetailTab === 'general' && (
                    <div className="space-y-4">
                      <div className="grid grid-cols-2 gap-4">
                        <div className={`p-5 ${currentTheme.isDark ? 'bg-emerald-900/10' : 'bg-slate-50'} rounded-2xl`}>
                          <span className={`text-[10px] font-black uppercase tracking-widest ${currentTheme.muted}`}>{lang === 'en' ? 'Enrollment Date' : "Date d'Inscription"}</span>
                          <p className={`text-sm font-bold ${currentTheme.isDark ? 'text-emerald-500' : 'text-slate-800'} mt-1`}>
                            {selectedStudent.enrollmentDate || '2026-07-16'}
                          </p>
                        </div>
                        <div className={`p-5 ${currentTheme.isDark ? 'bg-emerald-900/10' : 'bg-slate-50'} rounded-2xl`}>
                          <span className={`text-[10px] font-black uppercase tracking-widest ${currentTheme.muted}`}>{t.academicYear}</span>
                          <p className={`text-sm font-bold ${currentTheme.isDark ? 'text-emerald-500' : 'text-slate-800'} mt-1`}>
                            {selectedStudent.academicYear || '2025-2026'}
                          </p>
                        </div>
                      </div>

                      <div className="grid grid-cols-3 gap-4">
                        <div className={`p-4 ${currentTheme.isDark ? 'bg-emerald-900/10' : 'bg-slate-50'} rounded-2xl text-center`}>
                          <span className={`text-[9px] font-black uppercase tracking-widest ${currentTheme.muted}`}>{t.totalDue}</span>
                          <p className={`text-xs font-extrabold ${currentTheme.muted} mt-1`}>
                            {formatCurrency(selectedStudent.totalDue)}
                          </p>
                        </div>
                        <div className={`p-4 ${currentTheme.isDark ? 'bg-emerald-900/10' : 'bg-slate-50'} rounded-2xl text-center`}>
                          <span className={`text-[9px] font-black uppercase tracking-widest ${currentTheme.muted}`}>{t.paid}</span>
                          <p className="text-xs font-extrabold text-emerald-600 mt-1">
                            {formatCurrency(selectedStudent.amountPaid)}
                          </p>
                        </div>
                        <div className={`p-4 ${currentTheme.isDark ? 'bg-[#FFF1F2]' : 'bg-rose-50'} rounded-2xl text-center`}>
                          <span className="text-[9px] font-black uppercase tracking-widest text-rose-500">{t.balance}</span>
                          <p className="text-xs font-black text-rose-600 mt-1">
                            {formatCurrency(selectedStudent.totalDue - selectedStudent.amountPaid)}
                          </p>
                        </div>
                      </div>

                      {/* Mini Payment Ledger */}
                      <div className="space-y-2">
                        <span className={`text-[10px] font-black uppercase tracking-widest ${currentTheme.muted}`}>{lang === 'en' ? 'Payment History Ledger' : 'Historique des Paiements'}</span>
                        <div className="space-y-2 max-h-24 overflow-y-auto pr-2 custom-scrollbar">
                          {selectedStudent.payments.length > 0 ? (
                            [...selectedStudent.payments].reverse().map((p, idx) => (
                              <div key={`${p.date}-${p.amount}-${idx}`} className={`flex items-center justify-between p-3 ${currentTheme.isDark ? 'bg-emerald-900/10' : 'bg-slate-50'} rounded-xl text-xs`}>
                                <div className="flex flex-col">
                                  <span className={currentTheme.muted}>{formatDate(p.date)}</span>
                                  {p.receiptNumber && <span className="text-[10px] text-slate-400 font-mono">N° {p.receiptNumber}</span>}
                                </div>
                                <div className="flex items-center gap-3">
                                  <span className="font-bold text-emerald-600">+{formatCurrency(p.amount)}</span>
                                  <button
                                    onClick={() => generatePaymentReceiptPdf({
                                      student: selectedStudent,
                                      payment: p,
                                      lang,
                                      cashierName: currentUser?.name || 'Administration'
                                    })}
                                    className="px-2 py-1 bg-emerald-600 hover:bg-emerald-700 text-white rounded text-[10px] font-bold transition-all shadow-sm flex items-center gap-1"
                                    title={lang === 'en' ? 'Download Receipt PDF' : 'Télécharger Reçu PDF'}
                                  >
                                    📄 {lang === 'en' ? 'Receipt' : 'Reçu'}
                                  </button>
                                </div>
                              </div>
                            ))
                          ) : (
                            <p className={`text-xs ${currentTheme.muted} italic p-2`}>{t.noPayments}</p>
                          )}
                        </div>
                      </div>
                    </div>
                  )}

                  {studentDetailTab === 'parent' && (
                    <div className="space-y-4">
                      {/* Guardian Info Card */}
                      <div className={`p-5 ${currentTheme.isDark ? 'bg-[#1e293b]/50' : 'bg-slate-50'} rounded-2xl space-y-3`}>
                        <h4 className="text-[10px] font-black text-slate-400 uppercase tracking-widest">{t.guardianTitle}</h4>
                        <div className="grid grid-cols-2 gap-4 text-xs">
                          <div>
                            <span className={currentTheme.muted}>{t.parentName}</span>
                            <p className={`font-bold ${currentTheme.isDark ? 'text-emerald-500' : 'text-slate-800'}`}>{selectedStudent.parentName}</p>
                          </div>
                          <div>
                            <span className={currentTheme.muted}>{t.phone}</span>
                            <p className={`font-bold ${currentTheme.isDark ? 'text-emerald-500' : 'text-slate-800'}`}>{selectedStudent.parentPhone}</p>
                          </div>
                          <div className="col-span-2 border-t border-slate-100 pt-2 flex justify-between items-center">
                            <div>
                              <span className={currentTheme.muted}>{t.email}</span>
                              <p className={`font-semibold ${selectedStudent.parentEmail ? 'text-blue-600' : 'text-slate-400 italic text-xs'}`}>
                                {selectedStudent.parentEmail || (lang === 'en' ? 'Not provided' : 'Non renseigné')}
                              </p>
                            </div>
                            {selectedStudent.parentEmail && (
                              <button 
                                onClick={() => copyToClipboard(selectedStudent.parentEmail)}
                                className="p-2 hover:bg-blue-50 text-blue-500 rounded-lg transition-all"
                                title={t.copyEmail}
                              >
                                <Copy size={14} />
                              </button>
                            )}
                          </div>
                        </div>
                      </div>

                      {/* Emergency Contact Card */}
                      <div className={`p-5 ${currentTheme.isDark ? 'bg-[#1e293b]/50' : 'bg-slate-50'} rounded-2xl space-y-3`}>
                        <h4 className="text-[10px] font-black text-rose-500 uppercase tracking-widest">{t.emergencyTitle}</h4>
                        <div className="grid grid-cols-2 gap-4 text-xs">
                          <div>
                            <span className={currentTheme.muted}>{lang === 'en' ? 'Contact Name' : 'Nom du Contact'}</span>
                            <p className={`font-bold ${currentTheme.isDark ? 'text-emerald-500' : 'text-slate-800'}`}>
                              {selectedStudent.emergencyContactName || 'N/A'}
                            </p>
                          </div>
                          <div>
                            <span className={currentTheme.muted}>{t.relationshipLabel}</span>
                            <p className={`font-bold ${currentTheme.isDark ? 'text-emerald-500' : 'text-slate-800'}`}>
                              {selectedStudent.emergencyContactRelation || 'N/A'}
                            </p>
                          </div>
                          <div className="col-span-2 border-t border-slate-100 pt-2">
                            <span className={currentTheme.muted}>{t.emergencyPhoneLabel}</span>
                            <p className="font-black text-rose-600 text-sm">
                              {selectedStudent.emergencyContactPhone || 'N/A'}
                            </p>
                          </div>
                        </div>
                      </div>
                    </div>
                  )}

                  {studentDetailTab === 'medical' && (
                    <div className="space-y-4">
                      {/* Previous School */}
                      <div className={`p-5 ${currentTheme.isDark ? 'bg-[#1e293b]/50' : 'bg-slate-50'} rounded-2xl`}>
                        <span className={`text-[10px] font-black uppercase tracking-widest ${currentTheme.muted}`}>{t.previousSchoolHistory}</span>
                        <p className={`text-sm font-bold ${currentTheme.isDark ? 'text-emerald-500' : 'text-slate-800'} mt-1`}>
                          {selectedStudent.previousSchool || (lang === 'en' ? 'None / First Enrollment Entry' : 'Aucune / Première Inscription')}
                        </p>
                      </div>

                      {/* Medical Notes */}
                      <div className={`p-5 ${currentTheme.isDark ? 'bg-[#1e293b]/50' : 'bg-slate-50'} rounded-2xl`}>
                        <span className="text-[10px] font-black uppercase tracking-widest text-rose-500">{t.medicalNotesTitle}</span>
                        <p className={`text-xs font-semibold ${currentTheme.isDark ? 'text-emerald-400/80' : 'text-slate-700'} mt-1 bg-white p-3 rounded-xl border border-slate-100`}>
                          {selectedStudent.medicalNotes || 'None'}
                        </p>
                      </div>
                    </div>
                  )}
                </div>

                {/* --- Accounting Notes (Sticky Note) --- */}
                <div className="pt-2">
                  <div className="bg-[#FEF9C3] p-6 rounded-[2rem] shadow-inner border border-yellow-200/50 relative transform rotate-1">
                    <div className="absolute top-5 right-6 text-yellow-600/30">
                      <StickyNote size={24} />
                    </div>
                    <h4 className="text-[9px] font-black text-yellow-700 uppercase tracking-widest mb-3 flex items-center gap-1.5">
                      <FileText size={12} />
                      {t.accountingNotes}
                    </h4>
                    <textarea 
                      defaultValue={selectedStudent.notes}
                      onBlur={(e) => handleSaveNote(selectedStudent.id, e.target.value)}
                      placeholder="Add payment promises or issues..."
                      className="w-full bg-transparent border-none focus:ring-0 text-xs font-bold text-yellow-900 placeholder-yellow-700/40 resize-none min-h-[80px] custom-scrollbar"
                    />
                    <div className="mt-2 flex justify-end">
                      <span className="text-[9px] font-black text-yellow-600/50 uppercase tracking-widest">
                        {selectedStudent.lastNoteDate ? `Last updated: ${formatDate(selectedStudent.lastNoteDate)}` : ''}
                      </span>
                    </div>
                  </div>
                </div>

                {/* --- Bottom Actions Bar --- */}
                <div className="flex flex-col sm:flex-row gap-3 pt-4 border-t border-slate-100">
                  <button 
                    onClick={() => {
                      openEditModal(selectedStudent);
                      setSelectedStudent(null);
                    }}
                    className="flex-1 bg-blue-600 hover:bg-blue-700 text-white py-3.5 rounded-2xl font-black text-xs transition-all shadow-md flex items-center justify-center gap-2"
                  >
                    <FileText size={14} />
                    Edit Profile
                  </button>

                  <button 
                    onClick={() => setPrintStudentFile(selectedStudent)}
                    className="flex-1 bg-slate-800 hover:bg-slate-900 text-white py-3.5 rounded-2xl font-black text-xs transition-all shadow-md flex items-center justify-center gap-2"
                  >
                    <Printer size={14} />
                    Print Student File
                  </button>

                  <button 
                    onClick={() => setSelectedStudent(null)}
                    className={`px-6 py-3.5 border ${currentTheme.border} ${currentTheme.muted} hover:text-slate-600 hover:bg-slate-50 rounded-2xl font-bold text-xs transition-all text-center`}
                  >
                    {t.close}
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* --- Student Add/Edit Modal --- */}
      <AnimatePresence>
        {showStudentModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowStudentModal(false)}
              className="absolute inset-0 bg-slate-900/60 backdrop-blur-md"
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.9, y: 40 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 40 }}
              className={`relative ${currentTheme.card} w-full max-w-lg rounded-[3rem] shadow-2xl border ${currentTheme.border} overflow-hidden`}
            >
              <div className="p-8 border-b border-slate-50 flex justify-between items-center bg-[#0F172A] text-white" style={{ backgroundColor: currentTheme.header }}>
                <h2 className="text-xl font-bold flex items-center gap-3">
                  <Users size={24} className="text-blue-400" />
                  {editingStudent ? t.editStudent : t.addStudent}
                </h2>
                <button 
                  onClick={() => setShowStudentModal(false)}
                  className="p-2 hover:bg-white/10 rounded-xl transition-all"
                >
                  <X size={20} />
                </button>
              </div>

              <form onSubmit={handleStudentSubmit} className="p-10 space-y-6 max-h-[70vh] overflow-y-auto custom-scrollbar">
                {/* --- Student Profiles & Enrollment Core Fields --- */}
                <div className="grid grid-cols-2 gap-6">
                  <div className="space-y-2">
                    <label className={`text-[10px] font-black ${currentTheme.muted} uppercase tracking-widest`}>{t.studentName}</label>
                    <input 
                      required
                      type="text" 
                      value={studentForm.name}
                      onChange={(e) => setStudentForm({ ...studentForm, name: e.target.value })}
                      className={`w-full px-6 py-4 ${currentTheme.isDark ? 'bg-emerald-900/10' : 'bg-slate-50'} border ${currentTheme.border} rounded-2xl focus:outline-none focus:ring-4 focus:ring-blue-500/5 focus:border-blue-500 transition-all text-sm font-semibold ${currentTheme.isDark ? 'text-emerald-500' : 'text-slate-800'}`}
                      placeholder="Ibrahim"
                    />
                  </div>
                  <div className="space-y-2">
                    <label className={`text-[10px] font-black ${currentTheme.muted} uppercase tracking-widest`}>{lang === 'en' ? 'Student ID (Unique)' : 'ID de l\'élève (Unique)'}</label>
                    <input 
                      type="text" 
                      value={studentForm.studentId}
                      onChange={(e) => setStudentForm({ ...studentForm, studentId: e.target.value })}
                      className={`w-full px-6 py-4 ${currentTheme.isDark ? 'bg-emerald-900/10' : 'bg-slate-50'} border ${currentTheme.border} rounded-2xl focus:outline-none focus:ring-4 focus:ring-blue-500/5 focus:border-blue-500 transition-all text-sm font-semibold ${currentTheme.isDark ? 'text-emerald-500' : 'text-slate-800'}`}
                      placeholder="MT-2026-001 (Optional)"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-6">
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <label className={`text-[10px] font-black ${currentTheme.muted} uppercase tracking-widest`}>
                        {lang === 'en' ? 'Grade / Class' : 'Classe / Niveau'}
                      </label>
                      <button
                        type="button"
                        onClick={() => setShowAddClassModal(true)}
                        className="text-[10px] font-black text-blue-500 hover:text-blue-600 hover:underline flex items-center gap-1"
                      >
                        <Plus size={12} />
                        <span>{lang === 'en' ? 'New Class' : 'Nouvelle Classe'}</span>
                      </button>
                    </div>
                    <select 
                      required
                      value={studentForm.grade}
                      onChange={(e) => {
                        if (e.target.value === '__ADD_NEW_CLASS__') {
                          setShowAddClassModal(true);
                        } else {
                          setStudentForm({ ...studentForm, grade: e.target.value });
                        }
                      }}
                      className={`w-full px-6 py-4 ${currentTheme.isDark ? 'bg-slate-800 text-emerald-500' : 'bg-slate-50 text-slate-800'} border ${currentTheme.border} rounded-2xl focus:outline-none focus:ring-4 focus:ring-blue-500/5 focus:border-blue-500 transition-all text-sm font-semibold`}
                    >
                      <option value="">{lang === 'en' ? 'Select Grade / Class' : 'Sélectionner la classe'}</option>
                      <optgroup label={lang === 'en' ? "First Cycle (1st to 6th Year)" : "Premier Cycle (1ère à 6ème Année)"}>
                        {availableClasses.filter(c => c.cycle === 'cycle1').map(c => (
                          <option key={c.id} value={c.id}>{lang === 'en' ? c.nameEn : c.nameFr}</option>
                        ))}
                      </optgroup>
                      <optgroup label={lang === 'en' ? "Second Cycle (7th to 9th Year)" : "Second Cycle (7ème à 9ème Année)"}>
                        {availableClasses.filter(c => c.cycle === 'cycle2').map(c => (
                          <option key={c.id} value={c.id}>{lang === 'en' ? c.nameEn : c.nameFr}</option>
                        ))}
                      </optgroup>
                      {availableClasses.some(c => c.cycle !== 'cycle1' && c.cycle !== 'cycle2') && (
                        <optgroup label={lang === 'en' ? "Other / Custom Classes" : "Autres / Classes Personnalisées"}>
                          {availableClasses.filter(c => c.cycle !== 'cycle1' && c.cycle !== 'cycle2').map(c => (
                            <option key={c.id} value={c.id}>{lang === 'en' ? c.nameEn : c.nameFr}</option>
                          ))}
                        </optgroup>
                      )}
                      <option value="__ADD_NEW_CLASS__" className="text-blue-600 font-bold">
                        {lang === 'en' ? '+ Add another class / section...' : '+ Ajouter une autre classe / section...'}
                      </option>
                    </select>
                  </div>
                  <div className="space-y-2">
                    <label className={`text-[10px] font-black ${currentTheme.muted} uppercase tracking-widest`}>{lang === 'en' ? 'Enrollment Status' : 'Statut d\'Inscription'}</label>
                    <select 
                      value={studentForm.status}
                      onChange={(e) => setStudentForm({ ...studentForm, status: e.target.value as any })}
                      className={`w-full px-6 py-4 ${currentTheme.isDark ? 'bg-emerald-900/10' : 'bg-slate-50'} border ${currentTheme.border} rounded-2xl focus:outline-none focus:ring-4 focus:ring-blue-500/5 focus:border-blue-500 transition-all text-sm font-semibold ${currentTheme.isDark ? 'text-emerald-500' : 'text-slate-800'}`}
                    >
                      <option value="Active">{lang === 'en' ? 'Active' : 'Actif'}</option>
                      <option value="Graduated">{lang === 'en' ? 'Graduated' : 'Diplômé'}</option>
                      <option value="Left">{lang === 'en' ? 'Left' : 'Parti / Transféré'}</option>
                    </select>
                  </div>
                </div>

                <div className="space-y-2">
                  <label className={`text-[10px] font-black ${currentTheme.muted} uppercase tracking-widest`}>{lang === 'en' ? 'Passport Photo Link' : 'Lien de la photo d\'identité'}</label>
                  <input 
                    type="text" 
                    value={studentForm.photo}
                    onChange={(e) => setStudentForm({ ...studentForm, photo: e.target.value })}
                    className={`w-full px-6 py-4 ${currentTheme.isDark ? 'bg-emerald-900/10' : 'bg-slate-50'} border ${currentTheme.border} rounded-2xl focus:outline-none focus:ring-4 focus:ring-blue-500/5 focus:border-blue-500 transition-all text-sm font-semibold ${currentTheme.isDark ? 'text-emerald-500' : 'text-slate-800'}`}
                    placeholder="https://images.unsplash.com/photo-..."
                  />
                </div>

                {/* --- Parents Contact & Details --- */}
                <div className="grid grid-cols-2 gap-6">
                  <div className="space-y-2">
                    <label className={`text-[10px] font-black ${currentTheme.muted} uppercase tracking-widest`}>{t.parentName}</label>
                    <input 
                      required
                      type="text" 
                      value={studentForm.parentName}
                      onChange={(e) => setStudentForm({ ...studentForm, parentName: e.target.value })}
                      className={`w-full px-6 py-4 ${currentTheme.isDark ? 'bg-emerald-900/10' : 'bg-slate-50'} border ${currentTheme.border} rounded-2xl focus:outline-none focus:ring-4 focus:ring-blue-500/5 focus:border-blue-500 transition-all text-sm font-semibold ${currentTheme.isDark ? 'text-emerald-500' : 'text-slate-800'}`}
                      placeholder="Djeneba"
                    />
                  </div>
                  <div className="space-y-2">
                    <label className={`text-[10px] font-black ${currentTheme.muted} uppercase tracking-widest`}>
                      {lang === 'en' ? 'Parent Email (Optional)' : 'Email du Parent (Optionnel)'}
                    </label>
                    <input 
                      type="email" 
                      value={studentForm.parentEmail}
                      onChange={(e) => setStudentForm({ ...studentForm, parentEmail: e.target.value })}
                      className={`w-full px-6 py-4 ${currentTheme.isDark ? 'bg-emerald-900/10' : 'bg-slate-50'} border ${currentTheme.border} rounded-2xl focus:outline-none focus:ring-4 focus:ring-blue-500/5 focus:border-blue-500 transition-all text-sm font-semibold ${currentTheme.isDark ? 'text-emerald-500' : 'text-slate-800'}`}
                      placeholder={lang === 'en' ? "parent@example.com (optional)" : "parent@example.com (optionnel)"}
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <label className={`text-[10px] font-black ${currentTheme.muted} uppercase tracking-widest`}>{t.phone}</label>
                  <input 
                    required
                    type="tel" 
                    value={studentForm.parentPhone}
                    onChange={(e) => setStudentForm({ ...studentForm, parentPhone: e.target.value })}
                    className={`w-full px-6 py-4 ${currentTheme.isDark ? 'bg-emerald-900/10' : 'bg-slate-50'} border ${currentTheme.border} rounded-2xl focus:outline-none focus:ring-4 focus:ring-blue-500/5 focus:border-blue-500 transition-all text-sm font-semibold ${currentTheme.isDark ? 'text-emerald-500' : 'text-slate-800'}`}
                    placeholder="+223 70 00 00 00"
                  />
                </div>

                {/* --- Emergency Contact Fields --- */}
                <div className={`p-6 ${currentTheme.isDark ? 'bg-slate-900/50' : 'bg-slate-50'} rounded-3xl border ${currentTheme.border} space-y-4`}>
                  <h4 className={`text-[10px] font-black ${currentTheme.muted} uppercase tracking-widest`}>
                    {lang === 'en' ? 'Emergency Contact' : 'Contact d\'Urgence'}
                  </h4>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <label className={`text-[10px] font-black ${currentTheme.muted} uppercase tracking-widest`}>
                        {lang === 'en' ? 'Contact Name' : 'Nom du Contact'}
                      </label>
                      <input 
                        type="text" 
                        value={studentForm.emergencyContactName}
                        onChange={(e) => setStudentForm({ ...studentForm, emergencyContactName: e.target.value })}
                        className={`w-full px-4 py-3 bg-white ${currentTheme.isDark ? 'bg-slate-800 text-emerald-500 border-emerald-900/20' : 'border-slate-200 text-slate-850'} border rounded-xl text-xs font-semibold`}
                        placeholder={lang === 'en' ? 'Emergency contact name' : 'Nom complet du contact d\'urgence'}
                      />
                    </div>
                    <div className="space-y-2">
                      <label className={`text-[10px] font-black ${currentTheme.muted} uppercase tracking-widest`}>
                        {lang === 'en' ? 'Relation' : 'Lien de Parenté'}
                      </label>
                      <input 
                        type="text" 
                        value={studentForm.emergencyContactRelation}
                        onChange={(e) => setStudentForm({ ...studentForm, emergencyContactRelation: e.target.value })}
                        className={`w-full px-4 py-3 bg-white ${currentTheme.isDark ? 'bg-slate-800 text-emerald-500 border-emerald-900/20' : 'border-slate-200 text-slate-850'} border rounded-xl text-xs font-semibold`}
                        placeholder={lang === 'en' ? 'Uncle, Aunt, Parent, etc.' : 'Oncle, Tante, Parent, etc.'}
                      />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <label className={`text-[10px] font-black ${currentTheme.muted} uppercase tracking-widest`}>
                      {lang === 'en' ? 'Emergency Phone' : 'Téléphone d\'Urgence'}
                    </label>
                    <input 
                      type="tel" 
                      value={studentForm.emergencyContactPhone}
                      onChange={(e) => setStudentForm({ ...studentForm, emergencyContactPhone: e.target.value })}
                      className={`w-full px-4 py-3 bg-white ${currentTheme.isDark ? 'bg-slate-800 text-emerald-500 border-emerald-900/20' : 'border-slate-200 text-slate-850'} border rounded-xl text-xs font-semibold`}
                      placeholder={lang === 'en' ? 'Emergency contact phone' : 'Numéro de téléphone d\'urgence'}
                    />
                  </div>
                </div>

                {/* --- History & Medical notes --- */}
                <div className="grid grid-cols-2 gap-6">
                  <div className="space-y-2">
                    <label className={`text-[10px] font-black ${currentTheme.muted} uppercase tracking-widest`}>
                      {lang === 'en' ? 'Enrollment Date' : 'Date d\'Inscription'}
                    </label>
                    <input 
                      type="date" 
                      value={studentForm.enrollmentDate}
                      onChange={(e) => setStudentForm({ ...studentForm, enrollmentDate: e.target.value })}
                      className={`w-full px-6 py-4 ${currentTheme.isDark ? 'bg-emerald-900/10' : 'bg-slate-50'} border ${currentTheme.border} rounded-2xl focus:outline-none focus:ring-4 focus:ring-blue-500/5 focus:border-blue-500 transition-all text-sm font-semibold ${currentTheme.isDark ? 'text-emerald-500' : 'text-slate-800'}`}
                    />
                  </div>
                  <div className="space-y-2">
                    <label className={`text-[10px] font-black ${currentTheme.muted} uppercase tracking-widest`}>
                      {lang === 'en' ? 'Previous School' : 'École Précédente'}
                    </label>
                    <input 
                      type="text" 
                      value={studentForm.previousSchool}
                      onChange={(e) => setStudentForm({ ...studentForm, previousSchool: e.target.value })}
                      className={`w-full px-6 py-4 ${currentTheme.isDark ? 'bg-emerald-900/10' : 'bg-slate-50'} border ${currentTheme.border} rounded-2xl focus:outline-none focus:ring-4 focus:ring-blue-500/5 focus:border-blue-500 transition-all text-sm font-semibold ${currentTheme.isDark ? 'text-emerald-500' : 'text-slate-800'}`}
                      placeholder={lang === 'en' ? 'Transfer history school name' : 'Nom de l\'école de provenance'}
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <label className={`text-[10px] font-black ${currentTheme.muted} uppercase tracking-widest`}>
                    {lang === 'en' ? 'Medical Notes (Allergies / Conditions)' : 'Notes Médicales (Allergies / Conditions)'}
                  </label>
                  <textarea 
                    value={studentForm.medicalNotes}
                    onChange={(e) => setStudentForm({ ...studentForm, medicalNotes: e.target.value })}
                    className={`w-full px-6 py-4 ${currentTheme.isDark ? 'bg-emerald-900/10' : 'bg-slate-50'} border ${currentTheme.border} rounded-2xl focus:outline-none focus:ring-4 focus:ring-blue-500/5 focus:border-blue-500 transition-all text-sm font-semibold ${currentTheme.isDark ? 'text-emerald-500' : 'text-slate-800'} min-h-[100px]`}
                    placeholder={lang === 'en' ? 'Allergies, conditions, or None...' : 'Allergies, conditions médicales ou Aucune...'}
                  />
                </div>

                {/* --- Financial Controls --- */}
                <div className="grid grid-cols-2 gap-6">
                  <div className="space-y-2">
                    <label className={`text-[10px] font-black ${currentTheme.muted} uppercase tracking-widest`}>
                      {t.totalDue} ({t.currency})
                    </label>
                    <div className="relative">
                      <input 
                        required
                        type="number" 
                        min="0"
                        step="1"
                        value={studentForm.totalDue}
                        onChange={(e) => setStudentForm({ ...studentForm, totalDue: e.target.value })}
                        className={`w-full px-6 py-4 ${currentTheme.isDark ? 'bg-emerald-900/10' : 'bg-slate-50'} border ${currentTheme.border} rounded-2xl focus:outline-none focus:ring-4 focus:ring-blue-500/5 focus:border-blue-500 transition-all text-sm font-semibold ${currentTheme.isDark ? 'text-emerald-500' : 'text-slate-800'}`}
                        placeholder="120000"
                      />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <label className={`text-[10px] font-black ${currentTheme.muted} uppercase tracking-widest flex items-center justify-between`}>
                      <span>{t.scholarship}</span>
                      {currentUser?.role !== 'admin' && currentUser?.role !== 'dev' && (
                        <span className="text-[9px] text-rose-500 font-bold">
                          ({lang === 'en' ? 'Owner Only' : 'Promoteur Seul'})
                        </span>
                      )}
                    </label>
                    <input 
                      type="number" 
                      min="0"
                      max="100"
                      step="1"
                      value={studentForm.scholarshipDiscount}
                      onChange={(e) => setStudentForm({ ...studentForm, scholarshipDiscount: e.target.value })}
                      disabled={currentUser?.role !== 'admin' && currentUser?.role !== 'dev'}
                      className={`w-full px-6 py-4 ${currentUser?.role !== 'admin' && currentUser?.role !== 'dev' ? 'bg-slate-150 cursor-not-allowed opacity-70' : (currentTheme.isDark ? 'bg-emerald-900/10' : 'bg-slate-50')} border ${currentTheme.border} rounded-2xl focus:outline-none focus:ring-4 focus:ring-blue-500/5 focus:border-blue-500 transition-all text-sm font-semibold ${currentTheme.isDark ? 'text-emerald-500' : 'text-slate-800'}`}
                      placeholder="0"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-6">
                  <div className="space-y-2">
                    <label className={`text-[10px] font-black ${currentTheme.muted} uppercase tracking-widest`}>{t.academicYear}</label>
                    <select 
                      value={studentForm.academicYear}
                      onChange={(e) => setStudentForm({ ...studentForm, academicYear: e.target.value })}
                      className={`w-full px-6 py-4 ${currentTheme.isDark ? 'bg-emerald-900/10' : 'bg-slate-50'} border ${currentTheme.border} rounded-2xl focus:outline-none focus:ring-4 focus:ring-blue-500/5 focus:border-blue-500 transition-all text-sm font-semibold ${currentTheme.isDark ? 'text-emerald-500' : 'text-slate-800'}`}
                    >
                      {academicYears.map(year => (
                        <option key={year} value={year}>{year}</option>
                      ))}
                    </select>
                  </div>
                  <div className="space-y-2">
                    <label className={`text-[10px] font-black ${currentTheme.muted} uppercase tracking-widest`}>{t.dueDate}</label>
                    <input 
                      required
                      type="date" 
                      value={studentForm.dueDate}
                      onChange={(e) => setStudentForm({ ...studentForm, dueDate: e.target.value })}
                      className={`w-full px-6 py-4 ${currentTheme.isDark ? 'bg-emerald-900/10' : 'bg-slate-50'} border ${currentTheme.border} rounded-2xl focus:outline-none focus:ring-4 focus:ring-blue-500/5 focus:border-blue-500 transition-all text-sm font-semibold ${currentTheme.isDark ? 'text-emerald-500' : 'text-slate-800'}`}
                    />
                  </div>
                </div>

                <button 
                  type="submit"
                  className="w-full bg-blue-600 hover:bg-blue-700 text-white py-5 rounded-2xl font-black text-sm transition-all shadow-xl shadow-blue-500/20 active:scale-[0.98]"
                >
                  {editingStudent ? t.saveChanges : t.submit}
                </button>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* --- Add New Class / Section Modal --- */}
      <AnimatePresence>
        {showAddClassModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowAddClassModal(false)}
              className="absolute inset-0 bg-slate-900/60 backdrop-blur-md"
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.9, y: 40 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 40 }}
              className={`relative ${currentTheme.card} w-full max-w-md rounded-[2.5rem] shadow-2xl border ${currentTheme.border} overflow-hidden`}
            >
              <div className="p-6 border-b border-white/10 flex justify-between items-center bg-[#0F172A] text-white" style={{ backgroundColor: currentTheme.header }}>
                <h3 className="text-lg font-bold flex items-center gap-2.5">
                  <Layers size={20} className="text-blue-400" />
                  <span>{lang === 'en' ? 'Add Class / Section' : 'Ajouter une Classe / Section'}</span>
                </h3>
                <button 
                  onClick={() => setShowAddClassModal(false)}
                  className="p-2 hover:bg-white/10 rounded-xl transition-all"
                >
                  <X size={18} />
                </button>
              </div>

              <form onSubmit={handleCreateClassSubmit} className="p-6 space-y-5">
                <div className="space-y-1.5">
                  <label className={`text-[10px] font-black ${currentTheme.muted} uppercase tracking-widest`}>
                    {lang === 'en' ? 'School Cycle' : 'Cycle Scolaire'}
                  </label>
                  <select
                    value={newClassForm.cycle}
                    onChange={(e) => {
                      const c = e.target.value as any;
                      const defYear = c === 'cycle2' ? '7' : c === 'lycee' ? '10' : c === 'maternelle' ? 'PS' : '1';
                      setNewClassForm({ ...newClassForm, cycle: c, year: defYear });
                    }}
                    className={`w-full p-3.5 text-xs font-bold rounded-xl border ${currentTheme.border} ${currentTheme.isDark ? 'bg-slate-800 text-white' : 'bg-slate-50 text-slate-800'}`}
                  >
                    <option value="cycle1">{lang === 'en' ? 'First Cycle (1st to 6th Year)' : 'Premier Cycle (1ère à 6ème Année)'}</option>
                    <option value="cycle2">{lang === 'en' ? 'Second Cycle (7th to 9th Year)' : 'Second Cycle (7ème à 9ème Année)'}</option>
                    <option value="lycee">{lang === 'en' ? 'Lycée (High School)' : 'Lycée (Secondaire)'}</option>
                    <option value="maternelle">{lang === 'en' ? 'Maternelle (Kindergarten)' : 'Maternelle / Jardin d\'Enfants'}</option>
                    <option value="other">{lang === 'en' ? 'Other / Fully Custom Name' : 'Autre / Nom personnalisé'}</option>
                  </select>
                </div>

                {newClassForm.cycle !== 'other' ? (
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-1.5">
                      <label className={`text-[10px] font-black ${currentTheme.muted} uppercase tracking-widest`}>
                        {lang === 'en' ? 'Grade / Level' : 'Niveau / Année'}
                      </label>
                      <select
                        value={newClassForm.year}
                        onChange={(e) => setNewClassForm({ ...newClassForm, year: e.target.value })}
                        className={`w-full p-3.5 text-xs font-bold rounded-xl border ${currentTheme.border} ${currentTheme.isDark ? 'bg-slate-800 text-white' : 'bg-slate-50 text-slate-800'}`}
                      >
                        {newClassForm.cycle === 'cycle1' && (
                          <>
                            <option value="1">{lang === 'en' ? '1st Year (1ère)' : '1ère Année'}</option>
                            <option value="2">{lang === 'en' ? '2nd Year (2ème)' : '2ème Année'}</option>
                            <option value="3">{lang === 'en' ? '3rd Year (3ème)' : '3ème Année'}</option>
                            <option value="4">{lang === 'en' ? '4th Year (4ème)' : '4ème Année'}</option>
                            <option value="5">{lang === 'en' ? '5th Year (5ème)' : '5ème Année'}</option>
                            <option value="6">{lang === 'en' ? '6th Year (6ème)' : '6ème Année'}</option>
                          </>
                        )}
                        {newClassForm.cycle === 'cycle2' && (
                          <>
                            <option value="7">{lang === 'en' ? '7th Year (7ème)' : '7ème Année'}</option>
                            <option value="8">{lang === 'en' ? '8th Year (8ème)' : '8ème Année'}</option>
                            <option value="9">{lang === 'en' ? '9th Year (9ème)' : '9ème Année'}</option>
                          </>
                        )}
                        {newClassForm.cycle === 'lycee' && (
                          <>
                            <option value="10">{lang === 'en' ? '10th Year (10ème)' : '10ème Année (Seconde)'}</option>
                            <option value="11">{lang === 'en' ? '11th Year (11ème)' : '11ème Année (Première)'}</option>
                            <option value="12">{lang === 'en' ? '12th Year (12ème)' : '12ème Année (Terminale)'}</option>
                          </>
                        )}
                        {newClassForm.cycle === 'maternelle' && (
                          <>
                            <option value="PS">{lang === 'en' ? 'Petite Section (PS)' : 'Petite Section (PS)'}</option>
                            <option value="MS">{lang === 'en' ? 'Moyenne Section (MS)' : 'Moyenne Section (MS)'}</option>
                            <option value="GS">{lang === 'en' ? 'Grande Section (GS)' : 'Grande Section (GS)'}</option>
                          </>
                        )}
                      </select>
                    </div>

                    <div className="space-y-1.5">
                      <label className={`text-[10px] font-black ${currentTheme.muted} uppercase tracking-widest`}>
                        {lang === 'en' ? 'Section (e.g. D, E)' : 'Section (ex. D, E)'}
                      </label>
                      <input
                        type="text"
                        required
                        maxLength={5}
                        placeholder="D, E, F..."
                        value={newClassForm.section}
                        onChange={(e) => setNewClassForm({ ...newClassForm, section: e.target.value.toUpperCase() })}
                        className={`w-full p-3.5 text-xs font-bold uppercase rounded-xl border ${currentTheme.border} ${currentTheme.isDark ? 'bg-slate-800 text-white' : 'bg-slate-50 text-slate-800'}`}
                      />
                    </div>
                  </div>
                ) : (
                  <div className="space-y-1.5">
                    <label className={`text-[10px] font-black ${currentTheme.muted} uppercase tracking-widest`}>
                      {lang === 'en' ? 'Custom Class Name' : 'Nom de la classe'}
                    </label>
                    <input
                      type="text"
                      required
                      placeholder={lang === 'en' ? 'e.g., 1ère D or Garderie' : 'ex. 1ère D ou Garderie'}
                      value={newClassForm.customName}
                      onChange={(e) => setNewClassForm({ ...newClassForm, customName: e.target.value })}
                      className={`w-full p-3.5 text-xs font-bold rounded-xl border ${currentTheme.border} ${currentTheme.isDark ? 'bg-slate-800 text-white' : 'bg-slate-50 text-slate-800'}`}
                    />
                  </div>
                )}

                {/* Preview Badge */}
                <div className={`p-4 rounded-xl border ${currentTheme.border} ${currentTheme.isDark ? 'bg-slate-900/40' : 'bg-slate-50'}`}>
                  <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-1">
                    {lang === 'en' ? 'Generated Class Code:' : 'Code généré :'}
                  </p>
                  <div className="flex items-center gap-2">
                    <span className="px-2.5 py-1 bg-blue-50 text-blue-600 border border-blue-200 rounded-lg text-xs font-black">
                      {newClassForm.cycle === 'other' ? (newClassForm.customName || 'CUSTOM') : `${newClassForm.year}${newClassForm.section || 'A'}`}
                    </span>
                    <span className="text-xs text-slate-600 dark:text-slate-300 font-semibold">
                      {newClassForm.cycle === 'other' 
                        ? (newClassForm.customName || 'Classe personnalisée') 
                        : `${newClassForm.year === '1' ? '1ère Année' : newClassForm.year + 'ème Année'} ${newClassForm.section || 'A'}`}
                    </span>
                  </div>
                </div>

                <div className="pt-2 flex justify-end gap-3 border-t border-slate-100 dark:border-slate-800">
                  <button
                    type="button"
                    onClick={() => setShowAddClassModal(false)}
                    className="px-4 py-2.5 rounded-xl border border-slate-200 dark:border-slate-800 text-xs font-bold text-slate-600 dark:text-slate-400 hover:bg-slate-50"
                  >
                    {lang === 'en' ? 'Cancel' : 'Annuler'}
                  </button>
                  <button
                    type="submit"
                    className="px-5 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs shadow-lg shadow-blue-600/20 active:scale-95 transition-all flex items-center gap-1.5"
                  >
                    <Plus size={14} />
                    <span>{lang === 'en' ? 'Save Class' : 'Créer la classe'}</span>
                  </button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* --- Staff Add/Edit Modal --- */}
      <AnimatePresence>
        {showStaffModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowStaffModal(false)}
              className="absolute inset-0 bg-slate-900/60 backdrop-blur-md"
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.9, y: 40 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 40 }}
              className={`relative ${currentTheme.card} w-full max-w-lg rounded-[3rem] shadow-2xl border ${currentTheme.border} overflow-hidden`}
            >
              <div className="p-8 border-b border-slate-50 flex justify-between items-center bg-[#0F172A] text-white" style={{ backgroundColor: currentTheme.header }}>
                <h2 className="text-xl font-bold flex items-center gap-3">
                  <Briefcase size={24} className="text-blue-400" />
                  {editingStaff ? t.editStaff : t.addStaff}
                </h2>
                <button onClick={() => setShowStaffModal(false)} className="p-2 hover:bg-white/10 rounded-xl transition-all">
                  <X size={20} />
                </button>
              </div>

              <form onSubmit={handleStaffSubmit} className="p-10 space-y-6 max-h-[70vh] overflow-y-auto custom-scrollbar">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="space-y-2">
                    <label className={`text-[10px] font-black ${currentTheme.muted} uppercase tracking-widest`}>{t.staffName}</label>
                    <input 
                      required
                      type="text" 
                      value={staffForm.name}
                      onChange={(e) => setStaffForm({ ...staffForm, name: e.target.value })}
                      className={`w-full px-6 py-4 ${currentTheme.isDark ? 'bg-emerald-900/10' : 'bg-slate-50'} border ${currentTheme.border} rounded-2xl focus:outline-none focus:ring-4 focus:ring-blue-500/5 focus:border-blue-500 transition-all text-sm font-semibold ${currentTheme.isDark ? 'text-emerald-500' : 'text-slate-800'}`}
                      placeholder="Jane Doe"
                    />
                  </div>
                  <div className="space-y-2">
                    <label className={`text-[10px] font-black ${currentTheme.muted} uppercase tracking-widest`}>{t.position}</label>
                    <input 
                      required
                      type="text" 
                      value={staffForm.position}
                      onChange={(e) => setStaffForm({ ...staffForm, position: e.target.value })}
                      className={`w-full px-6 py-4 ${currentTheme.isDark ? 'bg-emerald-900/10' : 'bg-slate-50'} border ${currentTheme.border} rounded-2xl focus:outline-none focus:ring-4 focus:ring-blue-500/5 focus:border-blue-500 transition-all text-sm font-semibold ${currentTheme.isDark ? 'text-emerald-500' : 'text-slate-800'}`}
                      placeholder="Teacher"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="space-y-2">
                    <label className={`text-[10px] font-black ${currentTheme.muted} uppercase tracking-widest`}>{t.phone}</label>
                    <input 
                      required
                      type="text" 
                      value={staffForm.phone}
                      onChange={(e) => setStaffForm({ ...staffForm, phone: e.target.value })}
                      className={`w-full px-6 py-4 ${currentTheme.isDark ? 'bg-emerald-900/10' : 'bg-slate-50'} border ${currentTheme.border} rounded-2xl focus:outline-none focus:ring-4 focus:ring-blue-500/5 focus:border-blue-500 transition-all text-sm font-semibold ${currentTheme.isDark ? 'text-emerald-500' : 'text-slate-800'}`}
                      placeholder="+223 70 00 00 00"
                    />
                  </div>
                  <div className="space-y-2">
                    <label className={`text-[10px] font-black ${currentTheme.muted} uppercase tracking-widest`}>{t.email}</label>
                    <input 
                      required
                      type="email" 
                      value={staffForm.email}
                      onChange={(e) => setStaffForm({ ...staffForm, email: e.target.value })}
                      className={`w-full px-6 py-4 ${currentTheme.isDark ? 'bg-emerald-900/10' : 'bg-slate-50'} border ${currentTheme.border} rounded-2xl focus:outline-none focus:ring-4 focus:ring-blue-500/5 focus:border-blue-500 transition-all text-sm font-semibold ${currentTheme.isDark ? 'text-emerald-500' : 'text-slate-800'}`}
                      placeholder="jane.doe@school.com"
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <label className={`text-[10px] font-black ${currentTheme.muted} uppercase tracking-widest`}>{t.monthlySalary} ({t.currency})</label>
                  <input 
                    required
                    type="number" 
                    value={staffForm.salary}
                    onChange={(e) => setStaffForm({ ...staffForm, salary: e.target.value })}
                    className={`w-full px-6 py-4 ${currentTheme.isDark ? 'bg-emerald-900/10' : 'bg-slate-50'} border ${currentTheme.border} rounded-2xl focus:outline-none focus:ring-4 focus:ring-blue-500/5 focus:border-blue-500 transition-all text-sm font-semibold ${currentTheme.isDark ? 'text-emerald-500' : 'text-slate-800'}`}
                    placeholder="150 000"
                  />
                </div>

                <div className="space-y-2">
                  <label className={`text-[10px] font-black ${currentTheme.muted} uppercase tracking-widest`}>{t.bankDetails}</label>
                  <input 
                    required
                    type="text" 
                    value={staffForm.bankDetails}
                    onChange={(e) => setStaffForm({ ...staffForm, bankDetails: e.target.value })}
                    className={`w-full px-6 py-4 ${currentTheme.isDark ? 'bg-emerald-900/10' : 'bg-slate-50'} border ${currentTheme.border} rounded-2xl focus:outline-none focus:ring-4 focus:ring-blue-500/5 focus:border-blue-500 transition-all text-sm font-semibold ${currentTheme.isDark ? 'text-emerald-500' : 'text-slate-800'}`}
                    placeholder="RIB: ML01 00001 ..."
                  />
                </div>

                <div className="space-y-2">
                  <label className={`text-[10px] font-black ${currentTheme.muted} uppercase tracking-widest`}>{t.emergencyContact}</label>
                  <input 
                    required
                    type="text" 
                    value={staffForm.emergencyContact}
                    onChange={(e) => setStaffForm({ ...staffForm, emergencyContact: e.target.value })}
                    className={`w-full px-6 py-4 ${currentTheme.isDark ? 'bg-emerald-900/10' : 'bg-slate-50'} border ${currentTheme.border} rounded-2xl focus:outline-none focus:ring-4 focus:ring-blue-500/5 focus:border-blue-500 transition-all text-sm font-semibold ${currentTheme.isDark ? 'text-emerald-500' : 'text-slate-800'}`}
                    placeholder="Spouse: +223 60 00 00 00"
                  />
                </div>

                <button type="submit" className="w-full bg-blue-600 hover:bg-blue-700 text-white py-5 rounded-2xl font-black text-sm transition-all shadow-xl shadow-blue-500/20">
                  {editingStaff ? t.saveChanges : t.submit}
                </button>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* --- Expense Modal --- */}
      <AnimatePresence>
        {showExpenseModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowExpenseModal(false)}
              className="absolute inset-0 bg-slate-900/60 backdrop-blur-md"
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.9, y: 40 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 40 }}
              className={`relative ${currentTheme.card} w-full max-w-lg rounded-[3rem] shadow-2xl border ${currentTheme.border} overflow-hidden`}
            >
              <div className="p-8 border-b border-rose-100 flex justify-between items-center bg-rose-600 text-white">
                <h2 className="text-xl font-bold flex items-center gap-3">
                  <Receipt size={24} />
                  {t.addExpense}
                </h2>
                <button onClick={() => setShowExpenseModal(false)} className="p-2 hover:bg-white/10 rounded-xl transition-all">
                  <X size={20} />
                </button>
              </div>

              <form onSubmit={handleExpenseSubmit} className="p-10 space-y-6">
                <div className="space-y-2">
                  <label className={`text-[10px] font-black ${currentTheme.muted} uppercase tracking-widest`}>{t.category}</label>
                  <select 
                    value={expenseForm.category}
                    onChange={(e) => setExpenseForm({ ...expenseForm, category: e.target.value })}
                    className={`w-full px-6 py-4 ${currentTheme.isDark ? 'bg-emerald-900/10' : 'bg-slate-50'} border ${currentTheme.border} rounded-2xl focus:outline-none focus:ring-4 focus:ring-rose-500/5 focus:border-rose-500 transition-all text-sm font-semibold ${currentTheme.isDark ? 'text-emerald-500' : 'text-slate-800'}`}
                  >
                    <option value="Supplies">{t.supplies}</option>
                    <option value="Utilities">{t.utilities}</option>
                    <option value="Maintenance">{t.maintenance}</option>
                    <option value="Other">{t.other}</option>
                  </select>
                </div>
                <div className="space-y-2">
                  <label className={`text-[10px] font-black ${currentTheme.muted} uppercase tracking-widest`}>{t.description}</label>
                  <input 
                    required
                    type="text" 
                    value={expenseForm.description}
                    onChange={(e) => setExpenseForm({ ...expenseForm, description: e.target.value })}
                    className={`w-full px-6 py-4 ${currentTheme.isDark ? 'bg-emerald-900/10' : 'bg-slate-50'} border ${currentTheme.border} rounded-2xl focus:outline-none focus:ring-4 focus:ring-rose-500/5 focus:border-rose-500 transition-all text-sm font-semibold ${currentTheme.isDark ? 'text-emerald-500' : 'text-slate-800'}`}
                    placeholder="Electricity bill"
                  />
                </div>
                <div className="grid grid-cols-2 gap-6">
                  <div className="space-y-2">
                    <label className={`text-[10px] font-black ${currentTheme.muted} uppercase tracking-widest`}>{t.amount} ({t.currency})</label>
                    <input 
                      required
                      type="number" 
                      value={expenseForm.amount}
                      onChange={(e) => setExpenseForm({ ...expenseForm, amount: e.target.value })}
                      className={`w-full px-6 py-4 ${currentTheme.isDark ? 'bg-emerald-900/10' : 'bg-slate-50'} border ${currentTheme.border} rounded-2xl focus:outline-none focus:ring-4 focus:ring-rose-500/5 focus:border-rose-500 transition-all text-sm font-semibold ${currentTheme.isDark ? 'text-emerald-500' : 'text-slate-800'}`}
                      placeholder="25 000"
                    />
                  </div>
                  <div className="space-y-2">
                    <label className={`text-[10px] font-black ${currentTheme.muted} uppercase tracking-widest`}>{t.date}</label>
                    <input 
                      required
                      type="date" 
                      value={expenseForm.date}
                      onChange={(e) => setExpenseForm({ ...expenseForm, date: e.target.value })}
                      className={`w-full px-6 py-4 ${currentTheme.isDark ? 'bg-emerald-900/10' : 'bg-slate-50'} border ${currentTheme.border} rounded-2xl focus:outline-none focus:ring-4 focus:ring-rose-500/5 focus:border-rose-500 transition-all text-sm font-semibold ${currentTheme.isDark ? 'text-emerald-500' : 'text-slate-800'}`}
                    />
                  </div>
                </div>
                <button type="submit" className="w-full bg-rose-500 hover:bg-rose-600 text-white py-5 rounded-2xl font-black text-sm transition-all shadow-xl shadow-rose-500/20">
                  {t.submit}
                </button>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* --- Vendor Expense Modal --- */}
      <AnimatePresence>
        {showVendorExpenseModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => {
                setShowVendorExpenseModal(false);
                setEditingVendorExpense(null);
              }}
              className="absolute inset-0 bg-slate-900/60 backdrop-blur-md"
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.9, y: 40 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 40 }}
              className={`relative ${currentTheme.card} w-full max-w-lg rounded-[3rem] shadow-2xl border ${currentTheme.border} overflow-hidden`}
            >
              <div className={`p-8 border-b ${currentTheme.border} flex justify-between items-center ${currentTheme.isDark ? 'bg-emerald-800' : 'bg-blue-600'} text-white`}>
                <h2 className="text-xl font-bold flex items-center gap-3">
                  <Receipt size={24} />
                  {editingVendorExpense ? t.editVendorExpense : t.addVendorExpense}
                </h2>
                <button 
                  onClick={() => {
                    setShowVendorExpenseModal(false);
                    setEditingVendorExpense(null);
                  }} 
                  className="p-2 hover:bg-white/10 rounded-xl transition-all"
                >
                  <X size={20} />
                </button>
              </div>

              <form onSubmit={handleVendorExpenseSubmit} className="p-10 space-y-6">
                {/* Vendor Name */}
                <div className="space-y-2">
                  <label className={`text-[10px] font-black ${currentTheme.muted} uppercase tracking-widest`}>{t.vendorName}</label>
                  <input 
                    required
                    type="text" 
                    value={vendorExpenseForm.vendorName}
                    onChange={(e) => setVendorExpenseForm({ ...vendorExpenseForm, vendorName: e.target.value })}
                    className={`w-full px-6 py-4 border rounded-2xl focus:outline-none transition-all text-sm font-semibold ${currentTheme.input}`}
                    placeholder={lang === 'en' ? "e.g., SENELEC" : "ex. SENELEC"}
                  />
                </div>

                <div className="grid grid-cols-2 gap-6">
                  {/* Category */}
                  <div className="space-y-2">
                    <label className={`text-[10px] font-black ${currentTheme.muted} uppercase tracking-widest`}>{t.category}</label>
                    <select 
                      value={vendorExpenseForm.category}
                      onChange={(e) => setVendorExpenseForm({ ...vendorExpenseForm, category: e.target.value as any })}
                      className={`w-full px-6 py-4 border rounded-2xl focus:outline-none transition-all text-sm font-semibold ${currentTheme.input}`}
                    >
                      {expenseCategoryList.map(item => (
                        <option key={item.key} value={item.key}>{item.label}</option>
                      ))}
                    </select>
                  </div>

                  {/* Payment Status */}
                  <div className="space-y-2">
                    <label className={`text-[10px] font-black ${currentTheme.muted} uppercase tracking-widest`}>{t.paymentStatus}</label>
                    <select 
                      value={vendorExpenseForm.paymentStatus}
                      onChange={(e) => setVendorExpenseForm({ ...vendorExpenseForm, paymentStatus: e.target.value as any })}
                      className={`w-full px-6 py-4 border rounded-2xl focus:outline-none transition-all text-sm font-semibold ${currentTheme.input}`}
                    >
                      <option value="unpaid">{t.unpaid}</option>
                      <option value="partial">{t.partialPaid}</option>
                      <option value="paid">{t.fullyPaid}</option>
                    </select>
                  </div>
                </div>

                {/* Conditional Welfare Aid / Social Cases sub-fields */}
                {vendorExpenseForm.category === 'social_cases' && (
                  <div className={`p-6 ${currentTheme.isDark ? 'bg-rose-950/10' : 'bg-rose-50/40'} border ${currentTheme.isDark ? 'border-rose-950/30' : 'border-rose-100'} rounded-3xl space-y-4`}>
                    <p className="text-xs font-black uppercase tracking-widest text-rose-500 flex items-center gap-2">
                      <Heart size={14} className="text-rose-500 fill-rose-500/10" />
                      {lang === 'en' ? 'Student Welfare & Social Aid Details' : 'Détails des Cas Sociaux & Aides Liés aux Élèves'}
                    </p>
                    
                    {/* Aid Type Dropdown */}
                    <div className="space-y-2">
                      <label className={`text-[10px] font-black ${currentTheme.muted} uppercase tracking-widest`}>
                        {lang === 'en' ? 'Type of Aid' : 'Type d\'aide'}
                      </label>
                      <select 
                        required={vendorExpenseForm.category === 'social_cases'}
                        value={vendorExpenseForm.aidType}
                        onChange={(e) => setVendorExpenseForm({ ...vendorExpenseForm, aidType: e.target.value as any })}
                        className={`w-full px-6 py-4 border rounded-2xl focus:outline-none transition-all text-sm font-semibold ${currentTheme.input}`}
                      >
                        <option value="">{lang === 'en' ? 'Select Type of Aid' : 'Sélectionner le type d\'aide'}</option>
                        <option value="prise_en_charge">{lang === 'en' ? 'Tuition Waiver (Prise en charge Scolarité)' : 'Prise en charge Scolarité'}</option>
                        <option value="kits_fournitures">{lang === 'en' ? 'Supplies Support (Kits Scolaires & Fournitures)' : 'Kits Scolaires & Fournitures'}</option>
                        <option value="aide_urgence">{lang === 'en' ? 'Emergency Aid (Aide d\'Urgence)' : 'Aide d\'Urgence'}</option>
                      </select>
                    </div>

                    {/* Student Link Fields */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <label className={`text-[10px] font-black ${currentTheme.muted} uppercase tracking-widest`}>
                          {lang === 'en' ? 'Beneficiary Student Name (Optional)' : 'Nom de l\'élève bénéficiaire (Optionnel)'}
                        </label>
                        <input 
                          type="text" 
                          value={vendorExpenseForm.beneficiaryStudentName}
                          onChange={(e) => setVendorExpenseForm({ ...vendorExpenseForm, beneficiaryStudentName: e.target.value })}
                          className={`w-full px-6 py-4 border rounded-2xl focus:outline-none transition-all text-sm font-semibold ${currentTheme.input}`}
                          placeholder={lang === 'en' ? "e.g., Ibrahim Thera" : "ex. Ibrahim Thera"}
                        />
                      </div>
                      <div className="space-y-2">
                        <label className={`text-[10px] font-black ${currentTheme.muted} uppercase tracking-widest`}>
                          {lang === 'en' ? 'Student Grade (Optional)' : 'Classe de l\'élève (Optionnel)'}
                        </label>
                        <select 
                          value={vendorExpenseForm.beneficiaryStudentGrade}
                          onChange={(e) => setVendorExpenseForm({ ...vendorExpenseForm, beneficiaryStudentGrade: e.target.value })}
                          className={`w-full px-6 py-4 border rounded-2xl focus:outline-none transition-all text-sm font-semibold ${currentTheme.input}`}
                        >
                          <option value="">{lang === 'en' ? 'Select Grade' : 'Sélectionner la classe'}</option>
                          <optgroup label={lang === 'en' ? "First Cycle (Premier Cycle)" : "Premier Cycle"}>
                            {availableClasses.filter(c => c.cycle === 'cycle1').map(c => (
                              <option key={c.id} value={c.id}>{lang === 'en' ? c.nameEn : c.nameFr}</option>
                            ))}
                          </optgroup>
                          <optgroup label={lang === 'en' ? "Second Cycle" : "Second Cycle"}>
                            {availableClasses.filter(c => c.cycle === 'cycle2').map(c => (
                              <option key={c.id} value={c.id}>{lang === 'en' ? c.nameEn : c.nameFr}</option>
                            ))}
                          </optgroup>
                          {availableClasses.some(c => c.cycle !== 'cycle1' && c.cycle !== 'cycle2') && (
                            <optgroup label={lang === 'en' ? "Other Classes" : "Autres Classes"}>
                              {availableClasses.filter(c => c.cycle !== 'cycle1' && c.cycle !== 'cycle2').map(c => (
                                <option key={c.id} value={c.id}>{lang === 'en' ? c.nameEn : c.nameFr}</option>
                              ))}
                            </optgroup>
                          )}
                        </select>
                      </div>
                    </div>
                  </div>
                )}

                <div className="grid grid-cols-2 gap-6">
                  {/* Total Amount */}
                  <div className="space-y-2">
                    <label className={`text-[10px] font-black ${currentTheme.muted} uppercase tracking-widest`}>{t.amount} (XOF)</label>
                    <input 
                      required
                      type="number" 
                      value={vendorExpenseForm.amount}
                      onChange={(e) => setVendorExpenseForm({ ...vendorExpenseForm, amount: e.target.value })}
                      className={`w-full px-6 py-4 border rounded-2xl focus:outline-none transition-all text-sm font-semibold ${currentTheme.input}`}
                      placeholder="50000"
                    />
                  </div>

                  {/* Due Date */}
                  <div className="space-y-2">
                    <label className={`text-[10px] font-black ${currentTheme.muted} uppercase tracking-widest`}>{lang === 'en' ? "Due Date" : "Date d'échéance"}</label>
                    <input 
                      required
                      type="date" 
                      value={vendorExpenseForm.dueDate}
                      onChange={(e) => setVendorExpenseForm({ ...vendorExpenseForm, dueDate: e.target.value })}
                      className={`w-full px-6 py-4 border rounded-2xl focus:outline-none transition-all text-sm font-semibold ${currentTheme.input}`}
                    />
                  </div>
                </div>

                {/* Amount Paid - Only visible if Partially Paid */}
                {vendorExpenseForm.paymentStatus === 'partial' && (
                  <div className="space-y-2">
                    <label className={`text-[10px] font-black ${currentTheme.muted} uppercase tracking-widest`}>{t.amountPaid} (XOF)</label>
                    <input 
                      required
                      type="number" 
                      value={vendorExpenseForm.amountPaid}
                      onChange={(e) => setVendorExpenseForm({ ...vendorExpenseForm, amountPaid: e.target.value })}
                      className={`w-full px-6 py-4 border rounded-2xl focus:outline-none transition-all text-sm font-semibold ${currentTheme.input}`}
                      placeholder="20000"
                    />
                  </div>
                )}

                {/* Description */}
                <div className="space-y-2">
                  <label className={`text-[10px] font-black ${currentTheme.muted} uppercase tracking-widest`}>{t.description}</label>
                  <input 
                    type="text" 
                    value={vendorExpenseForm.description}
                    onChange={(e) => setVendorExpenseForm({ ...vendorExpenseForm, description: e.target.value })}
                    className={`w-full px-6 py-4 border rounded-2xl focus:outline-none transition-all text-sm font-semibold ${currentTheme.input}`}
                    placeholder={lang === 'en' ? "Optional notes..." : "Notes optionnelles..."}
                  />
                </div>

                <button 
                  type="submit" 
                  className={`w-full ${currentTheme.isDark ? 'bg-emerald-600 hover:bg-emerald-700' : 'bg-blue-600 hover:bg-blue-700'} text-white py-5 rounded-2xl font-black text-sm transition-all shadow-xl`}
                >
                  {t.submit}
                </button>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* --- Salary Payment Modal --- */}
      <AnimatePresence>
        {showSalaryModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowSalaryModal(false)}
              className="absolute inset-0 bg-slate-900/60 backdrop-blur-md"
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.9, y: 40 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 40 }}
              className={`relative ${currentTheme.card} w-full max-w-lg rounded-[3rem] shadow-2xl border ${currentTheme.border} overflow-hidden`}
            >
              <div className="p-8 border-b border-slate-50 flex justify-between items-center bg-[#0F172A] text-white" style={{ backgroundColor: currentTheme.header }}>
                <h2 className="text-xl font-bold flex items-center gap-3">
                  <DollarSign size={24} className="text-emerald-400" />
                  {t.recordSalaryPayment}
                </h2>
                <button onClick={() => setShowSalaryModal(false)} className="p-2 hover:bg-white/10 rounded-xl transition-all">
                  <X size={20} />
                </button>
              </div>

              <form onSubmit={handleSalarySubmit} className="p-10 space-y-6">
                <div className="space-y-2">
                  <label className={`text-[10px] font-black ${currentTheme.muted} uppercase tracking-widest`}>{t.staffName}</label>
                  <select 
                    required
                    value={salaryForm.staffId}
                    onChange={(e) => {
                      const sId = e.target.value;
                      const s = staff.find(st => st.id === sId);
                      if (s) {
                        const paid = salaryPayments
                          .filter(p => p.staffId === sId && new Date(p.date).getMonth() === currentMonth)
                          .reduce((sum, p) => sum + p.amount, 0);
                        setSalaryForm({ ...salaryForm, staffId: sId, amount: (s.salary - paid).toString() });
                      } else {
                        setSalaryForm({ ...salaryForm, staffId: sId });
                      }
                    }}
                    className={`w-full px-6 py-4 ${currentTheme.isDark ? 'bg-emerald-900/10' : 'bg-slate-50'} border ${currentTheme.border} rounded-2xl focus:outline-none focus:ring-4 focus:ring-blue-500/5 focus:border-blue-500 transition-all text-sm font-semibold ${currentTheme.isDark ? 'text-emerald-500' : 'text-slate-800'}`}
                  >
                    <option value="">Select Staff</option>
                    {staff.map(s => {
                      const paid = salaryPayments
                        .filter(p => p.staffId === s.id && new Date(p.date).getMonth() === currentMonth)
                        .reduce((sum, p) => sum + p.amount, 0);
                      const bal = s.salary - paid;
                      return (
                        <option key={s.id} value={s.id}>{s.name} ({formatCurrency(bal)} {t.remainingBalance})</option>
                      );
                    })}
                  </select>
                </div>
                {salaryForm.staffId && (
                  <div className={`p-4 rounded-2xl ${currentTheme.isDark ? 'bg-emerald-900/20' : 'bg-slate-50'} border ${currentTheme.border}`}>
                    <div className="flex justify-between items-center text-xs">
                      <span className={currentTheme.muted}>{t.remainingBalance}</span>
                      <span className="font-black text-rose-600">
                        {(() => {
                          const s = staff.find(st => st.id === salaryForm.staffId);
                          if (!s) return formatCurrency(0);
                          const paid = salaryPayments
                            .filter(p => p.staffId === s.id && new Date(p.date).getMonth() === currentMonth)
                            .reduce((sum, p) => sum + p.amount, 0);
                          return formatCurrency(s.salary - paid);
                        })()}
                      </span>
                    </div>
                  </div>
                )}
                <div className="grid grid-cols-2 gap-6">
                  <div className="space-y-2">
                    <label className={`text-[10px] font-black ${currentTheme.muted} uppercase tracking-widest`}>{t.amount} ({t.currency})</label>
                    <input 
                      required
                      type="number" 
                      value={salaryForm.amount}
                      onChange={(e) => setSalaryForm({ ...salaryForm, amount: e.target.value })}
                      className={`w-full px-6 py-4 ${currentTheme.isDark ? 'bg-emerald-900/10' : 'bg-slate-50'} border ${currentTheme.border} rounded-2xl focus:outline-none focus:ring-4 focus:ring-blue-500/5 focus:border-blue-500 transition-all text-sm font-semibold ${currentTheme.isDark ? 'text-emerald-500' : 'text-slate-800'}`}
                    />
                  </div>
                  <div className="space-y-2">
                    <label className={`text-[10px] font-black ${currentTheme.muted} uppercase tracking-widest`}>{t.date}</label>
                    <input 
                      required
                      type="date" 
                      value={salaryForm.date}
                      onChange={(e) => setSalaryForm({ ...salaryForm, date: e.target.value })}
                      className={`w-full px-6 py-4 ${currentTheme.isDark ? 'bg-emerald-900/10' : 'bg-slate-50'} border ${currentTheme.border} rounded-2xl focus:outline-none focus:ring-4 focus:ring-blue-500/5 focus:border-blue-500 transition-all text-sm font-semibold ${currentTheme.isDark ? 'text-emerald-500' : 'text-slate-800'}`}
                    />
                  </div>
                </div>

                {salaryForm.staffId && salaryForm.amount && (
                  <button 
                    type="button"
                    onClick={() => generateInstallmentMemo(salaryForm.staffId, parseFloat(salaryForm.amount))}
                    className={`w-full py-4 rounded-2xl border ${currentTheme.isDark ? 'border-emerald-900/30 text-emerald-500 hover:bg-emerald-900/10' : 'border-slate-100 text-slate-600 hover:bg-slate-50'} text-xs font-bold transition-all flex items-center justify-center gap-2`}
                  >
                    <Copy size={16} />
                    {t.generateMemo}
                  </button>
                )}

                <button type="submit" className="w-full bg-emerald-600 hover:bg-emerald-700 text-white py-5 rounded-2xl font-black text-sm transition-all shadow-xl shadow-emerald-500/20">
                  {t.submit}
                </button>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* --- Calendar Day Modal --- */}
      <AnimatePresence>
        {showCalendarModal && selectedCalendarDay && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowCalendarModal(false)}
              className="absolute inset-0 bg-slate-900/60 backdrop-blur-md"
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.9, y: 40 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 40 }}
              className={`relative ${currentTheme.card} w-full max-w-lg rounded-[3rem] shadow-2xl border ${currentTheme.border} overflow-hidden`}
            >
              <div className="p-8 border-b border-slate-50 flex justify-between items-center bg-[#0F172A] text-white" style={{ backgroundColor: currentTheme.header }}>
                <h2 className="text-xl font-bold flex flex-col">
                  <span className="text-sm opacity-70 uppercase tracking-widest font-black">{getDayName(selectedCalendarDay.getDay())}</span>
                  <span>{selectedCalendarDay.toLocaleDateString(lang === 'en' ? 'en-US' : 'fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })}</span>
                </h2>
                <button onClick={() => setShowCalendarModal(false)} className="p-2 hover:bg-white/10 rounded-xl transition-all">
                  <X size={20} />
                </button>
              </div>

              <div className="p-10 space-y-8 max-h-[60vh] overflow-y-auto custom-scrollbar">
                {(() => {
                  const dayEvents = getEventsForDay(selectedCalendarDay);
                  if (dayEvents.length === 0) {
                    return (
                      <div className="py-10 text-center">
                        <div className={`w-16 h-16 rounded-full ${currentTheme.isDark ? 'bg-emerald-900/20 text-emerald-500' : 'bg-slate-100 text-slate-400'} flex items-center justify-center mx-auto mb-4`}>
                          <Calendar size={32} />
                        </div>
                        <p className={currentTheme.muted}>{lang === 'en' ? 'No financial tasks for this day' : 'Aucune tâche financière pour ce jour'}</p>
                      </div>
                    );
                  }

                  return (
                    <div className="space-y-6">
                      {dayEvents.map((event, idx) => (
                        <div key={idx} className={`p-6 rounded-2xl border ${currentTheme.border} ${
                          event.type === 'due' ? 'bg-rose-50/30' :
                          event.type === 'salary' ? 'bg-emerald-50/30' :
                          'bg-blue-50/30'
                        }`}>
                          <div className="flex items-center gap-4 mb-4">
                            <div className={`p-3 rounded-xl ${
                              event.type === 'due' ? 'bg-rose-100 text-rose-600' :
                              event.type === 'salary' ? 'bg-emerald-100 text-emerald-600' :
                              'bg-blue-100 text-blue-600'
                            }`}>
                              {event.type === 'due' ? <Users size={20} /> : event.type === 'salary' ? <Briefcase size={20} /> : <Receipt size={20} />}
                            </div>
                            <div>
                              <h4 className={`font-black uppercase tracking-widest text-[10px] ${
                                event.type === 'due' ? 'text-rose-600' :
                                event.type === 'salary' ? 'text-emerald-600' :
                                'text-blue-600'
                              }`}>
                                {event.type === 'due' ? (lang === 'en' ? 'Student Fees Due' : 'Frais Scolaires Dus') : 
                                 event.type === 'salary' ? (lang === 'en' ? 'Staff Salaries' : 'Salaires du Personnel') : 
                                 (lang === 'en' ? 'Expenses' : 'Dépenses')}
                              </h4>
                              <p className={`text-lg font-bold ${currentTheme.isDark ? 'text-emerald-400' : 'text-slate-800'}`}>
                                {event.count}
                              </p>
                            </div>
                          </div>
                          
                          <div className="space-y-2">
                            {event.details?.map((detail, dIdx) => (
                              <div key={dIdx} className={`flex justify-between items-center text-sm py-2 border-t ${currentTheme.border}`}>
                                <span className={currentTheme.muted}>{detail.name}</span>
                                <span className={`font-bold ${currentTheme.isDark ? 'text-emerald-500' : 'text-slate-800'}`}>{formatCurrency(detail.amount)}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  );
                })()}
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* --- Success Toast --- */}
      <AnimatePresence>
        {showSuccessToast && (
          <motion.div 
            initial={{ opacity: 0, y: 100 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 100 }}
            className="fixed bottom-10 left-1/2 -translate-x-1/2 z-[60] bg-emerald-600 text-white px-8 py-4 rounded-2xl shadow-2xl flex items-center gap-3 font-bold"
          >
            <CheckCircle2 size={20} />
            {t.successMessage}
          </motion.div>
        )}
      </AnimatePresence>

      {/* --- Welcome Toast --- */}
      <AnimatePresence>
        {welcomeMessage && (
          <motion.div 
            initial={{ opacity: 0, y: -100, scale: 0.9 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -100, scale: 0.9 }}
            className="fixed top-10 left-1/2 -translate-x-1/2 z-[110] bg-slate-900 text-white dark:bg-emerald-600 px-8 py-5 rounded-3xl shadow-2xl flex items-center gap-4 font-black text-sm border-2 border-emerald-500/20"
          >
            <div className="w-8 h-8 bg-emerald-500 rounded-xl flex items-center justify-center text-white">
              <ShieldCheck size={18} />
            </div>
            <div className="text-left">
              <p className="leading-tight">{welcomeMessage}</p>
              <p className="text-[10px] text-white/60 font-medium">
                {currentUser?.role === 'dev'
                  ? (lang === 'en' ? 'System Developer Portal' : 'Portail Développeur Système')
                  : currentUser?.role === 'admin' 
                  ? (lang === 'en' ? 'Promoter / Owner Portal' : 'Portail Promoteur / Propriétaire') 
                  : (lang === 'en' ? 'Accountant Access' : 'Accès Comptable')}
              </p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* --- To-Do Sidebar --- */}
      <AnimatePresence>
        {showTodoSidebar && (
          <motion.aside 
            initial={{ x: 320 }}
            animate={{ x: 0 }}
            exit={{ x: 320 }}
            className={`fixed right-0 top-0 h-full w-80 ${currentTheme.card} border-l ${currentTheme.border} shadow-2xl z-30 flex flex-col`}
          >
            <div className="p-8 border-b border-slate-50 flex justify-between items-center bg-[#0F172A] text-white" style={{ backgroundColor: currentTheme.header }}>
              <h3 className="text-lg font-bold flex items-center gap-3">
                {productivitySidebarTab === 'tasks' ? (
                  <>
                    <CheckSquare size={20} className="text-amber-400" />
                    <span data-i18n="todoList">{t.todoList}</span>
                  </>
                ) : (
                  <>
                    <Sparkles size={20} className="text-blue-400" />
                    <span data-i18n="aiTitle">{t.aiTitle}</span>
                  </>
                )}
              </h3>
              <button 
                onClick={() => setShowTodoSidebar(false)}
                className="p-2 hover:bg-white/10 rounded-xl transition-all"
              >
                <X size={20} />
              </button>
            </div>

            {/* Tab switch */}
            <div className="flex border-b border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/10">
              <button 
                onClick={() => setProductivitySidebarTab('tasks')}
                className={`flex-1 py-3 text-center text-xs font-black uppercase tracking-widest border-b-2 transition-all ${productivitySidebarTab === 'tasks' ? 'border-blue-600 text-blue-600' : 'border-transparent text-slate-400 hover:text-slate-600'}`}
              >
                {lang === 'en' ? 'To-Do' : 'Tâches'}
              </button>
              <button 
                onClick={() => setProductivitySidebarTab('ai')}
                className={`flex-1 py-3 text-center text-xs font-black uppercase tracking-widest border-b-2 transition-all ${productivitySidebarTab === 'ai' ? 'border-blue-600 text-blue-600' : 'border-transparent text-slate-400 hover:text-slate-600'}`}
              >
                {lang === 'en' ? 'AI Assistant' : 'Assistant IA'}
              </button>
            </div>

            {productivitySidebarTab === 'ai' ? (
              <div className="flex-1 flex flex-col min-h-0 bg-slate-50/20 dark:bg-slate-900/5">
                {/* Messages list */}
                <div className="flex-1 overflow-y-auto p-6 space-y-4 custom-scrollbar">
                  {aiMessages.map((msg, idx) => (
                    <div key={idx} className={`flex ${msg.sender === 'user' ? 'justify-end' : 'justify-start'}`}>
                      <div className={`max-w-[85%] rounded-2xl px-4 py-3 text-xs font-semibold ${msg.sender === 'user' ? 'bg-blue-600 text-white' : (currentTheme.isDark ? 'bg-slate-800 text-emerald-400 border border-emerald-900/20' : 'bg-slate-100 text-slate-700')}`}>
                        <p className="leading-relaxed whitespace-pre-wrap">{msg.text}</p>
                      </div>
                    </div>
                  ))}
                </div>

                {/* Suggestions Chips */}
                <div className="px-6 py-4 border-t border-slate-100 dark:border-slate-800 space-y-2">
                  <span className="text-[10px] font-black uppercase tracking-widest text-slate-400 block">
                    {lang === 'en' ? 'Quick Questions' : 'Questions Rapides'}
                  </span>
                  <div className="flex flex-col gap-1.5 max-h-36 overflow-y-auto custom-scrollbar">
                    <button 
                      onClick={() => handleAiQuery(t.aiQuickQuestion1)}
                      className={`text-[10px] font-bold px-3 py-2 rounded-xl border ${currentTheme.border} ${currentTheme.card} ${currentTheme.isDark ? 'hover:bg-slate-800 text-emerald-400' : 'hover:bg-slate-50 text-slate-700'} text-left transition-all truncate`}
                    >
                      💡 {t.aiQuickQuestion1}
                    </button>
                    <button 
                      onClick={() => handleAiQuery(t.aiQuickQuestion2)}
                      className={`text-[10px] font-bold px-3 py-2 rounded-xl border ${currentTheme.border} ${currentTheme.card} ${currentTheme.isDark ? 'hover:bg-slate-800 text-emerald-400' : 'hover:bg-slate-50 text-slate-700'} text-left transition-all truncate`}
                    >
                      💡 {t.aiQuickQuestion2}
                    </button>
                    <button 
                      onClick={() => handleAiQuery(t.aiQuickQuestion3)}
                      className={`text-[10px] font-bold px-3 py-2 rounded-xl border ${currentTheme.border} ${currentTheme.card} ${currentTheme.isDark ? 'hover:bg-slate-800 text-emerald-400' : 'hover:bg-slate-50 text-slate-700'} text-left transition-all truncate`}
                    >
                      💡 {t.aiQuickQuestion3}
                    </button>
                    <button 
                      onClick={() => handleAiQuery(t.aiQuickQuestion4)}
                      className={`text-[10px] font-bold px-3 py-2 rounded-xl border ${currentTheme.border} ${currentTheme.card} ${currentTheme.isDark ? 'hover:bg-slate-800 text-emerald-400' : 'hover:bg-slate-50 text-slate-700'} text-left transition-all truncate`}
                    >
                      💡 {t.aiQuickQuestion4}
                    </button>
                  </div>
                </div>

                {/* Ask Form */}
                <form 
                  onSubmit={(e) => {
                    e.preventDefault();
                    handleAiQuery(aiInput);
                  }}
                  className="p-6 border-t border-slate-100 dark:border-slate-800 flex gap-2 bg-white dark:bg-slate-900"
                >
                  <input 
                    type="text"
                    value={aiInput}
                    onChange={(e) => setAiInput(e.target.value)}
                    placeholder={t.aiAskPlaceholder}
                    className={`flex-1 px-4 py-3 bg-white ${currentTheme.isDark ? 'bg-slate-800 text-emerald-500 border-emerald-900/20' : 'border-slate-200 text-slate-800'} border rounded-xl text-xs font-semibold`}
                  />
                  <button 
                    type="submit"
                    className="bg-blue-600 hover:bg-blue-700 text-white p-3 rounded-xl transition-all flex items-center justify-center flex-shrink-0"
                  >
                    <Sparkles size={16} />
                  </button>
                </form>
              </div>
            ) : (
              <div className="flex-1 overflow-y-auto p-8 space-y-6 custom-scrollbar">
                <form onSubmit={handleAddTodo} className="space-y-3">
                  <input 
                    type="text"
                    value={todoInput}
                    onChange={(e) => setTodoInput(e.target.value)}
                    placeholder={t.taskPlaceholder}
                    className={`w-full px-5 py-4 ${currentTheme.isDark ? 'bg-emerald-900/10' : 'bg-slate-50'} border ${currentTheme.border} rounded-2xl focus:outline-none focus:ring-4 focus:ring-blue-500/5 focus:border-blue-500 transition-all text-sm font-semibold ${currentTheme.isDark ? 'text-emerald-500' : 'text-slate-800'}`}
                  />
                  <button 
                    type="submit"
                    className="w-full bg-blue-600 hover:bg-blue-700 text-white py-4 rounded-2xl font-black text-xs transition-all flex items-center justify-center gap-2"
                  >
                    <Plus size={16} />
                    <span data-i18n="addTask">{t.addTask}</span>
                  </button>
                </form>

                <div className="space-y-3">
                  {todos.map(todo => (
                    <motion.div 
                      layout
                      key={todo.id}
                      className={`flex items-center justify-between p-4 rounded-2xl border transition-all ${todo.completed ? (currentTheme.isDark ? 'bg-emerald-900/10 border-emerald-900/20 opacity-60' : 'bg-slate-50 border-slate-100 opacity-60') : (currentTheme.isDark ? 'bg-emerald-900/20 border-emerald-800/50 shadow-sm' : 'bg-white border-slate-100 shadow-sm')}`}
                    >
                      <div className="flex items-center gap-3 flex-1">
                        <button 
                          onClick={() => toggleTodo(todo.id)}
                          className={`w-6 h-6 rounded-lg border-2 flex items-center justify-center transition-all ${todo.completed ? 'bg-emerald-500 border-emerald-500 text-white' : 'border-slate-200 hover:border-blue-400'}`}
                        >
                          {todo.completed && <CheckCircle2 size={14} />}
                        </button>
                        <span className={`text-sm font-bold ${todo.completed ? (currentTheme.isDark ? 'text-emerald-500/50 line-through' : 'text-slate-400 line-through') : (currentTheme.isDark ? 'text-emerald-500' : 'text-slate-700')}`}>
                          {todo.text}
                        </span>
                      </div>
                      <button 
                        onClick={() => deleteTodo(todo.id)}
                        className={`p-2 ${currentTheme.muted} hover:text-rose-500 transition-all`}
                      >
                        <Trash2 size={16} />
                      </button>
                    </motion.div>
                  ))}
                </div>
              </div>
            )}
          </motion.aside>
        )}
      </AnimatePresence>

      {/* --- Payment Entry Modal --- */}
      <AnimatePresence>
        {showPaymentForm && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowPaymentForm(false)}
              className="absolute inset-0 bg-slate-900/60 backdrop-blur-md"
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.9, y: 40 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 40 }}
              className={`relative ${currentTheme.card} w-full max-w-md rounded-[3rem] shadow-2xl border ${currentTheme.border} overflow-hidden`}
            >
              <div className="p-8 border-b border-slate-50 flex justify-between items-center bg-[#0F172A] text-white" style={{ backgroundColor: currentTheme.header }}>
                <h2 className="text-xl font-bold flex items-center gap-3">
                  <CreditCard size={24} className="text-blue-400" />
                  {t.paymentEntry}
                </h2>
                <button 
                  onClick={() => setShowPaymentForm(false)}
                  className="p-2 hover:bg-white/10 rounded-xl transition-all"
                >
                  <X size={20} />
                </button>
              </div>

              <form onSubmit={handlePaymentSubmit} className="p-10 space-y-8">
                <div className="space-y-2">
                  <label className={`text-[10px] font-black ${currentTheme.muted} uppercase tracking-widest`}>{t.selectStudent}</label>
                  <select 
                    required
                    value={paymentStudentId}
                    onChange={(e) => setPaymentStudentId(e.target.value)}
                    className={`w-full px-6 py-4 ${currentTheme.isDark ? 'bg-emerald-900/10' : 'bg-slate-50'} border ${currentTheme.border} rounded-2xl focus:outline-none focus:ring-4 focus:ring-blue-500/5 focus:border-blue-500 transition-all text-sm font-semibold ${currentTheme.isDark ? 'text-emerald-500' : 'text-slate-800'}`}
                  >
                    <option value="" className={currentTheme.isDark ? 'bg-[#121212]' : 'bg-white'}>{t.selectStudent}...</option>
                    {students.map(s => (
                      <option key={s.id} value={s.id} className={currentTheme.isDark ? 'bg-[#121212]' : 'bg-white'}>{s.name} ({formatCurrency(s.totalDue - s.amountPaid)} {t.balance})</option>
                    ))}
                  </select>
                </div>

                <div className="grid grid-cols-2 gap-6">
                  <div className="space-y-2">
                    <label className={`text-[10px] font-black ${currentTheme.muted} uppercase tracking-widest`}>{t.amount} ({t.currency})</label>
                    <div className="relative">
                      <input 
                        required
                        type="number" 
                        min="0"
                        step="1"
                        value={paymentAmount}
                        onChange={(e) => setPaymentAmount(e.target.value)}
                        className={`w-full px-6 py-4 ${currentTheme.isDark ? 'bg-emerald-900/10' : 'bg-slate-50'} border ${currentTheme.border} rounded-2xl focus:outline-none focus:ring-4 focus:ring-blue-500/5 focus:border-blue-500 transition-all text-sm font-semibold ${currentTheme.isDark ? 'text-emerald-500' : 'text-slate-800'}`}
                        placeholder="10 000"
                      />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <label className={`text-[10px] font-black ${currentTheme.muted} uppercase tracking-widest`}>{t.paymentDate}</label>
                    <input 
                      required
                      type="date" 
                      value={paymentDate}
                      onChange={(e) => setPaymentDate(e.target.value)}
                      className={`w-full px-6 py-4 ${currentTheme.isDark ? 'bg-emerald-900/10' : 'bg-slate-50'} border ${currentTheme.border} rounded-2xl focus:outline-none focus:ring-4 focus:ring-blue-500/5 focus:border-blue-500 transition-all text-sm font-semibold ${currentTheme.isDark ? 'text-emerald-500' : 'text-slate-800'}`}
                    />
                  </div>
                </div>

                <button 
                  type="submit"
                  className="w-full bg-blue-600 hover:bg-blue-700 text-white py-5 rounded-2xl font-black text-sm transition-all shadow-xl shadow-blue-500/20 active:scale-[0.98]"
                >
                  {t.submit}
                </button>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* --- Yearly Final Audit Sheet Modal --- */}
      <AnimatePresence>
        {showAuditModal && auditYear && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 no-print">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowAuditModal(false)}
              className="absolute inset-0 bg-slate-900/60 backdrop-blur-md"
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className={`relative ${currentTheme.card} w-full max-w-4xl max-h-[85vh] overflow-y-auto rounded-[2.5rem] shadow-2xl border ${currentTheme.border} p-8 md:p-12 custom-scrollbar`}
            >
              {/* Modal header */}
              <div className="flex justify-between items-start mb-8 pb-6 border-b border-slate-100 dark:border-slate-800">
                <div className="flex items-center gap-4">
                  <div className="p-3 bg-emerald-50 text-emerald-600 rounded-2xl">
                    <TrendingUp size={24} />
                  </div>
                  <div>
                    <h3 className={`text-2xl font-black ${currentTheme.text}`}>
                      {lang === 'en' ? 'Final Academic Audit Sheet' : 'Bilan de Clôture Annuel'}
                    </h3>
                    <p className={`text-sm ${currentTheme.muted} mt-0.5`}>
                      {lang === 'en' ? `Certified financial review for the academic year ${auditYear}` : `Bilan financier certifié pour l'année académique ${auditYear}`}
                    </p>
                  </div>
                </div>
                <button 
                  onClick={() => setShowAuditModal(false)}
                  className={`p-2 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-xl transition-all ${currentTheme.muted}`}
                >
                  <X size={20} />
                </button>
              </div>

              {/* Certified Document Content Preview */}
              <div className="p-8 border-2 border-slate-100 dark:border-slate-800 rounded-3xl bg-slate-50/50 dark:bg-slate-800/10 space-y-8 font-sans">
                {/* School Letterhead */}
                <div className="flex justify-between items-start border-b-2 border-slate-200 dark:border-slate-700 pb-6">
                  <div>
                    <h4 className="text-xl font-black text-slate-800 dark:text-slate-200 tracking-tight flex items-center gap-2">
                      {schoolLogo && (
                        <img src={schoolLogo} alt="Logo" className="w-8 h-8 rounded-lg object-cover" referrerPolicy="no-referrer" />
                      )}
                      {t.title}
                    </h4>
                    <p className="text-xs text-slate-500 mt-1 uppercase tracking-wider font-bold">{t.subtitle}</p>
                    <p className="text-[10px] text-slate-400">Ségou, Mali</p>
                  </div>
                  <div className="text-right">
                    <span className="px-3 py-1 bg-emerald-100 text-emerald-800 text-[10px] font-black rounded-full uppercase tracking-wider">
                      {lang === 'en' ? 'ARCHIVED & CERTIFIED' : 'ARCHIVÉ & CERTIFIÉ'}
                    </span>
                    <p className="text-xs text-slate-500 mt-2 font-bold">{lang === 'en' ? 'Date:' : 'Date de Clôture :'} {new Date().toLocaleDateString(lang === 'en' ? 'en-US' : 'fr-FR')}</p>
                    <p className="text-[10px] text-slate-400">{lang === 'en' ? 'Audit ID:' : 'ID Bilan :'} AUD-{auditYear}-{Math.floor(1000 + Math.random() * 9000)}</p>
                  </div>
                </div>

                {/* Main Metrics Aggregation */}
                {(() => {
                  const { revenue, expenses, balance } = getYearStats(auditYear);
                  return (
                    <div className="space-y-6">
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                        <div className="p-6 bg-emerald-50/50 dark:bg-emerald-950/10 rounded-2xl border border-emerald-100 dark:border-emerald-950">
                          <span className="text-xs font-bold text-emerald-700 dark:text-emerald-400 uppercase tracking-wider">{lang === 'en' ? 'Total Revenue (A)' : 'Recettes Totales (A)'}</span>
                          <p className="text-2xl font-black text-emerald-600 mt-1">{formatCurrency(revenue)}</p>
                          <p className="text-[10px] text-slate-400 mt-1">{lang === 'en' ? 'Actual student fees paid' : 'Frais de scolarité effectivement perçus'}</p>
                        </div>

                        <div className="p-6 bg-rose-50/50 dark:bg-rose-950/10 rounded-2xl border border-rose-100 dark:border-rose-950">
                          <span className="text-xs font-bold text-rose-700 dark:text-rose-400 uppercase tracking-wider">{lang === 'en' ? 'Total Expenses (B)' : 'Dépenses Totales (B)'}</span>
                          <p className="text-2xl font-black text-rose-600 mt-1">{formatCurrency(expenses)}</p>
                          <p className="text-[10px] text-slate-400 mt-1">{lang === 'en' ? 'Salaries, vendors & utility payments' : 'Salaires, fournisseurs & factures payées'}</p>
                        </div>

                        <div className={`p-6 ${balance >= 0 ? 'bg-teal-50/50 dark:bg-teal-950/10 border-teal-100 dark:border-teal-950' : 'bg-red-50/50 dark:bg-red-950/10 border-red-100 dark:border-red-950'} rounded-2xl border`}>
                          <span className={`text-xs font-bold ${balance >= 0 ? 'text-teal-700 dark:text-teal-400' : 'text-red-700 dark:text-red-400'} uppercase tracking-wider`}>{lang === 'en' ? 'Net Balance (A - B)' : 'Solde Net de Clôture (A - B)'}</span>
                          <p className={`text-2xl font-black ${balance >= 0 ? 'text-teal-600' : 'text-red-600'} mt-1`}>{formatCurrency(balance)}</p>
                          <p className="text-[10px] text-slate-400 mt-1">{lang === 'en' ? 'Final cash ledger balance' : 'Fonds de caisse net en clôture'}</p>
                        </div>
                      </div>

                      {/* Debts Carried Over (Reliquats) */}
                      {(() => {
                        const closedYearStudents = students.filter(s => s.academicYear === auditYear || (!s.academicYear && auditYear === '2024-2025'));
                        const studentsWithDebt = closedYearStudents.filter(s => {
                          const discount = s.scholarshipDiscount || 0;
                          const discountedTotal = s.totalDue * (1 - discount / 100);
                          return (discountedTotal - s.amountPaid) > 0;
                        });

                        return (
                          <div className="space-y-3 pt-4 border-t border-slate-200 dark:border-slate-700">
                            <h5 className="font-extrabold text-sm text-slate-700 dark:text-slate-300 uppercase tracking-wider">
                              {lang === 'en' ? 'Outstanding Parent Debts Carried Forward' : 'Rapport des Arriérés de Frais Reportés (Reliquats)'}
                            </h5>
                            {studentsWithDebt.length > 0 ? (
                              <div className="max-h-[200px] overflow-y-auto rounded-2xl border border-slate-100 dark:border-slate-800">
                                <table className="w-full text-left text-xs">
                                  <thead>
                                    <tr className="bg-slate-100 dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700 font-bold text-slate-600 dark:text-slate-300">
                                      <th className="px-4 py-2.5">{lang === 'en' ? 'Student Name' : 'Nom de l\'Élève'}</th>
                                      <th className="px-4 py-2.5">{lang === 'en' ? 'Parent Contact' : 'Parent / Contact'}</th>
                                      <th className="px-4 py-2.5 text-right">{lang === 'en' ? 'Unpaid Balance' : 'Montant Arriéré'}</th>
                                    </tr>
                                  </thead>
                                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                                    {studentsWithDebt.map(student => {
                                      const discount = student.scholarshipDiscount || 0;
                                      const discountedTotal = student.totalDue * (1 - discount / 100);
                                      const debt = discountedTotal - student.amountPaid;
                                      return (
                                        <tr key={student.id} className="text-slate-700 dark:text-slate-300">
                                          <td className="px-4 py-2 font-bold">{student.name}</td>
                                          <td className="px-4 py-2">{student.parentName} ({student.parentPhone})</td>
                                          <td className="px-4 py-2 text-right font-semibold text-rose-600">{formatCurrency(debt)}</td>
                                        </tr>
                                      );
                                    })}
                                  </tbody>
                                </table>
                              </div>
                            ) : (
                              <p className="text-xs text-slate-400 italic">
                                {lang === 'en' ? 'No outstanding student debts recorded for carryforward.' : 'Aucun arriéré de frais à reporter.'}
                              </p>
                            )}
                          </div>
                        );
                      })()}
                    </div>
                  );
                })()}

                {/* Audit Signature Block */}
                <div className="flex justify-between items-center pt-8 border-t-2 border-slate-200 dark:border-slate-700 text-xs">
                  <div>
                    <p className="font-bold text-slate-500">{lang === 'en' ? 'Certified by:' : 'Rapport préparé par :'}</p>
                    <p className="font-black text-slate-800 dark:text-slate-200 mt-1">Ibrahim Thera, Portal Admin</p>
                    <p className="text-slate-400 text-[10px]">{lang === 'en' ? 'Finance Controller' : 'Directeur Administratif et Financier'}</p>
                  </div>
                  <div className="text-right">
                    <p className="font-bold text-slate-500">{lang === 'en' ? 'Seal / Signature' : 'Sceau & Signature'}</p>
                    <div className="h-10 w-40 border-b border-dashed border-slate-300 dark:border-slate-600 mt-2 ml-auto" />
                    <p className="text-[9px] text-slate-400 mt-1">Ibrahim Thera / Executive Signature</p>
                  </div>
                </div>
              </div>

              {/* Modal Actions */}
              <div className="flex justify-end gap-4 mt-8 pt-6 border-t border-slate-100 dark:border-slate-800">
                <button 
                  onClick={() => setShowAuditModal(false)}
                  className={`px-6 py-3 rounded-2xl border ${currentTheme.border} ${currentTheme.text} hover:bg-slate-50 text-sm font-bold transition-all`}
                >
                  {lang === 'en' ? 'Close Preview' : 'Fermer l\'Aperçu'}
                </button>
                <button 
                  onClick={() => {
                    setTimeout(() => window.print(), 100);
                  }}
                  className="bg-emerald-600 hover:bg-emerald-700 text-white font-extrabold px-8 py-3 rounded-2xl text-sm transition-all flex items-center gap-2 shadow-lg shadow-emerald-600/20"
                >
                  <Printer size={18} />
                  {t.printAudit}
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* --- Personalized Late Payment Ticket Modal --- */}
      <AnimatePresence>
        {ticketStudent && (() => {
          const discount = ticketStudent.scholarshipDiscount || 0;
          const discountedTotal = ticketStudent.totalDue * (1 - discount / 100);
          const balance = discountedTotal - ticketStudent.amountPaid;
          
          return (
            <div className="fixed inset-0 z-50 flex items-center justify-center p-4 no-print">
              <motion.div 
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                onClick={() => setTicketStudent(null)}
                className="absolute inset-0 bg-slate-900/60 backdrop-blur-md"
              />
              <motion.div 
                initial={{ opacity: 0, scale: 0.9, y: 40 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.9, y: 40 }}
                className={`relative ${currentTheme.card} w-full max-w-lg rounded-[3rem] shadow-2xl border ${currentTheme.border} overflow-hidden`}
              >
                <div className="p-8 border-b border-slate-50 flex justify-between items-center bg-[#0F172A] text-white" style={{ backgroundColor: currentTheme.header }}>
                  <h2 className="text-xl font-bold flex items-center gap-3">
                    <Printer size={24} className="text-rose-400" />
                    {lang === 'en' ? 'Late Payment Ticket' : 'Ticket de retard de paiement'}
                  </h2>
                  <button 
                    onClick={() => setTicketStudent(null)}
                    className="p-2 hover:bg-white/10 rounded-xl transition-all"
                  >
                    <X size={20} />
                  </button>
                </div>

                <div className="p-10 space-y-6 max-h-[60vh] overflow-y-auto custom-scrollbar">
                  {/* Visual Slip Preview on Screen */}
                  <div className="border border-slate-200 rounded-2xl p-6 bg-slate-50 font-mono text-xs text-slate-800 space-y-4 shadow-inner">
                    <div className="text-center border-b border-dashed border-slate-300 pb-4">
                      <h3 className="font-bold text-base uppercase tracking-wider">{t.title}</h3>
                      <p className="text-[10px] text-slate-500">{t.subtitle}</p>
                      <h4 className="font-black text-rose-600 mt-2 text-sm uppercase tracking-widest">
                        {lang === 'en' ? 'LATE PAYMENT TICKET' : 'TICKET DE RETARD'}
                      </h4>
                    </div>

                    <div className="space-y-2 py-2">
                      <div className="flex justify-between">
                        <span className="font-bold">STUDENT:</span>
                        <span>{ticketStudent.name}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="font-bold">GRADE:</span>
                        <span>Classe : {getGradeDisplay(ticketStudent.grade, 'fr')} / Grade: {getGradeDisplay(ticketStudent.grade, 'en')}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="font-bold">PARENT:</span>
                        <span>{ticketStudent.parentName}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="font-bold">DUE DATE:</span>
                        <span>{formatDate(ticketStudent.dueDate)}</span>
                      </div>
                      <div className="flex justify-between border-t border-dashed border-slate-300 pt-2 text-rose-600 font-bold">
                        <span>TOTAL OWED:</span>
                        <span>{formatCurrency(balance)}</span>
                      </div>
                    </div>

                    <div className="border-t border-dashed border-slate-300 pt-4 text-center text-[10px] text-slate-600 leading-relaxed italic">
                      {lang === 'en' ? (
                        'Notice: This account is more than 2 months overdue. Please contact the finance department immediately to settle the outstanding balance.'
                      ) : (
                        'Avis : Ce compte accuse un retard de plus de 2 mois. Veuillez contacter le service financier immédiatement pour régulariser le solde.'
                      )}
                    </div>
                  </div>

                  <div className="flex gap-4">
                    <button 
                      onClick={() => {
                        setTimeout(() => window.print(), 100);
                      }}
                      className="flex-1 bg-rose-600 hover:bg-rose-700 text-white py-4 rounded-2xl font-black text-sm transition-all shadow-xl shadow-rose-500/20 flex items-center justify-center gap-2"
                    >
                      <Printer size={18} />
                      {lang === 'en' ? 'Print Ticket' : 'Imprimer le ticket'}
                    </button>
                    <button 
                      onClick={() => setTicketStudent(null)}
                      className={`px-8 py-4 border ${currentTheme.border} ${currentTheme.muted} hover:text-slate-600 hover:bg-slate-50 rounded-2xl font-bold text-sm transition-all`}
                    >
                      {t.close}
                    </button>
                  </div>
                </div>
              </motion.div>
            </div>
          );
        })()}
      </AnimatePresence>

      {/* --- Actual Printable Ticket Hidden on Screen --- */}
      {ticketStudent && (() => {
        const discount = ticketStudent.scholarshipDiscount || 0;
        const discountedTotal = ticketStudent.totalDue * (1 - discount / 100);
        const balance = discountedTotal - ticketStudent.amountPaid;
        
        return (
          <div className="hidden print:block ticket-print-container font-mono text-sm text-black space-y-6">
            <div className="text-center border-b border-black pb-4">
              <h1 className="font-bold text-xl uppercase tracking-wider">{t.title}</h1>
              <p className="text-xs text-black/70">{t.subtitle}</p>
              <h2 className="font-bold text-lg mt-3 uppercase tracking-widest border border-black px-2 py-1 inline-block">
                {lang === 'en' ? 'LATE PAYMENT TICKET' : 'TICKET DE RETARD'}
              </h2>
            </div>

            <div className="space-y-3 py-2 text-base">
              <div className="flex justify-between">
                <span className="font-bold">STUDENT:</span>
                <span>{ticketStudent.name}</span>
              </div>
              <div className="flex justify-between">
                <span className="font-bold">GRADE:</span>
                <span>Classe : {getGradeDisplay(ticketStudent.grade, 'fr')} / Grade: {getGradeDisplay(ticketStudent.grade, 'en')}</span>
              </div>
              <div className="flex justify-between">
                <span className="font-bold">PARENT:</span>
                <span>{ticketStudent.parentName}</span>
              </div>
              <div className="flex justify-between">
                <span className="font-bold">DUE DATE:</span>
                <span>{formatDate(ticketStudent.dueDate)}</span>
              </div>
              <div className="flex justify-between border-t border-black pt-2 font-bold text-lg">
                <span>TOTAL OWED:</span>
                <span>{formatCurrency(balance)}</span>
              </div>
            </div>

            <div className="border-t border-black pt-4 text-center text-xs leading-relaxed font-bold italic">
              {lang === 'en' ? (
                'Notice: This account is more than 2 months overdue. Please contact the finance department immediately to settle the outstanding balance.'
              ) : (
                'Avis : Ce compte accuse un retard de plus de 2 mois. Veuillez contacter le service financier immédiatement pour régulariser le solde.'
              )}
            </div>

            <div className="text-center text-[10px] pt-8 border-t border-black/10">
              <p>{lang === 'en' ? 'Generated on:' : 'Généré le :'} {formatDate(new Date().toISOString())}</p>
              <p className="mt-2 text-[8px] tracking-widest uppercase">Official Financial Receipt</p>
            </div>
          </div>
        );
      })()}

      {/* --- Actual Printable Audit Report Hidden on Screen --- */}
      {auditYear && (() => {
        const { revenue, expenses, balance } = getYearStats(auditYear);
        const closedYearStudents = students.filter(s => s.academicYear === auditYear || (!s.academicYear && auditYear === '2024-2025'));
        const studentsWithDebt = closedYearStudents.filter(s => {
          const discount = s.scholarshipDiscount || 0;
          const discountedTotal = s.totalDue * (1 - discount / 100);
          return (discountedTotal - s.amountPaid) > 0;
        });

        return (
          <div className="hidden print:block print-container bg-white text-black font-sans space-y-8">
            <div className="text-center border-b-2 border-black pb-4">
              <h1 className="font-bold text-2xl uppercase tracking-wider">{t.title}</h1>
              <p className="text-xs text-black/70 uppercase tracking-widest">{t.subtitle}</p>
              <h2 className="font-black text-lg mt-3 uppercase tracking-wider border-2 border-black px-4 py-2 inline-block">
                {lang === 'en' ? 'FINAL ACADEMIC AUDIT REPORT' : 'BILAN COMPTABLE DE CLÔTURE'}
              </h2>
              <p className="text-sm mt-2 font-semibold">{lang === 'en' ? 'ACADEMIC YEAR' : 'ANNÉE SCOLAIRE'} : {auditYear}</p>
            </div>

            <div className="grid grid-cols-3 gap-4 text-center py-4 border-b border-black">
              <div className="border border-black p-4 rounded-xl">
                <span className="text-[10px] font-bold block uppercase tracking-wide">{lang === 'en' ? 'TOTAL REVENUE' : 'RECETTES TOTALES'}</span>
                <span className="text-lg font-black">{formatCurrency(revenue)}</span>
              </div>
              <div className="border border-black p-4 rounded-xl">
                <span className="text-[10px] font-bold block uppercase tracking-wide">{lang === 'en' ? 'TOTAL EXPENSES' : 'DÉPENSES TOTALES'}</span>
                <span className="text-lg font-black">{formatCurrency(expenses)}</span>
              </div>
              <div className="border border-black p-4 rounded-xl">
                <span className="text-[10px] font-bold block uppercase tracking-wide">{lang === 'en' ? 'NET CLOSING BALANCE' : 'SOLDE NET DE CLÔTURE'}</span>
                <span className="text-lg font-black">{formatCurrency(balance)}</span>
              </div>
            </div>

            {/* Debts Carried Over */}
            <div className="space-y-3">
              <h3 className="font-bold text-sm uppercase tracking-wider">
                {lang === 'en' ? 'Outstanding Parent Debts Carried Forward (Reliquats)' : 'Arriérés de Paiement Reportés (Reliquats)'}
              </h3>
              {studentsWithDebt.length > 0 ? (
                <table className="w-full text-left text-xs border border-black">
                  <thead>
                    <tr className="bg-slate-100 border-b border-black font-bold">
                      <th className="px-3 py-2 border-r border-black">{lang === 'en' ? 'Student Name' : 'Nom de l\'Élève'}</th>
                      <th className="px-3 py-2 border-r border-black">{lang === 'en' ? 'Parent / Contact' : 'Parent / Contact'}</th>
                      <th className="px-3 py-2 text-right">{lang === 'en' ? 'Debt Carried Over' : 'Arriéré Reporté'}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-black">
                    {studentsWithDebt.map(student => {
                      const discount = student.scholarshipDiscount || 0;
                      const discountedTotal = student.totalDue * (1 - discount / 100);
                      const debt = discountedTotal - student.amountPaid;
                      return (
                        <tr key={student.id}>
                          <td className="px-3 py-2 border-r border-black font-bold">{student.name}</td>
                          <td className="px-3 py-2 border-r border-black">{student.parentName} ({student.parentPhone})</td>
                          <td className="px-3 py-2 text-right font-bold">{formatCurrency(debt)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              ) : (
                <p className="text-xs italic">{lang === 'en' ? 'No outstanding student debts recorded.' : 'Aucun arriéré de frais à reporter.'}</p>
              )}
            </div>

            {/* Certified signature block */}
            <div className="flex justify-between items-center pt-12 border-t border-black text-xs">
              <div>
                <p className="font-bold">{lang === 'en' ? 'Certified Sincerely by:' : 'Certifié sincère et conforme par :'}</p>
                <p className="font-black mt-1">Ibrahim Thera, Executive Admin</p>
                <p className="text-black/60 text-[10px]">{lang === 'en' ? 'School Director / Controller' : 'Directeur Administratif et Financier'}</p>
              </div>
              <div className="text-right">
                <p className="font-bold">{lang === 'en' ? 'Authorized Signature' : 'Signature Autorisée'}</p>
                <div className="h-12 w-48 border-b border-dashed border-black mt-2 ml-auto" />
                <p className="text-[8px] text-black/60 mt-1">Ibrahim Thera / Official Board Seal</p>
              </div>
            </div>

            <div className="text-center text-[10px] pt-8 border-t border-black/10">
              <p>{lang === 'en' ? 'System Certified Closing Document' : 'Document de clôture certifié par le système'}</p>
              <p className="mt-1 font-bold">Finance Exécutive Admin Portal</p>
            </div>
          </div>
        );
      })()}

      {/* --- Actual Printable Student File Hidden on Screen --- */}
      {printStudentFile && (() => {
        return (
          <div className="hidden print:block print-student-file-container bg-white text-black font-sans p-12 space-y-8">
            {/* Header / Logo banner */}
            <div className="flex justify-between items-start border-b-2 border-black pb-6">
              <div>
                <h1 className="font-black text-2xl tracking-tight text-slate-900">COMPLEXE SCOLAIRE MAMA THERA</h1>
                <p className="text-xs uppercase tracking-widest text-slate-500 font-bold mt-1">Official Student Profile & Academic File</p>
                <p className="text-[10px] text-slate-400 mt-0.5">Phone: +223 70 00 00 00 | Email: contact@mamathera.edu.ml</p>
              </div>
              <div className="border border-slate-300 px-4 py-2 text-center rounded-xl bg-slate-50">
                <span className="text-[9px] font-black uppercase tracking-widest block text-slate-400">STUDENT ID</span>
                <span className="font-mono font-bold text-sm text-slate-800">
                  {printStudentFile.studentId || `MT-2026-${printStudentFile.id.replace('ST', '')}`}
                </span>
              </div>
            </div>

            {/* Profile Grid: Photo and Details */}
            <div className="grid grid-cols-4 gap-8">
              {/* Photo placeholder on Left */}
              <div className="col-span-1 border-2 border-slate-300 rounded-[2rem] h-40 overflow-hidden bg-slate-50 flex items-center justify-center relative shadow-inner">
                {printStudentFile.photo ? (
                  <img 
                    src={printStudentFile.photo} 
                    alt={printStudentFile.name} 
                    className="w-full h-full object-cover" 
                    referrerPolicy="no-referrer"
                  />
                ) : (
                  <div className="text-center">
                    <Users size={32} className="text-slate-400 mx-auto mb-1" />
                    <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest">PASSPORT</span>
                  </div>
                )}
              </div>

              {/* Main Info */}
              <div className="col-span-3 space-y-4">
                <div>
                  <h2 className="text-3xl font-black text-slate-900 tracking-tight">{printStudentFile.name}</h2>
                  <div className="flex gap-4 mt-2">
                    <span className="bg-slate-100 px-3 py-1 rounded-lg text-xs font-bold uppercase">
                      Class: {getGradeDisplay(printStudentFile.grade, 'fr')}
                    </span>
                    <span className="bg-slate-100 px-3 py-1 rounded-lg text-xs font-bold uppercase">
                      Status: {printStudentFile.status || 'Active'}
                    </span>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4 text-xs">
                  <div>
                    <span className="font-bold text-slate-400 block uppercase tracking-wide">Enrollment Date</span>
                    <span className="font-semibold text-slate-800">{printStudentFile.enrollmentDate || '2026-07-16'}</span>
                  </div>
                  <div>
                    <span className="font-bold text-slate-400 block uppercase tracking-wide">Academic Year</span>
                    <span className="font-semibold text-slate-800">{printStudentFile.academicYear || '2025-2026'}</span>
                  </div>
                </div>
              </div>
            </div>

            {/* General Info & Financial Ledger Section */}
            <div className="border border-slate-300 rounded-[2rem] p-6 space-y-4">
              <h3 className="text-xs font-black uppercase tracking-widest text-slate-900 border-b pb-2">Financial Status Ledger</h3>
              <div className="grid grid-cols-3 gap-4 text-center">
                <div className="bg-slate-50 p-4 rounded-xl border border-slate-100">
                  <span className="text-[10px] font-bold text-slate-400 block uppercase">Total Tuition Due</span>
                  <span className="text-lg font-black text-slate-800">{formatCurrency(printStudentFile.totalDue)}</span>
                </div>
                <div className="bg-slate-50 p-4 rounded-xl border border-slate-100">
                  <span className="text-[10px] font-bold text-slate-400 block uppercase">{lang === 'en' ? 'Paid Tuition' : 'Scolarité Payée'}</span>
                  <span className="text-lg font-black text-emerald-600">+{formatCurrency(printStudentFile.amountPaid)}</span>
                </div>
                <div className="bg-rose-50 p-4 rounded-xl border border-rose-100">
                  <span className="text-[10px] font-bold text-rose-500 block uppercase">{lang === 'en' ? 'Remaining Balance' : 'Solde Restant Dû'}</span>
                  <span className="text-lg font-black text-rose-600">{formatCurrency(printStudentFile.totalDue - printStudentFile.amountPaid)}</span>
                </div>
              </div>
            </div>

            {/* Parent & Emergency Info */}
            <div className="grid grid-cols-2 gap-6">
              <div className="border border-slate-300 rounded-[2rem] p-6 space-y-3">
                <h3 className="text-xs font-black uppercase tracking-widest text-slate-900 border-b pb-2">{lang === 'en' ? 'Primary Guardian' : 'Tuteur Principal'}</h3>
                <div className="space-y-1.5 text-xs">
                  <p><strong className="text-slate-400">{lang === 'en' ? 'Name:' : 'Nom :'}</strong> <span className="font-bold text-slate-800">{printStudentFile.parentName}</span></p>
                  <p><strong className="text-slate-400">{lang === 'en' ? 'Phone:' : 'Téléphone :'}</strong> <span className="font-semibold text-slate-800">{printStudentFile.parentPhone}</span></p>
                  <p><strong className="text-slate-400">{lang === 'en' ? 'Email:' : 'Email :'}</strong> <span className="font-semibold text-blue-600">{printStudentFile.parentEmail}</span></p>
                </div>
              </div>

              <div className="border border-slate-300 rounded-[2rem] p-6 space-y-3">
                <h3 className="text-xs font-black uppercase tracking-widest text-rose-500 border-b pb-2">{lang === 'en' ? 'Emergency Contact' : 'Contact d\'Urgence'}</h3>
                <div className="space-y-1.5 text-xs">
                  <p><strong className="text-slate-400">{lang === 'en' ? 'Contact Person:' : 'Nom du Contact :'}</strong> <span className="font-bold text-slate-800">{printStudentFile.emergencyContactName || 'N/A'}</span></p>
                  <p><strong className="text-slate-400">{lang === 'en' ? 'Relationship:' : 'Lien de Parenté :'}</strong> <span className="font-semibold text-slate-800">{printStudentFile.emergencyContactRelation || 'N/A'}</span></p>
                  <p><strong className="text-slate-400">{lang === 'en' ? 'Phone Number:' : 'Téléphone :'}</strong> <span className="font-black text-rose-600">{printStudentFile.emergencyContactPhone || 'N/A'}</span></p>
                </div>
              </div>
            </div>

            {/* History & Medical Records */}
            <div className="border border-slate-300 rounded-[2rem] p-6 space-y-3">
              <h3 className="text-xs font-black uppercase tracking-widest text-slate-900 border-b pb-2">{lang === 'en' ? 'Medical & History File' : 'Fiche Médicale & Historique'}</h3>
              <div className="grid grid-cols-2 gap-6 text-xs">
                <div>
                  <span className="font-bold text-slate-400 block uppercase">{lang === 'en' ? 'Previous School Transfer History' : 'École Précédente / Provenance'}</span>
                  <p className="font-semibold text-slate-800 mt-1">{printStudentFile.previousSchool || (lang === 'en' ? 'None / Direct Admission Entry' : 'Aucune / Inscription Directe')}</p>
                </div>
                <div>
                  <span className="font-bold text-slate-400 block uppercase">{lang === 'en' ? 'Allergies, Medical Notes & Conditions' : 'Allergies, Notes Médicales & Conditions'}</span>
                  <p className="font-semibold text-slate-800 mt-1">{printStudentFile.medicalNotes || (lang === 'en' ? 'None / Clear profile' : 'Aucune / Profil Vierge')}</p>
                </div>
              </div>
            </div>

            {/* Signature Area */}
            <div className="flex justify-between items-center pt-12 border-t border-slate-200 text-xs">
              <div>
                <p className="font-bold">{lang === 'en' ? 'Generated and Verified Sincerely by:' : 'Généré et vérifié par :'}</p>
                <p className="font-black mt-1 text-slate-900">{currentUser?.name || 'Direction Complexe Scolaire MAMA THERA'}</p>
                <p className="text-slate-500 text-[10px]">{lang === 'en' ? 'Complexe Scolaire MAMA THERA Administration' : 'Administration Complexe Scolaire MAMA THERA'}</p>
              </div>
              <div className="text-right">
                <p className="font-bold">{lang === 'en' ? 'Official Seal & Signature' : 'Sceau Officiel & Signature'}</p>
                <div className="h-12 w-48 border-b border-dashed border-slate-400 mt-2 ml-auto" />
                <p className="text-[8px] text-slate-400 mt-1">{lang === 'en' ? 'Official Board Representative' : 'Représentant Officiel de la Direction'}</p>
              </div>
            </div>
          </div>
        );
      })()}

      {/* --- Mobile Sidebar Toggle (Simplified) --- */}
      <div className="lg:hidden fixed bottom-6 left-6 z-50">
        <button 
          onClick={() => toggleLanguage(lang === 'en' ? 'fr' : 'en')}
          className="bg-blue-600 text-white p-4 rounded-full shadow-2xl shadow-blue-500/40"
        >
          <Globe size={24} />
        </button>
      </div>

      {/* --- Add / Edit Parent Modal --- */}
      {showParentModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-fade-in no-print">
          <motion.div
            initial={{ scale: 0.95, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            className={`w-full max-w-xl ${currentTheme.card} p-8 rounded-[2rem] border ${currentTheme.border} shadow-2xl space-y-6 max-h-[90vh] overflow-y-auto`}
          >
            <div className="flex items-center justify-between pb-4 border-b border-slate-100 dark:border-slate-800">
              <h3 className={`text-xl font-black ${currentTheme.isDark ? 'text-white' : 'text-slate-900'}`}>
                {editingParent ? t.editParent : t.addParent}
              </h3>
              <button
                onClick={() => setShowParentModal(false)}
                className="p-2 text-slate-400 hover:text-slate-600 rounded-xl"
              >
                <X size={20} />
              </button>
            </div>

            <form onSubmit={handleParentSubmit} className="space-y-4">
              <div className="space-y-1">
                <label className="text-[10px] font-black uppercase tracking-widest text-slate-400">{t.parentName} *</label>
                <input
                  type="text"
                  required
                  value={parentForm.fullName}
                  onChange={(e) => setParentForm({ ...parentForm, fullName: e.target.value })}
                  placeholder="e.g. Mamadou Traoré"
                  className={`w-full p-3 text-xs font-bold rounded-xl border ${currentTheme.border} ${currentTheme.isDark ? 'bg-slate-900 text-white' : 'bg-slate-50 text-slate-800'}`}
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1">
                  <label className="text-[10px] font-black uppercase tracking-widest text-slate-400">{t.primaryPhone} *</label>
                  <input
                    type="text"
                    required
                    value={parentForm.primaryPhone}
                    onChange={(e) => setParentForm({ ...parentForm, primaryPhone: e.target.value })}
                    placeholder="+223 70 00 00 00"
                    className={`w-full p-3 text-xs font-bold rounded-xl border ${currentTheme.border} ${currentTheme.isDark ? 'bg-slate-900 text-white' : 'bg-slate-50 text-slate-800'}`}
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-[10px] font-black uppercase tracking-widest text-slate-400">{t.secondaryPhone}</label>
                  <input
                    type="text"
                    value={parentForm.secondaryPhone}
                    onChange={(e) => setParentForm({ ...parentForm, secondaryPhone: e.target.value })}
                    placeholder="+223 66 00 00 00"
                    className={`w-full p-3 text-xs font-bold rounded-xl border ${currentTheme.border} ${currentTheme.isDark ? 'bg-slate-900 text-white' : 'bg-slate-50 text-slate-800'}`}
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1">
                  <label className="text-[10px] font-black uppercase tracking-widest text-slate-400">{t.email}</label>
                  <input
                    type="email"
                    value={parentForm.email}
                    onChange={(e) => setParentForm({ ...parentForm, email: e.target.value })}
                    placeholder="parent@example.com"
                    className={`w-full p-3 text-xs font-bold rounded-xl border ${currentTheme.border} ${currentTheme.isDark ? 'bg-slate-900 text-white' : 'bg-slate-50 text-slate-800'}`}
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-[10px] font-black uppercase tracking-widest text-slate-400">{t.relationship} *</label>
                  <select
                    value={parentForm.relationship}
                    onChange={(e) => setParentForm({ ...parentForm, relationship: e.target.value })}
                    className={`w-full p-3 text-xs font-bold rounded-xl border ${currentTheme.border} ${currentTheme.isDark ? 'bg-slate-900 text-white' : 'bg-slate-50 text-slate-800'}`}
                  >
                    <option value="Father">{t.father}</option>
                    <option value="Mother">{t.mother}</option>
                    <option value="Guardian">{t.guardian}</option>
                    <option value="Uncle">{t.uncle}</option>
                    <option value="Aunt">{t.aunt}</option>
                    <option value="Other">{t.other}</option>
                  </select>
                </div>
              </div>

              <div className="space-y-1">
                <label className="text-[10px] font-black uppercase tracking-widest text-slate-400">{t.occupation} *</label>
                <input
                  type="text"
                  required
                  value={parentForm.occupation}
                  onChange={(e) => setParentForm({ ...parentForm, occupation: e.target.value })}
                  placeholder="e.g. Civil Engineer, Banker, Merchant..."
                  className={`w-full p-3 text-xs font-bold rounded-xl border ${currentTheme.border} ${currentTheme.isDark ? 'bg-slate-900 text-white' : 'bg-slate-50 text-slate-800'}`}
                />
              </div>

              <div className="space-y-1">
                <label className="text-[10px] font-black uppercase tracking-widest text-slate-400">{t.address} *</label>
                <input
                  type="text"
                  required
                  value={parentForm.address}
                  onChange={(e) => setParentForm({ ...parentForm, address: e.target.value })}
                  placeholder="e.g. Quartier Hippodrome, Bamako"
                  className={`w-full p-3 text-xs font-bold rounded-xl border ${currentTheme.border} ${currentTheme.isDark ? 'bg-slate-900 text-white' : 'bg-slate-50 text-slate-800'}`}
                />
              </div>

              <div className="space-y-1">
                <label className="text-[10px] font-black uppercase tracking-widest text-slate-400">{t.accountingNotes}</label>
                <textarea
                  rows={3}
                  value={parentForm.notes}
                  onChange={(e) => setParentForm({ ...parentForm, notes: e.target.value })}
                  placeholder="e.g. Family contact preferences or special notes..."
                  className={`w-full p-3 text-xs font-bold rounded-xl border ${currentTheme.border} ${currentTheme.isDark ? 'bg-slate-900 text-white' : 'bg-slate-50 text-slate-800'}`}
                />
              </div>

              <div className="pt-4 flex justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setShowParentModal(false)}
                  className="px-5 py-2.5 rounded-xl border border-slate-200 dark:border-slate-800 text-xs font-bold text-slate-600 dark:text-slate-400"
                >
                  {t.close}
                </button>
                <button
                  type="submit"
                  className="px-5 py-2.5 rounded-xl bg-emerald-600 text-white font-bold text-xs hover:bg-emerald-700 shadow-lg shadow-emerald-600/20"
                >
                  {t.saveChanges}
                </button>
              </div>
            </form>
          </motion.div>
        </div>
      )}

      {/* --- Link Student Modal --- */}
      {showLinkStudentModal && activeLinkingParent && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-fade-in no-print">
          <motion.div
            initial={{ scale: 0.95, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            className={`w-full max-w-md ${currentTheme.card} p-8 rounded-[2rem] border ${currentTheme.border} shadow-2xl space-y-6`}
          >
            <div className="flex items-center justify-between pb-4 border-b border-slate-100 dark:border-slate-800">
              <div>
                <h3 className={`text-lg font-black ${currentTheme.isDark ? 'text-white' : 'text-slate-900'}`}>
                  {t.linkStudent}
                </h3>
                <p className="text-xs text-slate-400">
                  {lang === 'en' ? `Attach child to ${activeLinkingParent.fullName}` : `Rattacher un enfant à ${activeLinkingParent.fullName}`}
                </p>
              </div>
              <button
                onClick={() => setShowLinkStudentModal(false)}
                className="p-2 text-slate-400 hover:text-slate-600 rounded-xl"
              >
                <X size={20} />
              </button>
            </div>

            <form onSubmit={handleLinkStudentSubmit} className="space-y-4">
              <div className="space-y-1">
                <label className="text-[10px] font-black uppercase tracking-widest text-slate-400">{t.selectStudent}</label>
                <select
                  required
                  value={studentToLinkId}
                  onChange={(e) => setStudentToLinkId(e.target.value)}
                  className={`w-full p-3 text-xs font-bold rounded-xl border ${currentTheme.border} ${currentTheme.isDark ? 'bg-slate-900 text-white' : 'bg-slate-50 text-slate-800'}`}
                >
                  <option value="">-- {t.selectStudentToLink} --</option>
                  {students.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name} ({s.studentId || s.id}) - Grade {s.grade || 'N/A'}
                    </option>
                  ))}
                </select>
              </div>

              <div className="pt-4 flex justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setShowLinkStudentModal(false)}
                  className="px-5 py-2.5 rounded-xl border border-slate-200 dark:border-slate-800 text-xs font-bold text-slate-600 dark:text-slate-400"
                >
                  {t.close}
                </button>
                <button
                  type="submit"
                  disabled={!studentToLinkId}
                  className="px-5 py-2.5 rounded-xl bg-emerald-600 text-white font-bold text-xs hover:bg-emerald-700 disabled:opacity-50 shadow-lg shadow-emerald-600/20"
                >
                  {t.linkStudent}
                </button>
              </div>
            </form>
          </motion.div>
        </div>
      )}

      {/* --- Late Payment Notification Modal (WhatsApp / SMS Generator) --- */}
      {showNotifyModal && notifyParent && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-fade-in no-print">
          <motion.div
            initial={{ scale: 0.95, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            className={`w-full max-w-xl ${currentTheme.card} p-6 sm:p-8 rounded-[2rem] border ${currentTheme.border} shadow-2xl space-y-6 max-h-[90vh] overflow-y-auto`}
          >
            {/* Modal Header */}
            <div className="flex items-start justify-between pb-4 border-b border-slate-100 dark:border-slate-800">
              <div className="flex items-center gap-3">
                <div className="p-3 rounded-2xl bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20">
                  <Bell size={24} />
                </div>
                <div>
                  <h3 className={`text-lg font-black ${currentTheme.isDark ? 'text-white' : 'text-slate-900'}`}>
                    {t.reminderModalTitle}
                  </h3>
                  <p className="text-xs text-slate-400 font-medium">
                    {t.reminderModalSubtitle}
                  </p>
                </div>
              </div>
              <button
                onClick={() => setShowNotifyModal(false)}
                className="p-2 text-slate-400 hover:text-slate-600 rounded-xl"
              >
                <X size={20} />
              </button>
            </div>

            {/* Parent Summary Card */}
            <div className="p-4 rounded-2xl bg-rose-500/5 border border-rose-500/20 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <span className="text-[10px] font-black uppercase tracking-widest text-slate-400 block">{t.parentName}</span>
                <span className="text-sm font-black text-slate-900 dark:text-white">{notifyParent.fullName}</span>
                <span className="text-xs text-slate-500 block">({t[notifyParent.relationship.toLowerCase() as keyof typeof t] || notifyParent.relationship})</span>
              </div>
              <div className="text-left sm:text-right">
                <span className="text-[10px] font-black uppercase tracking-widest text-rose-500 block">{t.totalOutstandingBalance}</span>
                <span className="text-lg font-black text-rose-600 dark:text-rose-400 font-mono">
                  {formatCurrency(getParentOutstandingBalance(notifyParent))}
                </span>
              </div>
            </div>

            <div className="space-y-4">
              {/* Recipient Phone Selection */}
              <div className="space-y-1">
                <label className="text-[10px] font-black uppercase tracking-widest text-slate-400">{t.selectPhone} *</label>
                <div className="flex items-center gap-2">
                  <Phone size={16} className="text-slate-400" />
                  <select
                    value={notifySelectedPhone}
                    onChange={(e) => setNotifySelectedPhone(e.target.value)}
                    className={`w-full p-3 text-xs font-bold rounded-xl border ${currentTheme.border} ${currentTheme.isDark ? 'bg-slate-900 text-white' : 'bg-slate-50 text-slate-800'}`}
                  >
                    {notifyParent.phones.map((ph, idx) => (
                      <option key={idx} value={ph}>
                        {ph} {idx === 0 ? `(${t.primaryPhone})` : `(${t.secondaryPhone})`}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Template Selection Radio Buttons / Pills */}
              <div className="space-y-1">
                <label className="text-[10px] font-black uppercase tracking-widest text-slate-400">{t.selectTemplate}</label>
                <div className="grid grid-cols-3 gap-2">
                  <button
                    type="button"
                    onClick={() => handleNotifyTemplateChange('polite')}
                    className={`p-2.5 rounded-xl border text-xs font-bold transition-all ${
                      notifyTemplateType === 'polite'
                        ? 'bg-emerald-600 text-white border-emerald-600 shadow-md shadow-emerald-600/20'
                        : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 border-transparent hover:bg-slate-200'
                    }`}
                  >
                    {t.templatePolite}
                  </button>
                  <button
                    type="button"
                    onClick={() => handleNotifyTemplateChange('urgent')}
                    className={`p-2.5 rounded-xl border text-xs font-bold transition-all ${
                      notifyTemplateType === 'urgent'
                        ? 'bg-rose-600 text-white border-rose-600 shadow-md shadow-rose-600/20'
                        : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 border-transparent hover:bg-slate-200'
                    }`}
                  >
                    {t.templateUrgent}
                  </button>
                  <button
                    type="button"
                    onClick={() => handleNotifyTemplateChange('detailed')}
                    className={`p-2.5 rounded-xl border text-xs font-bold transition-all ${
                      notifyTemplateType === 'detailed'
                        ? 'bg-amber-600 text-white border-amber-600 shadow-md shadow-amber-600/20'
                        : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 border-transparent hover:bg-slate-200'
                    }`}
                  >
                    {t.templateDetailed}
                  </button>
                </div>
              </div>

              {/* Editable Message Text Box */}
              <div className="space-y-1">
                <div className="flex items-center justify-between">
                  <label className="text-[10px] font-black uppercase tracking-widest text-slate-400">{t.customMessage}</label>
                  {copiedToast && (
                    <span className="text-[10px] font-bold text-emerald-600 flex items-center gap-1 animate-pulse">
                      <CheckCircle2 size={12} />
                      {t.copiedToClipboard}
                    </span>
                  )}
                </div>
                <textarea
                  rows={6}
                  value={notifyCustomText}
                  onChange={(e) => setNotifyCustomText(e.target.value)}
                  className={`w-full p-3.5 text-xs font-mono font-medium rounded-xl border ${currentTheme.border} ${currentTheme.isDark ? 'bg-slate-900 text-white' : 'bg-slate-50 text-slate-800'} leading-relaxed`}
                />
              </div>
            </div>

            {/* One-Click Action Buttons */}
            <div className="pt-4 border-t border-slate-100 dark:border-slate-800 flex flex-col sm:flex-row items-center justify-between gap-3">
              <button
                type="button"
                onClick={handleCopyNotifyMessage}
                className="w-full sm:w-auto px-4 py-2.5 rounded-xl border border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-300 font-bold text-xs hover:bg-slate-100 dark:hover:bg-slate-800 flex items-center justify-center gap-2 transition-all"
              >
                <Copy size={16} />
                <span>{t.copyMessage}</span>
              </button>

              <div className="w-full sm:w-auto flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleSendSMS}
                  className="flex-1 sm:flex-initial px-4 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-900 dark:bg-slate-700 dark:hover:bg-slate-600 text-white font-bold text-xs shadow-md flex items-center justify-center gap-2 transition-all"
                >
                  <MessageSquare size={16} />
                  <span>{t.sendSMS}</span>
                </button>

                <button
                  type="button"
                  onClick={handleSendWhatsApp}
                  className="flex-1 sm:flex-initial px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs shadow-lg shadow-emerald-600/30 flex items-center justify-center gap-2 transition-all"
                >
                  <MessageSquare size={16} className="text-emerald-200" />
                  <span>{t.openWhatsApp}</span>
                </button>
              </div>
            </div>
          </motion.div>
        </div>
      )}

      {/* --- Floating AI Financial Assistant Widget --- */}
      <div className="fixed bottom-6 right-6 z-50 no-print font-sans">
        <AnimatePresence>
          {isFloatingChatOpen ? (
            <motion.div
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 20 }}
              className={`w-[360px] sm:w-96 h-[500px] rounded-[2.5rem] shadow-2xl border ${currentTheme.border} ${currentTheme.card} flex flex-col overflow-hidden`}
            >
              {/* Header */}
              <div 
                className="px-6 py-4 text-white flex justify-between items-center" 
                style={{ backgroundColor: currentTheme.header }}
              >
                <div className="flex items-center gap-2">
                  <span className="text-xl">🤖</span>
                  <div>
                    <h4 className="font-bold text-sm">Mama Thera AI Assistant</h4>
                    <p className="text-[10px] text-white/75 font-semibold">
                      {lang === 'en' ? 'Live Financial Intelligence' : 'Intelligence Financière en Direct'}
                    </p>
                  </div>
                </div>
                <button 
                  onClick={() => setIsFloatingChatOpen(false)}
                  className="p-1.5 hover:bg-white/10 rounded-xl transition-all"
                >
                  <X size={16} />
                </button>
              </div>

              {/* Message History */}
              <div className="flex-1 overflow-y-auto p-4 space-y-3 custom-scrollbar bg-slate-50/50">
                {floatingChatMessages.map((msg, idx) => (
                  <div 
                    key={idx} 
                    className={`flex ${msg.sender === 'user' ? 'justify-end' : 'justify-start'}`}
                  >
                    <div 
                      className={`max-w-[85%] px-4 py-2.5 text-xs font-semibold leading-relaxed shadow-sm ${
                        msg.sender === 'user' 
                          ? `${currentTheme.isDark ? 'bg-emerald-600 text-white' : 'bg-blue-600 text-white'} rounded-t-2xl rounded-bl-2xl`
                          : `${currentTheme.isDark ? 'bg-[#334155] border-[#475569] text-white' : 'bg-white border-slate-100 text-slate-800'} border rounded-t-2xl rounded-br-2xl`
                      }`}
                      style={{ whiteSpace: 'pre-line' }}
                    >
                      {msg.text}
                    </div>
                  </div>
                ))}
              </div>

              {/* Quick Prompt Suggesters */}
              <div className="px-3 py-2 border-t border-slate-100 dark:border-slate-800 flex gap-2 overflow-x-auto whitespace-nowrap bg-white custom-scrollbar">
                {(lang === 'en' ? [
                  "How much tuition was collected this month?",
                  "Which parents still owe school fees?",
                  "Show all expenses for June.",
                  "How much money do we currently have in cash?",
                  "Which students haven't paid the second installment?",
                  "Generate this month's financial report."
                ] : [
                  "Combien de scolarités ont été collectées ce mois-ci ?",
                  "Quels parents doivent encore des frais de scolarité ?",
                  "Afficher toutes les dépenses pour juin.",
                  "Combien d'argent avons-nous actuellement en caisse ?",
                  "Quels élèves n'ont pas payé la deuxième tranche ?",
                  "Générer le rapport financier de ce mois-ci."
                ]).map((q, idx) => (
                  <button
                    key={idx}
                    type="button"
                    onClick={() => handleFloatingAiQuery(q)}
                    className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold rounded-full text-[10px] transition-all shrink-0 border border-slate-200/50"
                  >
                    {q.length > 35 ? q.substring(0, 32) + '...' : q}
                  </button>
                ))}
              </div>

              {/* Input Form */}
              <form 
                onSubmit={(e) => {
                  e.preventDefault();
                  handleFloatingAiQuery(floatingChatInput);
                }}
                className="p-4 border-t border-slate-100 dark:border-slate-800 bg-white flex gap-2 items-center"
              >
                <input 
                  type="text"
                  value={floatingChatInput}
                  onChange={(e) => setFloatingChatInput(e.target.value)}
                  placeholder={lang === 'en' ? 'Ask a financial question...' : 'Poser une question financière...'}
                  className="flex-1 px-4 py-2 border border-slate-200 rounded-xl text-xs font-semibold text-slate-800 bg-slate-50 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
                />
                <button 
                  type="submit"
                  disabled={!floatingChatInput.trim()}
                  className={`px-4 py-2 rounded-xl text-white font-extrabold text-xs transition-all ${
                    floatingChatInput.trim() 
                      ? `${currentTheme.isDark ? 'bg-emerald-600 hover:bg-emerald-700' : 'bg-blue-600 hover:bg-blue-700'} shadow-lg` 
                      : 'bg-slate-300 cursor-not-allowed'
                  }`}
                >
                  {lang === 'en' ? 'Send' : 'Envoyer'}
                </button>
              </form>
            </motion.div>
          ) : (
            <motion.button
              initial={{ scale: 0.8, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.8, opacity: 0 }}
              onClick={() => setIsFloatingChatOpen(true)}
              className={`px-6 py-4 rounded-full text-white font-extrabold text-sm transition-all flex items-center gap-2 shadow-2xl active:scale-[0.98] ${
                currentTheme.isDark 
                  ? 'bg-emerald-600 hover:bg-emerald-700 shadow-emerald-500/30' 
                  : 'bg-blue-600 hover:bg-blue-700 shadow-blue-500/30'
              }`}
            >
              <span className="text-lg">🤖</span>
              <span>{lang === 'en' ? 'Mama Thera AI Assistant' : 'Assistant IA Mama Thera'}</span>
            </motion.button>
          )}
        </AnimatePresence>
      </div>
        </div>
      )}

      {/* Academic Year Promotion Wizard Modal */}
      <PromotionWizardModal
        isOpen={isPromotionWizardOpen}
        onClose={() => setIsPromotionWizardOpen(false)}
        students={students}
        availableAcademicYears={academicYears}
        currentAcademicYear={selectedYear || '2025-2026'}
        onPromote={batchPromoteStudents}
        language={lang}
      />

      {/* Add Staff / User Account Modal */}
      <AnimatePresence>
        {showAddUserModal && (
          <div className="fixed inset-0 z-[120] flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowAddUserModal(false)}
              className="absolute inset-0 bg-slate-950/70 backdrop-blur-md"
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className={`relative w-full max-w-lg ${currentTheme.card} rounded-3xl border ${currentTheme.border} shadow-2xl overflow-hidden`}
            >
              {/* Header */}
              <div className="p-6 border-b border-white/10 bg-[#0F172A] text-white flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-2xl bg-emerald-600 flex items-center justify-center shadow-lg shadow-emerald-600/30">
                    <UserPlus size={20} className="text-white" />
                  </div>
                  <div>
                    <h3 className="font-bold text-base">
                      {lang === 'en' ? 'Add Staff Account' : 'Créer un Compte Collaborateur'}
                    </h3>
                    <p className="text-[11px] text-white/50">
                      {lang === 'en' 
                        ? 'Create a login and assign initial access role' 
                        : 'Créez un accès et attribuez le rôle initial'}
                    </p>
                  </div>
                </div>
                <button
                  onClick={() => setShowAddUserModal(false)}
                  className="p-2 rounded-xl text-white/60 hover:text-white hover:bg-white/10 transition-all text-sm font-bold"
                >
                  ✕
                </button>
              </div>

              {/* Form */}
              <form onSubmit={handleCreateUser} className="p-6 space-y-4">
                <div className="space-y-1.5">
                  <label className={`text-[10px] font-black ${currentTheme.muted} uppercase tracking-widest`}>
                    {lang === 'en' ? 'Full Name' : 'Nom & Prénom'}
                  </label>
                  <input
                    type="text"
                    required
                    value={newUserForm.fullName}
                    onChange={(e) => setNewUserForm({ ...newUserForm, fullName: e.target.value })}
                    placeholder={lang === 'en' ? 'e.g. Aminata Traoré' : 'ex. Aminata Traoré'}
                    className={`w-full px-4 py-3 rounded-xl border ${currentTheme.border} ${
                      currentTheme.isDark ? 'bg-white/5 text-white' : 'bg-slate-50 text-slate-900'
                    } text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-emerald-500/30`}
                  />
                </div>

                <div className="space-y-1.5">
                  <label className={`text-[10px] font-black ${currentTheme.muted} uppercase tracking-widest`}>
                    {lang === 'en' ? 'Email Address' : 'Adresse Email'}
                  </label>
                  <input
                    type="email"
                    required
                    value={newUserForm.email}
                    onChange={(e) => setNewUserForm({ ...newUserForm, email: e.target.value })}
                    placeholder="nom@mamathera.org"
                    className={`w-full px-4 py-3 rounded-xl border ${currentTheme.border} ${
                      currentTheme.isDark ? 'bg-white/5 text-white' : 'bg-slate-50 text-slate-900'
                    } text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-emerald-500/30`}
                  />
                </div>

                <div className="space-y-1.5">
                  <label className={`text-[10px] font-black ${currentTheme.muted} uppercase tracking-widest`}>
                    {lang === 'en' ? 'Initial Password (min 6 characters)' : 'Mot de Passe Initial (min 6 caractères)'}
                  </label>
                  <input
                    type="password"
                    required
                    minLength={6}
                    value={newUserForm.password}
                    onChange={(e) => setNewUserForm({ ...newUserForm, password: e.target.value })}
                    placeholder="••••••••"
                    className={`w-full px-4 py-3 rounded-xl border ${currentTheme.border} ${
                      currentTheme.isDark ? 'bg-white/5 text-white' : 'bg-slate-50 text-slate-900'
                    } text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-emerald-500/30`}
                  />
                </div>

                {/* Role selection */}
                <div className="space-y-2 pt-1">
                  <label className={`text-[10px] font-black ${currentTheme.muted} uppercase tracking-widest`}>
                    {lang === 'en' ? 'Assigned Role & Permissions' : 'Rôle & Autorisations Attribués'}
                  </label>
                  <div className="grid grid-cols-2 gap-3">
                    <button
                      type="button"
                      onClick={() => setNewUserForm({ ...newUserForm, role: 'staff' })}
                      className={`p-3.5 rounded-2xl border text-left transition-all ${
                        newUserForm.role === 'staff'
                          ? 'border-blue-500 bg-blue-500/10 ring-2 ring-blue-500/30'
                          : `${currentTheme.border} hover:bg-white/5`
                      }`}
                    >
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-base">💼</span>
                        <span className={`text-xs font-bold ${newUserForm.role === 'staff' ? 'text-blue-500' : currentTheme.isDark ? 'text-white' : 'text-slate-800'}`}>
                          {lang === 'en' ? 'Staff / Accountant' : 'Personnel / Économe'}
                        </span>
                      </div>
                      <p className={`text-[10px] ${currentTheme.muted} leading-snug`}>
                        {lang === 'en' 
                          ? 'Daily entries: fees, receipts, students, expenses.' 
                          : 'Saisie quotidienne : élèves, reçus, dépenses.'}
                      </p>
                    </button>

                    <button
                      type="button"
                      onClick={() => setNewUserForm({ ...newUserForm, role: 'admin' })}
                      className={`p-3.5 rounded-2xl border text-left transition-all ${
                        newUserForm.role === 'admin'
                          ? 'border-emerald-500 bg-emerald-500/10 ring-2 ring-emerald-500/30'
                          : `${currentTheme.border} hover:bg-white/5`
                      }`}
                    >
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-base">👑</span>
                        <span className={`text-xs font-bold ${newUserForm.role === 'admin' ? 'text-emerald-500' : currentTheme.isDark ? 'text-white' : 'text-slate-800'}`}>
                          {lang === 'en' ? 'Promoter / Admin' : 'Promotrice / Direction'}
                        </span>
                      </div>
                      <p className={`text-[10px] ${currentTheme.muted} leading-snug`}>
                        {lang === 'en' 
                          ? 'Full administrative control, closing years, role edits.' 
                          : 'Contrôle complet, clôture d\'année, gestion des rôles.'}
                      </p>
                    </button>
                  </div>
                </div>

                {/* Submit & Cancel */}
                <div className="flex items-center justify-end gap-3 pt-4 border-t border-white/10">
                  <button
                    type="button"
                    onClick={() => setShowAddUserModal(false)}
                    className={`px-4 py-2.5 rounded-xl text-xs font-bold ${currentTheme.muted} hover:text-white transition-all`}
                  >
                    {lang === 'en' ? 'Cancel' : 'Annuler'}
                  </button>
                  <button
                    type="submit"
                    disabled={isCreatingUser}
                    className="bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white px-6 py-2.5 rounded-xl text-xs font-black transition-all flex items-center gap-2 shadow-lg shadow-emerald-600/20 active:scale-95"
                  >
                    {isCreatingUser ? (
                      <>
                        <div className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                        <span>{lang === 'en' ? 'Creating...' : 'Création...'}</span>
                      </>
                    ) : (
                      <>
                        <UserPlus size={15} />
                        <span>{lang === 'en' ? 'Create Account' : 'Créer le Compte'}</span>
                      </>
                    )}
                  </button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Smart Excel Import Modal */}
      <ExcelImportModal
        isOpen={showExcelImport}
        onClose={() => setShowExcelImport(false)}
        lang={lang}
        academicYears={academicYears}
        selectedYear={selectedYear}
        onImportComplete={async (category: ImportCategory, records: Record<string, any>[], options) => {
          return await batchImportData(category, records, options);
        }}
        themeCard={currentTheme.card}
        themeBorder={currentTheme.border}
        themeMuted={currentTheme.muted}
        themeIsDark={currentTheme.isDark}
      />

      {/* Monthly Payroll Draft Modal */}
      <MonthlyPayrollDraftModal
        isOpen={showMonthlyDraftModal}
        onClose={() => setShowMonthlyDraftModal(false)}
        lang={lang}
        staff={staff}
        salaryPayments={salaryPayments}
        selectedAcademicYear={selectedYear || '2026-2027'}
        monthIndex={selectedDraftMonth}
        year={selectedDraftYear}
        onMonthChange={(m) => setSelectedDraftMonth(m)}
        onYearChange={(y) => setSelectedDraftYear(y)}
        onExportExcel={handleExportMonthlyPayrollExcel}
        onRecordPayment={(staffId, balance) => {
          setSalaryForm({ staffId, amount: balance.toString(), date: new Date().toISOString().split('T')[0] });
          setShowSalaryModal(true);
        }}
        formatCurrency={formatCurrency}
        themeCard={currentTheme.card}
        themeBorder={currentTheme.border}
        themeMuted={currentTheme.muted}
        themeIsDark={currentTheme.isDark}
      />

      {/* Global Toast Notifications & Offline Resilience Banner */}
      <OfflineBanner
        lang={lang}
        pendingCount={pendingQueueCount}
        isSyncing={isSyncing}
        onSync={syncOfflineQueue}
      />
      <EnvBadge env={appEnv} />
      <ToastContainer toasts={toast.toasts} onDismiss={toast.removeToast} />
    </>
  );
}

