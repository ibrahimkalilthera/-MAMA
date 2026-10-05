/**
 * Backup & export section — extracted verbatim from SettingsView so the view
 * stays under the line budget. Reads its data and actions through the
 * MainViewsContext.
 */
import { Download, UploadCloud } from 'lucide-react';
import { AuditWeekExportCard } from './AuditWeekExportCard';
import { useMainViews } from '../app/mainViewsContext';

export function SettingsBackupCard() {
  const { t, currentTheme, handleExportAllData } = useMainViews();

  return (
    <>
                {/* Backup & Export */}
                <div data-slot="settings-backup" className={`space-y-4 pt-8 border-t ${currentTheme.border}`}>
                  <h4 className={`text-sm font-black ${currentTheme.muted} uppercase tracking-widest`}>{t.backupSettings}</h4>
                  <AuditWeekExportCard />
                  <div className={`p-8 ${currentTheme.surfaceInset} rounded-3xl border ${currentTheme.border} flex flex-col md:flex-row items-center justify-between gap-6`}>
                    <div className="flex items-center gap-4">
                      <div className={`p-4 ${currentTheme.card} rounded-3xl text-blue-600 shadow-lg`}>
                        <UploadCloud size={32} />
                      </div>
                      <div>
                        <p className={`text-lg font-black ${currentTheme.inkStrong}`}>{t.exportData}</p>
                        <p className={`text-xs ${currentTheme.muted}`}>{t.downloadAFullBackupOfYourSchoolDataInExcelFormat}</p>
                      </div>
                    </div>
                    <button
                      onClick={handleExportAllData}
                      className="bg-slate-800 hover:bg-slate-900 text-white px-8 py-4 rounded-2xl font-black text-sm transition-all flex items-center gap-2 shadow-xl shadow-slate-800/20 active:scale-[0.98]"
                    >
                      <Download size={20} />
                      {t.exportData}
                    </button>
                  </div>
                </div>
    </>
  );
}
