/**
 * Calendar view (month grid, per-day event chips, day-modal triggers) —
 * extracted verbatim from MainViews.tsx. Reads its data and actions through
 * the MainViewsContext like the other extracted views (PayrollView,
 * ExpensesView…).
 */
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useMainViews } from '../app/mainViewsContext';

export function CalendarView() {
  const {
    t, currentTheme, calendarDate, setCalendarDate, changeMonth, getMonthName,
    getDayName, getDaysInMonth, getEventsForDay, setSelectedCalendarDay, setShowCalendarModal,
  } = useMainViews();
  return (
          <div className="space-y-8">
            <div className="flex justify-between items-center no-print">
              <div className="flex items-center gap-4">
                <button
                  onClick={() => changeMonth(-1)}
                  className={`p-2 rounded-xl ${currentTheme.accentSoft} ${currentTheme.accentSoftText} ${currentTheme.accentSoftHover} transition-all`}
                >
                  <ChevronLeft size={20} />
                </button>
                <h3 className={`text-2xl font-bold ${currentTheme.inkStrong} min-w-[200px] text-center`}>
                  {getMonthName(calendarDate.getMonth())} {calendarDate.getFullYear()}
                </h3>
                <button
                  onClick={() => changeMonth(1)}
                  className={`p-2 rounded-xl ${currentTheme.accentSoft} ${currentTheme.accentSoftText} ${currentTheme.accentSoftHover} transition-all`}
                >
                  <ChevronRight size={20} />
                </button>
              </div>
              <button
                onClick={() => setCalendarDate(new Date())}
                className={`px-6 py-2 rounded-xl border ${currentTheme.border} ${currentTheme.muted} font-bold text-sm hover:bg-slate-50 transition-all`}
              >
                {t.today}
              </button>
            </div>

            <div className={`${currentTheme.card} rounded-3xl border ${currentTheme.border} shadow-xl overflow-hidden`}>
              <div className={`grid grid-cols-7 border-b ${currentTheme.border} ${currentTheme.surfaceInset}`}>
                {[0, 1, 2, 3, 4, 5, 6].map(i => (
                  <div key={i} className={`py-4 text-center text-2xs font-black uppercase tracking-widest ${currentTheme.muted}`}>
                    {getDayName(i)}
                  </div>
                ))}
              </div>
              <div className="grid grid-cols-7">
                {getDaysInMonth(calendarDate).map((day, i) => {
                  const events = getEventsForDay(day.date);
                  const isToday = day.date.toDateString() === new Date().toDateString();

                  return (
                    <div
                      key={i}
                      onClick={() => {
                        setSelectedCalendarDay(day.date);
                        setShowCalendarModal(true);
                      }}
                      className={`min-h-[120px] p-4 border-b border-r ${currentTheme.border} cursor-pointer hover:bg-blue-50/30 transition-all relative ${!day.isCurrentMonth ? 'opacity-30' : ''}`}
                    >
                      <span className={`text-sm font-bold ${isToday ? `${currentTheme.accentBg} ${currentTheme.accentText} w-7 h-7 flex items-center justify-center rounded-full` : (currentTheme.inkStrong)}`}>
                        {day.date.getDate()}
                      </span>

                      <div className="mt-2 space-y-1">
                        {events.map((event, idx) => (
                          <div
                            key={idx}
                            className={`flex items-center gap-1.5 px-2 py-1 rounded-lg text-3xs font-black uppercase tracking-widest ${
                              event.type === 'due' ? 'bg-rose-100 dark:bg-rose-950/60 text-rose-600 dark:text-rose-300' :
                              event.type === 'salary' ? 'bg-emerald-100 dark:bg-emerald-950/60 text-emerald-600 dark:text-emerald-300' :
                              event.type === 'note' ? 'bg-yellow-100 dark:bg-yellow-950/60 text-yellow-700 dark:text-yellow-300' :
                              event.type === 'todo' ? 'bg-violet-100 dark:bg-violet-950/60 text-violet-700 dark:text-violet-300' :
                              'bg-blue-100 dark:bg-blue-950/60 text-blue-700 dark:text-blue-300'
                            }`}
                          >
                            <div className={`w-1.5 h-1.5 rounded-full ${
                              event.type === 'due' ? 'bg-current' :
                              event.type === 'salary' ? 'bg-current' :
                              event.type === 'note' ? 'bg-current' :
                              event.type === 'todo' ? 'bg-current' :
                              'bg-current'
                            }`} />
                            {event.count}
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
  );
}
