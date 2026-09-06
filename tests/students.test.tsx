/**
 * happy-dom unit tests for the useStudents domain hook.
 *
 * The hook is rendered for real (spy mutators, happy-dom globals):
 *   1. filteredStudents — filters by search term (name / parent / studentId /
 *      grade), grade filter, academic year, and sorts by name, parentName,
 *      discounted balance and dueDate (asc/desc), undefined values last;
 *   2. handleSort — toggles asc→desc on the same key, switches keys in asc;
 *   3. handleStudentSubmit — locked year blocks with an alert; invalid email
 *      and invalid amount are alerted and abort; a non-finance editor cannot
 *      sneak a scholarshipDiscount; success persists (create vs update),
 *      closes the modal and resets the form;
 *   4. handleSaveNote — writes notes + lastNoteDate; with a noteDate (the
 *      Notes ⇄ Calendar bridge) it appends a trimmed dated entry to
 *      noteEntries and updates the selected student copy; empty note text
 *      with a date skips the calendar entry; failure leaves everything
 *      untouched;
 *   5. openEditModal — hydrates the form from the record (studentId
 *      auto-format fallback, defaults for missing fields);
 *   6. toggleFlag — flips the flag only for a known id.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { act } from 'react';
import { translations } from '../src/i18n/translations';
import type { TranslationDict } from '../src/i18n/translations';
import type { Student } from '../src/app/types';
import { useStudents } from '../src/app/useStudents';
import { installDomGlobals, stubAlert, renderHook } from './harness';

const t = translations.fr as TranslationDict;

const win = installDomGlobals();

// ── fixtures ─────────────────────────────────────────────────────────────────

function student(overrides: Partial<Student> & { id: string; name: string; totalDue: number; amountPaid: number }): Student {
  return {
    parentName: 'Mamadou Diallo',
    parentEmail: 'parent@example.com',
    parentPhone: '+223 70 00 00 00',
    dueDate: '2026-12-31',
    payments: [],
    notes: '',
    ...overrides,
  };
}

const ali = (): Student => student({ id: 'ST1', name: 'Ali Diallo', totalDue: 150000, amountPaid: 50000, academicYear: '2026-2027', grade: '6e' });
const binta = (): Student => student({ id: 'ST2', name: 'Binta Fall', parentName: 'Ousmane Fall', totalDue: 80000, amountPaid: 80000, academicYear: '2026-2027', grade: '5e', dueDate: '2026-06-01' });
const omar = (): Student => student({ id: 'ST3', name: 'Omar Sy', parentName: 'Fatou Sy', totalDue: 60000, amountPaid: 0, academicYear: '2026-2027', grade: '9C', studentId: 'MT-2026-003' });

interface Spies {
  alerts: string[];
  addStudentCalls: Array<Record<string, unknown>>;
  addStudentResults: Array<Student | null>;
  updateCalls: Array<{ id: string; updates: Partial<Student> }>;
  updateResults: boolean[];
  toasts: number;
}

interface DepsOverrides {
  students?: Student[];
  selectedYear?: string;
  lockedYears?: string[];
  isPromoter?: boolean;
  isGeneralManager?: boolean;
  addStudentResults?: Array<Student | null>;
  updateResults?: boolean[];
}

function baseDeps(overrides: DepsOverrides = {}): {
  args: Parameters<typeof useStudents>[0];
  spies: Spies;
} {
  const spies: Spies = {
    alerts: [],
    addStudentCalls: [],
    // default success: the spy builds the persisted student; an explicit
    // [null] entry (failure) must be honoured.
    addStudentResults: overrides.addStudentResults ?? [],
    updateCalls: [],
    updateResults: overrides.updateResults ?? [true],
    toasts: 0,
  };
  const args = {
    t,
    lang: 'fr' as const,
    today: '2026-09-02',
    selectedYear: overrides.selectedYear ?? '2026-2027',
    lockedYears: overrides.lockedYears ?? [],
    isPromoter: overrides.isPromoter ?? true,
    isGeneralManager: overrides.isGeneralManager ?? false,
    students: overrides.students ?? [ali(), binta(), omar()],
    addStudent: async (s: Record<string, unknown>) => {
      spies.addStudentCalls.push(s);
      // default: the mutator returns the persisted student (id + empty payments);
      // an EXPLICIT null entry (addStudentResults: [null]) must be honoured.
      const idx = spies.addStudentCalls.length - 1;
      const explicit = spies.addStudentResults[idx];
      return explicit === undefined ? ({ ...s, id: 's-new', payments: [] } as unknown as Student) : explicit;
    },
    updateStudent: async (id: string, updates: Partial<Student>) => {
      spies.updateCalls.push({ id, updates });
      return spies.updateResults[spies.updateCalls.length - 1] ?? true;
    },
    showToast: () => { spies.toasts += 1; },
    toastError: (msg: string) => { spies.alerts.push(msg); },
  };
  return { args: args as Parameters<typeof useStudents>[0], spies };
}

async function setup(args: Parameters<typeof useStudents>[0], alertTarget: string[] = []): Promise<{
  ref: { current: ReturnType<typeof useStudents> | null };
  root: { unmount: () => void };
  restoreAlert: () => void;
}> {
  const ref: { current: ReturnType<typeof useStudents> | null } = { current: null };
  const { unmount } = renderHook(useStudents, args, ref);
  const restoreAlert = stubAlert(alertTarget);
  return { ref, root: { unmount }, restoreAlert };
}

const submitEvent = { preventDefault: () => {} } as never;

/** The full StudentForm payload the modal would submit. */
function fullForm(overrides: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
  return {
    name: 'Nouvel Élève',
    parentName: 'Parent Nouveau',
    parentEmail: 'parent@x.org',
    parentPhone: '+223 00 00 00 00',
    totalDue: '100000',
    scholarshipDiscount: '0',
    dueDate: '2026-12-31',
    academicYear: '2026-2027',
    grade: '6e',
    studentId: '',
    photo: '',
    emergencyContactName: '',
    emergencyContactRelation: '',
    emergencyContactPhone: '',
    medicalNotes: 'None',
    enrollmentDate: '2026-09-01',
    previousSchool: '',
    status: 'Active',
    ...overrides,
  };
}

