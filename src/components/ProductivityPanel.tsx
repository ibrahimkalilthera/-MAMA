/**
 * Productivité panel — the right-hand To-Do / AI sidebar, extracted from
 * AppModals.tsx as its own typed component (same treatment as FloatingChat).
 *
 * Self-manages the two keyboard overlays behaviours that AppModals used to
 * wire by index: the focus trap (Tab confined to the panel while open, focus
 * restored on close) and Escape-to-close (stacked with every other overlay
 * through the shared escape stack). The desktop resize logic (drag handle,
 * arrow keys, localStorage persistence) lives here too.
 */
import { useMemo, useRef, useState } from 'react';
import type { Dispatch, FormEvent, KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent, SetStateAction } from 'react';
import { motion } from 'motion/react';
import { CheckCircle2, CheckSquare, Lightbulb, Plus, Sparkles, Trash2, X } from 'lucide-react';
import { useFocusTrap } from '../lib/focusStack';
import { useEscapeToClose } from '../lib/useEscapeToClose';
import type { TranslationDict } from '../i18n/translations';
import type { ChatMessage } from '../app/useFloatingChat';
import type { Todo } from '../lib/useSupabaseData';
import type { CurrentTheme } from '../app/mainViewsProps';
import { groupTodosByDate, type TodoGroupKey } from '../lib/todoSort';

// ─── Panel sizing (resizable on desktop) ────────────────────────────────────
const PANEL_WIDTH_KEY = 'mama-thera:productivity-panel-width';
const PANEL_WIDTH_MIN = 280;
const PANEL_WIDTH_MAX = 720;
const PANEL_WIDTH_DEFAULT = 320;
const PANEL_WIDTH_STEP = 40;

const clampPanelWidth = (w: number): number =>
  Math.min(PANEL_WIDTH_MAX, Math.max(PANEL_WIDTH_MIN, w));

const loadPanelWidth = (): number => {
  try {
    if (typeof localStorage === 'undefined') return PANEL_WIDTH_DEFAULT;
    const raw = localStorage.getItem(PANEL_WIDTH_KEY);
    const parsed = raw ? Number.parseInt(raw, 10) : Number.NaN;
    return Number.isFinite(parsed) ? clampPanelWidth(parsed) : PANEL_WIDTH_DEFAULT;
  } catch {
    return PANEL_WIDTH_DEFAULT;
  }
};

const savePanelWidth = (w: number): void => {
  try {
    localStorage.setItem(PANEL_WIDTH_KEY, String(Math.round(w)));
  } catch {
    /* storage unavailable (private mode, test runner) — width stays session-only */
  }
};

/** Props of the Productivité panel — AppModals forwards the shared state. */
export interface ProductivityPanelProps {
  t: TranslationDict;
  open: boolean;
  onClose: () => void;
  /** Active tab ('tasks' = To-Do list, 'ai' = AI assistant). */
  productivitySidebarTab: 'tasks' | 'ai';
  setProductivitySidebarTab: Dispatch<SetStateAction<'tasks' | 'ai'>>;
  /** AI tab state + query handler. */
  aiMessages: ChatMessage[];
  aiInput: string;
  setAiInput: (value: string) => void;
  handleAiQuery: (query: string) => void;
  /** To-Do tab state + actions. */
  todoInput: string;
  setTodoInput: (value: string) => void;
  /** Calendar date for new tasks (YYYY-MM-DD, defaults to today). */
  todoDate: string;
  setTodoDate: (value: string) => void;
  handleAddTodo: (e: FormEvent) => void;
  todos: Todo[];
  toggleTodo: (id: string) => void;
  deleteTodo: (id: string) => void;
  /** Edit an existing task's calendar date (empty string removes it). */
  handleUpdateTodoDate: (id: string, date: string) => Promise<boolean>;
  /** Theme tokens from the app theme engine. */
  currentTheme: CurrentTheme;
}

