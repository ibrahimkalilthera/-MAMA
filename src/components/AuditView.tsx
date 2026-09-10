/**
 * Audit trail view (tamper-evident activity log) — extracted verbatim from
 * MainViews.tsx. Admin/dev only; reads its data through the MainViewsContext.
 */
import { useState } from 'react';
import { ChevronDown, Download, History, ShieldCheck } from 'lucide-react';
import { useMainViews } from '../app/mainViewsContext';

export function AuditView() {
  const { t, lang, currentTheme, auditLogs, fetchAuditLogs, auth } = useMainViews();
  // The audit tab is admin/dev-only (sidebar hides it for other roles too).
  const [roleFilter, setRoleFilter] = useState('all');
  const [actionFilter, setActionFilter] = useState('all');
  const [replayOnly, setReplayOnly] = useState(false);
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');

  if (!auth?.isAdmin) return null;

  const roles = Array.from(new Set(auditLogs.map((log) => log.userRole || 'staff'))).sort();
  const fromMs = fromDate ? new Date(`${fromDate}T00:00:00`).getTime() : null;
  const toMs = toDate ? new Date(`${toDate}T23:59:59.999`).getTime() : null;
  const filtered = auditLogs.filter((log) => {
    const roleOk = roleFilter === 'all' || (log.userRole || 'staff') === roleFilter;
    const actionOk = actionFilter === 'all' || log.action.startsWith(actionFilter) || (actionFilter === 'UPDATE' && log.action === 'PROMOTE_CLASS_BATCH');
    const replayOk = !replayOnly || (log.details || '').includes('[replay]');
    const ts = new Date(log.createdAt).getTime();
    const dateOk = (fromMs === null || ts >= fromMs) && (toMs === null || ts <= toMs);
    return roleOk && actionOk && replayOk && dateOk;
  });

  // CSV export of the CURRENT filtered view (BOM for Excel's accent handling).
  const downloadCsv = () => {
    const esc = (v: string | null | undefined) => `"${(v ?? '').replace(/"/g, '""')}"`;
    const header = [t.timestamp, t.actions, t.staffUser, t.auditExportRole, t.details];
    const rows = filtered.map((log) => [
      new Date(log.createdAt).toLocaleString(lang === 'fr' ? 'fr-FR' : 'en-US'),
      log.action,
      `${log.userName || ''}${log.userEmail ? ` (${log.userEmail})` : ''}`,
      log.userRole || '',
      log.details || '',
    ]);
    const csv = [header, ...rows].map((r) => r.map(esc).join(',')).join('\r\n');
    const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `audit-log-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };
  return (
          <div className="space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div>
                <h2 className="text-xl font-black tracking-tight flex items-center gap-2">
                  <ShieldCheck className="text-emerald-500" size={24} />
                  <span>{t.systemAuditTrailSecurityLogs}</span>
                </h2>
                <p className={`text-xs ${currentTheme.muted} mt-1`}>
                  {t.tamperEvidentActivityLogTrackingPaymentsExpensesAndStaffActionsInBamako}
                </p>
              </div>
              <div className="flex items-center gap-3">
                <button
                  onClick={downloadCsv}
                  disabled={filtered.length === 0}
                  className={`px-4 py-2 rounded-xl text-xs font-bold transition-all shadow-sm flex items-center gap-2 active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed ${currentTheme.card} border ${currentTheme.border} ${currentTheme.text} hover:opacity-80`}
                >
                  <Download size={14} />
                  <span>{t.exportCsv}</span>
                </button>
                <button
                  onClick={() => fetchAuditLogs()}
                  className="px-4 py-2 bg-slate-800 hover:bg-slate-900 text-white rounded-xl text-xs font-bold transition-all shadow-sm flex items-center gap-2 self-start sm:self-auto active:scale-95"
                >
                  <span>{t.refreshLogs}</span>
                </button>
              </div>
            </div>

            <div className="flex flex-col sm:flex-row flex-wrap items-start sm:items-center justify-between gap-3 no-print">
              <div className="flex flex-wrap items-center gap-3">
                <div className="relative">
                  <select
                    value={roleFilter}
                    onChange={(e) => setRoleFilter(e.target.value)}
                    aria-label={t.auditFilterAllRoles}
                    className={`appearance-none cursor-pointer pl-4 pr-10 py-2.5 ${currentTheme.card} border ${currentTheme.border} rounded-xl focus:outline-none focus:ring-4 focus:ring-blue-500/5 focus:border-blue-500 transition-all text-xs font-bold ${currentTheme.isDark ? 'text-emerald-500' : 'text-slate-800'}`}
                  >
                    <option value="all">{t.auditFilterAllRoles}</option>
                    {roles.map((role) => (
                      <option key={role} value={role}>{role}</option>
                    ))}
                  </select>
                  <ChevronDown size={14} className={`absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none ${currentTheme.muted}`} />
                </div>
                <div className="relative">
                  <select
                    value={actionFilter}
                    onChange={(e) => setActionFilter(e.target.value)}
                    aria-label={t.auditFilterAction}
                    className={`appearance-none cursor-pointer pl-4 pr-10 py-2.5 ${currentTheme.card} border ${currentTheme.border} rounded-xl focus:outline-none focus:ring-4 focus:ring-blue-500/5 focus:border-blue-500 transition-all text-xs font-bold ${currentTheme.isDark ? 'text-emerald-500' : 'text-slate-800'}`}
                  >
                    <option value="all">{t.auditFilterAllActions}</option>
                    <option value="ADD">{t.auditFilterGroupAdd}</option>
                    <option value="UPDATE">{t.auditFilterGroupUpdate}</option>
                    <option value="DELETE">{t.auditFilterGroupDelete}</option>
                    <option value="RECORD">{t.auditFilterGroupRecord}</option>
                  </select>
                  <ChevronDown size={14} className={`absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none ${currentTheme.muted}`} />
                </div>
                <div className="flex items-center gap-2">
                  <span className={`text-[10px] font-black uppercase tracking-wider ${currentTheme.muted}`}>{t.auditFilterFrom}</span>
                  <input
                    type="date"
                    value={fromDate}
                    onChange={(e) => setFromDate(e.target.value)}
                    aria-label={t.auditFilterFrom}
                    className={`${currentTheme.card} border ${currentTheme.border} rounded-xl px-3 py-2 text-xs font-bold ${currentTheme.isDark ? 'text-emerald-500' : 'text-slate-800'} focus:outline-none focus:ring-4 focus:ring-blue-500/5 focus:border-blue-500 transition-all`}
                  />
                </div>
                <div className="flex items-center gap-2">
                  <span className={`text-[10px] font-black uppercase tracking-wider ${currentTheme.muted}`}>{t.auditFilterTo}</span>
                  <input
                    type="date"
                    value={toDate}
                    onChange={(e) => setToDate(e.target.value)}
                    aria-label={t.auditFilterTo}
                    className={`${currentTheme.card} border ${currentTheme.border} rounded-xl px-3 py-2 text-xs font-bold ${currentTheme.isDark ? 'text-emerald-500' : 'text-slate-800'} focus:outline-none focus:ring-4 focus:ring-blue-500/5 focus:border-blue-500 transition-all`}
                  />
                </div>
                <button
                  onClick={() => setReplayOnly((v) => !v)}
                  aria-pressed={replayOnly}
                  className={`inline-flex items-center gap-2 px-3.5 py-2.5 rounded-xl border text-xs font-bold transition-all active:scale-95 ${
                    replayOnly
                      ? 'bg-violet-600 text-white border-violet-600 shadow-sm'
                      : `${currentTheme.card} ${currentTheme.border} ${currentTheme.text} hover:opacity-80`
                  }`}
                >
                  <History size={14} />
                  <span>{t.auditFilterReplayOnly}</span>
                </button>
              </div>
              <span className={`text-[10px] font-bold uppercase tracking-wider ${currentTheme.muted}`}>
                {t.auditFilterCount.replace('{shown}', String(filtered.length)).replace('{total}', String(auditLogs.length))}
              </span>
            </div>

            <div className={`${currentTheme.card} border ${currentTheme.border} rounded-2xl overflow-hidden shadow-sm`}>
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className={`${currentTheme.isDark ? 'bg-emerald-900/20' : 'bg-slate-50/50'} ${currentTheme.muted} text-[10px] font-black uppercase tracking-[0.2em]`}>
                      <th className="px-6 py-4">{t.timestamp}</th>
                      <th className="px-6 py-4">{t.staffUser}</th>
                      <th className="px-6 py-4">{t.actions}</th>
                      <th className="px-6 py-4">{t.details}</th>
                    </tr>
                  </thead>
                  <tbody className={`divide-y ${currentTheme.border}`}>
                    {filtered.length > 0 ? (
                      filtered.map((log) => {
                        const isPayment = log.action === 'RECORD_PAYMENT';
                        const isExpense = log.action === 'ADD_EXPENSE' || log.action === 'ADD_VENDOR_EXPENSE';
                        const isDelete = log.action.includes('DELETE');

                        const badgeColor = isPayment
                          ? 'bg-emerald-500/10 text-emerald-600 border-emerald-500/20'
                          : isExpense
                          ? 'bg-amber-500/10 text-amber-600 border-amber-500/20'
                          : isDelete
                          ? 'bg-rose-500/10 text-rose-600 border-rose-500/20'
                          : 'bg-blue-500/10 text-blue-600 border-blue-500/20';

                        return (
                          <tr key={log.id} className={`${currentTheme.rowHover} transition-all`}>
                            <td className="px-6 py-4 whitespace-nowrap">
                              <span className={`text-xs font-mono ${currentTheme.muted}`}>
                                {new Date(log.createdAt).toLocaleString(lang === 'fr' ? 'fr-FR' : 'en-US')}
                              </span>
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap">
                              <div className="flex flex-col">
                                <span className={`text-xs font-bold ${currentTheme.text}`}>{log.userName || t.roleStaff}</span>
                                <span className="text-[10px] text-slate-400 font-mono">{log.userEmail}</span>
                              </div>
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap">
                              <span className={`text-[10px] font-black tracking-wider uppercase px-2.5 py-1 rounded-full border ${badgeColor}`}>
                                {log.action}
                              </span>
                            </td>
                            <td className="px-6 py-4">
                              <span className={`text-xs font-medium ${currentTheme.text}`}>{log.details || '—'}</span>
                            </td>
                          </tr>
                        );
                      })
                    ) : (
                      <tr>
                        <td colSpan={4} className="px-6 py-12 text-center text-slate-400 italic">
                          {auditLogs.length === 0 ? t.noAuditLogEntriesRecordedYet : t.noAuditEntriesMatchingFilters}
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
  );
}