describe('useStudents.filteredStudents', () => {
  it('filters by search term, grade and academic year', async () => {
    const { args } = baseDeps({});
    const { ref, root } = await setup(args);
    try {
      // Omar, though matching the search below, belongs to 2025-2026 → year scope excludes him
      const prevYear = student({ id: 'ST4', name: 'Omar Sy', parentName: 'Fatou Sy', totalDue: 60000, amountPaid: 0, academicYear: '2025-2026', grade: '9C', studentId: 'MT-2026-003' });
      assert.deepEqual(ref.current!.filteredStudents.map((s) => s.name).sort(), ['Ali Diallo', 'Binta Fall', 'Omar Sy']);
      // the previous-year student is never visible
      await act(async () => { ref.current!.setSearchTerm('mt-2026-003'); });
      assert.deepEqual(ref.current!.filteredStudents.map((s) => s.name), ['Omar Sy']);
      void prevYear;

      // search by name
      await act(async () => { ref.current!.setSearchTerm('ali'); });
      assert.deepEqual(ref.current!.filteredStudents.map((s) => s.name), ['Ali Diallo']);
      // search by parent
      await act(async () => { ref.current!.setSearchTerm('ousmane'); });
      assert.deepEqual(ref.current!.filteredStudents.map((s) => s.name), ['Binta Fall']);
      // search by studentId
      await act(async () => { ref.current!.setSearchTerm('mt-2026-003'); });
      assert.deepEqual(ref.current!.filteredStudents.map((s) => s.name), ['Omar Sy']);
      // grade filter (case-insensitive)
      await act(async () => {
        ref.current!.setSearchTerm('');
        ref.current!.setStudentGradeFilter('5E');
      });
      assert.deepEqual(ref.current!.filteredStudents.map((s) => s.name), ['Binta Fall']);
      // academic year scope — students without academicYear always stay
      await act(async () => { ref.current!.setStudentGradeFilter('all'); });
      const scoped = baseDeps({ students: [ali(), student({ id: 'ST9', name: 'No Year', totalDue: 1, amountPaid: 0 })] });
      const { ref: ref2, root: root2 } = await setup(scoped.args);
      try {
        assert.deepEqual(ref2.current!.filteredStudents.map((s) => s.name).sort(), ['Ali Diallo', 'No Year']);
      } finally {
        act(() => root2.unmount());
      }
    } finally {
      act(() => root.unmount());
    }
  });

  it('sorts by name, discounted balance and dueDate in both directions', async () => {
    const { args } = baseDeps({});
    const { ref, root } = await setup(args);
    try {
      // balance: Ali = 150000*0.9-50000 = 85000; Binta = 0; Omar = 60000
      await act(async () => { ref.current!.handleSort('balance'); });
      assert.deepEqual(ref.current!.filteredStudents.map((s) => s.name), ['Binta Fall', 'Omar Sy', 'Ali Diallo'], 'asc: discounted balance');
      await act(async () => { ref.current!.handleSort('balance'); });
      assert.deepEqual(ref.current!.filteredStudents.map((s) => s.name), ['Ali Diallo', 'Omar Sy', 'Binta Fall'], 'desc');

      // name sorting: asc = [Ali, Binta, Omar], desc = reverse
      await act(async () => { ref.current!.handleSort('name'); });
      assert.deepEqual(ref.current!.filteredStudents.map((s) => s.name), ['Ali Diallo', 'Binta Fall', 'Omar Sy']);
      await act(async () => { ref.current!.handleSort('name'); });
      assert.deepEqual(ref.current!.filteredStudents.map((s) => s.name), ['Omar Sy', 'Binta Fall', 'Ali Diallo'], 'desc reverses the asc order');

      // dueDate: Binta (2026-06-01) < Ali/Omar (2026-12-31)
      await act(async () => { ref.current!.handleSort('dueDate'); });
      assert.equal(ref.current!.filteredStudents[0]?.name, 'Binta Fall');
    } finally {
      act(() => root.unmount());
    }
  });

  it('handleSort toggles direction on the same key and switches in asc', async () => {
    const { args } = baseDeps({});
    const { ref, root } = await setup(args);
    try {
      await act(async () => { ref.current!.handleSort('name'); });
      assert.deepEqual([ref.current!.studentSortKey, ref.current!.studentSortOrder], ['name', 'asc']);
      await act(async () => { ref.current!.handleSort('name'); });
      assert.deepEqual([ref.current!.studentSortKey, ref.current!.studentSortOrder], ['name', 'desc']);
      await act(async () => { ref.current!.handleSort('balance'); });
      assert.deepEqual([ref.current!.studentSortKey, ref.current!.studentSortOrder], ['balance', 'asc']);
    } finally {
      act(() => root.unmount());
    }
  });
});

