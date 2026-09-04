import { AnimatePresence, motion } from 'motion/react';
import { useMainViews } from '../app/mainViewsContext';
import type { TranslationDict } from '../i18n/translations';

export function DashboardView() {
  const { AlertCircle, Calendar, ChartsFallback, CheckCircle2, ChevronRight, Clock, Coins, DashboardCharts, GraduationCap, PieChart, Suspense, TrendingDown, TrendingUp, Wallet, chartData, currentTheme, formatCurrency, lateStudents, payrollWindowStatus, pieData, setSelectedStudent, stats, t, theme } = useMainViews();
  return (
          <div className="space-y-12">
            {/* Payroll Window Banner Alerts */}
            {(() => {
              const monthKeys: (keyof TranslationDict)[] = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
              const currentMonthName = t[monthKeys[payrollWindowStatus.currentCalendarMonth]];
              return (
                <div className="space-y-3 no-print">
                  {payrollWindowStatus.isOverdue && (
                    <div className="p-5 bg-rose-50 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-900/50 rounded-3xl flex items-center gap-4 text-rose-700 dark:text-rose-300 shadow-lg shadow-rose-500/5 animate-subtle-pulse">
                      <div className="p-2 bg-rose-100 dark:bg-rose-950/60 rounded-xl text-rose-600 dark:text-rose-300 flex-shrink-0">
                        <AlertCircle size={20} />
                      </div>
                      <div>
                        <h4 className="font-black text-sm">
                          {t.payrollWindowClosed.replace('{month}', currentMonthName)}
                        </h4>
                        <p className="text-xs text-rose-600/80 dark:text-rose-300/80 font-semibold mt-0.5">
                          {t.highPriorityActionRequiredToProcessCurrentMonthPayroll}
                        </p>
                      </div>
                    </div>
                  )}

                  {payrollWindowStatus.isOpen && (
                    <div className="p-5 bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-900/50 rounded-3xl flex items-center gap-4 text-blue-700 dark:text-blue-300 shadow-lg shadow-blue-500/5">
                      <div className="p-2 bg-blue-100 dark:bg-blue-950/60 rounded-xl text-blue-700 dark:text-blue-300 flex-shrink-0">
                        <Calendar size={20} />
                      </div>
                      <div>
                        <h4 className="font-black text-sm">
                          {t.payrollWindowOpen.replace('{month}', currentMonthName)}
                        </h4>
                        <p className="text-xs text-blue-600/80 dark:text-blue-300/80 font-semibold mt-0.5">
                          {t.thePayrollWindowIsActiveFromThe1stToThe10thOfTheMonth}
                        </p>
                      </div>
                    </div>
                  )}
                </div>
              );
            })()}

            {/* --- Premium KPI Cards --- */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5 no-print">
              {/* Cash Balance — Hero Card (spans 2 cols) */}
              <motion.div 
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                className="card-hero sm:col-span-2 p-7 relative group"
              >
                <div className="absolute top-0 right-0 w-40 h-40 bg-gradient-to-bl from-emerald-500/[0.06] to-transparent rounded-bl-full pointer-events-none"></div>
                <div className="flex justify-between items-start mb-5">
                  <div>
                    <p className="text-[10px] font-semibold text-white/40 uppercase tracking-[0.1em] mb-2">{t.cashBalance}</p>
                    <h3 className="text-3xl sm:text-4xl font-extrabold text-white tracking-tight" style={{ fontVariantNumeric: 'tabular-nums' }}>
                      {formatCurrency(stats.totalFees - stats.totalExpenses)}
                    </h3>
                  </div>
                  <div className="p-3 rounded-xl bg-emerald-500/[0.12] text-emerald-400 border border-emerald-500/[0.08]">
                    <Coins size={24} />
                  </div>
                </div>
                <div className="flex items-center gap-3 mt-2">
                  <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-400/80 bg-emerald-500/[0.08] px-2.5 py-1 rounded-full">
                    <TrendingUp size={12} />
                    {t.netLiquidity}
                  </span>
                </div>
              </motion.div>

              {/* Monthly Income Card */}
              <motion.div 
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.1 }}
                className={`card-stat p-6 flex flex-col justify-between ${currentTheme.isDark ? '!bg-slate-800/60 !border-white/[0.06]' : ''}`}
                style={{ ['--accent-primary' as string]: theme === 'cream' ? '#1E5E3A' : (theme === 'slate' ? '#38BDF8' : '#3b82f6') }}
              >
                <div className="flex justify-between items-start mb-3">
                  <div>
                    <p className={`text-[10px] font-semibold ${currentTheme.muted} uppercase tracking-[0.1em] mb-1.5`}>{t.incomeThisMonth}</p>
                    <h3 className={`text-2xl font-bold tracking-tight ${currentTheme.isDark ? 'text-white' : 'text-slate-800'}`} style={{ fontVariantNumeric: 'tabular-nums' }}>
                      {formatCurrency(stats.collectedMonth)}
                    </h3>
                  </div>
                  <div className={`p-2.5 rounded-xl ${theme === 'cream' ? 'bg-[#1E5E3A]/10 text-[#1E5E3A]' : (theme === 'slate' ? 'bg-sky-500/10 text-sky-400' : 'bg-blue-500/10 text-blue-600')}`}>
                    <TrendingUp size={18} />
                  </div>
                </div>
                <span className={`text-[10px] font-semibold ${currentTheme.muted} flex items-center gap-1.5 mt-1`}>
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
                  {t.monthlyInflow}
                </span>
              </motion.div>

              {/* Monthly Expenses Card */}
              <motion.div 
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.2 }}
                className={`card-stat p-6 flex flex-col justify-between ${currentTheme.isDark ? '!bg-slate-800/60 !border-white/[0.06]' : ''}`}
                style={{ ['--accent-primary' as string]: '#ef4444' }}
              >
                <div className="flex justify-between items-start mb-3">
                  <div>
                    <p className={`text-[10px] font-semibold ${currentTheme.muted} uppercase tracking-[0.1em] mb-1.5`}>{t.expensesThisMonth}</p>
                    <h3 className={`text-2xl font-bold tracking-tight ${currentTheme.isDark ? 'text-white' : 'text-slate-800'}`} style={{ fontVariantNumeric: 'tabular-nums' }}>
                      {formatCurrency(stats.expensesThisMonth)}
                    </h3>
                  </div>
                  <div className={`p-2.5 rounded-xl ${theme === 'cream' ? 'bg-rose-500/10 text-rose-700' : (theme === 'slate' ? 'bg-rose-500/10 text-rose-400' : 'bg-rose-500/10 text-rose-600')}`}>
                    <TrendingDown size={18} />
                  </div>
                </div>
                <span className={`text-[10px] font-semibold ${currentTheme.muted} flex items-center gap-1.5 mt-1`}>
                  <span className="w-1.5 h-1.5 rounded-full bg-rose-500"></span>
                  {t.monthlyOutflow}
                </span>
              </motion.div>
            </div>

            {/* --- Élèves Inscrits + Financial Overview Row --- */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5 no-print">
              {/* Enrolled Students */}
              <motion.div 
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                className={`card-stat p-6 ${currentTheme.isDark ? '!bg-slate-800/60 !border-white/[0.06]' : ''}`}
              >
                <div className="flex justify-between items-start mb-3">
                  <div>
                    <p className={`text-[10px] font-semibold ${currentTheme.muted} uppercase tracking-[0.1em] mb-1.5`}>{t.enrolledStudents}</p>
                    <h3 className={`text-2xl font-bold tracking-tight ${currentTheme.isDark ? 'text-white' : 'text-slate-800'}`}>
                      {stats.enrolledStudentsCount}
                    </h3>
                  </div>
                  <div className={`p-2.5 rounded-xl ${theme === 'cream' ? 'bg-[#1E5E3A]/10 text-[#1E5E3A]' : (theme === 'slate' ? 'bg-sky-500/10 text-sky-400' : 'bg-purple-500/10 text-purple-600')}`}>
                    <GraduationCap size={18} />
                  </div>
                </div>
                <span className={`text-[10px] font-semibold ${currentTheme.muted} flex items-center gap-1.5`}>
                  <span className="w-1.5 h-1.5 rounded-full bg-purple-500"></span>
                  {t.activeEnrolled}
                </span>
              </motion.div>

              {/* Total Impayé (Total Outstanding) */}
              <motion.div 
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.1 }}
                className={`card-stat p-6 ${currentTheme.isDark ? '!bg-slate-800/60 !border-white/[0.06]' : ''}`}
                style={{ ['--accent-primary' as string]: '#ef4444' }}
              >
                <div className="flex justify-between items-start mb-3">
                  <div>
                    <p className={`text-[10px] font-semibold ${currentTheme.muted} uppercase tracking-[0.1em] mb-1.5`}>{t.totalOutstanding}</p>
                    <h3 className={`text-2xl font-bold tracking-tight ${currentTheme.isDark ? 'text-white' : 'text-slate-800'}`} style={{ fontVariantNumeric: 'tabular-nums' }}>{formatCurrency(stats.totalOutstanding)}</h3>
                  </div>
                  <div className="p-2.5 rounded-xl bg-rose-500/10 text-rose-600">
                    <TrendingUp size={18} className="rotate-180" />
                  </div>
                </div>
                {(() => {
                  // Real month-over-month movement of the outstanding balance:
                  // (outstanding − prevOutstanding) / prevOutstanding. Hidden
                  // when there is no prior-month payment base to compare.
                  const prev = stats.prevMonthCollected || 0;
                  const nowCollected = stats.collectedMonth || 0;
                  if (prev <= 0) {
                    return (
                      <span className={`text-[10px] font-semibold ${currentTheme.muted} flex items-center gap-1.5`}>
                        <span className="w-1.5 h-1.5 rounded-full bg-slate-400" />
                        {t.outstandingNoComparison}
                      </span>
                    );
                  }
                  // Delta on COLLECTIONS: positive = collecting faster than last month (good).
                  const delta = Math.round(((nowCollected - prev) / prev) * 100);
                  const up = delta >= 0;
                  return (
                    <span className={`text-[10px] font-semibold ${currentTheme.muted} flex items-center gap-1.5`}>
                      <TrendingUp size={12} className={up ? 'text-emerald-500' : 'rotate-180 text-rose-500'} />
                      <span className={up ? 'text-emerald-500' : 'text-rose-500'}>
                        {t.outstandingVsLastMonth.replace('{delta}', up ? `+${delta}` : String(delta))}
                      </span>
                    </span>
                  );
                })()}
              </motion.div>

              {/* Parents en Retard (Late Parents) */}
              <motion.div 
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.2 }}
                className={`card-stat p-6 ${currentTheme.isDark ? '!bg-slate-800/60 !border-white/[0.06]' : ''}`}
              >
                <div className="flex justify-between items-start mb-3">
                  <div>
                    <p className={`text-[10px] font-semibold ${currentTheme.muted} uppercase tracking-[0.1em] mb-1.5`}>{t.lateParents}</p>
                    <h3 className={`text-2xl font-bold tracking-tight ${currentTheme.isDark ? 'text-white' : 'text-slate-800'}`}>
                      {stats.lateParentsCount}
                    </h3>
                  </div>
                  <div className="p-2.5 rounded-xl bg-amber-500/10 text-amber-800">
                    <Clock size={18} />
                  </div>
                </div>
                <span className={`text-[10px] font-semibold ${currentTheme.muted} flex items-center gap-1.5`}>
                  <span className="w-1.5 h-1.5 rounded-full bg-amber-500"></span>
                  {t.actionRequired}
                </span>
              </motion.div>

              {/* Total Arriérés Personnel (Staff Arrears) */}
              <motion.div 
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.3 }}
                className={`card-stat p-6 ${currentTheme.isDark ? '!bg-slate-800/60 !border-white/[0.06]' : ''}`}
                style={{ ['--accent-primary' as string]: '#ef4444' }}
              >
                <div className="flex justify-between items-start mb-3">
                  <div>
                    <p className={`text-[10px] font-semibold ${currentTheme.muted} uppercase tracking-[0.1em] mb-1.5`}>{t.totalArrears}</p>
                    <h3 className="text-2xl font-bold tracking-tight text-rose-600" style={{ fontVariantNumeric: 'tabular-nums' }}>
                      {formatCurrency(stats.totalArrears)}
                    </h3>
                  </div>
                  <div className="p-2.5 rounded-xl bg-rose-500/10 text-rose-600">
                    <AlertCircle size={18} />
                  </div>
                </div>
                <span className={`text-[10px] font-semibold ${currentTheme.muted} flex items-center gap-1.5`}>
                  <span className="w-1.5 h-1.5 rounded-full bg-rose-500"></span>
                  {t.unpaidInstallments}
                </span>
              </motion.div>
            </div>

            {/* --- Collecté ce Mois (single) --- */}
            <div className="grid grid-cols-1 gap-5 no-print">
              {(() => {
                const prevCollected = stats.prevMonthCollected || 0;
                const goalPercent = prevCollected > 0
                  ? Math.min(999, Math.round((stats.collectedMonth / prevCollected) * 100))
                  : 100;
                return (
                  <motion.div 
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    className={`card-elevated p-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4 ${currentTheme.isDark ? '!bg-slate-800/60 !border-white/[0.06]' : ''}`}
                  >
                    <div className="flex-1">
                      <p className={`text-[10px] font-semibold ${currentTheme.muted} uppercase tracking-[0.1em] mb-1.5`}>{t.collectedMonth}</p>
                      <h3 className={`text-3xl font-bold tracking-tight ${currentTheme.isDark ? 'text-white' : 'text-slate-800'}`} style={{ fontVariantNumeric: 'tabular-nums' }}>{formatCurrency(stats.collectedMonth)}</h3>
                      <div className="mt-3 max-w-xs">
                        <div className="flex items-center justify-between text-xs font-semibold mb-1">
                          <span className={currentTheme.muted}>{t.monthlyGoal}</span>
                          <span className="text-emerald-500">{goalPercent}%</span>
                        </div>
                        <div className={`h-2 rounded-full overflow-hidden ${currentTheme.isDark ? 'bg-slate-700/60' : 'bg-slate-200'}`}>
                          <motion.div
                            initial={{ width: 0 }}
                            animate={{ width: `${Math.min(100, goalPercent)}%` }}
                            transition={{ duration: 0.8, ease: 'easeOut' }}
                            className="h-full rounded-full bg-gradient-to-r from-emerald-500 to-emerald-400"
                          />
                        </div>
                        <p className={`text-[10px] ${currentTheme.muted} mt-1 font-semibold`}>{t.ofGoal.replace('{percent}', String(goalPercent))}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 text-emerald-500 text-sm font-semibold">
                      <TrendingUp size={16} />
                      <span>{goalPercent}%</span>
                    </div>
                  </motion.div>
                );
              })()}
            </div>

            {/* --- Analytics Section --- */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <Suspense fallback={<ChartsFallback isDark={currentTheme.isDark} />}>
                <DashboardCharts chartData={chartData} pieData={pieData} t={t} currentTheme={currentTheme} />
              </Suspense>
            </div>

            {/* --- Late Payments List --- */}
            <div className={`card-elevated overflow-hidden ${currentTheme.isDark ? '!bg-slate-800/60 !border-white/[0.06]' : ''}`}>
              <div className={`px-6 py-5 border-b ${currentTheme.isDark ? 'border-white/[0.06]' : currentTheme.border} flex justify-between items-center`}>
                <h3 className={`text-sm font-semibold ${currentTheme.isDark ? 'text-white' : 'text-slate-800'} tracking-tight`}>{t.lateParents}</h3>
                <span className="bg-rose-500/10 text-rose-600 px-3 py-1 rounded-full text-[10px] font-semibold uppercase tracking-[0.08em]">
                  Urgent
                </span>
              </div>

              {lateStudents.length > 0 ? (
                <div className={`divide-y ${currentTheme.border}`}>
                  {lateStudents.map(s => {
                    const discount = s.scholarshipDiscount || 0;
                    const discountedTotal = s.totalDue * (1 - discount / 100);
                    const balance = discountedTotal - s.amountPaid;
                    return (
                      <div 
                        key={s.id} 
                        onClick={() => setSelectedStudent(s)}
                        className={`p-6 ${currentTheme.rowHover} transition-all cursor-pointer flex items-center justify-between group`}
                      >
                        <div className="flex items-center gap-4">
                          <div className={`w-12 h-12 rounded-2xl ${currentTheme.isDark ? 'bg-emerald-900/20 text-emerald-500' : 'bg-slate-100 text-slate-600'} flex items-center justify-center font-bold group-hover:bg-blue-600 group-hover:text-white transition-all`}>
                            {s.name.charAt(0)}
                          </div>
                          <div>
                            <h4 className={`font-bold ${currentTheme.isDark ? 'text-emerald-500' : 'text-slate-800'}`}>{s.name}</h4>
                            <p className={`text-xs ${currentTheme.muted} font-medium`}>{s.parentName}</p>
                          </div>
                        </div>
                        <div className="text-right">
                          <p className="text-sm font-black text-rose-600">{formatCurrency(balance)}</p>
                          <p className={`text-[10px] ${currentTheme.muted} font-bold uppercase tracking-widest`}>{t.balance}</p>
                        </div>
                        <ChevronRight className={`${currentTheme.muted} group-hover:text-blue-600 group-hover:translate-x-1 transition-all`} size={20} />
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="p-20 flex flex-col items-center justify-center text-center">
                  <div className="w-20 h-20 rounded-full bg-emerald-50 dark:bg-emerald-950/40 flex items-center justify-center text-emerald-500 dark:text-emerald-300 mb-6">
                    <CheckCircle2 size={40} />
                  </div>
                  <h4 className={`text-xl font-bold ${currentTheme.isDark ? 'text-emerald-400' : 'text-slate-800'} mb-2`}>{t.allUpToDate}</h4>
                  <p className={`${currentTheme.muted} max-w-xs mx-auto text-sm`}>{t.allAccountsSettled}</p>
                </div>
              )}
            </div>

            {/* --- Cash Flow Summary --- */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
              <motion.div 
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                className={`${currentTheme.card} p-8 rounded-[2rem] border ${currentTheme.border} shadow-xl shadow-slate-200/50`}
              >
                <div className="flex items-center gap-4 mb-8">
                  <div className="p-3 bg-emerald-100 dark:bg-emerald-950/60 text-emerald-600 dark:text-emerald-300 rounded-2xl">
                    <PieChart size={24} />
                  </div>
                  <h3 className={`text-xl font-bold ${currentTheme.isDark ? 'text-emerald-400' : 'text-slate-800'}`}>{t.cashFlowSummary}</h3>
                </div>

                <div className="space-y-6">
                  <div className="flex justify-between items-center">
                    <span className={currentTheme.muted}>{t.totalFeesCollected}</span>
                    <span className={`font-bold ${currentTheme.isDark ? 'text-emerald-400' : 'text-slate-800'}`}>{formatCurrency(stats.totalFees)}</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className={currentTheme.muted}>{t.totalExpensesPaid}</span>
                    <span className="font-bold text-rose-500">-{formatCurrency(stats.totalExpenses)}</span>
                  </div>
                  <div className={`pt-6 border-t ${currentTheme.border} flex justify-between items-center`}>
                    <span className={`font-black uppercase tracking-widest text-xs ${currentTheme.isDark ? 'text-emerald-400' : 'text-slate-800'}`}>{t.netProfit}</span>
                    <span className={`text-2xl font-black ${stats.totalFees - stats.totalExpenses >= 0 ? 'text-emerald-500' : 'text-rose-500'}`}>
                      {formatCurrency(stats.totalFees - stats.totalExpenses)}
                    </span>
                  </div>
                </div>
              </motion.div>

              <motion.div 
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ delay: 0.1 }}
                className={`${currentTheme.card} p-8 rounded-[2rem] border ${currentTheme.border} shadow-xl shadow-slate-200/50 flex flex-col justify-center items-center text-center`}
              >
                <div className={`w-20 h-20 rounded-full ${stats.totalFees - stats.totalExpenses >= 0 ? 'bg-emerald-100 dark:bg-emerald-950/60 text-emerald-600 dark:text-emerald-300' : 'bg-rose-100 dark:bg-rose-950/60 text-rose-600 dark:text-rose-300'} flex items-center justify-center mb-6`}>
                  <Wallet size={40} />
                </div>
                <h4 className={`text-lg font-bold ${currentTheme.isDark ? 'text-emerald-400' : 'text-slate-800'} mb-2`}>
                  {stats.totalFees - stats.totalExpenses >= 0 ? (t.healthyBalance) : (t.deficitWarning)}
                </h4>
                <p className={`${currentTheme.muted} text-sm max-w-[250px]`}>
                  {stats.totalFees - stats.totalExpenses >= 0 
                    ? (t.yourSchoolIsCurrentlyOperatingWithAPositiveCashFlow)
                    : (t.expensesAreExceedingIncomeReviewYourSpending)}
                </p>
              </motion.div>
            </div>
          </div>
  );
}
