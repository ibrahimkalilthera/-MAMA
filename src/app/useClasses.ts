/**
 * Classes/sections domain hook — extracted verbatim from App.tsx.
 *
 * Owns the class management domain: the merged class list (`availableClasses`
 * = built-in DEFAULT_SCHOOL_CLASSES + Supabase custom_classes), the
 * add/edit modal state (forms + open flags + the edited row id) and the four
 * handlers (`handleCreateClassSubmit`, `openEditClass`,
 * `handleEditClassSubmit`, `handleDeleteClass`) — code-collision detection,
 * toast feedback, auto-selection of the new class in the student form and the
 * shared confirm dialog for deletion. App.tsx only consumes the returned API;
 * the props contracts passed down to MainViews/AppModals are unchanged
 * (guards verify the wiring).
 *
 * Call-site note: the hook takes customClasses/toast/setConfirmAction and an
 * `autoSelectGrade` callback as arguments, so App.tsx must call it after
 * those are declared.
 */
import { useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import { buildClassCode } from '../lib/classes';
import { DEFAULT_SCHOOL_CLASSES } from './types';
import type { ManagedClass } from './mainViewsProps';
import type { TranslationDict } from '../i18n/translations';
import type { ClassForm } from '../components/AddClassModal';
import type { ClassCycle, CustomClass } from '../lib/useSupabaseData';
import type { useToast } from '../lib/useToast';

type ToastApi = Pick<ReturnType<typeof useToast>, 'success' | 'error' | 'warning'>;

interface UseClassesDeps {
  t: TranslationDict;
  customClasses: ManagedClass[];
  toast: ToastApi;
  /** App-side hook into the student form: selects the new class code. */
  autoSelectGrade: (grade: string) => void;
  setConfirmAction: (action: { title: string; message: string; confirmLabel: string; onConfirm: () => void } | null) => void;
  addCustomClass: (cls: {
    code: string;
    cycle: ClassCycle;
    year: string;
    section: string;
    nameFr: string;
    nameEn: string;
  }) => Promise<CustomClass | null>;
  updateCustomClass: (rowId: string, updates: {
    code: string;
    cycle: ClassCycle;
    year: string;
    section: string;
    nameFr: string;
    nameEn: string;
  }) => Promise<boolean>;
  deleteCustomClass: (rowId: string) => Promise<boolean>;
}

export function useClasses(deps: UseClassesDeps) {
  const { t, customClasses, toast, autoSelectGrade, setConfirmAction, addCustomClass, updateCustomClass, deleteCustomClass } = deps;

  // Classes & Sections Management (single source of truth: Supabase custom_classes)
  const availableClasses = useMemo<ManagedClass[]>(() => {
    const seen = new Set(DEFAULT_SCHOOL_CLASSES.map(c => c.id.toLowerCase()));
    return [...DEFAULT_SCHOOL_CLASSES, ...customClasses.filter(c => !seen.has(c.id.toLowerCase()))];
  }, [customClasses]);

  const [showEditClassModal, setShowEditClassModal] = useState(false);
  const [editingClassRowId, setEditingClassRowId] = useState<string | null>(null);
  const [editClassForm, setEditClassForm] = useState<ClassForm>({ cycle: 'other', year: '1', section: 'D', customName: '' });

  const [showAddClassModal, setShowAddClassModal] = useState<boolean>(false);
  const [newClassForm, setNewClassForm] = useState<ClassForm>({
    cycle: 'cycle1',
    year: '1',
    section: 'D',
    customName: ''
  });

  const handleCreateClassSubmit = async (e?: FormEvent) => {
    if (e) e.preventDefault();

    const { code, nameFr, nameEn } = buildClassCode(newClassForm);

    // Check if class code already exists
    if (availableClasses.some(c => c.id.toLowerCase() === code.toLowerCase())) {
      toast.warning(t.classAlreadyExists.replace('{code}', code));
      autoSelectGrade(code);
      setShowAddClassModal(false);
      return;
    }

    const result = await addCustomClass({
      code,
      cycle: newClassForm.cycle,
      year: newClassForm.year,
      section: newClassForm.section.toUpperCase(),
      nameFr,
      nameEn,
    });
    if (!result) {
      toast.error(t.failedToAddClass);
      return;
    }

    // Auto-select in student form
    autoSelectGrade(code);

    toast.success(t.classAddedSuccessfully.replace('{code}', code));

    setShowAddClassModal(false);
    setNewClassForm({
      cycle: 'cycle1',
      year: '1',
      section: 'D',
      customName: ''
    });
  };

  const openEditClass = (c: ManagedClass) => {
    setEditingClassRowId(c.rowId || null);
    setEditClassForm({
      cycle: c.cycle,
      year: String(c.year),
      section: c.section,
      customName: c.cycle === 'other' ? c.id : '',
    });
    setShowEditClassModal(true);
  };

  const handleEditClassSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!editingClassRowId) return;

    const { code, nameFr, nameEn } = buildClassCode(editClassForm);

    // Prevent colliding with another class code
    if (availableClasses.some(c => c.id.toLowerCase() === code.toLowerCase() && c.rowId !== editingClassRowId)) {
      toast.warning(t.classAlreadyExists.replace('{code}', code));
      return;
    }

    const ok = await updateCustomClass(editingClassRowId, {
      code,
      cycle: editClassForm.cycle,
      year: editClassForm.year,
      section: editClassForm.section.toUpperCase(),
      nameFr,
      nameEn,
    });
    if (!ok) return;
    toast.success(t.classUpdated.replace('{code}', code));
    setShowEditClassModal(false);
    setEditingClassRowId(null);
  };

  const handleDeleteClass = async (c: ManagedClass) => {
    if (!c.rowId) return;
    const rowId = c.rowId;
    setConfirmAction({
      title: t.deleteClass,
      message: t.deleteClassConfirm.replace('{id}', c.id),
      confirmLabel: t.deleteClass,
      onConfirm: async () => {
        const ok = await deleteCustomClass(rowId);
        if (ok) {
          toast.success(t.classDeleted.replace('{id}', c.id));
        }
      },
    });
  };

  return {
    availableClasses,
    showEditClassModal, setShowEditClassModal,
    editingClassRowId, setEditingClassRowId,
    editClassForm, setEditClassForm,
    showAddClassModal, setShowAddClassModal,
    newClassForm, setNewClassForm,
    handleCreateClassSubmit,
    openEditClass,
    handleEditClassSubmit,
    handleDeleteClass,
  };
}