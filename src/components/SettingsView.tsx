/**
 * Settings view (language, theme, inactivity window, logo, backup/export,
 * class sections, user & role management + the set-password modal) —
 * extracted verbatim from MainViews.tsx. Admin/dev only; reads its data and
 * actions through the MainViewsContext.
 */
import { AnimatePresence, motion } from 'motion/react';
import {
  Briefcase, Check, Clock, Compass, Crown, DollarSign, Download, Edit2, Globe,
  KeyRound, Layers, Lock, Plus, Receipt, ShieldCheck, Trash2, UploadCloud,
  UserPlus, Users, X, Zap,
} from 'lucide-react';
import { useMainViews } from '../app/mainViewsContext';
import type { RoleTab, ThemeOption } from '../app/mainViewsProps';
import type { AppRole } from '../lib/useAuth';

export function SettingsView() {
  const {
    t, lang, currentTheme, theme, setTheme, toggleLanguage, schoolLogo, setSchoolLogo,
    logoColor, setLogoColor, logoInputRef, handleLogoUpload, inactivityMinutes,
    setInactivityMinutes, handleExportAllData, availableClasses, setShowAddClassModal,
    openEditClass, handleDeleteClass, userProfiles, setUserProfiles, auth,
    setShowAddUserModal, userRoleFilter, setUserRoleFilter, userSearchTerm,
    setUserSearchTerm, updatingUserId, handleUpdateRole, handleSendPasswordReset,
    passwordTarget, setPasswordTarget, passwordInput, setPasswordInput, handleSetPassword,
  } = useMainViews();
  // The settings tab is admin/dev-only (sidebar hides it for other roles too).
  if (!auth?.isAdmin) return null;
  return (
    <>
          <div className="max-w-2xl space-y-8">
            <div className={`${currentTheme.card} p-10 rounded-[2.5rem] border ${currentTheme.border} shadow-xl shadow-slate-200/50`}>
              <h3 className={`text-xl font-bold ${currentTheme.isDark ? 'text-emerald-400' : 'text-slate-800'} mb-8`}>{t.localizationAndPreferences}</h3>
              <div className="space-y-6">
                <div className={`flex items-center justify-between p-6 ${currentTheme.isDark ? 'bg-emerald-900/10' : 'bg-slate-50'} rounded-3xl`}>
                  <div className="flex items-center gap-4">
                    <div className={`p-3 ${currentTheme.card} rounded-2xl text-blue-600 shadow-sm`}>
                      <Globe size={20} />
                    </div>
                    <div>
                      <p className={`font-bold ${currentTheme.isDark ? 'text-emerald-500' : 'text-slate-800'}`}>{t.systemLanguage}</p>
                      <p className={`text-xs ${currentTheme.muted}`}>{t.changeTheInterfaceLanguage}</p>
                    </div>
                  </div>
                  <button
                    onClick={() => toggleLanguage(lang === 'en' ? 'fr' : 'en')}
                    className={`px-6 py-2 ${currentTheme.card} border ${currentTheme.border} rounded-xl text-sm font-bold ${currentTheme.isDark ? 'text-emerald-500' : 'text-slate-700'} hover:bg-slate-50 transition-all`}
                  >
                    {t.english}
                  </button>
                </div>

                <div className={`flex items-center justify-between p-6 ${currentTheme.isDark ? 'bg-emerald-900/10' : 'bg-slate-50'} rounded-3xl`}>
                  <div className="flex items-center gap-4">
                    <div className={`p-3 ${currentTheme.card} rounded-2xl text-emerald-600 shadow-sm`}>
                      <DollarSign size={20} />
                    </div>
                    <div>
                      <p className={`font-bold ${currentTheme.isDark ? 'text-emerald-500' : 'text-slate-800'}`}>{t.currencyFormat}</p>
                      <p className={`text-xs ${currentTheme.muted}`}>{t.current} {t.currency}</p>
                    </div>
                  </div>
                  <span className={`text-xs font-black ${currentTheme.muted} uppercase tracking-widest`}>{t.currency}</span>
                </div>

                {/* Theme Selection */}
                <div className="space-y-4 pt-4 border-t border-slate-100">
                  <h4 className={`text-sm font-black ${currentTheme.muted} uppercase tracking-widest`}>{t.themeSettings}</h4>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
                    {([
                      { id: 'navy', label: t.corporateNavy, color: 'bg-[#0f172a]' },
                      { id: 'emerald', label: t.emeraldGreen, color: 'bg-[#064E3B]' },
                      { id: 'cream', label: t.warmCreamLedger, color: 'bg-[#FDFBF7]' },
                      { id: 'bordeaux', label: t.bordeauxRed, color: 'bg-[#881337]' },
                      { id: 'slate', label: t.slateSlate, color: 'bg-[#1E293B]' },
                      { id: 'midnight', label: t.midnightDark, color: 'bg-[#030712]' }
                    ] as ThemeOption[]).map((tOption) => (
                      <button
                        key={tOption.id}
                        onClick={() => setTheme(tOption.id)}
                        className={`p-4 rounded-2xl border-2 transition-all flex flex-col items-center gap-3 ${
                          theme === tOption.id
                            ? 'border-emerald-600 bg-emerald-500/10 shadow-md ring-2 ring-emerald-500/30'
                            : `${currentTheme.border} ${currentTheme.isDark ? 'hover:bg-emerald-900/10' : 'hover:bg-slate-50'}`
                        }`}
                      >
                        <div className={`w-10 h-10 rounded-full ${tOption.color} border border-slate-200 shadow-inner flex items-center justify-center`}>
                          {theme === tOption.id && <Check size={14} className={`flex-shrink-0 ${tOption.id === 'cream' ? 'text-slate-800' : 'text-white'}`} />}
                        </div>
                        <span className={`text-xs font-bold ${currentTheme.isDark ? 'text-emerald-500' : 'text-slate-800'} text-center`}>{tOption.label}</span>
                      </button>
                    ))}
                  </div>
                </div>

                {/* Inactivity auto-logout window */}
                <div className={`space-y-4 pt-4 border-t ${currentTheme.border}`}>
                  <h4 className={`text-sm font-black ${currentTheme.muted} uppercase tracking-widest`}>{t.inactivityMinutesLabel}</h4>
                  <div className={`flex items-center justify-between p-6 ${currentTheme.isDark ? 'bg-emerald-900/10' : 'bg-slate-50'} rounded-3xl`}>
                    <div className="flex items-center gap-4">
                      <div className={`p-3 ${currentTheme.card} rounded-2xl text-amber-600 shadow-sm`}>
                        <Clock size={20} />
                      </div>
                      <p className={`text-xs ${currentTheme.muted}`}>{t.inactivityMinutesLabel}</p>
                    </div>
                    <input
                      type="number"
                      min={0}
                      max={480}
                      value={inactivityMinutes}
                      onChange={(e) => setInactivityMinutes(Number(e.target.value))}
                      className={`w-24 px-3 py-2 rounded-xl border ${currentTheme.border} text-sm font-bold text-center focus:outline-none focus:ring-2 focus:ring-amber-500/30 ${currentTheme.isDark ? 'bg-white/5 text-emerald-400 [color-scheme:dark]' : 'bg-white text-slate-800'}`}
                    />
                  </div>
                  <p className={`text-[10px] ${currentTheme.muted}`}>{t.inactivityTeamScope}</p>
                </div>

                {/* Logo Upload */}
                <div className={`space-y-4 pt-4 border-t ${currentTheme.border}`}>
                  <h4 className={`text-sm font-black ${currentTheme.muted} uppercase tracking-widest`}>{t.uploadLogo}</h4>
                  <div className="flex items-center gap-6">
                    <div
                      onClick={() => logoInputRef.current?.click()}
                      className={`w-24 h-24 rounded-3xl border-2 border-dashed ${currentTheme.border} flex flex-col items-center justify-center cursor-pointer hover:border-blue-400 transition-all overflow-hidden relative group`}
                    >
                      {schoolLogo ? (
                        <>
                          <img src={schoolLogo} alt="Logo" className="w-full h-full object-contain p-2" />
                          <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                            <UploadCloud size={20} className="text-white" />
                          </div>
                        </>
                      ) : (
                        <>
                          <UploadCloud size={24} className={currentTheme.muted} />
                          <span className={`text-[10px] ${currentTheme.muted} mt-2 font-bold`}>{t.upload}</span>
                        </>
                      )}
                    </div>
                    <div className="flex-1">
                      <p className={`text-sm font-bold ${currentTheme.isDark ? 'text-emerald-500' : 'text-slate-800'}`}>{t.logoAccentColor}</p>
                      <p className={`text-xs ${currentTheme.muted} mb-4`}>{t.headerSync}</p>
                      {logoColor && (
                        <div className="flex items-center gap-3">
                          <div
                            className="w-8 h-8 rounded-lg border border-white/20 shadow-sm"
                            style={{ backgroundColor: logoColor }}
                          />
                          <span className={`text-xs font-mono font-bold ${currentTheme.muted}`}>{logoColor.toUpperCase()}</span>
                          <button
                            onClick={() => { setSchoolLogo(null); setLogoColor(null); }}
                            className="text-xs text-rose-500 font-bold hover:underline"
                          >
                            Reset
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                  <input
                    type="file"
                    ref={logoInputRef}
                    onChange={handleLogoUpload}
                    accept="image/*"
                    className="hidden"
                  />
                </div>

                {/* Backup & Export */}
                <div className={`space-y-4 pt-8 border-t ${currentTheme.border}`}>
                  <h4 className={`text-sm font-black ${currentTheme.muted} uppercase tracking-widest`}>{t.backupSettings}</h4>
                  <div className={`p-8 ${currentTheme.isDark ? 'bg-emerald-900/10' : 'bg-slate-50'} rounded-[2.5rem] border ${currentTheme.border} flex flex-col md:flex-row items-center justify-between gap-6`}>
                    <div className="flex items-center gap-4">
                      <div className={`p-4 ${currentTheme.card} rounded-3xl text-blue-600 shadow-lg`}>
                        <UploadCloud size={32} />
                      </div>
                      <div>
                        <p className={`text-lg font-black ${currentTheme.isDark ? 'text-emerald-500' : 'text-slate-800'}`}>{t.exportData}</p>
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
                {/* Classes & Sections Configuration Card */}
                <div className={`space-y-4 pt-8 border-t ${currentTheme.border}`}>
                  <div className="flex items-center justify-between">
                    <div>
                      <h4 className={`text-base font-black ${currentTheme.isDark ? 'text-emerald-400' : 'text-slate-800'} flex items-center gap-2`}>
                        <Layers size={20} className="text-blue-500" />
                        {t.classesGradeLevelsManagement}
                      </h4>
                      <p className={`text-xs ${currentTheme.muted} mt-0.5`}>
                        {t.addSections1a1b1c1d2a7bOrCustomGradesAcrossSchoolCycles}
                      </p>
                    </div>
                    <button
                      onClick={() => setShowAddClassModal(true)}
                      className="px-4 py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs rounded-xl shadow-md transition-all flex items-center gap-1.5 active:scale-95"
                    >
                      <Plus size={14} />
                      <span>{t.addClassSection}</span>
                    </button>
                  </div>

                  <div className={`p-6 rounded-[2rem] border ${currentTheme.border} ${currentTheme.isDark ? 'bg-emerald-900/10' : 'bg-slate-50'} space-y-4`}>
                    <div>
                      <div className="flex items-center justify-between mb-2">
                        <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">
                          {t.firstCycle1stTo6thYear}
                        </p>
                        <span className="text-[10px] font-bold text-slate-400">
                          {availableClasses.filter(c => c.cycle === 'cycle1').length} {t.classesWord}
                        </span>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {availableClasses.filter(c => c.cycle === 'cycle1').map(c => (
                          <span key={c.id} className="px-3 py-1 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs font-bold text-slate-800 dark:text-emerald-400 shadow-sm flex items-center gap-1.5">
                            <span>{c.id}</span>
                            <span className="text-[10px] text-slate-400 font-normal">({c.section})</span>
                            {c.isCustom && (
                              <>
                                <button
                                  type="button"
                                  onClick={() => openEditClass(c)}
                                  title={t.renameClass}
                                  className="ml-1 p-0.5 rounded-md hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-400 hover:text-blue-500 transition-all"
                                >
                                  <Edit2 size={12} />
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleDeleteClass(c)}
                                  title={t.deleteClass}
                                  className="p-0.5 rounded-md hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-400 hover:text-rose-500 transition-all"
                                >
                                  <Trash2 size={12} />
                                </button>
                              </>
                            )}
                          </span>
                        ))}
                      </div>
                    </div>

                    <div className="pt-3 border-t border-slate-200/50 dark:border-slate-800">
                      <div className="flex items-center justify-between mb-2">
                        <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">
                          {t.secondCycle7thTo9thYear}
                        </p>
                        <span className="text-[10px] font-bold text-slate-400">
                          {availableClasses.filter(c => c.cycle === 'cycle2').length} {t.classesWord}
                        </span>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {availableClasses.filter(c => c.cycle === 'cycle2').map(c => (
                          <span key={c.id} className="px-3 py-1 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs font-bold text-slate-800 dark:text-emerald-400 shadow-sm flex items-center gap-1.5">
                            <span>{c.id}</span>
                            <span className="text-[10px] text-slate-400 font-normal">({c.section})</span>
                            {c.isCustom && (
                              <>
                                <button
                                  type="button"
                                  onClick={() => openEditClass(c)}
                                  title={t.renameClass}
                                  className="ml-1 p-0.5 rounded-md hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-400 hover:text-blue-500 transition-all"
                                >
                                  <Edit2 size={12} />
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleDeleteClass(c)}
                                  title={t.deleteClass}
                                  className="p-0.5 rounded-md hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-400 hover:text-rose-500 transition-all"
                                >
                                  <Trash2 size={12} />
                                </button>
                              </>
                            )}
                          </span>
                        ))}
                      </div>
                    </div>

                    {availableClasses.some(c => c.cycle !== 'cycle1' && c.cycle !== 'cycle2') && (
                      <div className="pt-3 border-t border-slate-200/50 dark:border-slate-800">
                        <div className="flex items-center justify-between mb-2">
                          <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">
                            {t.otherCustomClasses2}
                          </p>
                          <span className="text-[10px] font-bold text-slate-400">
                            {availableClasses.filter(c => c.cycle !== 'cycle1' && c.cycle !== 'cycle2').length}
                          </span>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          {availableClasses.filter(c => c.cycle !== 'cycle1' && c.cycle !== 'cycle2').map(c => (
                            <span key={c.id} className="px-3 py-1 bg-blue-50 dark:bg-blue-900/30 border border-blue-200 dark:border-blue-800 rounded-xl text-xs font-bold text-blue-700 dark:text-blue-300 shadow-sm flex items-center gap-1.5">
                              <span>{c.id}</span>
                              {c.isCustom && (
                                <>
                                  <button
                                    type="button"
                                    onClick={() => openEditClass(c)}
                                    title={t.renameClass}
                                    className="ml-1 p-0.5 rounded-md hover:bg-blue-100 dark:hover:bg-blue-800 text-blue-400 hover:text-blue-600 transition-all"
                                  >
                                    <Edit2 size={12} />
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => handleDeleteClass(c)}
                                    title={t.deleteClass}
                                    className="p-0.5 rounded-md hover:bg-blue-100 dark:hover:bg-blue-800 text-blue-400 hover:text-rose-500 transition-all"
                                  >
                                    <Trash2 size={12} />
                                  </button>
                                </>
                              )}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                {/* User & Role Management (Exclusive to Admin / Promoter / Dev settings) */}
                <div className={`space-y-6 pt-8 border-t ${currentTheme.border}`}>
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                    <div>
                      <h4 className={`text-base font-black ${currentTheme.isDark ? 'text-emerald-400' : 'text-slate-800'} flex items-center gap-2`}>
                        <ShieldCheck size={20} className="text-emerald-500" />
                        {t.staffAccessRoleManagement}
                      </h4>
                      <p className={`text-xs ${currentTheme.muted} mt-0.5`}>
                        {t.assignOrAdjustPermissionsForAdministratorsGeneralManagersAndAccountants}
                      </p>
                    </div>

                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => auth.fetchAllProfiles().then(profiles => setUserProfiles(profiles))}
                        className={`p-2.5 rounded-xl border ${currentTheme.border} ${currentTheme.card} ${currentTheme.isDark ? 'text-emerald-400 hover:text-emerald-300 hover:bg-white/5' : 'text-slate-600 hover:text-slate-900 hover:bg-slate-50'} transition-all text-xs font-bold flex items-center gap-1.5 shadow-sm`}
                        title={t.refreshUserList}
                      >
                        <span>↻</span>
                        <span className="hidden sm:inline">{t.refresh}</span>
                      </button>

                      <button
                        onClick={() => {
                          setShowAddUserModal(true);
                        }}
                        className="bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-2.5 rounded-xl text-xs font-black transition-all flex items-center gap-2 shadow-lg shadow-emerald-600/20 active:scale-95"
                      >
                        <UserPlus size={16} />
                        <span>{t.addStaffAccount2}</span>
                      </button>
                    </div>
                  </div>

                  {/* Role Definitions & Stats Banner */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                    <div className={`p-4 rounded-2xl border ${currentTheme.border} ${currentTheme.isDark ? 'bg-emerald-950/20 border-emerald-500/30' : 'bg-emerald-50/70 border-emerald-200'}`}>
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-[10px] font-black uppercase tracking-wider text-emerald-600 dark:text-emerald-400 flex items-center gap-1.5">
                          <Crown size={14} className="text-amber-500 flex-shrink-0" /> {t.promoterAdminsPlusGM}
                        </span>
                        <span className="text-xs font-black bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 px-2 py-0.5 rounded-full">
                          {userProfiles.filter(p => p.role === 'admin' || p.role === 'general_manager').length}
                        </span>
                      </div>
                      <p className={`text-[11px] ${currentTheme.isDark ? 'text-emerald-300/80' : 'text-emerald-800'}`}>
                        {t.fullControlFeePolicyClosingSchoolYearsRoleAssignment}
                      </p>
                    </div>

                    <div className={`p-4 rounded-2xl border ${currentTheme.border} ${currentTheme.isDark ? 'bg-blue-950/20 border-blue-500/30' : 'bg-blue-50/70 border-blue-200'}`}>
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-[10px] font-black uppercase tracking-wider text-blue-600 dark:text-blue-400 flex items-center gap-1.5">
                          <Briefcase size={14} className="text-sky-500 flex-shrink-0" /> {t.roleStaff}
                        </span>
                        <span className="text-xs font-black bg-blue-500/20 text-blue-700 dark:text-blue-400 px-2 py-0.5 rounded-full">
                          {userProfiles.filter(p => p.role === 'staff').length}
                        </span>
                      </div>
                      <p className={`text-[11px] ${currentTheme.isDark ? 'text-blue-300/80' : 'text-blue-800'}`}>
                        {t.studentEnrollmentPaymentReceiptsPayrollDailyExpenses}
                      </p>
                    </div>

                    <div className={`p-4 rounded-2xl border ${currentTheme.border} ${currentTheme.isDark ? 'bg-teal-950/20 border-teal-500/30' : 'bg-teal-50/70 border-teal-200'}`}>
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-[10px] font-black uppercase tracking-wider text-teal-700 dark:text-teal-400 flex items-center gap-1.5">
                          <Receipt size={14} className="text-violet-500 flex-shrink-0" /> {t.roleEconome}
                        </span>
                        <span className="text-xs font-black bg-teal-500/20 text-teal-800 dark:text-teal-400 px-2 py-0.5 rounded-full">
                          {userProfiles.filter(p => p.role === 'econome').length}
                        </span>
                      </div>
                      <p className={`text-[11px] ${currentTheme.isDark ? 'text-teal-300/80' : 'text-teal-800'}`}>
                        {t.economeDailyFinancialEntries}
                      </p>
                    </div>

                    <div className={`p-4 rounded-2xl border ${currentTheme.border} ${currentTheme.isDark ? 'bg-purple-950/20 border-purple-500/30' : 'bg-purple-50/70 border-purple-200'}`}>
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-[10px] font-black uppercase tracking-wider text-purple-600 dark:text-purple-400 flex items-center gap-1.5">
                          <Zap size={14} className="text-amber-500 flex-shrink-0" /> {t.engineeringDev}
                        </span>
                        <span className="text-xs font-black bg-purple-500/20 text-purple-700 dark:text-purple-400 px-2 py-0.5 rounded-full">
                          {userProfiles.filter(p => p.role === 'dev').length}
                        </span>
                      </div>
                      <p className={`text-[11px] ${currentTheme.isDark ? 'text-purple-300/80' : 'text-purple-800'}`}>
                        {t.technicalSystemMaintenanceAndDatabaseMigrations}
                      </p>
                    </div>
                  </div>

                  {/* Filter & Search Bar */}
                  <div className="flex flex-col sm:flex-row gap-3">
                    <div className="relative flex-1">
                      <input
                        type="text"
                        value={userSearchTerm}
                        onChange={(e) => setUserSearchTerm(e.target.value)}
                        placeholder={t.searchByNameOrEmail}
                        className={`w-full pl-10 pr-4 py-2.5 rounded-xl border ${currentTheme.border} ${currentTheme.isDark ? 'bg-white/5 text-white' : 'bg-slate-50 text-slate-800'} text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-emerald-500/30`}
                      />
                      <Users size={16} className={`absolute left-3.5 top-1/2 -translate-y-1/2 ${currentTheme.muted}`} />
                    </div>

                    <div className="flex items-center gap-1 p-1 bg-white/5 rounded-xl border border-white/10 self-start">
                      {([
                        { id: 'all', label: t.all },
                        { id: 'admin', label: 'Admins' },
                        { id: 'staff', label: t.staff2 },
                        { id: 'econome', label: t.roleEconome },
                      ] as RoleTab[]).map((tab) => (
                        <button
                          key={tab.id}
                          onClick={() => setUserRoleFilter(tab.id)}
                          className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                            userRoleFilter === tab.id
                              ? 'bg-emerald-600 text-white shadow-sm'
                              : `${currentTheme.muted} hover:text-white`
                          }`}
                        >
                          {tab.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Registered Users Cards */}
                  <div className="space-y-3">
                    {userProfiles
                      .filter(p => {
                        const matchesSearch = !userSearchTerm ||
                          p.fullName.toLowerCase().includes(userSearchTerm.toLowerCase()) ||
                          p.email.toLowerCase().includes(userSearchTerm.toLowerCase());
                        const matchesRole = userRoleFilter === 'all' || p.role === userRoleFilter;
                        return matchesSearch && matchesRole;
                      })
                      .length === 0 ? (
                      <div className={`text-xs ${currentTheme.muted} italic p-8 rounded-2xl text-center border ${currentTheme.border} ${currentTheme.card}`}>
                        {t.noUsersMatchingYourSearch}
                      </div>
                    ) : (
                      userProfiles
                        .filter(p => {
                          const matchesSearch = !userSearchTerm ||
                            p.fullName.toLowerCase().includes(userSearchTerm.toLowerCase()) ||
                            p.email.toLowerCase().includes(userSearchTerm.toLowerCase());
                          const matchesRole = userRoleFilter === 'all' || p.role === userRoleFilter;
                          return matchesSearch && matchesRole;
                        })
                        .map(profile => {
                          const isCurrentUser = auth.profile?.id === profile.id;
                          const isDev = profile.role === 'dev';
                          const isAdmin = profile.role === 'admin';
                          const isGM = profile.role === 'general_manager';
                          const isStaff = profile.role === 'staff' || profile.role === 'econome';

                          return (
                            <div
                              key={profile.id}
                              className={`flex flex-col md:flex-row md:items-center justify-between p-5 ${currentTheme.card} border ${
                                isCurrentUser ? 'border-emerald-500/40 ring-1 ring-emerald-500/20' : currentTheme.border
                              } rounded-2xl gap-4 shadow-sm transition-all hover:border-emerald-500/30`}
                            >
                              <div className="flex items-center gap-4">
                                <div className={`w-12 h-12 rounded-2xl flex items-center justify-center text-white font-black text-sm shadow-md flex-shrink-0 ${
                                  isDev ? 'bg-purple-600 shadow-purple-500/20' :
                                  isAdmin ? 'bg-emerald-600 shadow-emerald-500/20' :
                                  isGM ? 'bg-cyan-600 shadow-cyan-500/20' :
                                  'bg-blue-600 shadow-blue-500/20'
                                }`}>
                                  {profile.fullName.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase()}
                                </div>
                                <div className="min-w-0">
                                  <div className="flex items-center gap-2 flex-wrap">
                                    <p className={`text-sm font-bold truncate ${currentTheme.isDark ? 'text-white' : 'text-slate-900'}`}>
                                      {profile.fullName}
                                    </p>
                                    {isCurrentUser && (
                                      <span className="px-2 py-0.5 rounded-full text-[9px] font-black uppercase tracking-wider bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30">
                                        {t.you}
                                      </span>
                                    )}
                                    <span className={`px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider flex items-center gap-1 ${
                                      isDev
                                        ? 'bg-purple-500/20 text-purple-700 dark:text-purple-400 border border-purple-500/30'
                                        : isAdmin
                                        ? 'bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30'
                                        : isGM
                                        ? 'bg-cyan-500/20 text-cyan-800 dark:text-cyan-400 border border-cyan-500/30'
                                        : 'bg-blue-500/20 text-blue-700 dark:text-blue-400 border border-blue-500/30'
                                    }`}>
                                      {isDev && <Zap size={12} className="text-amber-500 flex-shrink-0" />}
                                      {isAdmin && <Crown size={12} className="text-amber-500 flex-shrink-0" />}
                                      {isGM && <Compass size={12} className="text-violet-500 flex-shrink-0" />}
                                      {profile.role === 'staff' && <Briefcase size={12} className="text-sky-500 flex-shrink-0" />}
                                      {profile.role === 'econome' && <Receipt size={12} className="text-violet-500 flex-shrink-0" />}
                                      {isDev
                                        ? (t.developer)
                                        : isAdmin
                                        ? (t.promoterAdmin2)
                                        : isGM
                                        ? (t.generalManager)
                                        : profile.role === 'econome'
                                        ? (t.roleEconome)
                                        : (t.roleStaff)}
                                    </span>
                                  </div>
                                  <p className={`text-xs ${currentTheme.muted} mt-0.5`}>{profile.email}</p>
                                </div>
                              </div>

                              <div className="flex items-center gap-2.5 self-end md:self-auto flex-wrap">
                                {/* Role Selector Dropdown */}
                                {!isDev && (
                                  <div className="flex items-center gap-1.5">
                                    <label className={`text-[10px] font-bold ${currentTheme.muted} hidden sm:inline`}>
                                      {t.role}
                                    </label>
                                    {/* Icône du rôle actif — hors <option> : le HTML interdit
                                        tout enfant non-texte dans <option> (erreur console
                                        « option cannot contain svg », icônes jamais rendues). */}
                                    {isAdmin ? <Crown size={14} className="text-amber-500 flex-shrink-0" />
                                      : isGM ? <Compass size={14} className="text-violet-500 flex-shrink-0" />
                                      : profile.role === 'econome' ? <Receipt size={14} className="text-violet-500 flex-shrink-0" />
                                      : <Briefcase size={14} className="text-sky-500 flex-shrink-0" />}
                                    <select
                                      value={profile.role}
                                      disabled={updatingUserId === profile.id}
                                      onChange={(e) => handleUpdateRole(profile, e.target.value as AppRole)}
                                      className={`px-3 py-2 rounded-xl text-xs font-bold border transition-all cursor-pointer ${
                                        isAdmin
                                          ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-500/20'
                                          : isGM
                                          ? 'bg-cyan-500/10 border-cyan-500/30 text-cyan-700 dark:text-cyan-300 hover:bg-cyan-500/20'
                                          : 'bg-blue-500/10 border-blue-500/30 text-blue-700 dark:text-blue-300 hover:bg-blue-500/20'
                                      } ${updatingUserId === profile.id ? 'opacity-50 cursor-wait' : ''}`}
                                    >
                                      <option value="admin" className="bg-slate-800 text-white">{t.promoterAdminFull}</option>
                                      <option value="general_manager" className="bg-slate-800 text-white">{t.generalManager}</option>
                                      <option value="staff" className="bg-slate-800 text-white">{t.roleStaff}</option>
                                      <option value="econome" className="bg-slate-800 text-white">{t.roleEconome}</option>
                                    </select>
                                  </div>
                                )}

                                {/* Set Password Button (admin/dev: direct password change) */}
                                <button
                                  onClick={() => { setPasswordInput(''); setPasswordTarget(profile); }}
                                  className="px-3 py-2 bg-slate-800 hover:bg-slate-900 text-white rounded-xl text-xs font-bold transition-all shadow-sm active:scale-95 flex items-center gap-1.5 border border-white/10"
                                  title={t.setPassword}
                                >
                                  <Lock size={14} className="text-slate-400 flex-shrink-0" />
                                  <span>{t.setPassword}</span>
                                </button>

                                {/* Password Reset Email Button */}
                                <button
                                  onClick={() => handleSendPasswordReset(profile.email)}
                                  className="px-3 py-2 bg-slate-800 hover:bg-slate-900 text-white rounded-xl text-xs font-bold transition-all shadow-sm active:scale-95 flex items-center gap-1.5 border border-white/10"
                                  title={t.sendPasswordResetEmail}
                                >
                                  <KeyRound size={14} className="text-slate-400 flex-shrink-0" />
                                  <span>{t.resetPass}</span>
                                </button>
                              </div>
                            </div>
                          );
                        })
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>

        <AnimatePresence>
          {passwordTarget && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4"
              onClick={() => setPasswordTarget(null)}
            >
              <motion.div
                initial={{ opacity: 0, scale: 0.9, y: 40 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.9, y: 40 }}
                onClick={(e) => e.stopPropagation()}
                className={`relative ${currentTheme.card} w-full max-w-md rounded-[2rem] shadow-2xl border ${currentTheme.border} overflow-hidden`}
              >
                <div className="p-6 border-b border-slate-100 flex justify-between items-center" style={{ backgroundColor: currentTheme.header }}>
                  <h2 className="text-lg font-bold text-white">{t.setPasswordTitle.replace('{name}', passwordTarget.fullName)}</h2>
                  <button onClick={() => setPasswordTarget(null)} className="p-2 hover:bg-white/10 rounded-xl transition-all text-white">
                    <X size={20} />
                  </button>
                </div>
                <div className="p-6 space-y-4">
                  <label className={`block text-xs font-bold ${currentTheme.muted}`}>{t.newPasswordLabel}</label>
                  <input
                    type="password"
                    value={passwordInput}
                    onChange={(e) => setPasswordInput(e.target.value)}
                    placeholder="••••••••"
                    autoFocus
                    className={`w-full px-4 py-3 rounded-xl border ${currentTheme.border} text-sm font-semibold ${currentTheme.isDark ? 'bg-white/5 text-white' : 'bg-white text-slate-800'} focus:outline-none focus:ring-2 focus:ring-blue-500/30`}
                  />
                  <div className="flex justify-end gap-3 pt-2">
                    <button
                      onClick={() => setPasswordTarget(null)}
                      className="px-4 py-2 rounded-xl text-xs font-bold border border-slate-200 hover:bg-slate-50 transition-all"
                    >
                      {t.cancel}
                    </button>
                    <button
                      disabled={passwordInput.trim().length < 6}
                      onClick={() => { void handleSetPassword(); }}
                      className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed text-white rounded-xl text-xs font-bold transition-all active:scale-95"
                    >
                      {t.save}
                    </button>
                  </div>
                </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>
    </>
  );
}
