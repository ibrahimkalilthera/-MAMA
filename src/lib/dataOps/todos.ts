/**
 * Todo CRUD operations — built from SupabaseDataCtx.
 * Extracted from useSupabaseData.ts during the per-domain split.
 */
import { supabase } from '../supabaseClient';
import type { SupabaseDataCtx } from '../dataOpsContext';
import type { Todo } from '../domainTypes';
import type { DbUpdate } from '../database.types';
import { mapTodoRow, createRowId } from '../rowMappers';
import { rowIdColumn } from '../offlineReplay';

export function createTodoOps(ctx: SupabaseDataCtx) {
  const { setTodos, notifySuccess, notifyError, isOffline, enqueueOffline } = ctx;

  const addTodo = async (todo: Omit<Todo, 'id'> & { id?: string }): Promise<Todo | null> => {
    // L'id du GESTE — minté par l'écran (une fois par saisie) ou ici à défaut.
    // Un double envoi de la même tâche retombe sur la MÊME clé primaire.
    const rowId = todo.id ?? createRowId();
    if (isOffline()) {
      const local: Todo = { ...todo, id: rowId };
      setTodos(prev => prev.some(t => t.id === rowId) ? prev : [...prev, local]);
      enqueueOffline('addTodo', todo, rowId);
      notifySuccess('addTodo');
      return local;
    }
    const { data, error } = await supabase
      .from('todos')
      .insert({
        ...rowIdColumn(rowId),
        text: todo.text,
        completed: todo.completed,
        student_id: todo.studentId || null,
        due_date: todo.date || null,
      })
      .select()
      .single();
    if (error) {
      // `23505` : la même tâche est déjà enregistrée — la ligne est rendue sans
      // erreur, et l'écran ne la montre pas deux fois.
      if (error.code === '23505' && rowIdColumn(rowId).id) {
        const existing = await supabase.from('todos').select().eq('id', rowId).single();
        if (existing.data) {
          const already = mapTodoRow(existing.data);
          setTodos(prev => prev.some(t => t.id === already.id) ? prev : [...prev, already]);
          return already;
        }
      }
      console.error('addTodo error:', error.message); notifyError('addTodo', error.message); return null;
    }
    const mapped = mapTodoRow(data);
    setTodos(prev => prev.some(t => t.id === mapped.id) ? prev : [...prev, mapped]);
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

    // Même règle honnête que staff/students/parents : une requête filtrée par la
    // policy RLS revient en 200 avec un corps VIDE — 0 ligne n'est pas un succès.
    const { data, error } = await supabase.from('todos').update(row).eq('id', id).select('id');
    if (error) { console.error('updateTodo error:', error.message); notifyError('updateTodo', error.message); return false; }
    if (!data || data.length === 0) {
      console.error('updateTodo: aucune ligne modifiée — cible filtrée par la policy RLS');
      notifyError('updateTodo', 'Aucune ligne modifiée — droits insuffisants sur cette tâche.');
      return false;
    }
    setTodos(prev => prev.map(t => t.id === id ? { ...t, ...updates } : t));
    return true;
  };

  const deleteTodo = async (id: string): Promise<boolean> => {
    if (isOffline()) {
      setTodos(prev => prev.filter(t => t.id !== id));
      enqueueOffline('deleteTodo', { id });
      return true;
    }
    const { data, error } = await supabase.from('todos').delete().eq('id', id).select('id');
    if (error) { console.error('deleteTodo error:', error.message); notifyError('deleteTodo', error.message); return false; }
    if (!data || data.length === 0) {
      console.error('deleteTodo: aucune ligne supprimée — cible filtrée par la policy RLS');
      notifyError('deleteTodo', 'Aucune ligne supprimée — droits insuffisants sur cette tâche.');
      return false;
    }
    setTodos(prev => prev.filter(t => t.id !== id));
    return true;
  };

  return { addTodo, updateTodo, deleteTodo };
}