/**
 * happy-dom unit tests for useParents.handleParentSubmit in CREATION mode.
 *
 * The branches that matter for creation are exercised against the REAL hook
 * with injected spy mutators (addParent / updateStudent) and spy callbacks
 * (setWelcomeMessage / setStudents), so no Supabase or DOM is needed beyond
 * a document to mount React:
 *   1. success — every selected student is linked via updateStudent with the
 *      created parent's id, and the modal switches to the "fiche" view
 *      (editingParent set, form refilled from the created parent);
 *   2. partial linkage failure — the loop stops on the first failed
 *      updateStudent and sets the partial-linkage welcome message
 *      (`Parent créé, mais seulement X/Y élève(s) lié(s).`);
 *   3. creation failure — addParent returns null: nothing is linked and no
 *      modal state moves (early return);
 * plus two guards: no student selected → modal closes and form resets;
 * empty fullName → no mutator is called at all.
 *
 * NOTE: the hook API must always be read through a LIVE ref — the object
 * returned by one render closes over that render's state, so a snapshot
 * taken before an `act` sees stale values.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { act, createElement } from 'react';
import type { FormEvent } from 'react';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import { Window } from 'happy-dom';
import { translations } from '../src/i18n/translations';
import type { TranslationDict } from '../src/i18n/translations';
import { useParents } from '../src/app/useParents';
import type { UseParentsArgs } from '../src/app/useParents';
import type { Parent, Student } from '../src/app/types';

const t = translations.en as TranslationDict;

/** Install happy-dom's window/document (and friends) on globalThis. */
function installDomGlobals(): Window {
  const win = new Window({ url: 'http://localhost/' });
  const define = (key: string, value: unknown): void => {
    Object.defineProperty(globalThis, key, { value, configurable: true, writable: true });
  };
  define('window', win);
  define('document', win.document);
  define('navigator', win.navigator);
  define('HTMLElement', win.HTMLElement);
  define('Element', win.Element);
  define('Node', win.Node);
  define('Event', win.Event);
  define('CustomEvent', win.CustomEvent);
  define('getComputedStyle', win.getComputedStyle.bind(win));
  define('localStorage', win.localStorage);
  define('IS_REACT_ACT_ENVIRONMENT', true);
  return win;
}

const win = installDomGlobals();

type ParentsApi = ReturnType<typeof useParents>;
type ApiRef = { current: ParentsApi | null };

/** Renders the hook inside a component and keeps a live ref to its API. */
function Harness(props: { args: UseParentsArgs; api: ApiRef }): null {
  props.api.current = useParents(props.args);
  return null;
}

function mount(args: UseParentsArgs): { root: Root; container: Element; ref: ApiRef } {
  const container = win.document.createElement('div');
  win.document.body.appendChild(container);
  const root = createRoot(container as unknown as Element);
  const ref: ApiRef = { current: null };
  act(() => {
    root.render(createElement(Harness, { args, api: ref }));
  });
  return { root, container: container as unknown as Element, ref };
}

// ── fixtures ─────────────────────────────────────────────────────────────────

const createdParent: Parent = {
  id: 'p1',
  fullName: 'Ada Diallo',
  phones: ['0700000000', '0777000000'],
  email: 'ada@example.com',
  address: 'Dakar',
  occupation: 'Teacher',
  relationship: 'Mother',
};

function baseArgs(): UseParentsArgs {
  return {
    t,
    lang: 'en',
    formatCurrency: (amount: number) => `${amount} XOF`,
    students: [],
    setStudents: () => {},
    addParent: async () => createdParent,
    updateParent: async () => true,
    deleteParent: async () => true,
    updateStudent: async () => true,
    setWelcomeMessage: () => {},
    setConfirmAction: () => {},
  };
}

interface Spies {
  addParentCalls: Array<Omit<Parent, 'id'>>;
  updateStudentCalls: Array<[string, Partial<Student>]>;
  welcomeMessages: string[];
}

