/**
 * Calendar view (month grid, per-day event chips, day-modal triggers) —
 * extracted verbatim from MainViews.tsx. Reads its data and actions through
 * the MainViewsContext like the other extracted views (PayrollView,
 * ExpensesView…).
 *
 * Trois choses ont quitté la version d'origine, et chacune était un défaut
 * mesuré, pas un goût :
 *
 *  • la GRILLE sous 640 px. Sept colonnes de `min-h-[120px]` demandent 840 px de
 *    large : sur un téléphone, les cases se comprimaient à ~50 px de large pour
 *    120 px de haut, et les pastilles ne s'y lisaient plus. Sous `sm`, le mois
 *    est donc une LISTE (une ligne par jour qui porte un événement), la grille
 *    revenant au-dessus ;
 *  • le clavier. Chaque case était un `<div onClick>` : un jour ne s'ouvrait
 *    qu'à la souris. C'est un `<button>` qui porte son nom (« 12 novembre —
 *    2 événements »), et les flèches de mois sont nommées ;
 *  • la couleur seule. Les pastilles ne portaient qu'un chiffre, et rien ne
 *    disait ce que le rose ou le vert comptaient : la légende le dit, avec les
 *    libellés des types d'événement que la fenêtre du jour emploie déjà.
 */
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useMainViews } from '../app/mainViewsContext';

/** Une couleur par type d'événement — la même partout dans la vue et la légende. */
const CHIP_CLASS: Record<string, string> = {
  due: 'bg-rose-100 dark:bg-rose-950/60 text-rose-600 dark:text-rose-300',
  salary: 'bg-emerald-100 dark:bg-emerald-950/60 text-emerald-600 dark:text-emerald-300',
  note: 'bg-yellow-100 dark:bg-yellow-950/60 text-yellow-700 dark:text-yellow-300',
  todo: 'bg-violet-100 dark:bg-violet-950/60 text-violet-700 dark:text-violet-300',
  expense: 'bg-blue-100 dark:bg-blue-950/60 text-blue-700 dark:text-blue-300',
};

const chipClass = (type: string): string => CHIP_CLASS[type] ?? CHIP_CLASS.expense;

