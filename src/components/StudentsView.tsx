import { useState } from 'react';
import { Search, Users } from 'lucide-react';
import { useMainViews } from '../app/mainViewsContext';
import type { Student } from '../lib/useSupabaseData';
import { ConfirmDialog } from './ConfirmDialog';
import { EmptyState } from './SharedUi';

export function StudentsView() {
  const [confirmDeleteStudent, setConfirmDeleteStudent] = useState<Student | null>(null);
  const { ArrowDown, ArrowUp, ArrowUpDown, FileText, Flag, HighlightText, Printer, Trash2, canDelete, currentTheme, deleteStudent, filteredStudents, formatCurrency, formatDate, getGradeDisplay, getStatus, handleSort, lang, openEditModal, searchTerm, setSelectedStudent, setTicketStudent, stats, studentSortKey, studentSortOrder, t, today, toggleFlag } = useMainViews();
  return (
    <>
          <div className="space-y-8">
            {/* Print Summary */}
            <div className="hidden print:block mb-8 p-6 bg-slate-50 border-2 border-slate-200 rounded-2xl">
              <div className="flex justify-around text-center">
                <div>
                  <p className="text-2xs font-black uppercase tracking-widest text-slate-500 mb-1">{t.totalCollected}</p>
                  <p className="text-xl font-black text-emerald-600">{formatCurrency(stats.totalCollected)}</p>
                </div>
                <div className="w-px h-10 bg-slate-200"></div>
                <div>
                  <p className="text-2xs font-black uppercase tracking-widest text-slate-500 mb-1">{t.totalOutstanding}</p>
                  <p className="text-xl font-black text-rose-600">{formatCurrency(stats.totalOutstanding)}</p>
                </div>
              </div>
            </div>

            <div className={`${currentTheme.card} rounded-3xl border ${currentTheme.border} shadow-2xl shadow-slate-200/50 overflow-hidden`}>
            <div className="max-h-[70vh] overflow-auto">
              <table className="w-full text-left border-collapse">
                <thead className="sticky top-0 z-10">
                  <tr className={`${currentTheme.surfaceInset} ${currentTheme.muted} text-2xs font-black uppercase tracking-[0.2em]`}>
                    <th 
                      onClick={() => handleSort('name')}
                      className={`px-8 py-6 cursor-pointer ${currentTheme.rowHover} transition-all group/sort select-none`}
                    >
                      <div className="flex items-center gap-2">
                        <span>{t.studentName}</span>
                        {studentSortKey === 'name' ? (
                          studentSortOrder === 'asc' ? <ArrowUp size={12} className="text-blue-500 flex-shrink-0" /> : <ArrowDown size={12} className="text-blue-500 flex-shrink-0" />
                        ) : (
                          <ArrowUpDown size={12} className="opacity-35 group-hover/sort:opacity-100 transition-opacity flex-shrink-0" />
                        )}
                      </div>
                    </th>
                    <th 
                      onClick={() => handleSort('parentName')}
                      className={`px-8 py-6 cursor-pointer ${currentTheme.rowHover} transition-all group/sort select-none`}
                    >
                      <div className="flex items-center gap-2">
                        <span>{t.parentName}</span>
                        {studentSortKey === 'parentName' ? (
                          studentSortOrder === 'asc' ? <ArrowUp size={12} className="text-blue-500 flex-shrink-0" /> : <ArrowDown size={12} className="text-blue-500 flex-shrink-0" />
                        ) : (
                          <ArrowUpDown size={12} className="opacity-35 group-hover/sort:opacity-100 transition-opacity flex-shrink-0" />
                        )}
                      </div>
                    </th>
                    <th className="px-8 py-6 select-none">{t.totalDue}</th>
                    <th 
                      onClick={() => handleSort('balance')}
                      className={`px-8 py-6 cursor-pointer ${currentTheme.rowHover} transition-all group/sort select-none`}
                    >
                      <div className="flex items-center gap-2">
                        <span>{t.balance}</span>
                        {studentSortKey === 'balance' ? (
                          studentSortOrder === 'asc' ? <ArrowUp size={12} className="text-blue-500 flex-shrink-0" /> : <ArrowDown size={12} className="text-blue-500 flex-shrink-0" />
                        ) : (
                          <ArrowUpDown size={12} className="opacity-35 group-hover/sort:opacity-100 transition-opacity flex-shrink-0" />
                        )}
                      </div>
                    </th>
                    <th 
                      onClick={() => handleSort('dueDate')}
                      className={`px-8 py-6 cursor-pointer ${currentTheme.rowHover} transition-all group/sort select-none`}
                    >
                      <div className="flex items-center gap-2">
                        <span>{t.status} / {t.dueDate}</span>
                        {studentSortKey === 'dueDate' ? (
                          studentSortOrder === 'asc' ? <ArrowUp size={12} className="text-blue-500 flex-shrink-0" /> : <ArrowDown size={12} className="text-blue-500 flex-shrink-0" />
                        ) : (
                          <ArrowUpDown size={12} className="opacity-35 group-hover/sort:opacity-100 transition-opacity flex-shrink-0" />
                        )}
                      </div>
                    </th>
                    <th className="px-8 py-6 text-right select-none">{t.actions}</th>
                  </tr>
                </thead>
                <tbody className={`divide-y ${currentTheme.border}`}>
                  {filteredStudents.length === 0 ? (
                    // A table with headers and no rows reads as a broken screen.
                    // A search that matches nothing and a register with nobody in
                    // it are different states, so they get different words — and
                    // only the empty register offers the next step.
                    <tr>
                      <td colSpan={6}>
                        <EmptyState
                          icon={searchTerm.trim() ? <Search size={22} /> : <Users size={22} />}
                          title={searchTerm.trim() ? t.noStudentsMatchingFilters : t.noStudentsInSystemTitle}
                          hint={searchTerm.trim() ? undefined : t.noStudentsInSystemHint}
                          isDark={currentTheme.isDark}
                        />
                      </td>
                    </tr>
                  ) : filteredStudents.map((student) => {
                    const discount = student.scholarshipDiscount || 0;
                    const balance = student.totalDue * (1 - discount / 100) - student.amountPaid;
                    const status = getStatus(student);

                    // Highlighting Logic
                    const dueDate = new Date(student.dueDate);
                    const now = new Date(today);
                    const diffTime = dueDate.getTime() - now.getTime();
                    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

                    let highlightClasses = "";
                    if (balance > 0) {
                      if (diffDays < -30) {
                        highlightClasses = currentTheme.isDark ? 'bg-rose-900/10' : 'bg-rose-50/50';
                      } else if (diffDays >= 0 && diffDays <= 2) {
                        highlightClasses = 'border-l-4 border-l-amber-400';
                      }
                    }
                    if (student.flagged) {
                      highlightClasses = currentTheme.isDark ? 'bg-amber-900/10' : 'bg-amber-50/50';
                    }

                    return (
                      <tr 
                        key={student.id} 
                        className={`${currentTheme.rowHover} transition-all group ${highlightClasses}`}
                      >
                        <td className="px-8 py-6">
                          <div className="flex items-center gap-4">
                            <button 
                              onClick={() => toggleFlag(student.id)}
                              className={`transition-colors ${student.flagged ? 'text-amber-500' : currentTheme.muted + ' hover:text-amber-400'}`}
                            >
                              <Flag size={16} fill={student.flagged ? 'currentColor' : 'none'} />
                            </button>
                            <div 
                              className="flex items-center gap-4 cursor-pointer"
                              onClick={() => setSelectedStudent(student)}
                            >
                              <div className={`w-10 h-10 rounded-xl ${currentTheme.surfaceInset} ${currentTheme.inkStrong} font-bold text-xs ${currentTheme.accentGroupHover} transition-all flex items-center justify-center`}>
                                {student.name.split(' ').map(n => n[0]).join('')}
                              </div>
                              <div>
                                <span className={`block font-bold ${currentTheme.inkStrong} text-sm`}>
                                  <HighlightText text={student.name} highlight={searchTerm} />
                                </span>
                                {/* The raw UUID used to live here; it is an internal
                                    identifier with no meaning for the user, so the row
                                    now shows the class badge only. */}
                                {student.grade && (
                                  <div className="flex items-center gap-2 mt-0.5">
                                    <span className="inline-block px-1.5 py-0.5 bg-blue-50 dark:bg-blue-950/40 text-blue-600 dark:text-blue-300 rounded-md text-3xs font-extrabold uppercase tracking-wider">
                                      {getGradeDisplay(student.grade, lang)}
                                    </span>
                                  </div>
                                )}
                              </div>
                            </div>
                          </div>
                        </td>
                        <td className="px-8 py-6">
                          <div className="flex flex-col">
                            <span className={`text-sm ${currentTheme.inkStrong} font-semibold`}>
                              <HighlightText text={student.parentName} highlight={searchTerm} />
                            </span>
                            <span className={`text-xs ${currentTheme.muted}`}>{student.parentEmail || student.parentPhone || '—'}</span>
                          </div>
                        </td>
                        <td className={`px-8 py-6 text-sm font-bold ${currentTheme.muted}`}>
                          <div className="flex flex-col">
                            <span>{formatCurrency(student.totalDue)}</span>
                            {(student.scholarshipDiscount || 0) > 0 && (
                              <span className="text-2xs text-emerald-500 font-black uppercase tracking-widest">-{student.scholarshipDiscount}% {t.scholarship}</span>
                            )}
                          </div>
                        </td>
                        <td className={`px-8 py-6 text-sm font-black ${currentTheme.inkStrong}`}>
                          {formatCurrency(balance)}
                        </td>
                        <td className="px-8 py-6">
                          <div className="flex flex-col gap-1 items-start">
                            <div className={`inline-flex items-center gap-2 px-4 py-1.5 rounded-full text-2xs font-black uppercase tracking-widest border ${status.color}`}>
                              {status.icon}
                              {status.label}
                            </div>
                            <span className={`text-2xs ${currentTheme.muted} font-bold mt-1 uppercase tracking-wider`}>
                              {t.dueDate}: {formatDate(student.dueDate)}
                            </span>
                          </div>
                        </td>
                        <td className="px-8 py-6 text-right flex justify-end gap-2">
                          <button 
                            onClick={() => openEditModal(student)}
                            className={`p-2 ${currentTheme.muted} hover:text-blue-600 hover:bg-blue-50 rounded-xl transition-all`}
                            title={t.editStudent2}
                          >
                            <FileText size={18} />
                          </button>
                          {balance > 0 && diffDays <= -60 && (
                            <button 
                              onClick={() => setTicketStudent(student)}
                              className="p-2 text-rose-500 hover:text-rose-600 hover:bg-rose-50 rounded-xl transition-all"
                              title={t.printLatePaymentTicket}
                            >
                              <Printer size={18} />
                            </button>
                          )}
                          {/* La suppression est réservée aux administrateurs par la
                              policy « Admin delete students » : le bouton n'existe pas
                              pour les autres rôles, au lieu d'échouer après le clic.
                              Le libellé accompagne l'icône : une corbeille seule se
                              lit comme un ornement. */}
                          {canDelete && (
                            <button
                              onClick={() => setConfirmDeleteStudent(student)}
                              className="px-3 py-2 text-rose-600 dark:text-rose-300 bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900/60 hover:bg-rose-100 dark:hover:bg-rose-950/60 rounded-xl text-2xs font-bold transition-all flex items-center gap-1.5 whitespace-nowrap"
                              title={t.deleteStudent}
                            >
                              <Trash2 size={16} /> {t.deleteStudent}
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            
            {/* Legend */}
            <div className={`px-8 py-4 border-t ${currentTheme.border} ${currentTheme.surfaceInset} flex flex-wrap gap-6 items-center`}>
              <span className={`text-2xs font-black uppercase tracking-widest ${currentTheme.muted}`}>{t.legend}:</span>
              <div className="flex items-center gap-2">
                <div className={`w-3 h-3 rounded-sm ${currentTheme.isDark ? 'bg-rose-900/30' : 'bg-rose-100'} border border-rose-200`}></div>
                <span className={`text-2xs font-bold ${currentTheme.muted}`}>{t.overdue30}</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 rounded-sm border-l-2 border-l-amber-400 bg-transparent"></div>
                <span className={`text-2xs font-bold ${currentTheme.muted}`}>{t.due48}</span>
              </div>
              <div className="flex items-center gap-2">
                <div className={`w-3 h-3 rounded-sm ${currentTheme.isDark ? 'bg-amber-900/30' : 'bg-amber-100'} border border-amber-200`}></div>
                <span className={`text-2xs font-bold ${currentTheme.muted}`}>{t.flaggedLabel}</span>
              </div>
            </div>
          </div>
        </div>

        <ConfirmDialog
          open={!!confirmDeleteStudent}
          title={t.deleteStudent}
          message={t.deleteStudentConfirm.replace('{name}', confirmDeleteStudent?.name || '')}
          confirmLabel={t.deleteStudent}
          cancelLabel={t.cancel}
          danger={confirmDeleteStudent && confirmDeleteStudent.payments.length > 0 ? {
            mode: 'type',
            text: confirmDeleteStudent.name,
            hint: t.typeToConfirm.replace('{text}', confirmDeleteStudent.name),
          } : undefined}
          onConfirm={() => {
            if (confirmDeleteStudent) {
              deleteStudent(confirmDeleteStudent.id);
            }
            setConfirmDeleteStudent(null);
          }}
          onCancel={() => setConfirmDeleteStudent(null)}
          currentTheme={currentTheme}
        />
    </>
  );
}
