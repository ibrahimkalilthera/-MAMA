/**
 * Todo CRUD operations — built from SupabaseDataCtx.
 * Extracted from useSupabaseData.ts during the per-domain split.
 */
import { supabase } from '../supabaseClient';
import type { SupabaseDataCtx } from '../dataOpsContext';
import type { Todo } from '../domainTypes';
import type { DbUpdate } from '../database.types';
import { mapTodoRow, createTempId } from '../rowMappers';

export function createTodoOps(ctx: SupabaseDataCtx) {
  const { setTodos, notifySuccess, notifyError, isOffline, enqueueOffline } = ctx;

  const addTodo = async (todo: Omit<Todo, 'id'>): Promise<Todo | null> => {
    if (isOffline()) {
      const tempId = createTempId('todo');
      const local: Todo = { id: tempId, ...todo };
      setTodos(prev => [...prev, local]);
      enqueueOffline('addTodo', todo);
      notifySuccess('addTodo');
      return local;
    }
    const { data, error } = await supabase
      .from('todos')
      .insert({
        text: todo.text,
        completed: todo.completed,
        student_id: todo.studentId || null,
        due_date: todo.date || null,
      })
      .select()
      .single();
    if (error) { console.error('addTodo error:', error.message); notifyError('addTodo', error.message); return null; }
    const mapped = mapTodoRow(data);
    setTodos(prev => [...prev, mapped]);
    notifySuccess('addTodo');
    return mapped;
  };

  const updateTodo = async (id: string, updates: Partial<Todo>): Promise<boolean> => {
    if (isOffline()) {
      setTodos(prev => prev.map(t => t.id === id ? { ...t, ...updates } : t));
      enqueueOffline('updateTodo', { id, updates });
      return true;
    }
    const row: DbUpdate<'todos'> = {};
    if (updates.text !== undefined) row.text = updates.text;
    if (updates.completed !== undefined) row.completed = updates.completed;
    if (updates.date !== undefined) row.due_date = updates.date;

    const { error } = await supabase.from('todos').update(row).eq('id', id);
    if (error) { console.error('updateTodo error:', error.message); notifyError('updateTodo', error.message); return false; }
    setTodos(prev => prev.map(t => t.id === id ? { ...t, ...updates } : t));
    return true;
  };

  const deleteTodo = async (id: string): Promise<boolean> => {
    if (isOffline()) {
      setTodos(prev => prev.filter(t => t.id !== id));
      enqueueOffline('deleteTodo', { id });
      return true;
    }
    const { error } = await supabase.from('todos').delete().eq('id', id);
    if (error) { console.error('deleteTodo error:', error.message); notifyError('deleteTodo', error.message); return false; }
    setTodos(prev => prev.filter(t => t.id !== id));
    return true;
  };

  return { addTodo, updateTodo, deleteTodo };
}