export function CalendarView() {
  const {
    t, currentTheme, calendarDate, setCalendarDate, changeMonth, getMonthName,
    getDayName, getDaysInMonth, getEventsForDay, setSelectedCalendarDay, setShowCalendarModal,
  } = useMainViews();

  const openDay = (date: Date) => {
    setSelectedCalendarDay(date);
    setShowCalendarModal(true);
  };

  /** « 12 novembre — 2 événements » : le nom que lit un lecteur d'écran. */
  const dayName = (date: Date, count: number): string => {
    const day = `${date.getDate()} ${getMonthName(date.getMonth())} ${date.getFullYear()}`;
    return count > 0 ? `${day} — ${t.calendarEventCount.replace('{count}', String(count))}` : day;
  };

  // La légende emploie les libellés de la fenêtre du jour : un type d'événement
  // n'a qu'un nom dans l'application.
  const legend: { type: string; label: string }[] = [
    { type: 'due', label: t.studentFeesDue },
    { type: 'salary', label: t.staffSalaries },
    { type: 'note', label: t.notes },
    { type: 'todo', label: t.tasks },
    { type: 'expense', label: t.expenses },
  ];

  const days = getDaysInMonth(calendarDate);
  const agendaDays = days.filter((day) => getEventsForDay(day.date).length > 0);

  const chips = (date: Date) => {
    const events = getEventsForDay(date);
    return (
      <span className="mt-2 flex flex-wrap gap-1">
        {events.map((event, idx) => (
          <span
            key={idx}
            className={`flex items-center gap-1.5 px-2 py-1 rounded-lg text-3xs font-black uppercase tracking-widest ${chipClass(event.type)}`}
          >
            <span className="w-1.5 h-1.5 rounded-full bg-current" aria-hidden="true" />
            {event.count}
          </span>
        ))}
      </span>
    );
  };

  return (
          <div className="space-y-8">
            <div className="flex justify-between items-center no-print">
              <div className="flex items-center gap-4">
                <button
                  onClick={() => changeMonth(-1)}
                  aria-label={t.previousMonth}
                  title={t.previousMonth}
                  className={`p-2 rounded-xl ${currentTheme.accentSoft} ${currentTheme.accentSoftText} ${currentTheme.accentSoftHover} transition-all`}
                >
                  <ChevronLeft size={20} aria-hidden="true" />
                </button>
                <h3 className={`text-2xl font-bold ${currentTheme.inkStrong} min-w-[200px] text-center`}>
                  {getMonthName(calendarDate.getMonth())} {calendarDate.getFullYear()}
                </h3>
                <button
                  onClick={() => changeMonth(1)}
                  aria-label={t.nextMonth}
                  title={t.nextMonth}
                  className={`p-2 rounded-xl ${currentTheme.accentSoft} ${currentTheme.accentSoftText} ${currentTheme.accentSoftHover} transition-all`}
                >
                  <ChevronRight size={20} aria-hidden="true" />
                </button>
              </div>
              <button
                onClick={() => setCalendarDate(new Date())}
                className={`px-6 py-2 rounded-xl border ${currentTheme.border} ${currentTheme.muted} font-bold text-sm ${currentTheme.hoverSurface} transition-all`}
              >
                {t.today}
              </button>
            </div>

            {/* Sous `sm` : le mois en liste. Sept colonnes ne tiennent pas sur un
                téléphone, et une case de 50 px ne dit rien. */}
            <div className={`sm:hidden ${currentTheme.card} rounded-3xl border ${currentTheme.border} shadow-xl overflow-hidden`}>
              <ul aria-label={t.calendarAgenda} className="divide-y divide-slate-200/60 dark:divide-white/5">
                {agendaDays.length === 0 ? (
                  <li className={`px-6 py-10 text-center text-sm font-semibold ${currentTheme.muted}`}>
                    {t.calendarNoEvent}
                  </li>
                ) : (
                  agendaDays.map((day, i) => (
                    <li key={i}>
                      <button
                        type="button"
                        onClick={() => openDay(day.date)}
                        aria-label={dayName(day.date, getEventsForDay(day.date).length)}
                        className={`w-full flex items-start justify-between gap-3 px-5 py-4 text-left ${currentTheme.hoverAccent} transition-all`}
                      >
                        <span className={`text-sm font-bold ${currentTheme.inkStrong}`}>
                          {day.date.getDate()} {getMonthName(day.date.getMonth())}
                        </span>
                        {chips(day.date)}
                      </button>
                    </li>
                  ))
                )}
              </ul>
            </div>

            <div className={`hidden sm:block ${currentTheme.card} rounded-3xl border ${currentTheme.border} shadow-xl overflow-hidden`}>
              <div className={`grid grid-cols-7 border-b ${currentTheme.border} ${currentTheme.surfaceInset}`}>
                {[0, 1, 2, 3, 4, 5, 6].map(i => (
                  <div key={i} className={`py-4 text-center text-2xs font-black uppercase tracking-widest ${currentTheme.muted}`}>
                    {getDayName(i)}
                  </div>
                ))}
              </div>
              <div className="grid grid-cols-7">
                {days.map((day, i) => {
                  const events = getEventsForDay(day.date);
                  const isToday = day.date.toDateString() === new Date().toDateString();

                  return (
                    <button
                      key={i}
                      type="button"
                      onClick={() => openDay(day.date)}
                      aria-label={dayName(day.date, events.length)}
                      aria-current={isToday ? 'date' : undefined}
                      className={`min-h-[120px] p-4 border-b border-r ${currentTheme.border} cursor-pointer text-left ${currentTheme.hoverAccent} transition-all ${!day.isCurrentMonth ? 'opacity-30' : ''}`}
                    >
                      <span className={`text-sm font-bold ${isToday ? `${currentTheme.accentBg} ${currentTheme.accentText} w-7 h-7 flex items-center justify-center rounded-full` : (currentTheme.inkStrong)}`}>
                        {day.date.getDate()}
                      </span>

                      <span className="block">
                        {chips(day.date)}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* La couleur était la seule clef des pastilles : elle est nommée. */}
            <div className={`flex flex-wrap items-center gap-x-6 gap-y-2 text-2xs font-bold ${currentTheme.muted}`}>
              <span className="font-black uppercase tracking-widest">{t.legend}</span>
              {legend.map((entry) => (
                <span key={entry.type} className="flex items-center gap-2">
                  <span className={`w-2.5 h-2.5 rounded-full ${chipClass(entry.type)}`} aria-hidden="true" />
                  {entry.label}
                </span>
              ))}
            </div>
          </div>
  );
}
