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
            <div className={`${currentTheme.card} p-10 rounded-3xl border ${currentTheme.border} shadow-xl shadow-slate-200/50`}>
              <div className="flex items-center gap-4 mb-8">
                <div className={`p-4 ${currentTheme.surfaceInset} ${currentTheme.inkStrong} rounded-3xl`}>
                  <StickyNote size={32} />
                </div>
                <div>
                  <h3 className={`text-2xl font-black ${currentTheme.inkStrong}`}>{t.notes}</h3>
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
                    className={`flex-1 px-6 py-4 ${currentTheme.surfaceInset} border ${currentTheme.border} rounded-2xl focus:outline-none ${currentTheme.accentRing} transition-all text-sm font-semibold ${currentTheme.inkStrong}`}
                  />
                  <input
                    type="date"
                    value={todoDate}
                    onChange={(e) => setTodoDate(e.target.value)}
                    aria-label={t.taskDate}
                    className={`px-4 py-4 ${currentTheme.surfaceInset} border ${currentTheme.border} rounded-2xl focus:outline-none ${currentTheme.accentRing} transition-all text-sm font-semibold ${currentTheme.isDark ? 'text-[#E2E8F0] [color-scheme:dark]' : 'text-slate-800'}`}
                  />
                  <button
                    type="submit"
                    className={`${currentTheme.accentBg} ${currentTheme.accentHover} ${currentTheme.accentText} px-8 py-4 rounded-2xl font-black text-sm transition-all flex items-center gap-2 shadow-lg ${currentTheme.accentShadow}`}
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
                          className={`w-6 h-6 rounded-lg border-2 flex items-center justify-center transition-all ${todo.completed ? `${currentTheme.accentBg} ${currentTheme.accentBorder} ${currentTheme.accentText}` : `border-slate-200 ${currentTheme.accentBorderHover}`}`}
                        >
                          {todo.completed && <CheckCircle2 size={14} />}
                        </button>
                        <span className={`text-sm font-bold ${todo.completed ? 'line-through text-slate-300' : (currentTheme.inkStrong)}`}>
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
                            className={`px-1.5 py-0.5 rounded-md text-2xs font-bold border ${currentTheme.accentSoft} ${currentTheme.accentSoftText} ${currentTheme.accentBorder} ${currentTheme.isDark ? '[color-scheme:dark]' : ''}`}
                          />
                        ) : (
                          <button
                            type="button"
                            onClick={() => setEditingDateId(todo.id)}
                            title={t.taskDate}
                            className={`px-2 py-0.5 rounded-md text-3xs font-black uppercase tracking-widest transition-all ${currentTheme.accentSoft} ${currentTheme.accentSoftText} ${currentTheme.accentSoftHover}`}
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
