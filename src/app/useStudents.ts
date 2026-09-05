/**
 * Students domain hook — extracted verbatim from App.tsx.
 *
 * Owns the student list & profile state: search/sort/filter (`searchTerm`,
 * `studentSortKey/Order`, `studentGradeFilter`, `handleSort`, the
 * `filteredStudents` memo), the add/edit modal state (`studentForm`,
 * `editingStudent`, `showStudentModal`, `selectedStudent`,
 * `studentDetailTab`), the A4 file printout (`printStudentFile` + trigger
 * effect) and the handlers (`handleStudentSubmit`, `openEditModal`,
 * `handleSaveNote`, `toggleFlag`).
 *
 * Call-site note: App.tsx calls this hook after `today` (it needs it for
 * `handleSaveNote`) and before `useTodoSidebar` (which consumes
 * `handleSaveNote`); `showToast` is passed as a dep, so App defines it above
 * the call site.
 */
import { useEffect, useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import type { Student, User } from './types';
import type { StudentForm } from '../components/StudentFormModal';
import type { TranslationDict } from '../i18n/translations';
import { canEditScholarship } from '../lib/permissions';
import { isNinthGradeClass, visibleStudentIdentifier } from '../lib/studentIdentifiers';

export type StudentSortKey = 'name' | 'parentName' | 'balance' | 'dueDate';

export interface UseStudentsDeps {
  t: TranslationDict;
  lang: 'en' | 'fr';
  today: string;
  selectedYear: string;
  lockedYears: string[];
  /** Who is acting — scholarship edits are derived from the role. */
  currentUser: User | null;
  students: Student[];
  addStudent: (s: Omit<Student, 'id' | 'payments'>) => Promise<Student | null>;
  updateStudent: (id: string, updates: Partial<Student>) => Promise<boolean>;
  showToast: () => void;
  /** Toast an error/validation message (replaces the native alert()). */
  toastError: (message: string) => void;
}

const emptyStudentForm = (): StudentForm => ({
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

export function useStudents(deps: UseStudentsDeps) {
  const { t, lang, today, selectedYear, lockedYears, currentUser, students, addStudent, updateStudent, showToast, toastError } = deps;

  const [searchTerm, setSearchTerm] = useState('');
  const [selectedStudent, setSelectedStudent] = useState<Student | null>(null);
  const [showStudentModal, setShowStudentModal] = useState(false);
  const [editingStudent, setEditingStudent] = useState<Student | null>(null);

  const [studentGradeFilter, setStudentGradeFilter] = useState<string>('all');

  // Sorting state for student list
  const [studentSortKey, setStudentSortKey] = useState<StudentSortKey | null>(null);
  const [studentSortOrder, setStudentSortOrder] = useState<'asc' | 'desc'>('asc');

  const handleSort = (key: StudentSortKey) => {
    if (studentSortKey === key) {
      setStudentSortOrder(prev => prev === 'asc' ? 'desc' : 'asc');
    } else {
      setStudentSortKey(key);
      setStudentSortOrder('asc');
    }
  };

  // Student Form State
  const [studentForm, setStudentForm] = useState<StudentForm>(emptyStudentForm);

  // State for active tab in student detailed viewer
  const [studentDetailTab, setStudentDetailTab] = useState<'general' | 'parent' | 'medical'>('general');
  // State for triggering A4 student file printout
  const [printStudentFile, setPrintStudentFile] = useState<Student | null>(null);

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

  const filteredStudents = useMemo(() => {
    const normalizedSearch = searchTerm.toLowerCase();
    const list = students.filter(s => {
      const searchableStudentId = visibleStudentIdentifier(s.grade, s.studentId)?.toLowerCase();
      return (
        (!selectedYear || s.academicYear === selectedYear || !s.academicYear) &&
        (studentGradeFilter === 'all' || (s.grade && s.grade.toLowerCase() === studentGradeFilter.toLowerCase())) &&
        (s.name.toLowerCase().includes(normalizedSearch) ||
         s.parentName.toLowerCase().includes(normalizedSearch) ||
         (searchableStudentId?.includes(normalizedSearch) ?? false) ||
         (s.grade && s.grade.toLowerCase().includes(normalizedSearch)))
      );
    });

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

        let valueA: number | string | undefined;
        let valueB: number | string | undefined;

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

  const handleStudentSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (lockedYears.includes(selectedYear)) {
      toastError(t.thisAcademicYearIsLocked);
      return;
    }
    
    // Validation: Email is optional, but if provided, must be valid
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (studentForm.parentEmail && studentForm.parentEmail.trim() && !emailRegex.test(studentForm.parentEmail.trim())) {
      toastError(t.invalidEmail);
      return;
    }

    const amount = parseFloat(studentForm.totalDue);
    if (isNaN(amount) || amount < 0) {
      toastError(t.invalidAmount);
      return;
    }

    const studentData = {
      ...studentForm,
      parentEmail: studentForm.parentEmail.trim(),
      totalDue: amount,
      // Matricules are reserved for 9th-year classes. The explicit undefined
      // is intentional: studentUpdatesToRow turns it into SQL NULL on edits.
      studentId: isNinthGradeClass(studentForm.grade)
        ? studentForm.studentId.trim() || undefined
        : undefined,
      scholarshipDiscount: canEditScholarship(currentUser?.role ?? null)
        ? (parseFloat(studentForm.scholarshipDiscount) || 0)
        : (editingStudent?.scholarshipDiscount || 0),
      notes: editingStudent?.notes || '',
    };

    const savedStudent = editingStudent
      ? await updateStudent(editingStudent.id, studentData)
      : await addStudent({ ...studentData, amountPaid: 0 });
    if (!savedStudent) return;

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
      studentId: isNinthGradeClass(student.grade)
        ? (student.studentId || `MT-2026-${student.id.replace('ST', '')}`)
        : '',
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

  /**
   * Saves the sticky-note text on the student record. When `noteDate` is
   * provided (Notes ⇄ Calendar bridge), the note is ALSO recorded as a dated
   * entry visible on that calendar day.
   */
  const handleSaveNote = async (studentId: string, note: string, noteDate?: string) => {
    const student = students.find(s => s.id === studentId);
    const updates: Partial<Student> = { notes: note, lastNoteDate: today };
    if (noteDate && note.trim()) {
      updates.noteEntries = [...(student?.noteEntries || []), { date: noteDate, text: note.trim() }];
    }
    const ok = await updateStudent(studentId, updates);
    if (!ok) return;
    if (selectedStudent?.id === studentId) {
      setSelectedStudent({ ...selectedStudent, ...updates });
    }
    showToast();
  };

  const toggleFlag = async (id: string) => {
    const student = students.find(s => s.id === id);
    if (!student) return;
    await updateStudent(id, { flagged: !student.flagged });
  };

  return {
    searchTerm, setSearchTerm,
    selectedStudent, setSelectedStudent,
    showStudentModal, setShowStudentModal,
    editingStudent, setEditingStudent,
    studentGradeFilter, setStudentGradeFilter,
    studentSortKey, setStudentSortKey,
    studentSortOrder, setStudentSortOrder,
    handleSort,
    studentForm, setStudentForm,
    studentDetailTab, setStudentDetailTab,
    printStudentFile, setPrintStudentFile,
    filteredStudents,
    handleStudentSubmit,
    openEditModal,
    handleSaveNote,
    toggleFlag,
  };
}
