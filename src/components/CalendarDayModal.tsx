/**
 * CalendarDayModal — Day modal behind a calendar click: that day's events (due/salary/note/todo/expense) and the add-a-note entry (Notes ⇄ Calendar bridge). Presentational — t/lang/theme, derivations and note-form state arrive as narrow props; overlayRef injected.
 */
import { Calendar, StickyNote, Users, Briefcase, CheckSquare, Receipt } from 'lucide-react';
import type { Dispatch, SetStateAction } from 'react';
import type { CalendarEvent, CurrentTheme } from '../app/mainViewsProps';
import type { TranslationDict } from '../i18n/translations';
import { ModalShell } from './ModalShell';

export interface CalendarDayModalProps {
  t: TranslationDict;
  lang: 'en' | 'fr';
  currentTheme: CurrentTheme;
  selectedCalendarDay: Date;
  getDayName: (dayIndex: number) => string;
  getEventsForDay: (date: Date) => CalendarEvent[];
  getNotesForDay: (date: Date) => { id: string; studentName?: string; text: string }[];
  noteText: string;
  setNoteText: Dispatch<SetStateAction<string>>;
  savingNoteOnDate: boolean;
  saveNoteOnDate: (date: Date) => Promise<boolean>;
  formatCurrency: (amount: number) => string;
  /** The dialog root — registered in AppModals' overlay refs (focus trap). */
  overlayRef: (el: HTMLElement | null) => void;
  onClose: () => void;
}

