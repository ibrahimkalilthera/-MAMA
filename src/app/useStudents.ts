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
import { useEffect, useMemo, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import type { Student, User } from './types';
import type { StudentForm } from '../components/StudentFormModal';
import type { TranslationDict } from '../i18n/translations';
import { studentMatricule } from '../lib/studentIdentifiers';
import { localIsoDate, systemClock, type Clock } from '../lib/dateWindows';
import { createRowId } from '../lib/rowMappers';
import { canUseSection } from './sectionRights';

export type StudentSortKey = 'name' | 'parentName' | 'balance' | 'dueDate';

export interface UseStudentsDeps {
  t: TranslationDict;
  lang: 'en' | 'fr';
  today: string;
  selectedYear: string;
  lockedYears: string[];
  /**
   * La personne connectée. Son RÔLE décide de la remise sur frais de scolarité —
   * et il le décide par la surface `scholarship-edit` (`src/app/sectionRights.ts`),
   * lue sur `public.is_finance_admin()`. Le hook ne compose plus
   * `isPromoter || isGeneralManager` : deux booléens de rôle additionnés ici
   * étaient une QUATRIÈME copie de la liste, non mesurée.
   */
  currentUser: User | null;
  students: Student[];
  addStudent: (s: Omit<Student, 'id' | 'payments'> & { id?: string }) => Promise<Student | null>;
  updateStudent: (id: string, updates: Partial<Student>) => Promise<boolean>;
  showToast: () => void;
  /** Toast an error/validation message (replaces the native alert()). */
  toastError: (message: string) => void;
  /** Reference clock for the form's default day (dueDate/enrollmentDate of the
   *  current month). Defaults to `systemClock`; a test pins it. */
  now?: Clock;
}

const emptyStudentForm = (today: string): StudentForm => ({
  name: '',
  parentName: '',
  parentEmail: '',
  parentPhone: '',
  totalDue: '',
  scholarshipDiscount: '0',
  dueDate: today,
  // Plus d'année en dur : le formulaire naît SANS année et c'est l'année de
  // travail (`selectedYear`) qui s'applique à l'enregistrement. Un littéral ici
  // écrivait une année que les listes ne filtraient pas — l'élève était en base
  // et invisible, ce qui se lit « mes données ont disparu » (2026-09-13).
  academicYear: '',
  grade: '',
  // Student Profiles & Enrollment Fields
  studentId: '',
  photo: '',
  emergencyContactName: '',
  emergencyContactRelation: '',
  emergencyContactPhone: '',
  medicalNotes: 'None',
  enrollmentDate: today,
  previousSchool: '',
  status: 'Active' as 'Active' | 'Graduated' | 'Left',
  classScope: 'all'
});

export function useStudents(deps: UseStudentsDeps) {
  const { t, lang, today, selectedYear, lockedYears, currentUser, students, addStudent, updateStudent, showToast, toastError, now: nowFn = systemClock } = deps;
  // Le jour local du repère d'horloge : les défauts de formulaire (dueDate /
  // enrollmentDate) naissent au mois courant de ce repère, pas d'une horloge murale.
  const todayIso = localIsoDate(nowFn());
  // La remise sur frais de scolarité est un acte de gestionnaire financier : la
  // surface `scholarship-edit` le dit UNE fois (`src/app/sectionRights.ts`), et
  // la modale reçoit ce booléen au lieu de recomposer la liste (`canEditScholarship`
  // dans `AppModalsProps`). La garde d'écriture et celle du champ disent donc la
  // même chose par construction, pas par recopie.
  const canEditScholarship = canUseSection('scholarship-edit', currentUser?.role);

  const [searchTerm, setSearchTerm] = useState('');
  const [selectedStudent, setSelectedStudent] = useState<Student | null>(null);
  // Le reçu MUET sur lequel une fiche doit s'OUVRIR, quand un écran l'a demandé
  // (l'écran École des reçus muets, `SilentReceiptsView`). `null` = ouverture
  // ordinaire. L'état vit ICI, à côté de la fiche qu'il concerne, et AppModals le
  // remet à zéro à chaque fermeture : le focus d'un clic ne doit jamais se rejouer
  // sur une fiche ouverte plus tard, depuis la liste des élèves ou la cloche.
  const [studentFileFocus, setStudentFileFocus] = useState<string | null>(null);
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
  const [studentForm, setStudentForm] = useState<StudentForm>(() => emptyStudentForm(todayIso));

  /**
   * L'id du GESTE d'ajout — minté UNE fois par fiche ouverte, puis réutilisé par
   * tous les envois de cette fiche (voir `handleStudentSubmit`).
   *
   * Le défaut mesuré le 2026-10-05 sur la base partagée : « Mahamadou DJIRE » en
   * SEPT lignes identiques, semées en quinze secondes, dont deux créées à
   * 1 milliseconde d'écart — et « Mamadou SIDIBE » en double. La cause n'était
   * pas la file : le chemin EN LIGNE n'envoyait aucun id, donc chaque envoi
   * répété créait une NOUVELLE ligne (`<uuid> PRIMARY KEY DEFAULT
   * uuid_generate_v4()`). Avec un id stable par geste, le second envoi retombe
   * sur la même clé primaire et la base le refuse au lieu de dupliquer.
   *
   * L'id est libéré à la FERMETURE de la fiche : la fiche suivante est un autre
   * geste, donc un autre élève — un id conservé ferait qu'un nouvel élève serait
   * pris pour le doublon du précédent.
   */
  const draftStudentIdRef = useRef<string | null>(null);
  useEffect(() => {
    if (showStudentModal && !editingStudent) {
      if (!draftStudentIdRef.current) draftStudentIdRef.current = createRowId();
      return;
    }
    // Fiche fermée (enregistrée, ou abandonnée) : le geste est terminé.
    if (!showStudentModal) draftStudentIdRef.current = null;
  }, [showStudentModal, editingStudent]);

  // State for active tab in student detailed viewer
  const [studentDetailTab, setStudentDetailTab] = useState<'general' | 'parent' | 'medical'>('general');

  /**
   * La fiche dont on compare les homonymes — l'outil `DuplicateReviewModal`.
   *
   * On garde la FICHE, jamais le groupe : le groupe « même nom + même classe »
   * est recalculé à l'affichage depuis l'annuaire (voir `duplicateStudents.ts`),
   * donc une fusion ou une suppression ne laisse pas l'écran pointer sur des
   * fiches qui n'existent plus, et une fiche éditée pendant qu'on compare reste
   * la fiche réelle.
   */
  const [reviewStudent, setReviewStudent] = useState<Student | null>(null);
  const openDuplicateReview = (student: Student) => setReviewStudent(student);
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
      const searchableStudentId = studentMatricule(s.studentId)?.toLowerCase();
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

    // `classScope` ne choisit que les classes que le modal PROPOSE (« Ajouter
    // CR ») : ce n'est pas un champ de la fiche, donc il est retiré ici — au
    // seul endroit qui écrit — et aucune ligne n'en porte jamais la trace.
    const { classScope: _classScope, ...studentFields } = studentForm;
    const studentData = {
      ...studentFields,
      // L'année ÉCRITE est celle qui est AFFICHÉE : le formulaire garde la main
      // si l'utilisateur en choisit une autre, sinon c'est l'année de travail.
      academicYear: studentForm.academicYear || selectedYear,
      parentEmail: studentForm.parentEmail.trim(),
      totalDue: amount,
      // Le matricule appartient à la BASE : elle l'attribue à l'insertion
      // (`MT-<année>-<n°>`). Le formulaire ne transmet donc une valeur que si
      // l'école en a saisi une (le numéro d'examen des 9e) ; `undefined` laisse
      // `studentUpdatesToRow` ne PAS toucher à la colonne — le matricule déjà en
      // place survit à une édition, comme à un changement de classe.
      studentId: studentForm.studentId.trim() || undefined,
      scholarshipDiscount: canEditScholarship
        ? (parseFloat(studentForm.scholarshipDiscount) || 0)
        : (editingStudent?.scholarshipDiscount || 0),
      notes: editingStudent?.notes || '',
    };

    const savedStudent = editingStudent
      ? await updateStudent(editingStudent.id, studentData)
      // `??=` : le premier envoi minte l'id, tous les suivants du MÊME geste le
      // réutilisent — c'est ce qui rend un double clic inoffensif.
      : await addStudent({ ...studentData, amountPaid: 0, id: (draftStudentIdRef.current ??= createRowId()) });
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
      dueDate: todayIso,
      academicYear: selectedYear,
      grade: '',
      studentId: '',
      photo: '',
      emergencyContactName: '',
      emergencyContactRelation: '',
      emergencyContactPhone: '',
      medicalNotes: 'None',
      enrollmentDate: todayIso,
      previousSchool: '',
      status: 'Active',
      classScope: 'all'
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
      academicYear: student.academicYear || selectedYear,
      grade: student.grade || '',
      // Le champ n'est proposé qu'aux 9e, mais l'état du formulaire porte
      // TOUJOURS le matricule réel : sans cela, enregistrer une fiche d'une
      // autre classe écrirait un matricule vide. Plus aucun matricule inventé
      // côté client : c'est la base qui numérote.
      studentId: student.studentId || '',
      photo: student.photo || '',
      emergencyContactName: student.emergencyContactName || '',
      emergencyContactRelation: student.emergencyContactRelation || '',
      emergencyContactPhone: student.emergencyContactPhone || '',
      medicalNotes: student.medicalNotes || 'None',
      enrollmentDate: student.enrollmentDate || todayIso,
      previousSchool: student.previousSchool || '',
      status: student.status || 'Active',
      classScope: 'all'
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
    studentFileFocus, setStudentFileFocus,
    showStudentModal, setShowStudentModal,
    editingStudent, setEditingStudent,
    studentGradeFilter, setStudentGradeFilter,
    studentSortKey, setStudentSortKey,
    studentSortOrder, setStudentSortOrder,
    handleSort,
    studentForm, setStudentForm,
    studentDetailTab, setStudentDetailTab,
    printStudentFile, setPrintStudentFile,
    reviewStudent, setReviewStudent,
    openDuplicateReview,
    filteredStudents,
    handleStudentSubmit,
    openEditModal,
    handleSaveNote,
    toggleFlag,
    canEditScholarship,
  };
}