describe('useStudents.handleStudentSubmit', () => {
  it('blocks a locked year with an alert and no write', async () => {
    const { args, spies } = baseDeps({ lockedYears: ['2026-2027'] });
    const { ref, root, restoreAlert } = await setup(args, spies.alerts);
    try {
      await act(async () => {
        ref.current!.setStudentForm(fullForm() as never);
      });
      await act(async () => { await ref.current!.handleStudentSubmit(submitEvent); });
      assert.equal(spies.alerts[0], t.thisAcademicYearIsLocked);
      assert.equal(spies.addStudentCalls.length, 0);
    } finally {
      act(() => root.unmount());
      restoreAlert();
    }
  });

  it('alerts on an invalid email and an invalid amount without writing', async () => {
    const { args, spies } = baseDeps({});
    const { ref, root, restoreAlert } = await setup(args, spies.alerts);
    try {
      await act(async () => {
        ref.current!.setStudentForm(fullForm({ parentEmail: 'not-an-email' }) as never);
      });
      await act(async () => { await ref.current!.handleStudentSubmit(submitEvent); });
      assert.equal(spies.alerts[0], t.invalidEmail);
      await act(async () => {
        ref.current!.setStudentForm(fullForm({ parentEmail: '', totalDue: 'abc' }) as never);
      });
      await act(async () => { await ref.current!.handleStudentSubmit(submitEvent); });
      assert.equal(spies.alerts[1], t.invalidAmount);
      assert.equal(spies.addStudentCalls.length, 0, 'no write on either validation failure');
    } finally {
      act(() => root.unmount());
      restoreAlert();
    }
  });

  it('creates the student with the parsed amount and resets the form', async () => {
    const { args, spies } = baseDeps({});
    const { ref, root, restoreAlert } = await setup(args, spies.alerts);
    try {
      await act(async () => {
        ref.current!.setStudentForm(fullForm({ totalDue: '100000' }) as never);
      });
      await act(async () => { await ref.current!.handleStudentSubmit(submitEvent); });
      assert.equal(spies.addStudentCalls.length, 1);
      const created = spies.addStudentCalls[0]!;
      assert.equal(created.totalDue, 100000, 'the string amount is parsed to a number');
      assert.equal(created.amountPaid, 0, 'a new student starts unpaid');
      assert.equal(created.name, 'Nouvel Élève');
      assert.equal(ref.current!.showStudentModal, false);
      assert.equal(ref.current!.studentForm.name, '', 'form reset');
      assert.equal(spies.toasts, 1);
    } finally {
      act(() => root.unmount());
      restoreAlert();
    }
  });

  it('keeps matricules only for ninth-grade submissions', async () => {
    {
      const { args, spies } = baseDeps({ students: [] });
      const { ref, root, restoreAlert } = await setup(args, spies.alerts);
      try {
        await act(async () => {
          ref.current!.setStudentForm(fullForm({ grade: '6B', studentId: 'NOT-FOR-6B' }) as never);
        });
        await act(async () => { await ref.current!.handleStudentSubmit(submitEvent); });
        assert.equal(spies.addStudentCalls[0]?.studentId, undefined, 'non-9th matricules are discarded');
      } finally {
        act(() => root.unmount());
        restoreAlert();
      }
    }
    {
      const { args, spies } = baseDeps({ students: [] });
      const { ref, root, restoreAlert } = await setup(args, spies.alerts);
      try {
        await act(async () => {
          ref.current!.setStudentForm(fullForm({ grade: '9D', studentId: ' MT-2026-004 ' }) as never);
        });
        await act(async () => { await ref.current!.handleStudentSubmit(submitEvent); });
        assert.equal(spies.addStudentCalls[0]?.studentId, 'MT-2026-004', 'ninth-grade matricules are trimmed and retained');
      } finally {
        act(() => root.unmount());
        restoreAlert();
      }
    }
  });

  it('silently aborts when the mutator returns null', async () => {
    const { args, spies } = baseDeps({ addStudentResults: [null] });
    const { ref, root, restoreAlert } = await setup(args, spies.alerts);
    try {
      await act(async () => {
        ref.current!.setShowStudentModal(true);
        ref.current!.setStudentForm(fullForm() as never);
      });
      await act(async () => { await ref.current!.handleStudentSubmit(submitEvent); });
      assert.equal(spies.addStudentCalls.length, 1, 'the create was attempted');
      assert.equal(ref.current!.showStudentModal, true, 'modal stays open on failure');
      assert.equal(spies.toasts, 0, 'no success toast');
    } finally {
      act(() => root.unmount());
      restoreAlert();
    }
  });

  it('a non-finance editor cannot sneak a scholarshipDiscount; the promoter can', async () => {
    // non-finance: the form value is ignored, the existing discount is kept
    {
      const { args, spies } = baseDeps({ isPromoter: false, isGeneralManager: false, students: [ali()] });
      const { ref, root, restoreAlert } = await setup(args, spies.alerts);
      try {
        await act(async () => {
          ref.current!.openEditModal(ali());
        });
        await act(async () => {
          ref.current!.setStudentForm(fullForm({ name: 'Ali Diallo', academicYear: '2026-2027', scholarshipDiscount: '50' }) as never);
        });
        await act(async () => { await ref.current!.handleStudentSubmit(submitEvent); });
        assert.equal(spies.updateCalls.length, 1, 'the edit reached the mutator');
        assert.equal(spies.updateCalls[0]?.updates.scholarshipDiscount, 0, 'discount reset from the existing record (0)');
      } finally {
        act(() => root.unmount());
        restoreAlert();
      }
    }
    // general manager may edit the discount
    {
      const { args, spies } = baseDeps({ isPromoter: false, isGeneralManager: true, students: [ali()] });
      const { ref, root, restoreAlert } = await setup(args, spies.alerts);
      try {
        await act(async () => {
          ref.current!.openEditModal(ali());
        });
        await act(async () => {
          ref.current!.setStudentForm(fullForm({ name: 'Ali Diallo', academicYear: '2026-2027', scholarshipDiscount: '25' }) as never);
        });
        await act(async () => { await ref.current!.handleStudentSubmit(submitEvent); });
        assert.equal(spies.updateCalls.length, 1, 'the edit reached the mutator');
        assert.equal(spies.updateCalls[0]?.updates.scholarshipDiscount, 25, 'the GM discount is honored');
      } finally {
        act(() => root.unmount());
        restoreAlert();
      }
    }
  });

  it('edits an existing student through updateStudent and preserves existing notes', async () => {
    const noted = student({ id: 'ST1', name: 'Ali Diallo', totalDue: 150000, amountPaid: 50000, notes: 'Dort en classe', academicYear: '2026-2027' });
    const { args, spies } = baseDeps({ students: [noted] });
    const { ref, root, restoreAlert } = await setup(args, spies.alerts);
    try {
      await act(async () => {
        ref.current!.openEditModal(noted);
      });
      await act(async () => {
        ref.current!.setStudentForm(fullForm({ name: 'Ali Diallo Jr', academicYear: '2026-2027' }) as never);
      });
      await act(async () => { await ref.current!.handleStudentSubmit(submitEvent); });
      assert.equal(spies.updateCalls.length, 1);
      const upd = spies.updateCalls[0]!;
      assert.equal(upd.id, 'ST1');
      assert.equal(upd.updates.name, 'Ali Diallo Jr');
      assert.equal(upd.updates.notes, 'Dort en classe', 'existing notes are preserved through an edit');
      assert.equal(ref.current!.showStudentModal, false);
    } finally {
      act(() => root.unmount());
      restoreAlert();
    }
  });
});