/** Builds args with recording spies; updateStudent resolves per-call from the list. */
function spyArgs(overrides: {
  addParentResult?: Parent | null;
  updateStudentResults?: boolean[];
}): { args: UseParentsArgs; spies: Spies } {
  const spies: Spies = { addParentCalls: [], updateStudentCalls: [], welcomeMessages: [] };
  const addParent = async (p: Omit<Parent, 'id'>): Promise<Parent | null> => {
    spies.addParentCalls.push(p);
    return overrides.addParentResult === undefined ? createdParent : overrides.addParentResult;
  };
  const updateStudent = async (id: string, updates: Partial<Student>): Promise<boolean> => {
    spies.updateStudentCalls.push([id, updates]);
    const result = (overrides.updateStudentResults ?? [true])[spies.updateStudentCalls.length - 1];
    return result ?? true;
  };
  const args: UseParentsArgs = {
    ...baseArgs(),
    addParent,
    updateStudent,
    setWelcomeMessage: (msg: string | null) => {
      if (msg !== null) spies.welcomeMessages.push(msg);
    },
  };
  return { args, spies };
}

const submitEvent = { preventDefault: () => {} } as unknown as FormEvent;

const filledForm = (linkedStudentIds: string[]) => ({
  fullName: '  Ada Diallo  ',
  primaryPhone: ' 0700000000 ',
  secondaryPhone: '0777000000',
  email: ' ada@example.com ',
  address: 'Dakar',
  occupation: 'Teacher',
  relationship: 'Mother',
  notes: '',
  linkedStudentIds,
});

