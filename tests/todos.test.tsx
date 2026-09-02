/**
 * happy-dom unit tests for the useTodoSidebar domain hook.
 *
 * Real hook, spy mutators: the task editor state, add (trimmed, silent when
 * empty or when the insert fails), toggle (completion persists, the
 * "Call Parent" automation writes a follow-up note via handleSaveNote only
 * when a task mentioning the call is *becoming* completed), delete passthrough
 * and the tasks/ai panel tab.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import type { FormEvent } from 'react';
import { Window } from 'happy-dom';
import { translations } from '../src/i18n/translations';
import type { TranslationDict } from '../src/i18n/translations';
import type { Todo } from '../src/lib/useSupabaseData';
import { useTodoSidebar } from '../src/app/useTodoSidebar';

const t = translations.fr as TranslationDict;

// ── global stubs ─────────────────────────────────────────────────────────────
let hasSaveNoteCalled = 0;
let hasSaveNotePayload: { studentId: string; note: string } | null = null;
let addTodoResult: Todo | null = null;
let updateTodoResult = true;
let deleteTodoResult = true;
const addCalls: Array<Omit<Todo, 'id'>> = [];
const updateCalls: Array<{ id: string; updates: Partial<Todo> }> = [];
const deleteCalls: string[] = [];

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

installDomGlobals();

function makeArgs(todos: Todo[]): Parameters<typeof useTodoSidebar>[0] {
  return {
    todos,
    t,
    handleSaveNote: async (studentId: string, note: string): Promise<void> => {
      hasSaveNoteCalled++;
      hasSaveNotePayload = { studentId, note };
    },
    addTodoItem: async (todo) => { addCalls.push(todo); return addTodoResult; },
    updateTodoItem: async (id, updates) => { updateCalls.push({ id, updates }); return updateTodoResult; },
    deleteTodoItem: async (id) => { deleteCalls.push(id); return deleteTodoResult; },
  };
}

type Api = ReturnType<typeof useTodoSidebar>;
type ApiRef = { current: Api | null };

function Harness(props: { args: Parameters<typeof useTodoSidebar>[0]; api: ApiRef }): null {
  props.api.current = useTodoSidebar(props.args);
  return null;
}

let root: Root;
let container: HTMLElement;
function render(args: Parameters<typeof useTodoSidebar>[0], api: ApiRef): void {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root.render(createElement(Harness, { args, api })));
}
function unmount(): void {
  if (root) { act(() => root.unmount()); root = null as unknown as Root; }
  if (container) container.remove();
}

const event = () => ({ preventDefault: () => {} }) as unknown as FormEvent;

function resetSpies(): void {
  hasSaveNoteCalled = 0;
  hasSaveNotePayload = null;
  addCalls.length = 0;
  updateCalls.length = 0;
  deleteCalls.length = 0;
  addTodoResult = { id: 't9', text: 'x', completed: false };
  updateTodoResult = true;
  deleteTodoResult = true;
}
resetSpies();

describe('useTodoSidebar', () => {
  it('ignores empty or whitespace-only task names', async () => {
    const apiRef: ApiRef = { current: null };
    render(makeArgs([]), apiRef);
    act(() => { apiRef.current?.setTodoInput('   '); });
    await act(async () => { await apiRef.current?.handleAddTodo(event()); });
    assert.equal(addCalls.length, 0);
    unmount();
  });

  it('adds a trimmed task and clears the input on success', async () => {
    resetSpies();
    const apiRef: ApiRef = { current: null };
    render(makeArgs([]), apiRef);
    act(() => { apiRef.current?.setTodoInput('  Appeler le parent de Fatou  '); });
    await act(async () => { await apiRef.current?.handleAddTodo(event()); });
    assert.deepEqual(addCalls, [{ text: 'Appeler le parent de Fatou', completed: false }]);
    assert.equal(apiRef.current?.todoInput, '');
    unmount();
  });

  it('keeps the input when the insert fails', async () => {
    resetSpies();
    addTodoResult = null;
    const apiRef: ApiRef = { current: null };
    render(makeArgs([]), apiRef);
    act(() => { apiRef.current?.setTodoInput('tache'); });
    await act(async () => { await apiRef.current?.handleAddTodo(event()); });
    assert.equal(addCalls.length, 1);
    assert.equal(apiRef.current?.todoInput, 'tache');
    unmount();
  });

  it('toggles completion through the mutator and ignores unknown ids', async () => {
    resetSpies();
    const todo: Todo = { id: 't1', text: 'Ranger la classe', completed: false };
    const apiRef: ApiRef = { current: null };
    render(makeArgs([todo]), apiRef);
    await act(async () => { await apiRef.current?.toggleTodo('t1'); });
    assert.deepEqual(updateCalls, [{ id: 't1', updates: { completed: true } }]);
    assert.equal(hasSaveNoteCalled, 0);

    await act(async () => { await apiRef.current?.toggleTodo('inexistant'); });
    assert.equal(updateCalls.length, 1); // untouched
    unmount();
  });

  it('automates the follow-up note only when a "call parent" task becomes completed', async () => {
    resetSpies();
    const callTodo: Todo = { id: 't2', text: 'Appeler parent d’Omar', completed: false, studentId: 'stu-1' };
    const apiRef: ApiRef = { current: null };
    render(makeArgs([callTodo]), apiRef);

    // completing the call task → note written
    await act(async () => { await apiRef.current?.toggleTodo('t2'); });
    assert.equal(hasSaveNoteCalled, 1);
    assert.deepEqual(hasSaveNotePayload, { studentId: 'stu-1', note: t.followUpCompleted });

    // un-completing it (re-render with the todo now completed) → no new note
    hasSaveNoteCalled = 0;
    updateTodoResult = true;
    render(makeArgs([{ ...callTodo, completed: true }]), apiRef);
    await act(async () => { await apiRef.current?.toggleTodo('t2'); });
    assert.equal(hasSaveNoteCalled, 0);
    unmount();
  });

  it('does not write a note for a completed task without a student or without a failed update', async () => {
    resetSpies();
    const plainTodo: Todo = { id: 't3', text: 'call parent', completed: false }; // no studentId
    const apiRef: ApiRef = { current: null };
    render(makeArgs([plainTodo]), apiRef);
    await act(async () => { await apiRef.current?.toggleTodo('t3'); });
    assert.equal(hasSaveNoteCalled, 0); // call language, but no student to attach to

    // failing update → no note either
    const withStudent: Todo = { id: 't4', text: 'appeler parent', completed: false, studentId: 'stu-2' };
    const apiRef2: ApiRef = { current: null };
    render(makeArgs([withStudent]), apiRef2);
    updateTodoResult = false;
    await act(async () => { await apiRef2.current?.toggleTodo('t4'); });
    assert.equal(hasSaveNoteCalled, 0);
    unmount();
  });

  it('deletes through the mutator passthrough', async () => {
    resetSpies();
    const apiRef: ApiRef = { current: null };
    render(makeArgs([{ id: 't5', text: 'x', completed: false }]), apiRef);
    await act(async () => { await apiRef.current?.deleteTodo('t5'); });
    assert.deepEqual(deleteCalls, ['t5']);
    unmount();
  });

  it('exposes the tasks/ai panel tab switch', () => {
    const apiRef: ApiRef = { current: null };
    render(makeArgs([]), apiRef);
    assert.equal(apiRef.current?.productivitySidebarTab, 'tasks');
    act(() => { apiRef.current?.setProductivitySidebarTab('ai'); });
    assert.equal(apiRef.current?.productivitySidebarTab, 'ai');
    assert.equal(apiRef.current?.showTodoSidebar, false);
    act(() => { apiRef.current?.setShowTodoSidebar(true); });
    assert.equal(apiRef.current?.showTodoSidebar, true);
    unmount();
  });
});