/**
 * happy-dom unit tests for the useClasses domain hook (classes/sections
 * management). Real hook, spy mutators:
 *   1. availableClasses merges the built-in defaults with the Supabase
 *      custom classes, deduplicating case-insensitively;
 *   2. creation rejects an existing code (case-insensitive) with a warning
 *      toast + auto-select, and never calls the mutator;
 *   3. creation success passes the built code with the section uppercased,
 *      auto-selects the grade, toasts and resets the form;
 *   4. a failed insert keeps the modal open with an error toast;
 *   5. openEditClass fills the form (+ customName for 'other' cycles);
 *   6. editing rejects a collision with ANOTHER class but allows its own
 *      code, and success updates + toasts + closes;
 *   7. deletion opens the shared confirm dialog and only deletes on
 *      confirm (built-in classes without a rowId are never offered);
 *   8. a failed delete shows no success toast.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { act } from 'react';
import type { FormEvent } from 'react';
import { translations } from '../src/i18n/translations';
import type { TranslationDict } from '../src/i18n/translations';
import type { ManagedClass } from '../src/app/mainViewsProps';
import { useClasses } from '../src/app/useClasses';
import { DEFAULT_SCHOOL_CLASSES } from '../src/app/types';
import { installDomGlobals, renderHook } from './harness';

const t = translations.fr as TranslationDict;

installDomGlobals();

const customClass = (overrides: Partial<ManagedClass> = {}): ManagedClass => ({
  id: '1E',
  rowId: 'row-1e',
  cycle: 'cycle1',
  year: 1,
  section: 'E',
  nameFr: '1ère Année E (1E)',
  nameEn: '1st Year E (1E)',
  isCustom: true,
  ...overrides,
});

interface Spies {
  warnings: string[];
  errors: string[];
  success: string[];
  autoSelected: string[];
  confirmAction: { title: string; message: string; confirmLabel: string; onConfirm: () => Promise<void> } | null;
  addCalls: Array<Parameters<NonNullable<Parameters<typeof useClasses>[0]['addCustomClass']>>[0]>;
  addResults: (unknown | null)[];
  updateCalls: Parameters<NonNullable<Parameters<typeof useClasses>[0]['updateCustomClass']>>[];
  updateResults: boolean[];
  deleteCalls: string[];
  deleteResults: boolean[];
}

function makeDeps(customClasses: ManagedClass[] = []): { args: Parameters<typeof useClasses>[0]; spies: Spies } {
  const spies: Spies = {
    warnings: [], errors: [], success: [], autoSelected: [],
    confirmAction: null,
    addCalls: [], addResults: [null],
    updateCalls: [], updateResults: [true],
    deleteCalls: [], deleteResults: [true],
  };
  const args: Parameters<typeof useClasses>[0] = {
    t,
    customClasses,
    toast: {
      success: (msg) => { spies.success.push(msg); return 'id'; },
      error: (msg) => { spies.errors.push(msg); return 'id'; },
      warning: (msg) => { spies.warnings.push(msg); return 'id'; },
    },
    autoSelectGrade: (grade) => { spies.autoSelected.push(grade); },
    setConfirmAction: (action) => { spies.confirmAction = action as Spies['confirmAction']; },
    addCustomClass: async (cls) => {
      spies.addCalls.push(cls);
      const r = spies.addResults[spies.addCalls.length - 1] ?? null;
      return r as Awaited<ReturnType<NonNullable<Parameters<typeof useClasses>[0]['addCustomClass']>>>;
    },
    updateCustomClass: async (rowId, updates) => {
      spies.updateCalls.push([rowId, updates]);
      return spies.updateResults[spies.updateCalls.length - 1] ?? true;
    },
    deleteCustomClass: async (rowId) => {
      spies.deleteCalls.push(rowId);
      return spies.deleteResults[spies.deleteCalls.length - 1] ?? true;
    },
  };
  return { args, spies };
}

type Api = ReturnType<typeof useClasses>;

describe('useClasses', () => {
  it('merges default and custom classes, deduplicating case-insensitively', () => {
    const { args } = makeDeps([
      customClass({ id: '1e' }), // lowercase custom class — kept as-is (not in the defaults)
      customClass({ id: '1A', rowId: 'row-dup' }), // duplicates built-in 1A (case-insensitive) → filtered
      customClass({ id: '1F', rowId: 'row-1f' }),
    ]);
    const { api, unmount } = renderHook(useClasses, args);
    const ids = api.current!.availableClasses.map((c) => c.id);
    assert.ok(ids.includes('1A'), 'built-in 1A present');
    assert.ok(ids.includes('1e'), 'custom 1e kept');
    assert.ok(ids.includes('1F'));
    const dups = ids.filter((id) => id.toLowerCase() === '1a');
    assert.equal(dups.length, 1, 'the duplicate of 1A is filtered out (case-insensitive)');
    assert.equal(ids.length, DEFAULT_SCHOOL_CLASSES.length + 2, 'defaults + two kept customs');
    act(() => unmount());
  });

  it('rejects an existing code on create (case-insensitive) with a warning and no insert', async () => {
    const { args, spies } = makeDeps();
    const { api, unmount } = renderHook(useClasses, args);
    // form 1A → collides with the built-in 1A (sections only go to C, so 1D would be a fresh code)
    await act(async () => {
      api.current!.setShowAddClassModal(true);
      api.current!.setNewClassForm({ cycle: 'cycle1', year: '1', section: 'a', customName: '' }); // lowercase section
    });
    await act(async () => { await api.current!.handleCreateClassSubmit(undefined); });

    assert.equal(spies.addCalls.length, 0, 'no insert on collision');
    assert.deepEqual(spies.warnings, [t.classAlreadyExists.replace('{code}', '1A')]);
    assert.deepEqual(spies.autoSelected, ['1A'], 'the existing code is auto-selected');
    assert.equal(api.current!.showAddClassModal, false, 'modal closes on collision');
    act(() => unmount());
  });

  it('creates a new class, uppercases the section, auto-selects and resets the form', async () => {
    const { args, spies } = makeDeps();
    spies.addResults = [{ id: 'row-1e', code: '1E', cycle: 'cycle1', year: '1', section: 'E', nameFr: 'x', nameEn: 'x' }];
    const { api, unmount } = renderHook(useClasses, args);
    await act(async () => {
      api.current!.setShowAddClassModal(true);
      api.current!.setNewClassForm({ cycle: 'cycle1', year: '1', section: 'e', customName: '' });
    });
    await act(async () => { await api.current!.handleCreateClassSubmit(undefined); });

    assert.equal(spies.addCalls.length, 1);
    assert.deepEqual(spies.addCalls[0], {
      code: '1E', cycle: 'cycle1', year: '1', section: 'E', // section uppercased
      nameFr: '1ère Année E (1E)', nameEn: '1st Year E (1E)',
    });
    assert.deepEqual(spies.autoSelected, ['1E']);
    assert.deepEqual(spies.success, [t.classAddedSuccessfully.replace('{code}', '1E')]);
    assert.equal(api.current!.showAddClassModal, false);
    assert.deepEqual(api.current!.newClassForm, { cycle: 'cycle1', year: '1', section: 'D', customName: '' }, 'form reset');
    act(() => unmount());
  });

  it('keeps the modal open with an error toast when the insert fails', async () => {
    const { args, spies } = makeDeps();
    spies.addResults = [null]; // mutator failure
    const { api, unmount } = renderHook(useClasses, args);
    await act(async () => {
      api.current!.setShowAddClassModal(true);
      api.current!.setNewClassForm({ cycle: 'cycle1', year: '9', section: 'D', customName: '' });
    });
    await act(async () => { await api.current!.handleCreateClassSubmit(undefined); });

    assert.equal(spies.addCalls.length, 1);
    assert.deepEqual(spies.errors, [t.failedToAddClass]);
    assert.equal(api.current!.showAddClassModal, true, 'modal stays open');
    act(() => unmount());
  });

  it('openEditClass fills the form (customName for other cycles) and opens the modal', () => {
    const { args } = makeDeps();
    const { api, unmount } = renderHook(useClasses, args);
    act(() => { api.current!.openEditClass(customClass({ rowId: 'row-x', cycle: 'other', id: 'Garderie' })); });
    assert.equal(api.current!.showEditClassModal, true);
    assert.equal(api.current!.editingClassRowId, 'row-x');
    assert.deepEqual(api.current!.editClassForm, { cycle: 'other', year: '1', section: 'E', customName: 'Garderie' });
    act(() => unmount());
  });

  it('rejects an edit colliding with another class but allows its own code', async () => {
    const { args, spies } = makeDeps([customClass({ id: '1E', rowId: 'row-1e' })]);
    const { api, unmount } = renderHook(useClasses, args);
    // edit 1E → 1A (collides with the built-in 1A)
    await act(async () => {
      api.current!.openEditClass(customClass({ id: '1E', rowId: 'row-1e' }));
      api.current!.setEditClassForm({ cycle: 'cycle1', year: '1', section: 'A', customName: '' });
    });
    await act(async () => { await api.current!.handleEditClassSubmit({ preventDefault: () => {} } as FormEvent); });
    assert.equal(spies.updateCalls.length, 0, 'no update on a cross-class collision');
    assert.deepEqual(spies.warnings, [t.classAlreadyExists.replace('{code}', '1A')]);
    assert.equal(api.current!.showEditClassModal, true, 'modal stays open');

    // editing 1E keeping its own code is fine
    await act(async () => {
      api.current!.setEditClassForm({ cycle: 'cycle1', year: '1', section: 'E', customName: '' });
    });
    await act(async () => { await api.current!.handleEditClassSubmit({ preventDefault: () => {} } as FormEvent); });
    assert.equal(spies.updateCalls.length, 1, 'own code is allowed');
    assert.equal(spies.updateCalls[0][0], 'row-1e');
    assert.equal(spies.updateCalls[0][1].section, 'E');
    assert.deepEqual(spies.success, [t.classUpdated.replace('{code}', '1E')]);
    assert.equal(api.current!.showEditClassModal, false);
    assert.equal(api.current!.editingClassRowId, null);
    act(() => unmount());
  });

  it('deletes only through the confirm dialog, and only for custom classes', async () => {
    const { args, spies } = makeDeps([customClass({ id: '1E', rowId: 'row-1e' })]);
    const { api, unmount } = renderHook(useClasses, args);

    // built-in class (no rowId) → no dialog
    const builtIn = api.current!.availableClasses.find((c) => c.id === '1A')!;
    await act(async () => { await api.current!.handleDeleteClass(builtIn); });
    assert.equal(spies.confirmAction, null, 'built-in classes cannot be deleted');

    // custom class → dialog opens with the right copy
    const custom = api.current!.availableClasses.find((c) => c.id === '1E')!;
    await act(async () => { await api.current!.handleDeleteClass(custom); });
    // Function call: the earlier assert.equal(..., null) narrowed the
    // property to null in TS's eyes — a call re-reads it fresh.
    const readConfirm = (): Spies['confirmAction'] => spies.confirmAction;
    const confirm = readConfirm();
    assert.ok(confirm, 'confirm dialog opened');
    assert.equal(confirm.title, t.deleteClass);
    assert.equal(confirm.message, t.deleteClassConfirm.replace('{id}', '1E'));
    assert.equal(spies.deleteCalls.length, 0, 'nothing deleted before confirmation');

    // confirm → delete + success toast
    await act(async () => { await confirm.onConfirm(); });
    assert.deepEqual(spies.deleteCalls, ['row-1e']);
    assert.deepEqual(spies.success, [t.classDeleted.replace('{id}', '1E')]);
    act(() => unmount());
  });

  it('shows no success toast when the delete fails', async () => {
    const { args, spies } = makeDeps([customClass({ id: '1E', rowId: 'row-1e' })]);
    spies.deleteResults = [false];
    const { api, unmount } = renderHook(useClasses, args);
    const custom = api.current!.availableClasses.find((c) => c.id === '1E')!;
    await act(async () => { await api.current!.handleDeleteClass(custom); });
    await act(async () => { await spies.confirmAction!.onConfirm(); });
    assert.deepEqual(spies.deleteCalls, ['row-1e']);
    assert.equal(spies.success.length, 0, 'no success toast on failure');
    act(() => unmount());
  });
});