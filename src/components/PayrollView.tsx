import { useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { useMainViews } from '../app/mainViewsContext';
import type { Staff } from '../lib/useSupabaseData';
import { sameYearMonth } from '../lib/dateWindows';
import { ConfirmDialog } from './ConfirmDialog';

export function PayrollView() {
  const [confirmDeleteStaff, setConfirmDeleteStaff] = useState<Staff | null>(null);
  const { AlertCircle, Download, FileText, Globe, HighlightText, Mail, Phone, Plus, Receipt, Search, ShieldCheck, Trash2, currentMonth, currentTheme, deleteStaff, filteredStaff, formatCurrency, generateStaffPayslipPdf, getMonthName, handleExportStaffReceiptPdf, lang, openEditStaffModal, salaryForm, salaryPayments, setEditingStaff, setSalaryForm, setSelectedDraftMonth, setSelectedDraftYear, setShowMonthlyDraftModal, setShowSalaryModal, setShowStaffModal, setStaffForm, setStaffModalMode, setStaffSearchTerm, setVisibleBankDetails, staff, staffSearchTerm, t, visibleBankDetails } = useMainViews();
  const currentYear = new Date().getFullYear();
  return (
    <>
          <div className="space-y-8">
            {/* Print Summary */}
            <div className="hidden print:block mb-8 p-6 bg-slate-50 border-2 border-slate-200 rounded-2xl">
              <h4 className="text-sm font-black uppercase tracking-widest text-slate-800 mb-4">{t.payroll} - {getMonthName(currentMonth)}</h4>
              <div className="grid grid-cols-4 gap-4 text-[10px] font-black uppercase tracking-widest text-slate-500 border-b border-slate-200 pb-2">
                <span>{t.staffName}</span>
                <span>{t.monthlySalary}</span>
                <span>{t.installment}</span>
                <span>{t.remainingBalance}</span>
              </div>
              <div className="divide-y divide-slate-100">
                {staff.map(s => {
                  const paymentsThisMonth = salaryPayments.filter(p => p.staffId === s.id && sameYearMonth(p.date, currentYear, currentMonth));
                  const paidThisMonth = paymentsThisMonth.reduce((sum, p) => sum + p.amount, 0);
                  const balance = s.salary - paidThisMonth;
                  return (
                    <div key={s.id} className="grid grid-cols-4 gap-4 py-3 text-xs">
                      <span className="font-bold text-slate-800">{s.name}</span>
                      <span className="text-slate-600">{formatCurrency(s.salary)}</span>
                      <span className="text-emerald-600 font-bold">{formatCurrency(paidThisMonth)}</span>
                      <span className={balance > 0 ? "text-rose-600 font-bold" : "text-slate-400"}>{formatCurrency(balance)}</span>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* 12-Month Payroll Summary Grid */}
            <div className={`${currentTheme.card} p-8 rounded-[2rem] border ${currentTheme.border} shadow-xl shadow-slate-200/50 no-print`}>
              <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-6">
                <div>
                  <h4 className={`text-lg font-black ${currentTheme.isDark ? 'text-emerald-400' : 'text-slate-800'}`}>
                    {t.automaticPayrollAudit}
                  </h4>
                  <p className={`text-xs ${currentTheme.muted} mt-1`}>
                    {t.n12MonthPayrollTrackingForTheCurrentCalendarYear}
                  </p>
                </div>
                <div className="flex flex-wrap gap-4 text-[10px] font-black uppercase tracking-widest">
                  <div className="flex items-center gap-1.5">
                    <div className="w-2.5 h-2.5 rounded-full bg-emerald-500"></div>
                    <span className={currentTheme.muted}>{t.fullPayment}</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <div className="w-2.5 h-2.5 rounded-full bg-amber-500"></div>
                    <span className={currentTheme.muted}>{t.partial2}</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <div className="w-2.5 h-2.5 rounded-full bg-rose-500 animate-pulse"></div>
                    <span className={currentTheme.muted}>{t.missing}</span>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-12 gap-4">
                {['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'].map((monthKey, index) => {
                  const currentCalendarYear = new Date().getFullYear();
                  const currentCalendarMonth = new Date().getMonth();
                  const isFuture = index > currentCalendarMonth;
                  const monthName = (t as Record<string, string>)[monthKey];

                  // calculate payroll status for this month
                  const monthPayments = salaryPayments.filter(p => {
                    const payDate = new Date(p.date);
                    return payDate.getFullYear() === currentCalendarYear && payDate.getMonth() === index;
                  });
                  const totalPaid = monthPayments.reduce((sum, p) => sum + p.amount, 0);
                  const totalExpected = staff.reduce((sum, s) => sum + s.salary, 0);

                  let boxClass = "";
                  let statusText = "";
                  
                  if (isFuture) {
                    boxClass = `${currentTheme.isDark ? 'bg-emerald-950/10 border-emerald-950/20 text-emerald-500/80' : 'bg-slate-50 border-slate-100 text-slate-500'}`;
                    statusText = t.scheduled;
                  } else if (totalPaid === 0) {
                    boxClass = "bg-rose-500 text-white border-rose-600 animate-pulse shadow-lg shadow-rose-500/20";
                    statusText = t.unpaid;
                  } else if (totalPaid >= totalExpected) {
                    boxClass = "bg-emerald-600 text-white border-emerald-700 shadow-lg shadow-emerald-600/20";
                    statusText = t.settle;
                  } else {
                    boxClass = "bg-amber-500 text-amber-950 border-amber-600 shadow-lg shadow-amber-500/20";
                    statusText = t.partial2;
                  }

                  return (
                    <div 
                      key={index} 
                      onClick={() => {
                        setSelectedDraftMonth(index);
                        setSelectedDraftYear(currentCalendarYear);
                        setShowMonthlyDraftModal(true);
                      }}
                      className={`${boxClass} p-4 rounded-2xl border flex flex-col items-center justify-center text-center transition-all hover:scale-[1.05] cursor-pointer shadow-sm`}
                      title={t.clickToViewDraft.replace('{month}', monthName)}
                    >
                      <span className="text-xs font-black uppercase tracking-wider">{monthName.substring(0, 3)}</span>
                      <span className="text-[9px] font-bold opacity-85 mt-1.5">{statusText}</span>
                      {totalPaid > 0 && (
                        <span className="text-[8px] font-mono mt-1 font-bold opacity-75">{formatCurrency(totalPaid)}</span>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-6 no-print">
              <div>
                <h3 className={`text-2xl font-bold ${currentTheme.isDark ? 'text-emerald-400' : 'text-slate-800'}`}>{t.staffDirectory}</h3>
                <p className={`text-sm ${currentTheme.muted}`}>{t.manageEmployeeProfilesAndPayroll}</p>
              </div>
              <div className="flex flex-col sm:flex-row gap-4 w-full md:w-auto">
                <div className="relative flex-1 sm:w-80">
                  <Search className={`absolute left-4 top-1/2 -translate-y-1/2 ${currentTheme.muted}`} size={18} />
                  <input 
                    type="text" 
                    placeholder={t.staffSearchPlaceholder}
                    value={staffSearchTerm}
                    onChange={(e) => setStaffSearchTerm(e.target.value)}
                    className={`w-full pl-12 pr-6 py-3 ${currentTheme.card} border ${currentTheme.border} rounded-2xl focus:outline-none focus:ring-4 focus:ring-blue-500/5 focus:border-blue-500 transition-all text-sm font-semibold ${currentTheme.isDark ? 'text-emerald-500' : 'text-slate-800'}`}
                  />
                </div>
                <button 
                  onClick={() => {
                    setSelectedDraftMonth(new Date().getMonth());
                    setSelectedDraftYear(new Date().getFullYear());
                    setShowMonthlyDraftModal(true);
                  }}
                  className="px-5 py-3 rounded-2xl border border-emerald-600/30 text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-950/20 text-xs font-bold transition-all flex items-center gap-2"
                  title={t.openMonthlyPayrollDraft}
                >
                  <FileText size={16} />
                  <span>{t.monthlyDraft}</span>
                </button>
                <button 
                  onClick={() => {
                    setEditingStaff(null);
                    setStaffModalMode('employee');
                    setStaffForm({ name: '', position: '', salary: '', email: '', phone: '', bankDetails: '', emergencyContact: '' });
                    setShowStaffModal(true);
                  }}
                  className={`${currentTheme.accentBg} text-white px-6 py-3 rounded-2xl text-sm font-bold ${currentTheme.accentHover} transition-all flex items-center gap-2 shadow-lg ${currentTheme.accentShadow}`}
                >
                  <Plus size={18} />
                  {t.addStaff}
                </button>
                <button 
                  onClick={() => {
                    setEditingStaff(null);
                    setStaffModalMode('admin');
                    setStaffForm({ name: '', position: '', salary: '', email: '', phone: '', bankDetails: '', emergencyContact: '' });
                    setShowStaffModal(true);
                  }}
                  className="bg-violet-600 hover:bg-violet-700 text-white px-6 py-3 rounded-2xl text-sm font-bold transition-all flex items-center gap-2 shadow-lg shadow-violet-500/20"
                >
                  <ShieldCheck size={18} />
                  {t.addAdminMember}
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
              {filteredStaff.map(s => {
                const paymentsThisMonth = salaryPayments.filter(p => p.staffId === s.id && sameYearMonth(p.date, currentYear, currentMonth));
                const paidThisMonth = paymentsThisMonth.reduce((sum, p) => sum + p.amount, 0);
                const balance = s.salary - paidThisMonth;
                const payDatePassed = new Date().getDate() > 25;
                
                let statusColor = "";
                let statusLabel = "";
                
                if (paidThisMonth === 0) {
                  if (payDatePassed) {
                    statusColor = "bg-rose-700 text-white shadow-lg shadow-rose-700/40 border-rose-800";
                    statusLabel = t.unpaid;
                  } else {
                    statusColor = `${currentTheme.card} border ${currentTheme.border}`;
                    statusLabel = t.unpaid;
                  }
                } else if (balance > 0) {
                  statusColor = "bg-amber-700 text-white shadow-lg shadow-amber-700/40 border-amber-800";
                  statusLabel = t.partialPaid;
                } else {
                  statusColor = "bg-emerald-700 text-white shadow-lg shadow-emerald-700/40 border-emerald-800";
                  statusLabel = t.fullyPaid;
                }

                const isBankVisible = visibleBankDetails[s.id];

                return (
                  <motion.div 
                    key={s.id}
                    initial={{ opacity: 0, scale: 0.95 }}
                    animate={{ opacity: 1, scale: 1 }}
                    className={`${statusColor} p-8 rounded-[2rem] border transition-all group relative`}
                  >
                    <div className="flex items-start justify-between mb-6">
                      <div className="flex items-center gap-4">
                        <div className={`w-14 h-14 rounded-2xl ${paidThisMonth > 0 || payDatePassed ? 'bg-white/20 text-white' : (currentTheme.isDark ? 'bg-emerald-900/20 text-emerald-500' : 'bg-slate-100 text-slate-600')} flex items-center justify-center font-bold text-xl`}>
                          {s.name.charAt(0)}
                        </div>
                        <div>
                          <h4 className={`font-bold ${paidThisMonth > 0 || payDatePassed ? 'text-white' : (currentTheme.isDark ? 'text-emerald-500' : 'text-slate-800')}`}>
                            <HighlightText text={s.name} highlight={staffSearchTerm} />
                          </h4>
                          <p className={`text-xs ${paidThisMonth > 0 || payDatePassed ? 'text-white/70' : currentTheme.muted} font-bold uppercase tracking-widest`}>{s.position}</p>
                        </div>
                      </div>
                      <div className="flex gap-2">
                        <a 
                          href={`tel:${s.phone}`}
                          className={`p-2 rounded-xl ${paidThisMonth > 0 || payDatePassed ? 'bg-white/20 text-white hover:bg-white/30' : 'bg-slate-50 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:text-blue-600'} transition-all`}
                        >
                          <Phone size={16} />
                        </a>
                        <a 
                          href={`mailto:${s.email}`}
                          className={`p-2 rounded-xl ${paidThisMonth > 0 || payDatePassed ? 'bg-white/20 text-white hover:bg-white/30' : 'bg-slate-50 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:text-blue-600'} transition-all`}
                        >
                          <Mail size={16} />
                        </a>
                      </div>
                    </div>
                    
                    <div className="space-y-4">
                      <div className="flex justify-between items-center">
                        <span className={paidThisMonth > 0 || payDatePassed ? 'text-white/70' : currentTheme.muted}>{t.monthlySalary}</span>
                        <span className={`font-bold ${paidThisMonth > 0 || payDatePassed ? 'text-white' : (currentTheme.isDark ? 'text-emerald-400' : 'text-slate-800')}`}>{formatCurrency(s.salary)}</span>
                      </div>
                      
                      {/* Contact Details */}
                      <div className={`pt-4 border-t ${paidThisMonth > 0 || payDatePassed ? 'border-white/10' : currentTheme.border} space-y-3`}>
                        <div className="flex items-center gap-3 text-xs">
                          <Phone size={14} className={paidThisMonth > 0 || payDatePassed ? 'text-white/80' : currentTheme.muted} />
                          <span className={paidThisMonth > 0 || payDatePassed ? 'text-white/80' : 'text-slate-600'}>
                            <HighlightText text={s.phone} highlight={staffSearchTerm} />
                          </span>
                        </div>
                        <div className="flex items-center gap-3 text-xs">
                          <Mail size={14} className={paidThisMonth > 0 || payDatePassed ? 'text-white/80' : currentTheme.muted} />
                          <span className={paidThisMonth > 0 || payDatePassed ? 'text-white/80' : 'text-slate-600'}>{s.email}</span>
                        </div>
                        <div className="flex items-center gap-3 text-xs">
                          <AlertCircle size={14} className={paidThisMonth > 0 || payDatePassed ? 'text-white/80' : currentTheme.muted} />
                          <span className={paidThisMonth > 0 || payDatePassed ? 'text-white/80' : 'text-slate-600'}>
                            <span className="font-bold mr-1">{t.emergencyContact}:</span> {s.emergencyContact}
                          </span>
                        </div>
                      </div>

                      {/* Bank Details with Privacy Toggle */}
                      <div className={`p-4 rounded-2xl ${paidThisMonth > 0 || payDatePassed ? 'bg-white/10' : (currentTheme.isDark ? 'bg-emerald-900/10' : 'bg-slate-50')} border ${paidThisMonth > 0 || payDatePassed ? 'border-white/10' : currentTheme.border}`}>
                        <div className="flex justify-between items-center mb-2">
                          <span className={`text-[10px] font-black uppercase tracking-widest ${paidThisMonth > 0 || payDatePassed ? 'text-white/80' : currentTheme.muted}`}>{t.bankDetails}</span>
                          <button 
                            onClick={() => setVisibleBankDetails(prev => ({ ...prev, [s.id]: !prev[s.id] }))}
                            className={`p-1 rounded-lg ${paidThisMonth > 0 || payDatePassed ? 'hover:bg-white/10 text-white/80' : 'hover:bg-slate-200 text-slate-400'} transition-all`}
                            title={isBankVisible ? t.hideBankDetails : t.showBankDetails}
                          >
                            <Globe size={14} />
                          </button>
                        </div>
                        <p className={`text-xs font-mono font-bold ${paidThisMonth > 0 || payDatePassed ? 'text-white' : 'text-slate-700'}`}>
                          {isBankVisible ? s.bankDetails : '•••• •••• •••• •••• ••••'}
                        </p>
                      </div>

                      {paidThisMonth > 0 && (
                        <div className="flex justify-between items-center">
                          <span className={paidThisMonth > 0 || payDatePassed ? 'text-white/70' : currentTheme.muted}>{t.installment}</span>
                          <span className="font-bold text-white">{formatCurrency(paidThisMonth)}</span>
                        </div>
                      )}

                      {balance > 0 && (
                        <div className="flex justify-between items-center pt-2 border-t border-white/20">
                          <span className={paidThisMonth > 0 || payDatePassed ? 'text-white/70' : currentTheme.muted}>{t.remainingBalance}</span>
                          <span className={`font-black ${paidThisMonth > 0 || payDatePassed ? 'text-white' : 'text-rose-600'}`}>{formatCurrency(balance)}</span>
                        </div>
                      )}

                      {/* Ledger View (Mini) */}
                      {paymentsThisMonth.length > 0 && (
                        <div className="mt-4 pt-4 border-t border-white/10 space-y-2">
                          <p className={`text-[10px] font-black uppercase tracking-widest ${paidThisMonth > 0 || payDatePassed ? 'text-white/80' : currentTheme.muted}`}>{t.paymentHistory}</p>
                          {paymentsThisMonth.map(p => (
                            <div key={p.id} className="flex justify-between text-[10px] font-bold">
                              <span className={paidThisMonth > 0 || payDatePassed ? 'text-white/60' : currentTheme.muted}>{p.date}</span>
                              <span className={paidThisMonth > 0 || payDatePassed ? 'text-white' : 'text-emerald-600'}>{formatCurrency(p.amount)}</span>
                            </div>
                          ))}
                        </div>
                      )}

                      <div className={`pt-4 border-t ${paidThisMonth > 0 || payDatePassed ? 'border-white/20' : currentTheme.border} flex gap-2`}>
                        <button 
                          onClick={() => openEditStaffModal(s)}
                          className={`flex-1 py-2 rounded-xl border ${paidThisMonth > 0 || payDatePassed ? 'border-white/30 text-white hover:bg-white/10' : 'border-slate-100 text-slate-600 hover:bg-slate-50'} text-xs font-bold transition-all`}
                        >
                          {t.edit}
                        </button>
                        {balance > 0 && (
                          <button 
                            onClick={() => {
                              setSalaryForm({ ...salaryForm, staffId: s.id, amount: balance.toString() });
                              setShowSalaryModal(true);
                            }}
                            className={`flex-1 py-2 rounded-xl ${paidThisMonth > 0 || payDatePassed ? 'bg-white text-slate-800 hover:bg-white/90' : `${currentTheme.accentBg} text-white ${currentTheme.accentHover}`} text-xs font-bold transition-all shadow-md`}
                          >
                            {t.recordSalary}
                          </button>
                        )}
                        <button 
                          onClick={() => handleExportStaffReceiptPdf(s)}
                          className={`p-2 rounded-xl border ${paidThisMonth > 0 || payDatePassed ? 'border-white/30 text-white hover:bg-white/10' : 'border-slate-100 text-slate-600 hover:bg-emerald-50'} text-xs font-bold transition-all`}
                          title={t.downloadReceiptPdf}
                        >
                          <Download size={16} />
                        </button>
                        <button 
                          onClick={() => setConfirmDeleteStaff(s)}
                          className={`p-2 rounded-xl border ${paidThisMonth > 0 || payDatePassed ? 'border-white/30 text-white hover:bg-rose-500/30' : 'border-rose-100 text-rose-500 hover:bg-rose-50'} text-xs font-bold transition-all`}
                          title={t.deleteStaffMember}
                        >
                          <Trash2 size={16} />
                        </button>
                      </div>
                    </div>

                    <div className="absolute top-4 right-4">
                      <span className={`text-[8px] font-black uppercase tracking-widest px-2 py-1 rounded-full ${paidThisMonth > 0 || payDatePassed ? 'bg-white/20 text-white' : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300'}`}>
                        {statusLabel}
                      </span>
                    </div>
                  </motion.div>
                );
              })}
            </div>

            {/* Salary History */}
            <div className={`${currentTheme.card} rounded-[2rem] border ${currentTheme.border} shadow-xl shadow-slate-200/50 overflow-hidden`}>
              <div className="p-8 border-b border-slate-100">
                <h3 className={`text-xl font-bold ${currentTheme.isDark ? 'text-emerald-400' : 'text-slate-800'}`}>{t.payrollHistory}</h3>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className={`${currentTheme.isDark ? 'bg-emerald-900/20' : 'bg-slate-50/50'} ${currentTheme.muted} text-[10px] font-black uppercase tracking-[0.2em]`}>
                      <th className="px-8 py-6">{t.staffName}</th>
                      <th className="px-8 py-6">{t.date}</th>
                      <th className="px-8 py-6">{t.amount}</th>
                      <th className="px-8 py-6 text-right">{t.actions}</th>
                    </tr>
                  </thead>
                  <tbody className={`divide-y ${currentTheme.border}`}>
                    {salaryPayments.length > 0 ? salaryPayments.map(p => {
                      const staffMember = staff.find(s => s.id === p.staffId);
                      return (
                        <tr key={p.id} className={`${currentTheme.rowHover} transition-all`}>
                          <td className="px-8 py-6">
                            <span className={`font-bold ${currentTheme.isDark ? 'text-emerald-500' : 'text-slate-800'}`}>{staffMember?.name || (t.unknown)}</span>
                          </td>
                          <td className="px-8 py-6">
                            <span className={`text-sm ${currentTheme.muted}`}>{p.date}</span>
                          </td>
                          <td className="px-8 py-6">
                            <span className="text-sm font-black text-emerald-600">{formatCurrency(p.amount)}</span>
                          </td>
                          <td className="px-8 py-6 text-right">
                            {staffMember && (
                              <button
                                onClick={() => generateStaffPayslipPdf({ staffMember, payment: p, lang })}
                                className="px-3 py-1.5 bg-slate-800 hover:bg-slate-900 text-white rounded-xl text-xs font-bold transition-all shadow-sm flex items-center gap-1.5 ml-auto active:scale-95"
                                title={t.downloadPayslipPdf}
                              >
                                <Receipt size={12} /> {t.payslip}
                              </button>
                            )}
                          </td>
                        </tr>
                      );
                    }) : (
                      <tr>
                        <td colSpan={4} className="px-8 py-12 text-center text-slate-400 italic">{t.noPaymentsRecordedYet}</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

        <ConfirmDialog
          open={!!confirmDeleteStaff}
          title={t.deleteStaffMember}
          message={t.deleteStaffConfirm.replace('{name}', confirmDeleteStaff?.name || '')}
          confirmLabel={t.deleteStaffMember}
          cancelLabel={t.cancel}
          onConfirm={() => {
            if (confirmDeleteStaff) {
              deleteStaff(confirmDeleteStaff.id);
            }
            setConfirmDeleteStaff(null);
          }}
          onCancel={() => setConfirmDeleteStaff(null)}
          currentTheme={currentTheme}
        />
    </>
  );
}
