import type { MainViewsProps } from './MainViews';

export function ExpensesView(props: MainViewsProps) {
  const { expenses, AlertCircle, ArrowDown, ArrowUp, ArrowUpDown, Award, Bell, BookOpen, Briefcase, Calendar, ChartsFallback, CheckCircle2, ChevronDown, ChevronLeft, ChevronRight, ChevronUp, Clock, Coins, Cpu, CreditCard, DashboardCharts, DollarSign, Download, Droplet, Edit2, FileText, Flag, Globe, GraduationCap, Hammer, Heart, HighlightText, Landmark, Layers, Mail, MapPin, Phone, PieChart, Plus, Printer, Receipt, Search, Shield, ShieldCheck, Sparkles, Sprout, StickyNote, Sun, Suspense, Trash2, TrendingDown, TrendingUp, Unlink, UploadCloud, UserCheck, UserPlus, Users, Utensils, Wallet, Wifi, X, Zap, activeTab, auditLogs, auth, availableClasses, calendarDate, changeMonth, chartData, currentMonth, currentTheme, deleteStaff, deleteStudent, deleteTodo, expandedParentId, expenseCategoryList, fetchAuditLogs, filteredStaff, filteredStudents, formatCurrency, formatDate, generateExpensesReportPdf, generateStaffPayslipPdf, getChildrenForParent, getDayName, getDaysInMonth, getEventsForDay, getGradeDisplay, getMonthName, getParentOutstandingBalance, getParentPaymentHistory, getStatus, handleAddTodo, handleDeleteClass, handleDeleteParent, handleDeleteVendorExpense, handleExportAllData, handleExportParentLedgerPdf, handleLogoUpload, handlePrint, handleSendPasswordReset, handleSort, handleUnlinkStudent, handleUpdateRole, isPromoter, lang, lateStudents, logoColor, logoInputRef, missedMonths, openEditClass, openEditModal, openEditParentModal, openEditStaffModal, openNotifyModal, parentChildrenSortBy, parentSearchTerm, parents, payrollWindowStatus, pieData, salaryForm, salaryPayments, schoolLogo, searchTerm, selectedYear, setActiveLinkingParent, setCalendarDate, setEditingParent, setEditingStaff, setEditingVendorExpense, setExpandedParentId, setLogoColor, setNewUserForm, setParentChildrenSortBy, setParentForm, setParentSearchTerm, setSalaryForm, setSchoolLogo, setSelectedCalendarDay, setSelectedDraftMonth, setSelectedDraftYear, setSelectedStudent, setShowAddClassModal, setShowAddUserModal, setShowCalendarModal, setShowLinkStudentModal, setShowMonthlyDraftModal, setShowParentModal, setShowSalaryModal, setShowStaffModal, setShowVendorExpenseModal, setStaffForm, setStaffSearchTerm, setStudentToLinkId, setTheme, setTicketStudent, setTodoInput, setUserProfiles, setUserRoleFilter, setUserSearchTerm, setVendorCategoryFilter, setVendorExpenseForm, setVendorSearch, setVendorStatusFilter, setVisibleBankDetails, staff, staffSearchTerm, stats, studentSortKey, studentSortOrder, t, theme, today, todoInput, todos, toggleFlag, toggleLanguage, toggleTodo, updatingUserId, userProfiles, userRoleFilter, userSearchTerm, vendorCategoryFilter, vendorExpenses, vendorSearch, vendorStatusFilter, visibleBankDetails } = props;
  return (
          <div className="space-y-8">
            {/* Print-Only Official Header */}
            <div className="hidden print:block mb-6 p-6 bg-rose-700 text-white rounded-2xl">
              <div className="flex justify-between items-center">
                <div>
                  <h1 className="text-2xl font-black">COMPLEXE SCOLAIRE MAMA THERA</h1>
                  <p className="text-sm opacity-90">
                    {lang === 'en' 
                      ? `GENERAL OPERATING EXPENSES REPORT — ${selectedYear}` 
                      : `RAPPORT DES DÉPENSES GÉNÉRALES & CHARGES D'EXPLOITATION — ${selectedYear}`}
                    {vendorCategoryFilter !== 'all' && (
                      <span className="ml-2 px-2 py-0.5 bg-white/20 rounded font-bold">
                        [{lang === 'en' ? `Category: ${t[vendorCategoryFilter] || vendorCategoryFilter}` : `Catégorie : ${t[vendorCategoryFilter] || vendorCategoryFilter}`}]
                      </span>
                    )}
                  </p>
                </div>
                <div className="text-right text-xs opacity-90">
                  <p>Bamako, Mali</p>
                  <p>{new Date().toLocaleDateString(lang === 'en' ? 'en-US' : 'fr-FR', { year: 'numeric', month: 'long', day: 'numeric' })}</p>
                </div>
              </div>
            </div>

            <div className="space-y-8">
              {/* Summary Cards */}
              {(() => {
                const academicYearVendorExpenses = vendorExpenses.filter(v => !selectedYear || !v.academicYear || v.academicYear === selectedYear);
                const totalVendorAmount = academicYearVendorExpenses.reduce((sum, v) => sum + v.amount, 0);
                const totalVendorPaid = academicYearVendorExpenses.reduce((sum, v) => {
                  if (v.paymentStatus === 'paid') return sum + v.amount;
                  if (v.paymentStatus === 'partial') return sum + (v.amountPaid || 0);
                  return sum;
                }, 0);
                const totalVendorOutstanding = academicYearVendorExpenses.reduce((sum, v) => {
                  if (v.paymentStatus === 'paid') return sum;
                  if (v.paymentStatus === 'partial') return sum + Math.max(0, v.amount - (v.amountPaid || 0));
                  return sum + v.amount;
                }, 0);
                const overdueVendorCount = academicYearVendorExpenses.filter(v => v.paymentStatus === 'unpaid' && v.dueDate < today).length;

                const filteredVendorExpensesList = vendorExpenses.filter(v => {
                  if (selectedYear && v.academicYear && v.academicYear !== selectedYear) return false;
                  const matchesSearch = v.vendorName.toLowerCase().includes(vendorSearch.toLowerCase()) || 
                                        (v.description || '').toLowerCase().includes(vendorSearch.toLowerCase());
                  if (!matchesSearch) return false;
                  if (vendorCategoryFilter !== 'all' && v.category !== vendorCategoryFilter) return false;
                  if (vendorStatusFilter !== 'all' && v.paymentStatus !== vendorStatusFilter) return false;
                  return true;
                });

                return (
                  <>
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                      <h3 className={`text-2xl font-bold tracking-tight ${currentTheme.isDark ? 'text-emerald-400' : 'text-slate-800'}`}>{t.generalExpenses}</h3>
                      <div className="flex items-center gap-3 no-print">
                        <button
                          onClick={() => generateExpensesReportPdf({
                            expenses,
                            vendorExpenses,
                            selectedYear,
                            subTab: 'vendors',
                            selectedCategory: vendorCategoryFilter,
                            selectedStatus: vendorStatusFilter,
                            searchQuery: vendorSearch,
                            lang,
                          })}
                          className="px-4 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold transition-all shadow-md shadow-emerald-600/20 flex items-center gap-2 active:scale-95"
                          title={lang === 'en' ? 'Download Expenses PDF Report (Filtered)' : 'Télécharger le Rapport des Dépenses en PDF (Filtré)'}
                        >
                          <FileText size={16} />
                          <span>{lang === 'en' ? 'Export PDF' : 'Exporter PDF'}</span>
                        </button>
                        <button
                          onClick={handlePrint}
                          className={`p-2.5 rounded-xl border ${currentTheme.border} ${currentTheme.card} ${currentTheme.text} hover:bg-slate-50 transition-all flex items-center gap-1.5 text-xs font-bold shadow-sm active:scale-95`}
                          title={t.printReport}
                        >
                          <Printer size={16} />
                          <span className="hidden sm:inline">{lang === 'en' ? 'Print' : 'Imprimer'}</span>
                        </button>
                        {isPromoter && (
                          <button
                            onClick={() => {
                              setEditingVendorExpense(null);
                              setVendorExpenseForm({
                                vendorName: '',
                                category: 'stationery',
                                amount: '',
                                dueDate: new Date().toISOString().split('T')[0],
                                paymentStatus: 'unpaid',
                                amountPaid: '',
                                description: '',
                                aidType: '' as any,
                                beneficiaryStudentName: '',
                                beneficiaryStudentGrade: '',
                              });
                              setShowVendorExpenseModal(true);
                            }}
                            className={`${currentTheme.isDark ? 'bg-emerald-600 hover:bg-emerald-700' : 'bg-blue-600 hover:bg-blue-700'} text-white px-5 py-2.5 rounded-xl text-xs font-bold transition-all flex items-center gap-2 shadow-lg`}
                          >
                            <Plus size={16} />
                            {t.addVendorExpense}
                          </button>
                        )}
                      </div>
                    </div>

                    {/* Overdue Alert Banner if active overdue items exist */}
                    {overdueVendorCount > 0 && (
                      <div className="bg-rose-50 border border-rose-200 text-rose-800 p-6 rounded-3xl flex items-center gap-4 animate-pulse">
                        <AlertCircle size={28} className="text-rose-600 flex-shrink-0" />
                        <div>
                          <h4 className="font-bold text-base">
                            {lang === 'en' ? `${overdueVendorCount} Overdue Payments Detected!` : `${overdueVendorCount} Paiements en retard détectés !`}
                          </h4>
                          <p className="text-sm opacity-90">{t.overdueWarning}</p>
                        </div>
                      </div>
                    )}

                    <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
                      <div className={`${currentTheme.card} p-6 rounded-[2rem] border ${currentTheme.border} shadow-md`}>
                        <p className={`text-[10px] font-bold uppercase tracking-widest mb-1 ${currentTheme.muted}`}>{t.totalVendorBills}</p>
                        <h4 className={`text-2xl font-black ${currentTheme.isDark ? 'text-white' : 'text-slate-800'}`}>{formatCurrency(totalVendorAmount)}</h4>
                      </div>
                      <div className="bg-emerald-50/50 p-6 rounded-[2rem] border border-emerald-100 shadow-sm">
                        <p className="text-[10px] font-bold uppercase tracking-widest mb-1 text-emerald-600">{t.paidPortions}</p>
                        <h4 className="text-2xl font-black text-emerald-700">{formatCurrency(totalVendorPaid)}</h4>
                      </div>
                      <div className="bg-amber-50/50 p-6 rounded-[2rem] border border-amber-100 shadow-sm">
                        <p className="text-[10px] font-bold uppercase tracking-widest mb-1 text-amber-600">{t.outstandingBalanceVendor}</p>
                        <h4 className="text-2xl font-black text-amber-700">{formatCurrency(totalVendorOutstanding)}</h4>
                      </div>
                      <div className={`${overdueVendorCount > 0 ? 'bg-rose-100 border-rose-200' : 'bg-slate-50 border-slate-100'} p-6 rounded-[2rem] border shadow-sm transition-all`}>
                        <p className={`text-[10px] font-bold uppercase tracking-widest mb-1 ${overdueVendorCount > 0 ? 'text-rose-600' : 'text-slate-500'}`}>{t.overdueUnpaid}</p>
                        <h4 className={`text-2xl font-black ${overdueVendorCount > 0 ? 'text-rose-700' : 'text-slate-700'}`}>{overdueVendorCount} {t.billsCountLabel}</h4>
                      </div>
                    </div>

                    {/* Search & Filters */}
                    <div className={`${currentTheme.card} p-6 rounded-3xl border ${currentTheme.border} shadow-sm flex flex-col md:flex-row gap-4 items-center justify-between no-print`}>
                      <div className="relative w-full md:w-80">
                        <Search size={16} className={`absolute left-4 top-1/2 -translate-y-1/2 ${currentTheme.muted}`} />
                        <input 
                          type="text" 
                          placeholder={lang === 'en' ? "Search expenses..." : "Rechercher dépenses..."}
                          value={vendorSearch}
                          onChange={(e) => setVendorSearch(e.target.value)}
                          className={`w-full pl-11 pr-4 py-3 rounded-xl border text-sm focus:outline-none ${currentTheme.input}`}
                        />
                      </div>
                      <div className="flex flex-wrap gap-4 w-full md:w-auto">
                        {/* Category Filter */}
                        <div className="flex items-center gap-2">
                          <span className={`text-xs ${currentTheme.muted}`}>{t.category}:</span>
                          <select 
                            value={vendorCategoryFilter}
                            onChange={(e) => setVendorCategoryFilter(e.target.value)}
                            className={`px-3 py-2 rounded-xl border text-xs focus:outline-none ${currentTheme.input}`}
                          >
                            <option value="all">{lang === 'en' ? "All Categories" : "Toutes catégories"}</option>
                            {expenseCategoryList.map(item => (
                              <option key={item.key} value={item.key}>{item.label}</option>
                            ))}
                          </select>
                        </div>
                        {/* Status Filter */}
                        <div className="flex items-center gap-2">
                          <span className={`text-xs ${currentTheme.muted}`}>{t.paymentStatus}:</span>
                          <select 
                            value={vendorStatusFilter}
                            onChange={(e) => setVendorStatusFilter(e.target.value)}
                            className={`px-3 py-2 rounded-xl border text-xs focus:outline-none ${currentTheme.input}`}
                          >
                            <option value="all">{lang === 'en' ? "All Statuses" : "Tous statuts"}</option>
                            <option value="paid">{t.fullyPaid}</option>
                            <option value="partial">{t.partialPaid}</option>
                            <option value="unpaid">{t.unpaid}</option>
                          </select>
                        </div>
                      </div>
                    </div>

                    {/* Expenses Table */}
                    <div className={`${currentTheme.card} rounded-[2rem] border ${currentTheme.border} shadow-xl overflow-hidden`}>
                      <div className="overflow-x-auto">
                        <table className="w-full text-left border-collapse">
                          <thead>
                            <tr className={`${currentTheme.tableHeader} text-[10px] font-black uppercase tracking-[0.2em]`}>
                              <th className="px-8 py-6">{t.category}</th>
                              <th className="px-8 py-6">{t.vendorName}</th>
                              <th className="px-8 py-6 text-right">{t.amount}</th>
                              <th className="px-8 py-6 text-right">{t.amountPaid}</th>
                              <th className="px-8 py-6">{lang === 'en' ? "Due Date" : "Date d'échéance"}</th>
                              <th className="px-8 py-6">{t.paymentStatus}</th>
                              <th className="px-8 py-6 text-right no-print">{lang === 'en' ? "Actions" : "Actions"}</th>
                            </tr>
                          </thead>
                          <tbody className={`divide-y ${currentTheme.border}`}>
                            {(() => {
                              const list = filteredVendorExpensesList;
                              if (list.length === 0) {
                                return (
                                  <tr>
                                    <td colSpan={7} className="px-8 py-16 text-center text-slate-400 italic">
                                      {lang === 'en' ? "No expenses found matching the selected filter" : "Aucune dépense trouvée pour ce filtre"}
                                    </td>
                                  </tr>
                                );
                              }
                              return list.map(v => {
                                const isOverdue = v.paymentStatus === 'unpaid' && v.dueDate < today;
                                const categoryIcon = (() => {
                                  switch (v.category) {
                                    case 'stationery': return <BookOpen size={14} className="text-purple-500" />;
                                    case 'solar_energy': return <Sun size={14} className="text-amber-500" />;
                                    case 'electricity': return <Zap size={14} className="text-yellow-500" />;
                                    case 'water': return <Droplet size={14} className="text-sky-500" />;
                                    case 'taxes': return <Landmark size={14} className="text-rose-500" />;
                                    case 'insurance': return <ShieldCheck size={14} className="text-blue-500" />;
                                    case 'security_maintenance':
                                    case 'security_guarding':
                                    case 'facility_maintenance': return <Shield size={14} className="text-emerald-600" />;
                                    case 'works_renovation': return <Hammer size={14} className="text-amber-600" />;
                                    case 'machine_management': return <Cpu size={14} className="text-teal-500" />;
                                    case 'reforestation': return <Sprout size={14} className="text-emerald-500" />;
                                    case 'catering': return <Utensils size={14} className="text-orange-500" />;
                                    case 'training': return <Award size={14} className="text-emerald-500" />;
                                    case 'social_events': return <Sparkles size={14} className="text-pink-500" />;
                                    case 'exam_def': return <GraduationCap size={14} className="text-indigo-600" />;
                                    case 'exam_bac': return <GraduationCap size={14} className="text-violet-600" />;
                                    case 'internet': return <Wifi size={14} className="text-cyan-500" />;
                                    case 'furniture': return <FileText size={14} className="text-amber-600" />;
                                    case 'social_cases': return <Heart size={14} className="text-rose-500 fill-rose-500/10" />;
                                    default: return <Receipt size={14} className="text-slate-500" />;
                                  }
                                })();

                                return (
                                  <tr key={v.id} className={`${currentTheme.rowHover} transition-all ${isOverdue ? 'bg-rose-50/10 hover:bg-rose-50/20' : ''}`}>
                                    <td className="px-8 py-6">
                                      <span className="inline-flex items-center gap-2 px-3 py-1 bg-slate-100 rounded-full text-[10px] font-black uppercase tracking-widest text-slate-700">
                                        {categoryIcon}
                                        {t[v.category] || v.category}
                                      </span>
                                    </td>
                                    <td className="px-8 py-6">
                                      <div className="flex flex-col">
                                        <span className={`text-sm font-bold ${currentTheme.isDark ? 'text-white' : 'text-slate-800'}`}>{v.vendorName}</span>
                                        {v.category === 'social_cases' && (
                                          <div className="mt-1 flex flex-wrap items-center gap-2 text-xs">
                                            {v.aidType && (
                                              <span className="inline-block px-2 py-0.5 bg-rose-50 dark:bg-rose-950/40 text-rose-600 dark:text-rose-400 font-extrabold rounded-md text-[10px] tracking-wider uppercase">
                                                ❤️ {t[v.aidType] || v.aidType}
                                              </span>
                                            )}
                                            {v.beneficiaryStudentName && (
                                              <span className={`${currentTheme.muted} font-medium`}>
                                                {lang === 'en' ? 'Student: ' : 'Élève : '}<strong>{v.beneficiaryStudentName}</strong>
                                                {v.beneficiaryStudentGrade && ` (${getGradeDisplay(v.beneficiaryStudentGrade, lang)})`}
                                              </span>
                                            )}
                                          </div>
                                        )}
                                        {v.description && <span className={`text-xs ${currentTheme.muted} mt-0.5`}>{v.description}</span>}
                                      </div>
                                    </td>
                                    <td className="px-8 py-6 text-right">
                                      <span className={`text-sm font-black ${currentTheme.isDark ? 'text-[#E2E8F0]' : 'text-slate-700'}`}>{formatCurrency(v.amount)}</span>
                                    </td>
                                    <td className="px-8 py-6 text-right">
                                      <span className="text-sm text-slate-500">{formatCurrency(v.amountPaid || 0)}</span>
                                    </td>
                                    <td className="px-8 py-6">
                                      <span className={`text-sm font-bold flex items-center gap-1.5 ${isOverdue ? 'text-rose-600 font-extrabold' : (currentTheme.isDark ? 'text-[#CBD5E1]' : 'text-slate-600')}`}>
                                        {isOverdue && <AlertCircle size={14} className="animate-bounce" />}
                                        {v.dueDate}
                                        {isOverdue && <span className="text-[10px] uppercase font-black tracking-widest ml-1">{lang === 'en' ? 'OVERDUE' : 'EN RETARD'}</span>}
                                      </span>
                                    </td>
                                    <td className="px-8 py-6">
                                      {v.paymentStatus === 'paid' && (
                                        <span className="px-3 py-1 bg-emerald-50 text-emerald-700 border border-emerald-100 rounded-full text-[10px] font-black uppercase tracking-widest">
                                          {t.fullyPaid}
                                        </span>
                                      )}
                                      {v.paymentStatus === 'partial' && (
                                        <span className="px-3 py-1 bg-amber-50 text-amber-700 border border-amber-100 rounded-full text-[10px] font-black uppercase tracking-widest">
                                          {t.partialPaid}
                                        </span>
                                      )}
                                      {v.paymentStatus === 'unpaid' && (
                                        <span className={`px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-widest border ${isOverdue ? 'bg-rose-500 text-white border-rose-600 animate-pulse' : 'bg-rose-50 text-rose-700 border-rose-100'}`}>
                                          {t.unpaid}
                                        </span>
                                      )}
                                    </td>
                                    <td className="px-8 py-6 text-right no-print">
                                      <div className="flex justify-end gap-3">
                                        <button
                                          onClick={() => {
                                            setEditingVendorExpense(v);
                                            setVendorExpenseForm({
                                              vendorName: v.vendorName,
                                              category: v.category,
                                              amount: v.amount.toString(),
                                              dueDate: v.dueDate,
                                              paymentStatus: v.paymentStatus,
                                              amountPaid: (v.amountPaid || 0).toString(),
                                              description: v.description || '',
                                              aidType: v.aidType || '' as any,
                                              beneficiaryStudentName: v.beneficiaryStudentName || '',
                                              beneficiaryStudentGrade: v.beneficiaryStudentGrade || '',
                                            });
                                            setShowVendorExpenseModal(true);
                                          }}
                                          className="p-2 text-slate-400 hover:text-blue-600 hover:bg-slate-50 rounded-xl transition-all"
                                          title={lang === 'en' ? "Edit Expense" : "Modifier la dépense"}
                                        >
                                          <FileText size={16} />
                                        </button>
                                        <button 
                                          onClick={() => {
                                            const confirmMsg = lang === 'en'
                                              ? `Are you sure you want to delete this expense for "${v.vendorName}"?`
                                              : `Êtes-vous sûr de vouloir supprimer cette dépense pour "${v.vendorName}" ?`;
                                            if (confirm(confirmMsg)) {
                                              handleDeleteVendorExpense(v.id);
                                            }
                                          }}
                                          disabled={!isPromoter}
                                          className="p-2 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-xl transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                                          title={isPromoter ? (lang === 'en' ? "Delete Expense" : "Supprimer la dépense") : (lang === 'en' ? "Promoter only" : "Promotrice uniquement")}
                                        >
                                          <Trash2 size={16} />
                                        </button>
                                      </div>
                                    </td>
                                  </tr>
                                );
                              });
                            })()}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  </>
                );
              })()}
            </div>
          </div>
  );
}
