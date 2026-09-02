/**
 * To-Do list + Productivité panel domain hook — extracted verbatim from
 * App.tsx.
 *
 * Owns the task editor state (input, sidebar open flag, active panel tab)
 * and the three task actions (add / toggle / delete), including the
 * "Call Parent" automation when a follow-up task is completed. Task data
 * comes from useSupabaseData through the deps; App.tsx only consumes the
 * returned API and forwards it to the views.
 */
import { useState } from 'react';
import type { FormEvent } from 'react';
import type { TranslationDict } from '../i18n/translations';
import type { Todo } from '../lib/useSupabaseData';

interface TodoSidebarDeps {
  todos: Todo[];
  t: TranslationDict;
  handleSaveNote: (studentId: string, note: string) => Promise<void>;
  addTodoItem: (todo: Omit<Todo, 'id'>) => Promise<Todo | null>;
  updateTodoItem: (id: string, updates: Partial<Todo>) => Promise<boolean>;
  deleteTodoItem: (id: string) => Promise<boolean>;
}

export function useTodoSidebar(deps: TodoSidebarDeps) {
  const { todos, t, handleSaveNote, addTodoItem, updateTodoItem, deleteTodoItem } = deps;

  const [todoInput, setTodoInput] = useState('');
  const [todoDate, setTodoDate] = useState(() => new Date().toISOString().split('T')[0]);
  const [showTodoSidebar, setShowTodoSidebar] = useState(false);
  const [productivitySidebarTab, setProductivitySidebarTab] = useState<'tasks' | 'ai'>('tasks');

  const handleAddTodo = async (e: FormEvent) => {
    e.preventDefault();
    if (!todoInput.trim()) return;
    const saved = await addTodoItem({ text: todoInput.trim(), completed: false, date: todoDate });
    if (!saved) return;
    setTodoInput('');
  };

  const toggleTodo = async (id: string) => {
    const todo = todos.find(t => t.id === id);
    if (!todo) return;
    const newCompleted = !todo.completed;
    const ok = await updateTodoItem(id, { completed: newCompleted });
    if (!ok) return;
    // Automation: if "Call Parent" is checked
    if (newCompleted && (todo.text.toLowerCase().includes('call parent') || todo.text.toLowerCase().includes('appeler parent')) && todo.studentId) {
      await handleSaveNote(todo.studentId, t.followUpCompleted);
    }
  };

  const deleteTodo = async (id: string) => {
    return deleteTodoItem(id);
  };

  /** Edit an existing task's calendar date (empty string removes it). */
  const handleUpdateTodoDate = async (id: string, date: string): Promise<boolean> => {
    return updateTodoItem(id, date ? { date } : { date: undefined });
  };

  return {
    todoInput,
    setTodoInput,
    todoDate,
    setTodoDate,
    showTodoSidebar,
    setShowTodoSidebar,
    productivitySidebarTab,
    setProductivitySidebarTab,
    handleAddTodo,
    toggleTodo,
    deleteTodo,
    handleUpdateTodoDate,
  };
}