describe('useParents.handleParentSubmit — creation mode', () => {
  it('creates the parent and links every selected student on success', async () => {
    const { args, spies } = spyArgs({ updateStudentResults: [true, true] });
    const { root, container, ref } = mount(args);
    try {
      act(() => {
        ref.current?.setShowParentModal(true);
        ref.current?.setParentForm(filledForm(['s1', 's2']));
      });

      await act(async () => {
        await ref.current?.handleParentSubmit(submitEvent);
      });

      const api = ref.current as ParentsApi;

      // One addParent call with the trimmed/normalised parent data.
      assert.equal(spies.addParentCalls.length, 1);
      assert.equal(spies.addParentCalls[0].fullName, 'Ada Diallo');
      assert.deepEqual(spies.addParentCalls[0].phones, ['0700000000', '0777000000']);
      assert.equal(spies.addParentCalls[0].email, 'ada@example.com');
      assert.equal(spies.addParentCalls[0].address, 'Dakar');
      assert.equal(spies.addParentCalls[0].occupation, 'Teacher');
      assert.equal(spies.addParentCalls[0].relationship, 'Mother');

      // Both students linked to the created parent id.
      assert.deepEqual(
        spies.updateStudentCalls.map(([id]) => id),
        ['s1', 's2']
      );
      const expectedLink = {
        parentId: 'p1',
        parentName: 'Ada Diallo',
        parentPhone: '0700000000',
        parentEmail: 'ada@example.com',
      };
      assert.deepEqual(spies.updateStudentCalls[0][1], expectedLink);
      assert.deepEqual(spies.updateStudentCalls[1][1], expectedLink);

      // All linked → no partial-linkage warning; the modal switches to the
      // "fiche" view (editingParent = created parent, form refilled).
      assert.deepEqual(spies.welcomeMessages, []);
      assert.equal(api.editingParent?.id, 'p1');
      assert.equal(api.parentForm.fullName, 'Ada Diallo');
      assert.equal(api.parentForm.primaryPhone, '0700000000');
      assert.equal(api.parentForm.secondaryPhone, '0777000000');
      assert.deepEqual(api.parentForm.linkedStudentIds, [], 'selection list is cleared in fiche view');
      assert.equal(api.showParentModal, true, 'fiche view keeps the modal open');
    } finally {
      await act(async () => root.unmount());
      container.remove();
    }
  });

  it('stops at the first failed link and reports the partial linkage', async () => {
    const { args, spies } = spyArgs({ updateStudentResults: [true, false] });
    const { root, container, ref } = mount(args);
    try {
      act(() => {
        ref.current?.setShowParentModal(true);
        ref.current?.setParentForm(filledForm(['s1', 's2']));
      });

      await act(async () => {
        await ref.current?.handleParentSubmit(submitEvent);
      });

      const api = ref.current as ParentsApi;

      // Both students were attempted (the failure is on the second one).
      assert.deepEqual(
        spies.updateStudentCalls.map(([id]) => id),
        ['s1', 's2']
      );
      // Partial-linkage warning with the exact count.
      assert.deepEqual(spies.welcomeMessages, ['Parent créé, mais seulement 1/2 élève(s) lié(s).']);
      // The fiche view still opens so the user can see what was linked.
      assert.equal(api.editingParent?.id, 'p1');
      assert.equal(api.showParentModal, true);
    } finally {
      await act(async () => root.unmount());
      container.remove();
    }
  });

  it('stops on the FIRST failed link (no further students are touched)', async () => {
    const { args, spies } = spyArgs({ updateStudentResults: [false, true] });
    const { root, container, ref } = mount(args);
    try {
      act(() => {
        ref.current?.setShowParentModal(true);
        ref.current?.setParentForm(filledForm(['s1', 's2']));
      });

      await act(async () => {
        await ref.current?.handleParentSubmit(submitEvent);
      });

      const api = ref.current as ParentsApi;

      // Only the first student was attempted; the loop broke on its failure.
      assert.deepEqual(
        spies.updateStudentCalls.map(([id]) => id),
        ['s1']
      );
      assert.deepEqual(spies.welcomeMessages, ['Parent créé, mais seulement 0/2 élève(s) lié(s).']);
      // 0 linked → the fiche view is NOT kept; the modal closes.
      assert.equal(api.editingParent, null);
      assert.equal(api.showParentModal, false);
    } finally {
      await act(async () => root.unmount());
      container.remove();
    }
  });

  it('aborts creation when addParent fails: nothing is linked, modal untouched', async () => {
    const { args, spies } = spyArgs({ addParentResult: null });
    const { root, container, ref } = mount(args);
    try {
      act(() => {
        ref.current?.setShowParentModal(true);
        ref.current?.setParentForm(filledForm(['s1', 's2']));
      });

      await act(async () => {
        await ref.current?.handleParentSubmit(submitEvent);
      });

      const api = ref.current as ParentsApi;

      assert.equal(spies.addParentCalls.length, 1);
      assert.equal(spies.updateStudentCalls.length, 0, 'no student is linked when creation fails');
      assert.deepEqual(spies.welcomeMessages, []);
      // Early return: no modal/state change at all.
      assert.equal(api.showParentModal, true, 'modal state is untouched');
      assert.equal(api.editingParent, null);
      assert.deepEqual(api.parentForm.linkedStudentIds, ['s1', 's2'], 'form is not reset');
    } finally {
      await act(async () => root.unmount());
      container.remove();
    }
  });

  it('closes the modal and resets the form when no student is selected', async () => {
    const { args, spies } = spyArgs({});
    const { root, container, ref } = mount(args);
    try {
      act(() => {
        ref.current?.setShowParentModal(true);
        ref.current?.setParentForm(filledForm([]));
      });

      await act(async () => {
        await ref.current?.handleParentSubmit(submitEvent);
      });

      const api = ref.current as ParentsApi;

      assert.equal(spies.addParentCalls.length, 1);
      assert.equal(spies.updateStudentCalls.length, 0);
      assert.equal(api.showParentModal, false, 'modal closes without linked students');
      assert.equal(api.editingParent, null);
      assert.equal(api.parentForm.fullName, '', 'form is reset after creation');
      assert.deepEqual(api.parentForm.linkedStudentIds, []);
    } finally {
      await act(async () => root.unmount());
      container.remove();
    }
  });

  it('does nothing at all when the fullName is empty', async () => {
    const { args, spies } = spyArgs({});
    const { root, container, ref } = mount(args);
    try {
      act(() => {
        ref.current?.setShowParentModal(true);
        ref.current?.setParentForm({ ...filledForm(['s1']), fullName: '   ' });
      });

      await act(async () => {
        await ref.current?.handleParentSubmit(submitEvent);
      });

      const api = ref.current as ParentsApi;

      assert.equal(spies.addParentCalls.length, 0, 'no addParent without a name');
      assert.equal(spies.updateStudentCalls.length, 0);
      assert.deepEqual(spies.welcomeMessages, []);
      assert.equal(api.showParentModal, true, 'modal untouched');
    } finally {
      await act(async () => root.unmount());
      container.remove();
    }
  });
});