export function CalendarDayModal(props: CalendarDayModalProps) {
  const { t, lang, currentTheme, selectedCalendarDay, getDayName, getEventsForDay, getNotesForDay, noteText, setNoteText, savingNoteOnDate, saveNoteOnDate, formatCurrency, overlayRef, onClose } = props;
  return (
    <ModalShell
      overlayRef={overlayRef}
      onClose={onClose}
      currentTheme={currentTheme}
      titleId="modal-title-payment-history"
      ariaLabel={t.paymentHistory}
      titleClassName="text-xl font-bold flex flex-col"
      title={
        <>
          <span className="text-sm opacity-70 uppercase tracking-widest font-black">{getDayName(selectedCalendarDay.getDay())}</span>
          <span>{selectedCalendarDay.toLocaleDateString(lang === 'en' ? 'en-US' : 'fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })}</span>
        </>
      }
    >

              <div className="p-10 space-y-8 max-h-[60vh] overflow-y-auto custom-scrollbar">
                {(() => {
                  const dayEvents = getEventsForDay(selectedCalendarDay);
                  const dayNotes = getNotesForDay(selectedCalendarDay);
                  if (dayEvents.length === 0 && dayNotes.length === 0) {
                    return (
                      <div className="py-10 text-center">
                        <div className={`w-16 h-16 rounded-full ${currentTheme.isDark ? 'bg-emerald-900/20 text-emerald-500' : 'bg-slate-100 text-slate-600'} flex items-center justify-center mx-auto mb-4`}>
                          <Calendar size={32} />
                        </div>
                        <p className={currentTheme.muted}>{t.noTasks}</p>
                      </div>
                    );
                  }

                  return (
                    <div className="space-y-6">
                      {dayNotes.length > 0 && (
                        <div className="p-6 rounded-2xl border border-yellow-200 dark:border-yellow-900/40 bg-yellow-50/60 dark:bg-yellow-950/30">
                          <div className="flex items-center gap-4 mb-4">
                            <div className="p-3 rounded-xl bg-yellow-100 dark:bg-yellow-950/60 text-yellow-800 dark:text-yellow-300">
                              <StickyNote size={20} />
                            </div>
                            <div>
                              <h4 className="font-black uppercase tracking-widest text-[10px] text-yellow-700">
                                {t.notes}
                              </h4>
                              <p className={`text-lg font-bold ${currentTheme.isDark ? 'text-emerald-400' : 'text-slate-800'}`}>
                                {dayNotes.length}
                              </p>
                            </div>
                          </div>
                          <div className="space-y-2">
                            {dayNotes.map((n) => (
                              <div key={n.id} className="flex justify-between items-start gap-3 text-sm py-2 border-t border-yellow-200">
                                {n.studentName && (
                                  <span className={`font-bold ${currentTheme.isDark ? 'text-emerald-500' : 'text-slate-800'} flex-shrink-0`}>{n.studentName}</span>
                                )}
                                <span className={`${currentTheme.muted} text-right`}>{n.text}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                      {dayEvents.map((event, idx) => (
                        <div key={idx} className={`p-6 rounded-2xl border ${currentTheme.border} ${
                          event.type === 'due' ? 'bg-rose-50/30 dark:bg-rose-950/30' :
                          event.type === 'salary' ? 'bg-emerald-50/30 dark:bg-emerald-950/30' :
                          event.type === 'note' ? 'bg-yellow-50/60 dark:bg-yellow-950/30' :
                          event.type === 'todo' ? 'bg-violet-50/60 dark:bg-violet-950/30' :
                          'bg-blue-50/30 dark:bg-blue-950/30'
                        }`}>
                          <div className="flex items-center gap-4 mb-4">
                            <div className={`p-3 rounded-xl ${
                              event.type === 'due' ? 'bg-rose-100 dark:bg-rose-950/60 text-rose-600 dark:text-rose-300' :
                              event.type === 'salary' ? 'bg-emerald-100 dark:bg-emerald-950/60 text-emerald-600 dark:text-emerald-300' :
                              event.type === 'note' ? 'bg-yellow-100 dark:bg-yellow-950/60 text-yellow-700 dark:text-yellow-300' :
                              event.type === 'todo' ? 'bg-violet-100 dark:bg-violet-950/60 text-violet-700 dark:text-violet-300' :
                              'bg-blue-100 dark:bg-blue-950/60 text-blue-700 dark:text-blue-300'
                            }`}>
                              {event.type === 'due' ? <Users size={20} /> : event.type === 'salary' ? <Briefcase size={20} /> : event.type === 'note' ? <StickyNote size={20} /> : event.type === 'todo' ? <CheckSquare size={20} /> : <Receipt size={20} />}
                            </div>
                            <div>
                              <h4 className={`font-black uppercase tracking-widest text-[10px] ${
                                event.type === 'due' ? 'text-rose-600' :
                                event.type === 'salary' ? 'text-emerald-600' :
                                event.type === 'note' ? 'text-yellow-700' :
                                event.type === 'todo' ? 'text-violet-600' :
                                'text-blue-600'
                              }`}>
                                {event.type === 'due' ? (t.studentFeesDue) : 
                                 event.type === 'salary' ? (t.staffSalaries) : 
                                 event.type === 'note' ? (t.notes) : 
                                 event.type === 'todo' ? (t.tasks) : 
                                 (t.expenses)}
                              </h4>
                              <p className={`text-lg font-bold ${currentTheme.isDark ? 'text-emerald-400' : 'text-slate-800'}`}>
                                {event.count}
                              </p>
                            </div>
                          </div>
                          
                          <div className="space-y-2">
                            {event.details?.map((detail, dIdx) => (
                              <div key={dIdx} className={`flex justify-between items-center text-sm py-2 border-t ${currentTheme.border}`}>
                                <span className={`${currentTheme.muted} ${detail.completed ? 'line-through opacity-60' : ''}`}>{detail.name}</span>
                                {detail.amount !== undefined && (
                                  <span className={`font-bold ${currentTheme.isDark ? 'text-emerald-500' : 'text-slate-800'}`}>{formatCurrency(detail.amount)}</span>
                                )}
                              </div>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  );
                })()}

                {/* Add a note on this date (Notes ⇄ Calendar bridge) */}
                <div className="pt-2 border-t border-slate-100">
                  <div className="bg-[#FEF9C3] p-5 rounded-2xl border border-yellow-200/70">                      <h4 className="text-[9px] font-black text-yellow-900 uppercase tracking-widest mb-3 flex items-center gap-1.5">
                      <StickyNote size={12} />
                      {t.addNoteForThisDay}
                    </h4>
                    <div className="space-y-2.5">
                      <textarea
                        value={noteText}
                        onChange={(e) => setNoteText(e.target.value)}
                        placeholder={t.notesPlaceholder}
                        rows={2}
                        className="w-full bg-white/70 dark:bg-slate-800 border border-yellow-200 dark:border-yellow-900/40 rounded-xl px-3 py-2 text-xs font-semibold text-yellow-900 dark:text-yellow-300 placeholder-yellow-700/40 dark:placeholder-yellow-500/40 focus:outline-none focus:ring-2 focus:ring-yellow-500/30 resize-none custom-scrollbar"
                      />
                      <div className="flex justify-end">
                        <button
                          type="button"
                          disabled={savingNoteOnDate || !noteText.trim()}
                          onClick={() => { void saveNoteOnDate(selectedCalendarDay); }}
                          className="px-4 py-2 bg-yellow-500 hover:bg-yellow-600 disabled:opacity-40 disabled:cursor-not-allowed text-white rounded-xl text-xs font-bold transition-all active:scale-95"
                        >
                          {savingNoteOnDate ? t.saving : t.save}
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
    </ModalShell>
  );
}