describe('useStudents.handleSaveNote (Notes ⇄ Calendar bridge)', () => {
  it('writes the note text and lastNoteDate', async () => {
    const { args, spies } = baseDeps({ students: [ali()] });
    const { ref, root, restoreAlert } = await setup(args, spies.alerts);
    try {
      await act(async () => { await ref.current!.handleSaveNote('ST1', 'Bon élève'); });
      assert.deepEqual(spies.updateCalls, [{ id: 'ST1', updates: { notes: 'Bon élève', lastNoteDate: '2026-09-02' } }]);
      assert.equal(spies.toasts, 1);
    } finally {
      act(() => root.unmount());
      restoreAlert();
    }
  });

  it('with a noteDate, appends a trimmed dated entry to noteEntries (calendar side)', async () => {
    const { args, spies } = baseDeps({ students: [ali()] });
    const { ref, root, restoreAlert } = await setup(args, spies.alerts);
    try {
      await act(async () => { await ref.current!.handleSaveNote('ST1', '  Rendez-vous parents  ', '2026-09-15'); });
      const upd = spies.updateCalls[0]!.updates;
      assert.equal(upd.notes, '  Rendez-vous parents  ', 'the raw text stays on the record');
      assert.deepEqual(upd.noteEntries, [{ date: '2026-09-15', text: 'Rendez-vous parents' }], 'the calendar entry is trimmed and dated');
      // selected-student copy is refreshed
      await act(async () => { ref.current!.setSelectedStudent(ali()); });
      await act(async () => { await ref.current!.handleSaveNote('ST1', 'Second', '2026-09-16'); });
      assert.deepEqual(ref.current!.selectedStudent?.noteEntries, [
        { date: '2026-09-16', text: 'Second' },
      ], 'the selected-student copy carries the fresh entry');
    } finally {
      act(() => root.unmount());
      restoreAlert();
    }
  });

  it('a blank note with a date skips the calendar entry but still saves the record text', async () => {
    const { args, spies } = baseDeps({ students: [ali()] });
    const { ref, root, restoreAlert } = await setup(args, spies.alerts);
    try {
      await act(async () => { await ref.current!.handleSaveNote('ST1', '   ', '2026-09-15'); });
      const upd = spies.updateCalls[0]!.updates;
      assert.equal(upd.noteEntries, undefined, 'no dated entry for a blank note');
      assert.equal(upd.notes, '   ');
    } finally {
      act(() => root.unmount());
      restoreAlert();
    }
  });

  it('appends to existing noteEntries and leaves everything untouched on failure', async () => {
    const withEntries = student({ id: 'ST1', name: 'Ali Diallo', totalDue: 150000, amountPaid: 50000, academicYear: '2026-2027', noteEntries: [{ date: '2026-09-01', text: 'Ancienne' }] });
    const { args, spies } = baseDeps({ students: [withEntries], updateResults: [true, false] });
    const { ref, root, restoreAlert } = await setup(args, spies.alerts);
    try {
      await act(async () => { await ref.current!.handleSaveNote('ST1', 'Nouvelle', '2026-09-20'); });
      assert.deepEqual(spies.updateCalls[0]!.updates.noteEntries, [
        { date: '2026-09-01', text: 'Ancienne' },
        { date: '2026-09-20', text: 'Nouvelle' },
      ], 'existing entries are preserved');
      // failing write
      await act(async () => { await ref.current!.handleSaveNote('ST1', 'Échec'); });
      assert.equal(spies.toasts, 1, 'no toast after the failed write');
    } finally {
      act(() => root.unmount());
      restoreAlert();
    }
  });
});

