/**
 * Audit trail view (tamper-evident activity log) — extracted verbatim from
 * MainViews.tsx. Admin/dev only; reads its data through the MainViewsContext.
 */
import { useState } from 'react';
import { ChevronDown, ChevronRight, Download, History, Layers, ShieldCheck } from 'lucide-react';
import { useMainViews } from '../app/mainViewsContext';
import { incidentRows } from '../lib/blockedIncidents';
import type { BlockedIncident } from '../lib/blockedIncidents';

/** Combien de postes un incident nomme avant de compter les autres. */
const STATION_LIMIT = 4;

export function AuditView() {
  const { t, lang, currentTheme, auditLogs, fetchAuditLogs, auth } = useMainViews();
  // The audit tab is admin/dev-only (sidebar hides it for other roles too).
  const [roleFilter, setRoleFilter] = useState('all');
  const [actionFilter, setActionFilter] = useState('all');
  const [replayOnly, setReplayOnly] = useState(false);
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  // Regroupés par défaut : vingt postes bloqués par le même 404 sont UN incident,
  // et c'est la question que l'administrateur se pose (« qu'est-ce qui est cassé,
  // et combien de machines ? »). Le dépliage rend les lignes brutes, donc rien
  // n'est caché — c'est un mode de LECTURE, pas une réécriture du journal.
  const [groupIncidents, setGroupIncidents] = useState(true);
  const [openIncidents, setOpenIncidents] = useState<Record<string, boolean>>({});

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

  // Les lignes affichées : un incident par panne (regroupé), ou l'entrée brute.
  const viewRows = groupIncidents ? incidentRows(filtered) : filtered.map((log) => ({ kind: 'log' as const, at: log.createdAt, log }));
  const fmt = (iso: string) => new Date(iso).toLocaleString(lang === 'fr' ? 'fr-FR' : 'en-US');

  /** Le résumé d'un incident — ce que le CSV emporte, et ce que l'écran déplie. */
  const incidentSummary = (incident: BlockedIncident) =>
    [
      `${t.auditIncidentMotif} : ${incident.motif}`,
      `${t.auditIncidentStations} : ${incident.stations.join(', ')}`,
      t.auditIncidentCount.replace('{count}', String(incident.stations.length)),
      t.auditIncidentOccurrences.replace('{count}', String(incident.occurrences)),
      incident.firstAt === incident.lastAt
        ? fmt(incident.firstAt)
        : t.auditIncidentSpan.replace('{from}', fmt(incident.firstAt)).replace('{to}', fmt(incident.lastAt)),
    ].join(' · ');

  // CSV export of the CURRENT filtered view (BOM for Excel's accent handling).
  // Il suit la vue : regroupé, il exporte UNE ligne par incident — sinon le
  // tableur redonne exactement les vingt lignes qu'on vient de regrouper.
  const downloadCsv = () => {
    const esc = (v: string | null | undefined) => `"${(v ?? '').replace(/"/g, '""')}"`;
    const header = [t.timestamp, t.actions, t.auditReplay, t.staffUser, t.auditExportRole, t.details];
    const csvRows = viewRows.map((row) => row.kind === 'incident'
      ? [
          fmt(row.incident.lastAt),
          t.auditIncidentAction.replace('{code}', row.incident.code),
          '',
          t.auditIncidentCount.replace('{count}', String(row.incident.stations.length)),
          '',
          incidentSummary(row.incident),
        ]
      : [
          fmt(row.log.createdAt),
          row.log.action,
          (row.log.details || '').includes('[replay]') ? '[replay]' : '',
          `${row.log.userName || ''}${row.log.userEmail ? ` (${row.log.userEmail})` : ''}`,
          row.log.userRole || '',
          row.log.details || '',
        ]);
    const csv = [header, ...csvRows].map((r) => r.map(esc).join(',')).join('\r\n');
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
                <button
                  onClick={() => setGroupIncidents((v) => !v)}
                  aria-pressed={groupIncidents}
                  className={`inline-flex items-center gap-2 px-3.5 py-2.5 rounded-xl border text-xs font-bold transition-all active:scale-95 ${
                    groupIncidents
                      ? 'bg-rose-600 text-white border-rose-600 shadow-sm'
                      : `${currentTheme.card} ${currentTheme.border} ${currentTheme.text} hover:opacity-80`
                  }`}
                >
                  <Layers size={14} />
                  <span>{t.auditFilterGroupIncidents}</span>
                </button>
              </div>
              <span className={`text-[10px] font-bold uppercase tracking-wider ${currentTheme.muted}`}>
                {t.auditFilterCount.replace('{shown}', String(viewRows.length)).replace('{total}', String(auditLogs.length))}
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
                      <th className="px-6 py-4">{t.auditReplay}</th>
                      <th className="px-6 py-4">{t.details}</th>
                    </tr>
                  </thead>
                  <tbody className={`divide-y ${currentTheme.border}`}>
                    {viewRows.length > 0 ? (
                      viewRows.map((row) => {
                        if (row.kind === 'incident') {
                          const incident = row.incident;
                          const open = openIncidents[incident.key] === true;
                          const shown = incident.stations.slice(0, STATION_LIMIT);
                          const others = incident.stations.length - shown.length;
                          return (
                            <tr key={`incident-${incident.key}`} className={`${currentTheme.rowHover} transition-all`}>
                              <td className="px-6 py-4 whitespace-nowrap align-top">
                                <div className="flex flex-col gap-1">
                                  <span className={`text-xs font-mono ${currentTheme.muted}`}>{fmt(incident.lastAt)}</span>
                                  {incident.firstAt !== incident.lastAt && (
                                    <span className={`text-[10px] ${currentTheme.muted}`}>
                                      {t.auditIncidentSpan.replace('{from}', fmt(incident.firstAt)).replace('{to}', fmt(incident.lastAt))}
                                    </span>
                                  )}
                                </div>
                              </td>
                              <td className="px-6 py-4 whitespace-nowrap align-top">
                                <div className="flex flex-col">
                                  <span className={`text-lg font-black ${currentTheme.text}`}>{incident.stations.length}</span>
                                  <span className={`text-[10px] font-bold uppercase tracking-wider ${currentTheme.muted}`}>
                                    {t.auditIncidentStations}
                                  </span>
                                </div>
                              </td>
                              <td className="px-6 py-4 whitespace-nowrap align-top">
                                <div className="flex items-center gap-2">
                                  <button
                                    onClick={() => setOpenIncidents((prev) => ({ ...prev, [incident.key]: !open }))}
                                    aria-expanded={open}
                                    aria-label={open ? t.auditIncidentHide : t.auditIncidentShow}
                                    className={`p-1.5 rounded-lg border ${currentTheme.border} ${currentTheme.muted} hover:opacity-70 transition-all active:scale-95`}
                                  >
                                    {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                                  </button>
                                  <span className="text-[10px] font-black tracking-wider uppercase px-2.5 py-1 rounded-full border bg-rose-500/10 text-rose-600 dark:text-rose-300 border-rose-500/20">
                                    {t.auditIncidentAction.replace('{code}', incident.code)}
                                  </span>
                                </div>
                              </td>
                              <td className="px-6 py-4 whitespace-nowrap align-top">
                                <span className={`text-xs ${currentTheme.muted}`}>—</span>
                              </td>
                              <td className="px-6 py-4 align-top">
                                <div className="flex flex-col gap-1.5">
                                  <span className={`text-xs font-bold ${currentTheme.text}`}>{incident.motif}</span>
                                  <div className="flex flex-wrap items-center gap-1.5">
                                    {shown.map((station) => (
                                      <span
                                        key={station}
                                        className={`text-[10px] font-mono px-2 py-0.5 rounded-md border ${currentTheme.border} ${currentTheme.muted}`}
                                      >
                                        {station}
                                      </span>
                                    ))}
                                    {others > 0 && (
                                      <span className={`text-[10px] font-bold ${currentTheme.muted}`}>
                                        {t.auditIncidentMore.replace('{count}', String(others))}
                                      </span>
                                    )}
                                  </div>
                                  <span className={`text-[10px] ${currentTheme.muted}`}>
                                    {t.auditIncidentOccurrences.replace('{count}', String(incident.occurrences))}
                                  </span>
                                  {open && (
                                    <div className={`mt-1 flex flex-col gap-1 border-l-2 pl-3 ${currentTheme.border}`}>
                                      {incident.reports.map((log) => (
                                        <div key={log.id} className="flex flex-col">
                                          <span className={`text-[10px] font-mono ${currentTheme.muted}`}>{fmt(log.createdAt)}</span>
                                          <span className={`text-[11px] ${currentTheme.text}`}>{log.details || '—'}</span>
                                        </div>
                                      ))}
                                    </div>
                                  )}
                                </div>
                              </td>
                            </tr>
                          );
                        }
                        const log = row.log;
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
                                {fmt(log.createdAt)}
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
                            <td className="px-6 py-4 whitespace-nowrap">
                              {(log.details || '').includes('[replay]') ? (
                                <span className="text-[10px] font-black tracking-wider uppercase px-2.5 py-1 rounded-full border bg-violet-500/10 text-violet-600 dark:text-violet-300 border-violet-500/20">
                                  [replay]
                                </span>
                              ) : (
                                <span className={`text-xs ${currentTheme.muted}`}>—</span>
                              )}
                            </td>
                            <td className="px-6 py-4">
                              <span className={`text-xs font-medium ${currentTheme.text}`}>{log.details || '—'}</span>
                            </td>
                          </tr>
                        );
                      })
                    ) : (
                      <tr>
                        <td colSpan={5} className="px-6 py-12 text-center text-slate-400 italic">
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
