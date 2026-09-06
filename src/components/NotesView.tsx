/**
 * Notes view (personal accounting notes / todo list with optional dates) —
 * extracted verbatim from MainViews.tsx. Owns its inline date-edit state;
 * reads data and actions through the MainViewsContext.
 */
import { useState } from 'react';
import { motion } from 'motion/react';
import { CheckCircle2, Plus, StickyNote, Trash2 } from 'lucide-react';
import { useMainViews } from '../app/mainViewsContext';

export function NotesView() {
  // Task whose date chip is being edited inline.
  const [editingDateId, setEditingDateId] = useState<string | null>(null);
  const {
    t, currentTheme, todoInput, setTodoInput, todoDate, setTodoDate, todos,
    toggleTodo, deleteTodo, handleAddTodo, handleUpdateTodoDate,
  } = useMainViews();
  return (
          <div className="max-w-4xl space-y-8">
            <div className={`${currentTheme.card} p-10 rounded-[2.5rem] border ${currentTheme.border} shadow-xl shadow-slate-200/50`}>
              <div className="flex items-center gap-4 mb-8">
                <div className={`p-4 ${currentTheme.isDark ? 'bg-emerald-900/20 text-emerald-500' : 'bg-slate-100 text-slate-600'} rounded-3xl`}>
                  <StickyNote size={32} />
                </div>
                <div>
                  <h3 className={`text-2xl font-black ${currentTheme.isDark ? 'text-emerald-400' : 'text-slate-800'}`}>{t.notes}</h3>
                  <p className={currentTheme.muted}>{t.manageYourPersonalAccountingNotes}</p>
                </div>
              </div>

              <div className="space-y-6">
                <form onSubmit={handleAddTodo} className="flex gap-4">
                  <input
                    type="text"
                    value={todoInput}
                    onChange={(e) => setTodoInput(e.target.value)}
                    placeholder={t.taskPlaceholder}
                    className={`flex-1 px-6 py-4 ${currentTheme.isDark ? 'bg-emerald-900/10' : 'bg-slate-50'} border ${currentTheme.border} rounded-2xl focus:outline-none focus:ring-4 focus:ring-blue-500/5 focus:border-blue-500 transition-all text-sm font-semibold ${currentTheme.isDark ? 'text-emerald-500' : 'text-slate-800'}`}
                  />
                  <input
                    type="date"
                    value={todoDate}
                    onChange={(e) => setTodoDate(e.target.value)}
                    aria-label={t.taskDate}
                    className={`px-4 py-4 ${currentTheme.isDark ? 'bg-emerald-900/10' : 'bg-slate-50'} border ${currentTheme.border} rounded-2xl focus:outline-none focus:ring-4 focus:ring-blue-500/5 focus:border-blue-500 transition-all text-sm font-semibold ${currentTheme.isDark ? 'text-emerald-500 [color-scheme:dark]' : 'text-slate-800'}`}
                  />
                  <button
                    type="submit"
                    className="bg-blue-600 hover:bg-blue-700 text-white px-8 py-4 rounded-2xl font-black text-sm transition-all flex items-center gap-2 shadow-lg shadow-blue-500/20"
                  >
                    <Plus size={20} />
                    {t.addTask}
                  </button>
                </form>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {todos.map(todo => (
                    <motion.div
                      layout
                      key={todo.id}
                      className={`p-6 rounded-3xl border ${currentTheme.border} ${currentTheme.card} shadow-sm flex items-center justify-between group`}
                    >
                      <div className="flex items-center gap-4">
                        <button
                          onClick={() => toggleTodo(todo.id)}
                          className={`w-6 h-6 rounded-lg border-2 flex items-center justify-center transition-all ${todo.completed ? 'bg-emerald-500 border-emerald-500 text-white' : 'border-slate-200 hover:border-blue-400'}`}
                        >
                          {todo.completed && <CheckCircle2 size={14} />}
                        </button>
                        <span className={`text-sm font-bold ${todo.completed ? 'line-through text-slate-300' : (currentTheme.isDark ? 'text-emerald-500' : 'text-slate-700')}`}>
                          {todo.text}
                        </span>
                        {editingDateId === todo.id ? (
                          <input
                            type="date"
                            defaultValue={todo.date}
                            autoFocus
                            aria-label={t.taskDate}
                            onChange={(e) => {
                              setEditingDateId(null);
                              void handleUpdateTodoDate(todo.id, e.target.value);
                            }}
                            onBlur={() => setEditingDateId(null)}
                            className={`px-1.5 py-0.5 rounded-md text-[10px] font-bold border ${currentTheme.isDark ? 'bg-emerald-900/30 text-emerald-400 border-emerald-800/40 [color-scheme:dark]' : 'bg-white text-slate-700 border-blue-200'}`}
                          />
                        ) : (
                          <button
                            type="button"
                            onClick={() => setEditingDateId(todo.id)}
                            title={t.taskDate}
                            className={`px-2 py-0.5 rounded-md text-[9px] font-black uppercase tracking-widest transition-all hover:ring-2 hover:ring-blue-400/50 ${currentTheme.isDark ? 'bg-emerald-900/30 text-emerald-400' : 'bg-blue-50 text-blue-600 hover:bg-blue-100'}`}
                          >
                            {todo.date ? todo.date.split('-').reverse().join('/') : t.addDate}
                          </button>
                        )}
                      </div>
                      <button
                        onClick={() => deleteTodo(todo.id)}
                        className="p-2 text-rose-400 hover:bg-rose-50 rounded-xl transition-all opacity-0 group-hover:opacity-100"
                      >
                        <Trash2 size={18} />
                      </button>
                    </motion.div>
                  ))}
                </div>
              </div>
            </div>
          </div>
  );
}