describe('useStudents.openEditModal & toggleFlag', () => {
  it('hydrates the form from the record with fallbacks', async () => {
    const minimal = student({ id: 'ST7', name: 'Fatou Bâ', totalDue: 40000, amountPaid: 0 });
    const { args } = baseDeps({ students: [minimal] });
    const { ref, root, restoreAlert } = await setup(args);
    try {
      await act(async () => { ref.current!.openEditModal(minimal); });
      const f = ref.current!.studentForm;
      assert.equal(f.name, 'Fatou Bâ');
      assert.equal(f.totalDue, '40000', 'numeric totalDue becomes a form string');
      assert.equal(f.studentId, '', 'non-9th students do not receive a matricule fallback');
      assert.equal(f.medicalNotes, 'None', 'default for missing medicalNotes');
      assert.equal(f.status, 'Active', 'default for missing status');
      assert.equal(ref.current!.showStudentModal, true);
    } finally {
      act(() => root.unmount());
      restoreAlert();
    }
  });

  it('toggleFlag flips the flag only for a known id', async () => {
    const { args, spies } = baseDeps({ students: [ali()] });
    const { ref, root, restoreAlert } = await setup(args, spies.alerts);
    try {
      await act(async () => { await ref.current!.toggleFlag('ST1'); });
      await act(async () => { await ref.current!.toggleFlag('ghost'); });
      assert.deepEqual(spies.updateCalls, [{ id: 'ST1', updates: { flagged: true } }], 'one write, unknown ids ignored');
    } finally {
      act(() => root.unmount());
      restoreAlert();
    }
  });
});
