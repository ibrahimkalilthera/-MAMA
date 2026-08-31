import { useState } from 'react';
import type { MainViewsProps } from './MainViews';
import type { Student } from '../lib/useSupabaseData';
import { ConfirmDialog } from './ConfirmDialog';

export function StudentsView(props: MainViewsProps) {
  const [confirmDeleteStudent, setConfirmDeleteStudent] = useState<Student | null>(null);
  const { expenses, AlertCircle, ArrowDown, ArrowUp, ArrowUpDown, Award, Bell, BookOpen, Briefcase, Calendar, ChartsFallback, CheckCircle2, ChevronDown, ChevronLeft, ChevronRight, ChevronUp, Clock, Coins, Cpu, CreditCard, DashboardCharts, DollarSign, Download, Droplet, Edit2, FileText, Flag, Globe, GraduationCap, Hammer, Heart, HighlightText, Landmark, Layers, Mail, MapPin, Phone, PieChart, Plus, Printer, Receipt, Search, Shield, ShieldCheck, Sparkles, Sprout, StickyNote, Sun, Suspense, Trash2, TrendingDown, TrendingUp, Unlink, UploadCloud, UserCheck, UserPlus, Users, Utensils, Wallet, Wifi, X, Zap, activeTab, auditLogs, auth, availableClasses, calendarDate, changeMonth, chartData, currentMonth, currentTheme, deleteStaff, deleteStudent, deleteTodo, expandedParentId, expenseCategoryList, fetchAuditLogs, filteredStaff, filteredStudents, formatCurrency, formatDate, generateExpensesReportPdf, generateStaffPayslipPdf, getChildrenForParent, getDayName, getDaysInMonth, getEventsForDay, getGradeDisplay, getMonthName, getParentOutstandingBalance, getParentPaymentHistory, getStatus, handleAddTodo, handleDeleteClass, handleDeleteParent, handleDeleteVendorExpense, handleExportAllData, handleExportParentLedgerPdf, handleLogoUpload, handlePrint, handleSendPasswordReset, handleSort, handleUnlinkStudent, handleUpdateRole, isPromoter, lang, lateStudents, logoColor, logoInputRef, missedMonths, openEditClass, openEditModal, openEditParentModal, openEditStaffModal, openNotifyModal, parentChildrenSortBy, parentSearchTerm, parents, payrollWindowStatus, pieData, salaryForm, salaryPayments, schoolLogo, searchTerm, selectedYear, setActiveLinkingParent, setCalendarDate, setEditingParent, setEditingStaff, setEditingVendorExpense, setExpandedParentId, setLogoColor, setParentChildrenSortBy, setParentForm, setParentSearchTerm, setSalaryForm, setSchoolLogo, setSelectedCalendarDay, setSelectedDraftMonth, setSelectedDraftYear, setSelectedStudent, setShowAddClassModal, setShowAddUserModal, setShowCalendarModal, setShowLinkStudentModal, setShowMonthlyDraftModal, setShowParentModal, setShowSalaryModal, setShowStaffModal, setShowVendorExpenseModal, setStaffForm, setStaffSearchTerm, setStudentToLinkId, setTheme, setTicketStudent, setTodoInput, setUserProfiles, setUserRoleFilter, setUserSearchTerm, setVendorCategoryFilter, setVendorExpenseForm, setVendorSearch, setVendorStatusFilter, setVisibleBankDetails, staff, staffSearchTerm, stats, studentSortKey, studentSortOrder, t, theme, today, todoInput, todos, toggleFlag, toggleLanguage, toggleTodo, updatingUserId, userProfiles, userRoleFilter, userSearchTerm, vendorCategoryFilter, vendorExpenses, vendorSearch, vendorStatusFilter, visibleBankDetails } = props;
  return (
    <>
          <div className="space-y-8">
            {/* Print Summary */}
            <div className="hidden print:block mb-8 p-6 bg-slate-50 border-2 border-slate-200 rounded-2xl">
              <div className="flex justify-around text-center">
                <div>
                  <p className="text-[10px] font-black uppercase tracking-widest text-slate-500 mb-1">{t.totalCollected}</p>
                  <p className="text-xl font-black text-emerald-600">{formatCurrency(stats.totalCollected)}</p>
                </div>
                <div className="w-px h-10 bg-slate-200"></div>
                <div>
                  <p className="text-[10px] font-black uppercase tracking-widest text-slate-500 mb-1">{t.totalOutstanding}</p>
                  <p className="text-xl font-black text-rose-600">{formatCurrency(stats.totalOutstanding)}</p>
                </div>
              </div>
            </div>

            <div className={`${currentTheme.card} rounded-[2.5rem] border ${currentTheme.border} shadow-2xl shadow-slate-200/50 overflow-hidden`}>
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className={`${currentTheme.isDark ? 'bg-emerald-900/20' : 'bg-slate-50/50'} ${currentTheme.muted} text-[10px] font-black uppercase tracking-[0.2em]`}>
                    <th 
                      onClick={() => handleSort('name')}
                      className={`px-8 py-6 cursor-pointer ${currentTheme.isDark ? 'hover:bg-emerald-900/10' : 'hover:bg-slate-100'} transition-all group/sort select-none`}
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
                      className={`px-8 py-6 cursor-pointer ${currentTheme.isDark ? 'hover:bg-emerald-900/10' : 'hover:bg-slate-100'} transition-all group/sort select-none`}
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
                      className={`px-8 py-6 cursor-pointer ${currentTheme.isDark ? 'hover:bg-emerald-900/10' : 'hover:bg-slate-100'} transition-all group/sort select-none`}
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
                      className={`px-8 py-6 cursor-pointer ${currentTheme.isDark ? 'hover:bg-emerald-900/10' : 'hover:bg-slate-100'} transition-all group/sort select-none`}
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
                    <th className="px-8 py-6 text-right select-none">Actions</th>
                  </tr>
                </thead>
                <tbody className={`divide-y ${currentTheme.border}`}>
                  {filteredStudents.map((student) => {
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
                              <div className={`w-10 h-10 rounded-xl ${currentTheme.isDark ? 'bg-emerald-900/20 text-emerald-500' : 'bg-slate-100 text-slate-400'} font-bold text-xs group-hover:bg-blue-600 group-hover:text-white transition-all flex items-center justify-center`}>
                                {student.name.split(' ').map(n => n[0]).join('')}
                              </div>
                              <div>
                                <span className={`block font-bold ${currentTheme.isDark ? 'text-emerald-500' : 'text-slate-800'} text-sm`}>
                                  <HighlightText text={student.name} highlight={searchTerm} />
                                </span>
                                <div className="flex items-center gap-2 mt-0.5">
                                  <span className={`text-[10px] ${currentTheme.muted} font-bold tracking-widest uppercase`}>{student.id}</span>
                                  {student.grade && (
                                    <span className="inline-block px-1.5 py-0.5 bg-blue-50 text-blue-600 rounded-md text-[9px] font-extrabold uppercase tracking-wider">
                                      {getGradeDisplay(student.grade, lang)}
                                    </span>
                                  )}
                                </div>
                              </div>
                            </div>
                          </div>
                        </td>
                        <td className="px-8 py-6">
                          <div className="flex flex-col">
                            <span className={`text-sm ${currentTheme.isDark ? 'text-emerald-500' : 'text-slate-600'} font-semibold`}>
                              <HighlightText text={student.parentName} highlight={searchTerm} />
                            </span>
                            <span className={`text-xs ${currentTheme.muted}`}>{student.parentEmail || student.parentPhone || '—'}</span>
                          </div>
                        </td>
                        <td className={`px-8 py-6 text-sm font-bold ${currentTheme.muted}`}>
                          <div className="flex flex-col">
                            <span>{formatCurrency(student.totalDue)}</span>
                            {student.scholarshipDiscount > 0 && (
                              <span className="text-[10px] text-emerald-500 font-black uppercase tracking-widest">-{student.scholarshipDiscount}% {t.scholarship}</span>
                            )}
                          </div>
                        </td>
                        <td className={`px-8 py-6 text-sm font-black ${currentTheme.isDark ? 'text-emerald-400' : 'text-slate-800'}`}>
                          {formatCurrency(balance)}
                        </td>
                        <td className="px-8 py-6">
                          <div className="flex flex-col gap-1 items-start">
                            <div className={`inline-flex items-center gap-2 px-4 py-1.5 rounded-full text-[10px] font-black uppercase tracking-widest border ${status.color}`}>
                              {status.icon}
                              {status.label}
                            </div>
                            <span className={`text-[10px] ${currentTheme.muted} font-bold mt-1 uppercase tracking-wider`}>
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
                          <button 
                            onClick={() => setConfirmDeleteStudent(student)}
                            className="p-2 text-rose-500 hover:text-rose-700 hover:bg-rose-50 dark:hover:bg-rose-950/20 rounded-xl transition-all"
                            title={t.deleteStudent}
                          >
                            <Trash2 size={18} />
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            
            {/* Legend */}
            <div className={`px-8 py-4 border-t ${currentTheme.border} ${currentTheme.isDark ? 'bg-emerald-900/10' : 'bg-slate-50/30'} flex flex-wrap gap-6 items-center`}>
              <span className={`text-[10px] font-black uppercase tracking-widest ${currentTheme.muted}`}>{t.legend}:</span>
              <div className="flex items-center gap-2">
                <div className={`w-3 h-3 rounded-sm ${currentTheme.isDark ? 'bg-rose-900/30' : 'bg-rose-100'} border border-rose-200`}></div>
                <span className={`text-[10px] font-bold ${currentTheme.muted}`}>{t.overdue30}</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 rounded-sm border-l-2 border-l-amber-400 bg-transparent"></div>
                <span className={`text-[10px] font-bold ${currentTheme.muted}`}>{t.due48}</span>
              </div>
              <div className="flex items-center gap-2">
                <div className={`w-3 h-3 rounded-sm ${currentTheme.isDark ? 'bg-amber-900/30' : 'bg-amber-100'} border border-amber-200`}></div>
                <span className={`text-[10px] font-bold ${currentTheme.muted}`}>{t.flaggedLabel}</span>
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
