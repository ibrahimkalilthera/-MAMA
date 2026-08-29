import { AnimatePresence, motion } from 'motion/react';
import type { MainViewsProps } from './MainViews';

export function ParentsView(props: MainViewsProps) {
  const { expenses, AlertCircle, ArrowDown, ArrowUp, ArrowUpDown, Award, Bell, BookOpen, Briefcase, Calendar, ChartsFallback, CheckCircle2, ChevronDown, ChevronLeft, ChevronRight, ChevronUp, Clock, Coins, Cpu, CreditCard, DashboardCharts, DollarSign, Download, Droplet, Edit2, FileText, Flag, Globe, GraduationCap, Hammer, Heart, HighlightText, Landmark, Layers, Mail, MapPin, Phone, PieChart, Plus, Printer, Receipt, Search, Shield, ShieldCheck, Sparkles, Sprout, StickyNote, Sun, Suspense, Trash2, TrendingDown, TrendingUp, Unlink, UploadCloud, UserCheck, UserPlus, Users, Utensils, Wallet, Wifi, X, Zap, activeTab, auditLogs, auth, availableClasses, calendarDate, changeMonth, chartData, currentMonth, currentTheme, deleteStaff, deleteStudent, deleteTodo, expandedParentId, expenseCategoryList, fetchAuditLogs, filteredStaff, filteredStudents, formatCurrency, formatDate, generateExpensesReportPdf, generateStaffPayslipPdf, getChildrenForParent, getDayName, getDaysInMonth, getEventsForDay, getGradeDisplay, getMonthName, getParentOutstandingBalance, getParentPaymentHistory, getStatus, handleAddTodo, handleDeleteClass, handleDeleteParent, handleDeleteVendorExpense, handleExportAllData, handleExportParentLedgerPdf, handleLogoUpload, handlePrint, handleSendPasswordReset, handleSort, handleUnlinkStudent, handleUpdateRole, isPromoter, lang, lateStudents, logoColor, logoInputRef, missedMonths, openEditClass, openEditModal, openEditParentModal, openEditStaffModal, openNotifyModal, parentChildrenSortBy, parentSearchTerm, parents, payrollWindowStatus, pieData, salaryForm, salaryPayments, schoolLogo, searchTerm, selectedYear, setActiveLinkingParent, setCalendarDate, setEditingParent, setEditingStaff, setEditingVendorExpense, setExpandedParentId, setLogoColor, setNewUserForm, setParentChildrenSortBy, setParentForm, setParentSearchTerm, setSalaryForm, setSchoolLogo, setSelectedCalendarDay, setSelectedDraftMonth, setSelectedDraftYear, setSelectedStudent, setShowAddClassModal, setShowAddUserModal, setShowCalendarModal, setShowLinkStudentModal, setShowMonthlyDraftModal, setShowParentModal, setShowSalaryModal, setShowStaffModal, setShowVendorExpenseModal, setStaffForm, setStaffSearchTerm, setStudentToLinkId, setTheme, setTicketStudent, setTodoInput, setUserProfiles, setUserRoleFilter, setUserSearchTerm, setVendorCategoryFilter, setVendorExpenseForm, setVendorSearch, setVendorStatusFilter, setVisibleBankDetails, staff, staffSearchTerm, stats, studentSortKey, studentSortOrder, t, theme, today, todoInput, todos, toggleFlag, toggleLanguage, toggleTodo, updatingUserId, userProfiles, userRoleFilter, userSearchTerm, vendorCategoryFilter, vendorExpenses, vendorSearch, vendorStatusFilter, visibleBankDetails } = props;
  return (
          <div className="space-y-8">
            {/* Header & Search Bar */}
            <div className={`p-8 rounded-[2rem] ${currentTheme.card} border ${currentTheme.border} shadow-xl shadow-slate-200/50 flex flex-col md:flex-row md:items-center justify-between gap-6`}>
              <div className="space-y-1">
                <div className="flex items-center gap-3">
                  <div className={`p-3 rounded-2xl ${currentTheme.isDark ? 'bg-emerald-900/30 text-emerald-400' : 'bg-emerald-50 text-emerald-600'}`}>
                    <Users size={24} />
                  </div>
                  <div>
                    <h3 className={`text-2xl font-black ${currentTheme.isDark ? 'text-white' : 'text-slate-900'}`}>
                      {t.parentGuardian}
                    </h3>
                    <p className={`text-xs ${currentTheme.muted}`}>
                      {t.parentDirectorySubtitle}
                    </p>
                  </div>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-4">
                {/* Search Bar */}
                <div className="relative min-w-[280px] sm:min-w-[340px]">
                  <Search className={`absolute left-4 top-1/2 -translate-y-1/2 ${currentTheme.muted}`} size={18} />
                  <input
                    type="text"
                    value={parentSearchTerm}
                    onChange={(e) => setParentSearchTerm(e.target.value)}
                    placeholder={t.searchParentsPlaceholder}
                    className={`w-full pl-11 pr-4 py-3 text-xs font-semibold rounded-2xl border ${currentTheme.border} ${currentTheme.isDark ? 'bg-slate-900 text-white' : 'bg-slate-50 text-slate-800'} focus:outline-none focus:ring-2 focus:ring-emerald-500/20 transition-all`}
                  />
                  {parentSearchTerm && (
                    <button
                      onClick={() => setParentSearchTerm('')}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                    >
                      <X size={14} />
                    </button>
                  )}
                </div>

                {/* Add Parent Button */}
                <button
                  onClick={() => {
                    setEditingParent(null);
                    setParentForm({
                      fullName: '',
                      primaryPhone: '',
                      secondaryPhone: '',
                      email: '',
                      address: '',
                      occupation: '',
                      relationship: 'Father',
                      notes: '',
                      linkedStudentIds: []
                    });
                    setShowParentModal(true);
                  }}
                  className="px-5 py-3 rounded-2xl bg-emerald-600 text-white font-bold text-xs hover:bg-emerald-700 shadow-lg shadow-emerald-600/20 transition-all flex items-center gap-2"
                >
                  <Plus size={16} />
                  <span>{t.addParent}</span>
                </button>
              </div>
            </div>

            {/* Parent Directory Cards Grid */}
            <div className="space-y-6">
              {parents.filter(p => {
                const search = parentSearchTerm.toLowerCase().trim();
                if (!search) return true;
                const children = getChildrenForParent(p);
                const hasMatchingChild = children.some(c => c.name.toLowerCase().includes(search) || (c.studentId && c.studentId.toLowerCase().includes(search)) || c.id.toLowerCase().includes(search));
                return p.fullName.toLowerCase().includes(search) ||
                  p.occupation.toLowerCase().includes(search) ||
                  p.address.toLowerCase().includes(search) ||
                  p.relationship.toLowerCase().includes(search) ||
                  p.phones.some(ph => ph.includes(search)) ||
                  (p.email && p.email.toLowerCase().includes(search)) ||
                  hasMatchingChild;
              }).length === 0 ? (
                <div className={`p-12 text-center rounded-[2rem] ${currentTheme.card} border ${currentTheme.border}`}>
                  <Users size={48} className="mx-auto mb-4 text-slate-300" />
                  <p className={`text-sm font-bold ${currentTheme.muted}`}>
                    {t.noParentProfilesFoundMatchingYourSearch}
                  </p>
                </div>
              ) : (
                parents.filter(p => {
                  const search = parentSearchTerm.toLowerCase().trim();
                  if (!search) return true;
                  const children = getChildrenForParent(p);
                  const hasMatchingChild = children.some(c => c.name.toLowerCase().includes(search) || (c.studentId && c.studentId.toLowerCase().includes(search)) || c.id.toLowerCase().includes(search));
                  return p.fullName.toLowerCase().includes(search) ||
                    p.occupation.toLowerCase().includes(search) ||
                    p.address.toLowerCase().includes(search) ||
                    p.relationship.toLowerCase().includes(search) ||
                    p.phones.some(ph => ph.includes(search)) ||
                    (p.email && p.email.toLowerCase().includes(search)) ||
                    hasMatchingChild;
                }).map((parent) => {
                  const children = getChildrenForParent(parent);
                  const totalOutstanding = getParentOutstandingBalance(parent);
                  const paymentHistory = getParentPaymentHistory(parent);
                  const totalPaymentsEver = paymentHistory.reduce((sum, item) => sum + item.amount, 0);
                  const isExpanded = expandedParentId === parent.id;

                  return (
                    <motion.div
                      key={parent.id}
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      className={`${currentTheme.card} rounded-[2rem] border ${currentTheme.border} shadow-xl shadow-slate-200/50 overflow-hidden transition-all`}
                    >
                      {/* Main Card Header Bar */}
                      <div className="p-6 flex flex-col lg:flex-row lg:items-center justify-between gap-6 cursor-pointer hover:bg-slate-500/5 transition-colors" onClick={() => setExpandedParentId(isExpanded ? null : parent.id)}>
                        <div className="flex items-center gap-4">
                          <div className={`w-14 h-14 rounded-2xl flex items-center justify-center text-lg font-black ${currentTheme.isDark ? 'bg-emerald-900/30 text-emerald-400' : 'bg-slate-100 text-slate-700'}`}>
                            {parent.fullName.charAt(0).toUpperCase()}
                          </div>
                          <div>
                            <div className="flex items-center gap-2 flex-wrap">
                              <h4 className={`text-lg font-black ${currentTheme.isDark ? 'text-white' : 'text-slate-900'}`}>
                                <HighlightText text={parent.fullName} highlight={parentSearchTerm} />
                              </h4>
                              <span className="px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-wider bg-slate-200/60 dark:bg-slate-800 text-slate-600 dark:text-slate-300">
                                {t[parent.relationship.toLowerCase() as keyof typeof t] || parent.relationship}
                              </span>
                            </div>
                            <div className="flex items-center gap-4 text-xs mt-1 text-slate-500 flex-wrap">
                              <span className="flex items-center gap-1 font-semibold">
                                <Briefcase size={14} className="text-slate-400" />
                                {parent.occupation || 'N/A'}
                              </span>
                              <span className="flex items-center gap-1 font-semibold">
                                <MapPin size={14} className="text-slate-400" />
                                {parent.address || 'N/A'}
                              </span>
                            </div>
                          </div>
                        </div>

                        {/* Right Summary Metrics & Actions */}
                        <div className="flex items-center gap-4 flex-wrap justify-between lg:justify-end" onClick={(e) => e.stopPropagation()}>
                          {/* Children Count Pill */}
                          <div className="flex flex-col items-start lg:items-end">
                            <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">{t.listOfChildren}</span>
                            <span className="text-sm font-bold text-slate-700 dark:text-slate-300 flex items-center gap-1">
                              <Users size={14} className="text-emerald-500" />
                              {children.length} {t.studentsCountLabel}
                            </span>
                          </div>

                          {/* Family Balance Badge (Highlighted in Red if overdue with direct Notify button) */}
                          <div className="flex flex-col items-start lg:items-end">
                            <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">{t.totalOutstandingBalance}</span>
                            {totalOutstanding > 0 ? (
                              <div className="flex items-center gap-2 mt-1">
                                <span className="px-3 py-1.5 rounded-xl bg-rose-500/10 text-rose-600 border border-rose-200 font-black text-sm flex items-center gap-1 animate-pulse">
                                  <AlertCircle size={14} />
                                  {formatCurrency(totalOutstanding)}
                                </span>
                                <button
                                  title={t.sendReminder}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    openNotifyModal(parent);
                                  }}
                                  className="px-3 py-1.5 rounded-xl bg-amber-500 hover:bg-amber-600 text-white font-bold text-xs shadow-md shadow-amber-500/20 flex items-center gap-1.5 transition-all active:scale-95"
                                >
                                  <Bell size={14} />
                                  <span>{t.notify}</span>
                                </button>
                              </div>
                            ) : (
                              <span className="px-3 py-1.5 rounded-xl bg-emerald-500/10 text-emerald-600 border border-emerald-200 font-bold text-xs flex items-center gap-1 mt-1">
                                <CheckCircle2 size={14} />
                                0 {t.currency} ({t.settle})
                              </span>
                            )}
                          </div>

                          {/* Quick Actions */}
                          <div className="flex items-center gap-2">
                            <button
                              title={t.linkStudent}
                              onClick={(e) => {
                                e.stopPropagation();
                                setActiveLinkingParent(parent);
                                setStudentToLinkId('');
                                setShowLinkStudentModal(true);
                              }}
                              className="p-2.5 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-100 transition-all font-bold text-xs flex items-center gap-1"
                            >
                              <UserPlus size={16} />
                              <span className="hidden sm:inline">{t.linkStudent}</span>
                            </button>

                            <button
                              title={t.editParent}
                              onClick={(e) => {
                                e.stopPropagation();
                                openEditParentModal(parent);
                              }}
                              className="p-2.5 rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200 transition-all"
                            >
                              <Edit2 size={16} />
                            </button>

                            <button
                              title={t.deleteParent}
                              onClick={(e) => {
                                e.stopPropagation();
                                handleDeleteParent(parent.id);
                              }}
                              className="p-2.5 rounded-xl bg-rose-50 dark:bg-rose-950/40 text-rose-600 hover:bg-rose-100 transition-all"
                            >
                              <Trash2 size={16} />
                            </button>

                            <button
                              onClick={() => setExpandedParentId(isExpanded ? null : parent.id)}
                              className="p-2.5 rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200 transition-all"
                            >
                              {isExpanded ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
                            </button>
                          </div>
                        </div>
                      </div>

                      {/* Expandable Details Container */}
                      <AnimatePresence>
                        {isExpanded && (
                          <motion.div
                            initial={{ height: 0, opacity: 0 }}
                            animate={{ height: 'auto', opacity: 1 }}
                            exit={{ height: 0, opacity: 0 }}
                            className={`border-t ${currentTheme.border} p-6 lg:p-8 bg-slate-50/50 dark:bg-slate-900/30 space-y-8`}
                          >
                            {/* Summary Banner Row: Sum of all payments ever made by parent across all children */}
                            <div className="p-5 rounded-2xl bg-gradient-to-r from-emerald-600 to-teal-700 text-white shadow-lg shadow-emerald-600/20 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                              <div className="flex items-center gap-3">
                                <div className="p-3 rounded-xl bg-white/10 backdrop-blur-md">
                                  <CreditCard size={22} className="text-emerald-200" />
                                </div>
                                <div>
                                  <p className="text-[10px] font-black uppercase tracking-widest text-emerald-200">
                                    {t.totalPaymentsAllChildren}
                                  </p>
                                  <p className="text-xs font-medium text-emerald-50/90">
                                    {t.cumulativePaymentsSum.replace('{name}', parent.fullName)}
                                  </p>
                                </div>
                              </div>
                              <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4 border-t sm:border-t-0 border-white/10 pt-3 sm:pt-0">
                                <div className="text-left sm:text-right">
                                  <span className="text-[10px] uppercase font-bold text-emerald-200 block sm:hidden">{t.amountPaid}</span>
                                  <span className="text-xl sm:text-2xl font-black text-white font-mono tracking-tight block">
                                    {formatCurrency(totalPaymentsEver)}
                                  </span>
                                </div>
                                <button
                                  type="button"
                                  onClick={() => handleExportParentLedgerPdf(parent)}
                                  className="px-4 py-2.5 rounded-xl bg-white text-emerald-900 hover:bg-emerald-50 font-black text-xs shadow-md flex items-center gap-2 transition-all active:scale-95"
                                >
                                  <Download size={16} className="text-emerald-600" />
                                  <span>{t.downloadLedger}</span>
                                </button>
                              </div>
                            </div>

                            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                              {/* Column 1: Contact, Employment & Residence Details */}
                              <div className="space-y-6 bg-white dark:bg-slate-900 p-6 rounded-2xl border border-slate-200/60 dark:border-slate-800 shadow-sm">
                                <h5 className="text-xs font-black uppercase tracking-widest text-emerald-600 dark:text-emerald-400 flex items-center gap-2">
                                  <UserCheck size={16} />
                                  {t.parentDetails} & {t.contactCard}
                                </h5>

                                <div className="space-y-4 text-xs">
                                  <div className="flex items-center gap-3">
                                    <Phone size={16} className="text-slate-400" />
                                    <div>
                                      <p className="font-bold text-slate-400 uppercase text-[9px]">{t.primaryPhone}</p>
                                      <p className="font-bold text-slate-800 dark:text-slate-200">{parent.phones[0] || 'N/A'}</p>
                                    </div>
                                  </div>

                                  {parent.phones[1] && (
                                    <div className="flex items-center gap-3">
                                      <Phone size={16} className="text-slate-400" />
                                      <div>
                                        <p className="font-bold text-slate-400 uppercase text-[9px]">{t.secondaryPhone}</p>
                                        <p className="font-bold text-slate-800 dark:text-slate-200">{parent.phones[1]}</p>
                                      </div>
                                    </div>
                                  )}

                                  {parent.email && (
                                    <div className="flex items-center gap-3">
                                      <Mail size={16} className="text-slate-400" />
                                      <div>
                                        <p className="font-bold text-slate-400 uppercase text-[9px]">{t.email}</p>
                                        <p className="font-bold text-slate-800 dark:text-slate-200">{parent.email}</p>
                                      </div>
                                    </div>
                                  )}

                                  <div className="flex items-center gap-3">
                                    <MapPin size={16} className="text-slate-400" />
                                    <div>
                                      <p className="font-bold text-slate-400 uppercase text-[9px]">{t.address}</p>
                                      <p className="font-bold text-slate-800 dark:text-slate-200">{parent.address}</p>
                                    </div>
                                  </div>

                                  <div className="flex items-center gap-3">
                                    <Briefcase size={16} className="text-slate-400" />
                                    <div>
                                      <p className="font-bold text-slate-400 uppercase text-[9px]">{t.occupation}</p>
                                      <p className="font-bold text-slate-800 dark:text-slate-200">{parent.occupation}</p>
                                    </div>
                                  </div>

                                  {parent.notes && (
                                    <div className="flex items-start gap-3 pt-2 border-t border-slate-100 dark:border-slate-800">
                                      <FileText size={16} className="text-slate-400 mt-0.5" />
                                      <div>
                                        <p className="font-bold text-slate-400 uppercase text-[9px]">{t.accountingNotes}</p>
                                        <p className="italic text-slate-600 dark:text-slate-400">{parent.notes}</p>
                                      </div>
                                    </div>
                                  )}
                                </div>
                              </div>

                              {/* Column 2: Connected Children List */}
                              <div className="space-y-6 bg-white dark:bg-slate-900 p-6 rounded-2xl border border-slate-200/60 dark:border-slate-800 shadow-sm">
                                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                                  <h5 className="text-xs font-black uppercase tracking-widest text-emerald-600 dark:text-emerald-400 flex items-center gap-2">
                                    <Users size={16} />
                                    {t.listOfChildren} ({children.length})
                                  </h5>

                                  <div className="flex items-center gap-2 flex-wrap">
                                    {children.length > 1 && (
                                      <div className="flex items-center gap-1 bg-slate-100 dark:bg-slate-800 p-1 rounded-xl text-xs">
                                        <span className="text-[10px] font-bold text-slate-400 pl-1 hidden sm:inline">{t.sortByLabel}</span>
                                        <button
                                          type="button"
                                          onClick={() => setParentChildrenSortBy('highest_balance')}
                                          className={`px-2.5 py-1 rounded-lg font-bold text-[10px] transition-all flex items-center gap-1 ${
                                            parentChildrenSortBy === 'highest_balance'
                                              ? 'bg-emerald-600 text-white shadow-xs'
                                              : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                                          }`}
                                          title={t.sortHighestBalance}
                                        >
                                          <ArrowUpDown size={12} />
                                          <span>{t.sortHighestBalance}</span>
                                        </button>
                                        <button
                                          type="button"
                                          onClick={() => setParentChildrenSortBy('alphabetical')}
                                          className={`px-2.5 py-1 rounded-lg font-bold text-[10px] transition-all flex items-center gap-1 ${
                                            parentChildrenSortBy === 'alphabetical'
                                              ? 'bg-emerald-600 text-white shadow-xs'
                                              : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                                          }`}
                                          title={t.sortAlphabetical}
                                        >
                                          <span>{t.sortAlphabetical}</span>
                                        </button>
                                      </div>
                                    )}

                                    <button
                                      onClick={() => {
                                        setActiveLinkingParent(parent);
                                        setStudentToLinkId('');
                                        setShowLinkStudentModal(true);
                                      }}
                                      className="px-3 py-1.5 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-100 text-xs font-bold flex items-center gap-1 transition-all"
                                    >
                                      <Plus size={14} />
                                      {t.linkStudent}
                                    </button>
                                  </div>
                                </div>

                                {children.length === 0 ? (
                                  <div className="p-8 text-center bg-slate-50 dark:bg-slate-800/40 rounded-xl border border-dashed border-slate-200 dark:border-slate-700">
                                    <p className="text-xs text-slate-400 font-semibold mb-3">{t.noChildrenLinked}</p>
                                    <button
                                      onClick={() => {
                                        setActiveLinkingParent(parent);
                                        setStudentToLinkId('');
                                        setShowLinkStudentModal(true);
                                      }}
                                      className="px-4 py-2 rounded-xl bg-emerald-600 text-white font-bold text-xs"
                                    >
                                      {t.linkStudent}
                                    </button>
                                  </div>
                                ) : (
                                  <div className="space-y-3">
                                    {[...children]
                                      .sort((a, b) => {
                                        if (parentChildrenSortBy === 'highest_balance') {
                                          const balA = Math.max(0, a.totalDue - a.amountPaid);
                                          const balB = Math.max(0, b.totalDue - b.amountPaid);
                                          if (balB !== balA) return balB - balA;
                                          return a.name.localeCompare(b.name);
                                        } else {
                                          return a.name.localeCompare(b.name);
                                        }
                                      })
                                      .map((child) => {
                                      const remaining = Math.max(0, child.totalDue - child.amountPaid);
                                      return (
                                        <div
                                          key={child.id}
                                          className="p-4 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200/60 dark:border-slate-700/60 flex items-center justify-between gap-4 hover:border-emerald-500/40 transition-all"
                                        >
                                          <div>
                                            <div className="flex items-center gap-2">
                                              <span className="font-bold text-sm text-slate-900 dark:text-white">
                                                {child.name}
                                              </span>
                                              <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-300">
                                                {child.studentId || child.id}
                                              </span>
                                              {child.grade && (
                                                <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-100 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-300">
                                                  {child.grade}
                                                </span>
                                              )}
                                            </div>

                                            <div className="text-[11px] text-slate-500 mt-1 flex items-center gap-3">
                                              <span>{t.totalDue}: <strong className="text-slate-700 dark:text-slate-300">{formatCurrency(child.totalDue)}</strong></span>
                                              <span>•</span>
                                              <span>
                                                {t.balance}:{' '}
                                                <strong className={remaining > 0 ? 'text-rose-600 font-black' : 'text-emerald-600 font-bold'}>
                                                  {formatCurrency(remaining)}
                                                </strong>
                                              </span>
                                            </div>
                                          </div>

                                          <div className="flex items-center gap-2">
                                            {/* Quick Link Navigation to Student Profile */}
                                            <button
                                              onClick={() => setSelectedStudent(child)}
                                              title={t.studentDetails}
                                              className="px-3 py-1.5 rounded-xl bg-blue-50 dark:bg-blue-950/40 text-blue-600 dark:text-blue-400 hover:bg-blue-100 text-xs font-bold flex items-center gap-1"
                                            >
                                              <span>{t.studentDetails}</span>
                                              <ChevronRight size={14} />
                                            </button>

                                            {/* Unlink Student */}
                                            <button
                                              onClick={() => handleUnlinkStudent(child.id)}
                                              title={t.unlinkStudent}
                                              className="p-1.5 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/40 transition-colors"
                                            >
                                              <Unlink size={14} />
                                            </button>
                                          </div>
                                        </div>
                                      );
                                    })}
                                  </div>
                                )}
                              </div>
                            </div>

                            {/* Consolidated Ledger / Payment History Table */}
                            <div className="bg-white dark:bg-slate-900 p-6 rounded-2xl border border-slate-200/60 dark:border-slate-800 shadow-sm space-y-4">
                              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                                <h5 className="text-xs font-black uppercase tracking-widest text-emerald-600 dark:text-emerald-400 flex items-center gap-2">
                                  <Receipt size={16} />
                                  {t.paymentHistory} ({t.consolidatedFamilyLedger})
                                </h5>
                                <button
                                  type="button"
                                  onClick={() => handleExportParentLedgerPdf(parent)}
                                  className="px-3 py-1.5 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-100 font-bold text-xs flex items-center gap-1.5 border border-emerald-200/50 dark:border-emerald-800/50 transition-all self-start sm:self-auto"
                                >
                                  <Download size={14} />
                                  <span>{t.downloadLedger}</span>
                                </button>
                              </div>

                              {paymentHistory.length === 0 ? (
                                <p className="text-xs text-slate-400 italic py-4 text-center">
                                  {t.noHistoricalReceiptsFoundAcrossConnectedChildren}
                                </p>
                              ) : (
                                <div className="overflow-x-auto">
                                  <table className="w-full text-left border-collapse text-xs">
                                    <thead>
                                      <tr className="border-b border-slate-200 dark:border-slate-800 text-[10px] font-black uppercase tracking-widest text-slate-400">
                                        <th className="py-2.5 px-3">{t.receiptNo}</th>
                                        <th className="py-2.5 px-3">{t.studentName}</th>
                                        <th className="py-2.5 px-3">{t.date}</th>
                                        <th className="py-2.5 px-3">{t.amount}</th>
                                        <th className="py-2.5 px-3">{t.academicYear || 'Year'}</th>
                                      </tr>
                                    </thead>
                                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                                      {paymentHistory.map((item, idx) => (
                                        <tr key={idx} className="hover:bg-slate-50 dark:hover:bg-slate-800/40 transition-colors">
                                          <td className="py-2.5 px-3 font-mono font-bold text-emerald-600 dark:text-emerald-400">
                                            {item.receiptNumber}
                                          </td>
                                          <td className="py-2.5 px-3 font-bold text-slate-800 dark:text-slate-200">
                                            {item.studentName} <span className="text-[10px] font-normal text-slate-400">({item.studentId})</span>
                                          </td>
                                          <td className="py-2.5 px-3 text-slate-600 dark:text-slate-400">
                                            {item.date}
                                          </td>
                                          <td className="py-2.5 px-3 font-black text-slate-900 dark:text-white">
                                            {formatCurrency(item.amount)}
                                          </td>
                                          <td className="py-2.5 px-3 text-slate-500">
                                            {item.academicYear || selectedYear}
                                          </td>
                                        </tr>
                                      ))}
                                    </tbody>
                                    <tfoot className="border-t-2 border-emerald-500/30 bg-emerald-50/70 dark:bg-emerald-950/40 font-bold">
                                      <tr>
                                        <td colSpan={3} className="py-3 px-3 font-black text-slate-800 dark:text-slate-200 uppercase text-[10px] tracking-wider">
                                          {t.totalPaymentsAllChildren}
                                        </td>
                                        <td className="py-3 px-3 font-black text-emerald-700 dark:text-emerald-400 text-sm font-mono">
                                          {formatCurrency(totalPaymentsEver)}
                                        </td>
                                        <td className="py-3 px-3 text-[10px] text-slate-500 dark:text-slate-400 font-semibold">
                                          {paymentHistory.length} {t.receiptS}
                                        </td>
                                      </tr>
                                    </tfoot>
                                  </table>
                                </div>
                              )}
                            </div>
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </motion.div>
                  );
                })
              )}
            </div>
          </div>
  );
}