export function ProductivityPanel(props: ProductivityPanelProps) {
  const {
    t,
    open,
    onClose,
    productivitySidebarTab,
    setProductivitySidebarTab,
    aiMessages,
    aiInput,
    setAiInput,
    handleAiQuery,
    todoInput,
    setTodoInput,
    todoDate,
    setTodoDate,
    handleAddTodo,
    todos,
    toggleTodo,
    deleteTodo,
    handleUpdateTodoDate,
    currentTheme,
  } = props;

  // Tab is confined to the panel while open; focus returns to the trigger on
  // close. Escape closes it (stacked with every other overlay).
  const rootRef = useRef<HTMLElement | null>(null);
  useFocusTrap(open, () => rootRef.current);
  useEscapeToClose(open, onClose);

  // Task whose date chip is currently being edited (inline date input).
  const [editingDateId, setEditingDateId] = useState<string | null>(null);

  // Panel width — resizable on desktop (drag handle or arrow keys), persisted.
  const [panelWidth, setPanelWidth] = useState<number>(loadPanelWidth);
  const dragStartRef = useRef<{ pointerX: number; startWidth: number } | null>(null);
  const panelWidthRef = useRef(panelWidth);
  panelWidthRef.current = panelWidth;

  const applyPanelWidth = (w: number): void => {
    const next = clampPanelWidth(w);
    panelWidthRef.current = next;
    setPanelWidth(next);
    savePanelWidth(next);
  };

  const handleResizePointerDown = (e: ReactPointerEvent<HTMLButtonElement>): void => {
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    dragStartRef.current = { pointerX: e.clientX, startWidth: panelWidth };
  };

  const handleResizePointerMove = (e: ReactPointerEvent<HTMLButtonElement>): void => {
    const drag = dragStartRef.current;
    if (!drag) return;
    // The panel is right-anchored: pulling the left edge outwards (leftwards)
    // widens it, pushing it inwards narrows it.
    setPanelWidth(clampPanelWidth(drag.startWidth + (drag.pointerX - e.clientX)));
  };

  const handleResizePointerEnd = (e: ReactPointerEvent<HTMLButtonElement>): void => {
    const drag = dragStartRef.current;
    if (!drag) return;
    dragStartRef.current = null;
    try { e.currentTarget.releasePointerCapture(e.pointerId); } catch { /* pointer already released */ }
    applyPanelWidth(drag.startWidth + (drag.pointerX - e.clientX));
  };

  // Local date in YYYY-MM-DD (toISOString would be UTC — off by a day for
  // evening users west of Greenwich).
  const todayStr = useMemo(() => {
    const d = new Date();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${d.getFullYear()}-${month}-${day}`;
  }, []);
  const groups = useMemo(() => groupTodosByDate(todos, todayStr), [todos, todayStr]);

  // Flatten the four date buckets into renderable sections, each introduced
  // by a group header with its counter; empty buckets are hidden entirely.
  const sections = useMemo(() => {
    const defs: { key: TodoGroupKey; label: string }[] = [
      // Most urgent first: overdue on top, then today, upcoming, undated.
      { key: 'overdue', label: t.overdue },
      { key: 'today', label: t.today },
      { key: 'upcoming', label: t.upcoming },
      { key: 'undated', label: t.noDate },
    ];
    return defs.flatMap(({ key, label }) => {
      const items = groups[key];
      if (items.length === 0) return [];
      return [
        { kind: 'header' as const, key, label, count: items.length },
        ...items.map(todo => ({ kind: 'task' as const, todo })),
      ];
    });
  }, [groups, t]);

  const handleResizeKeyDown = (e: ReactKeyboardEvent<HTMLButtonElement>): void => {
    // Left widens (the left edge moves left), right narrows — mirroring the
    // drag direction. Home/End snap to the bounds.
    if (e.key === 'ArrowLeft') { e.preventDefault(); applyPanelWidth(panelWidthRef.current + PANEL_WIDTH_STEP); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); applyPanelWidth(panelWidthRef.current - PANEL_WIDTH_STEP); }
    else if (e.key === 'Home') { e.preventDefault(); applyPanelWidth(PANEL_WIDTH_MIN); }
    else if (e.key === 'End') { e.preventDefault(); applyPanelWidth(PANEL_WIDTH_MAX); }
  };

  return (
    <>
      {/* Below the lg breakpoint the fixed panel (320px by default, user-resizable
          on desktop via the left-edge handle) overlays the app and can swallow
          most of the viewport (it covers ~75% of a 430px-wide window). Dim the
          app behind it and close on outside click — the same pattern as every
          other modal in this app — instead of a silent white takeover. */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
        className="fixed inset-0 z-20 bg-slate-900/50 backdrop-blur-sm lg:hidden"
      />
      <motion.aside
        ref={rootRef}
        role="dialog"
        aria-modal="true"
        aria-label={t.productivity}
        aria-labelledby="panel-title-productivity"
        initial={{ x: panelWidth }}
        animate={{ x: 0 }}
        exit={{ x: panelWidth }}
        style={{ width: panelWidth }}
        className={`fixed right-0 top-0 h-full max-w-[88vw] ${currentTheme.card} border-l ${currentTheme.border} shadow-2xl z-30 flex flex-col`}
      >
        <div className="p-8 border-b border-slate-50 flex justify-between items-center bg-[#0F172A] text-white" style={{ backgroundColor: currentTheme.header }}>
          <h3 id="panel-title-productivity" className="text-lg font-bold flex items-center gap-3">
            {productivitySidebarTab === 'tasks' ? (
              <>
                <CheckSquare size={20} className="text-amber-400" />
                <span data-i18n="todoList">{t.todoList}</span>
              </>
            ) : (
              <>
                <Sparkles size={20} className="text-blue-400" />
                <span data-i18n="aiTitle">{t.aiTitle}</span>
              </>
            )}
          </h3>
          <button
            onClick={onClose}
            className="p-2 hover:bg-white/10 rounded-xl transition-all"
          >
            <X size={20} />
          </button>
        </div>

        {/* Tab switch */}
        <div className="flex border-b border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/10">
          <button
            onClick={() => setProductivitySidebarTab('tasks')}
            className={`flex-1 py-3 text-center text-xs font-black uppercase tracking-widest border-b-2 transition-all ${productivitySidebarTab === 'tasks' ? 'border-blue-600 text-blue-600' : 'border-transparent text-slate-400 hover:text-slate-600'}`}
          >
            {t.toDo}
          </button>
          <button
            onClick={() => setProductivitySidebarTab('ai')}
            className={`flex-1 py-3 text-center text-xs font-black uppercase tracking-widest border-b-2 transition-all ${productivitySidebarTab === 'ai' ? 'border-blue-600 text-blue-600' : 'border-transparent text-slate-400 hover:text-slate-600'}`}
          >
            {t.aiAssistant}
          </button>
        </div>

        {productivitySidebarTab === 'ai' ? (
          <div className="flex-1 flex flex-col min-h-0 bg-slate-50/20 dark:bg-slate-900/5">
            {/* Messages list */}
            <div className="flex-1 overflow-y-auto p-6 space-y-4 custom-scrollbar">
              {aiMessages.map((msg, idx) => (
                <div key={idx} className={`flex ${msg.sender === 'user' ? 'justify-end' : 'justify-start'}`}>
                  <div className={`max-w-[85%] rounded-2xl px-4 py-3 text-xs font-semibold ${msg.sender === 'user' ? 'bg-blue-600 text-white' : (currentTheme.isDark ? 'bg-slate-800 text-emerald-400 border border-emerald-900/20' : 'bg-slate-100 text-slate-700')}`}>
                    <p className="leading-relaxed whitespace-pre-wrap">{msg.text}</p>
                  </div>
                </div>
              ))}
            </div>

            {/* Suggestions Chips */}
            <div className="px-6 py-4 border-t border-slate-100 dark:border-slate-800 space-y-2">
              <span className="text-[10px] font-black uppercase tracking-widest text-slate-400 block">
                {t.quickQuestions}
              </span>
              <div className="flex flex-col gap-1.5 max-h-36 overflow-y-auto custom-scrollbar">
                <button
                  onClick={() => handleAiQuery(t.aiQuickQuestion1)}
                  className={`text-[10px] font-bold px-3 py-2 rounded-xl border ${currentTheme.border} ${currentTheme.card} ${currentTheme.isDark ? 'hover:bg-slate-800 text-emerald-400' : 'hover:bg-slate-50 text-slate-700'} text-left transition-all truncate`}
                >
                  <Lightbulb size={12} className="flex-shrink-0 text-amber-500" /> {t.aiQuickQuestion1}
                </button>
                <button
                  onClick={() => handleAiQuery(t.aiQuickQuestion2)}
                  className={`text-[10px] font-bold px-3 py-2 rounded-xl border ${currentTheme.border} ${currentTheme.card} ${currentTheme.isDark ? 'hover:bg-slate-800 text-emerald-400' : 'hover:bg-slate-50 text-slate-700'} text-left transition-all truncate`}
                >
                  <Lightbulb size={12} className="flex-shrink-0 text-amber-500" /> {t.aiQuickQuestion2}
                </button>
                <button
                  onClick={() => handleAiQuery(t.aiQuickQuestion3)}
                  className={`text-[10px] font-bold px-3 py-2 rounded-xl border ${currentTheme.border} ${currentTheme.card} ${currentTheme.isDark ? 'hover:bg-slate-800 text-emerald-400' : 'hover:bg-slate-50 text-slate-700'} text-left transition-all truncate`}
                >
                  <Lightbulb size={12} className="flex-shrink-0 text-amber-500" /> {t.aiQuickQuestion3}
                </button>
                <button
                  onClick={() => handleAiQuery(t.aiQuickQuestion4)}
                  className={`text-[10px] font-bold px-3 py-2 rounded-xl border ${currentTheme.border} ${currentTheme.card} ${currentTheme.isDark ? 'hover:bg-slate-800 text-emerald-400' : 'hover:bg-slate-50 text-slate-700'} text-left transition-all truncate`}
                >
                  <Lightbulb size={12} className="flex-shrink-0 text-amber-500" /> {t.aiQuickQuestion4}
                </button>
              </div>
            </div>

            {/* Ask Form */}
            <form
              onSubmit={(e) => {
                e.preventDefault();
                handleAiQuery(aiInput);
              }}
              className="p-6 border-t border-slate-100 dark:border-slate-800 flex gap-2 bg-white dark:bg-slate-900"
            >
              <input
                type="text"
                value={aiInput}
                onChange={(e) => setAiInput(e.target.value)}
                placeholder={t.aiAskPlaceholder}
                className={`flex-1 px-4 py-3 bg-white ${currentTheme.isDark ? 'bg-slate-800 text-emerald-500 border-emerald-900/20' : 'border-slate-200 text-slate-800'} border rounded-xl text-xs font-semibold`}
              />
              <button
                type="submit"
                className="bg-blue-600 hover:bg-blue-700 text-white p-3 rounded-xl transition-all flex items-center justify-center flex-shrink-0"
              >
                <Sparkles size={16} />
              </button>
            </form>
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto p-8 space-y-6 custom-scrollbar">
            <form onSubmit={handleAddTodo} className="space-y-3">
              <input
                type="text"
                value={todoInput}
                onChange={(e) => setTodoInput(e.target.value)}
                placeholder={t.taskPlaceholder}
                className={`w-full px-5 py-4 ${currentTheme.isDark ? 'bg-emerald-900/10' : 'bg-slate-50'} border ${currentTheme.border} rounded-2xl focus:outline-none focus:ring-4 focus:ring-blue-500/5 focus:border-blue-500 transition-all text-sm font-semibold ${currentTheme.isDark ? 'text-emerald-500' : 'text-slate-800'}`}
              />
              <input
                type="date"
                value={todoDate}
                onChange={(e) => setTodoDate(e.target.value)}
                aria-label={t.taskDate}
                className={`w-full px-5 py-3.5 ${currentTheme.isDark ? 'bg-emerald-900/10' : 'bg-slate-50'} border ${currentTheme.border} rounded-2xl focus:outline-none focus:ring-4 focus:ring-blue-500/5 focus:border-blue-500 transition-all text-xs font-semibold ${currentTheme.isDark ? 'text-emerald-500 [color-scheme:dark]' : 'text-slate-800'}`}
              />
              <button
                type="submit"
                className="w-full bg-blue-600 hover:bg-blue-700 text-white py-4 rounded-2xl font-black text-xs transition-all flex items-center justify-center gap-2"
              >
                <Plus size={16} />
                <span data-i18n="addTask">{t.addTask}</span>
              </button>
            </form>

            <div className="space-y-3">
              {sections.map((section, idx) =>
                section.kind === 'header' ? (
                  <div
                    key={`header-${section.key}`}
                    className={`flex items-center gap-2 ${idx > 0 ? 'pt-5 mt-1 border-t border-slate-100 dark:border-slate-800' : ''}`}
                  >
                    <span
                      className={`text-[10px] font-black uppercase tracking-widest ${
                        section.key === 'overdue' ? 'text-rose-500' :
                        section.key === 'today' ? 'text-amber-500' :
                        section.key === 'upcoming' ? 'text-emerald-500' :
                        'text-slate-400'
                      }`}
                    >
                      {section.label}
                    </span>
                    <span className={`min-w-[18px] h-[18px] px-1.5 rounded-full text-[10px] font-black flex items-center justify-center ${currentTheme.isDark ? 'bg-slate-800 text-slate-300' : 'bg-slate-100 text-slate-600'}`}>
                      {section.count}
                    </span>
                  </div>
                ) : (
                  <motion.div
                    layout
                    key={section.todo.id}
                    className={`flex items-center justify-between p-4 rounded-2xl border transition-all ${section.todo.completed ? (currentTheme.isDark ? 'bg-emerald-900/10 border-emerald-900/20 opacity-60' : 'bg-slate-50 border-slate-100 opacity-60') : (currentTheme.isDark ? 'bg-emerald-900/20 border-emerald-800/50 shadow-sm' : 'bg-white border-slate-100 shadow-sm')}`}
                  >
                    <div className="flex items-center gap-3 flex-1">
                      <button
                        onClick={() => toggleTodo(section.todo.id)}
                        className={`w-6 h-6 rounded-lg border-2 flex items-center justify-center transition-all ${section.todo.completed ? 'bg-emerald-500 border-emerald-500 text-white' : 'border-slate-200 hover:border-blue-400'}`}
                      >
                        {section.todo.completed && <CheckCircle2 size={14} />}
                      </button>
                      <span className={`text-sm font-bold ${section.todo.completed ? (currentTheme.isDark ? 'text-emerald-500/50 line-through' : 'text-slate-400 line-through') : (currentTheme.isDark ? 'text-emerald-500' : 'text-slate-700')}`}>
                        {section.todo.text}
                      </span>
                      {editingDateId === section.todo.id ? (
                        <input
                          type="date"
                          defaultValue={section.todo.date}
                          autoFocus
                          aria-label={t.taskDate}
                          onChange={(e) => {
                            setEditingDateId(null);
                            void handleUpdateTodoDate(section.todo.id, e.target.value);
                          }}
                          onBlur={() => setEditingDateId(null)}
                          className={`px-1.5 py-0.5 rounded-md text-[10px] font-bold border ${currentTheme.isDark ? 'bg-emerald-900/30 text-emerald-400 border-emerald-800/40 [color-scheme:dark]' : 'bg-white text-slate-700 border-blue-200'}`}
                        />
                      ) : (
                        <button
                          type="button"
                          onClick={() => setEditingDateId(section.todo.id)}
                          title={t.taskDate}
                          className={`px-2 py-0.5 rounded-md text-[9px] font-black uppercase tracking-widest transition-all hover:ring-2 hover:ring-blue-400/50 ${currentTheme.isDark ? 'bg-emerald-900/30 text-emerald-400' : 'bg-blue-50 text-blue-600 hover:bg-blue-100'}`}
                        >
                          {section.todo.date ? section.todo.date.split('-').reverse().join('/') : t.addDate}
                        </button>
                      )}
                    </div>
                    <button
                      onClick={() => deleteTodo(section.todo.id)}
                      className={`p-2 ${currentTheme.muted} hover:text-rose-500 transition-all`}
                    >
                      <Trash2 size={16} />
                    </button>
                  </motion.div>
                )
              )}
            </div>
          </div>
        )}
        {/* Desktop resize handle: drag the left edge (or focus it and use
            ← to widen / → to narrow; Home/End snap to the bounds; double-click
            resets to the 320px default). Hidden below lg — mobile keeps the
            88vw cap and its backdrop. */}
        <button
          type="button"
          role="separator"
          aria-orientation="vertical"
          aria-label={t.resizeProductivityPanel}
          aria-valuemin={PANEL_WIDTH_MIN}
          aria-valuemax={PANEL_WIDTH_MAX}
          aria-valuenow={Math.round(panelWidth)}
          onPointerDown={handleResizePointerDown}
          onPointerMove={handleResizePointerMove}
          onPointerUp={handleResizePointerEnd}
          onPointerCancel={handleResizePointerEnd}
          onDoubleClick={() => applyPanelWidth(PANEL_WIDTH_DEFAULT)}
          onKeyDown={handleResizeKeyDown}
          className="absolute left-0 top-0 z-10 hidden h-full w-2.5 cursor-col-resize touch-none select-none items-center justify-center group lg:flex"
        >
          <span className="h-16 w-1 rounded-full bg-slate-400/50 transition-colors group-hover:bg-blue-500 group-focus-visible:bg-blue-500" />
        </button>
      </motion.aside>
    </>
  );
}
