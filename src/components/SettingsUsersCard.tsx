/**
 * User & role management section (staff accounts, role stats, filter, cards) —
 * extracted verbatim from SettingsView so the view stays under the line budget.
 * Reads its data and actions through the MainViewsContext.
 */
import { useEffect, useState } from 'react';
import { Briefcase, Compass, Crown, KeyRound, Lock, Receipt, ShieldCheck, UserPlus, Users, WifiOff, Zap } from 'lucide-react';
import { useMainViews } from '../app/mainViewsContext';
import type { RoleTab } from '../app/mainViewsProps';
import type { AppRole, UserProfile } from '../lib/useAuth';

export function SettingsUsersCard() {
  const {
    t, currentTheme, userProfiles, setUserProfiles, auth, setShowAddUserModal,
    userRoleFilter, setUserRoleFilter, userSearchTerm, setUserSearchTerm,
    updatingUserId, handleUpdateRole, handleSendPasswordReset, setPasswordTarget, setPasswordInput,
  } = useMainViews();

  // ── La ligne est-elle là ? (dit AVANT le clic, pas après l'échec) ─────────
  // Un RÔLE part en file et arrivera tout seul ; un MOT DE PASSE ou une CRÉATION
  // DE COMPTE passent par l'authentification du serveur et ne peuvent pas
  // attendre. Écouteur local, comme le bandeau : une coupure ne provoque aucun
  // rendu de l'application, donc cet état ne peut venir que d'ici.
  const [lineDown, setLineDown] = useState(typeof navigator !== 'undefined' && navigator.onLine === false);
  useEffect(() => {
    const up = () => setLineDown(false);
    const down = () => setLineDown(true);
    window.addEventListener('online', up);
    window.addEventListener('offline', down);
    return () => { window.removeEventListener('online', up); window.removeEventListener('offline', down); };
  }, []);
  const accountGesturesNeedConnection = lineDown || Boolean(auth?.isOfflineSession);

  // ─── Le filtre de la liste des comptes, calculé UNE fois ────────────────────
  // Il était écrit deux fois (`.length === 0` puis `.map`), donc un changement
  // de règle atterrissait dans une moitié sur deux — et « ce que le filtre
  // masque » n'était dit nulle part.
  const matchesFilter = (p: UserProfile): boolean => {
    const matchesSearch = !userSearchTerm ||
      p.fullName.toLowerCase().includes(userSearchTerm.toLowerCase()) ||
      p.email.toLowerCase().includes(userSearchTerm.toLowerCase());
    const matchesRole = userRoleFilter === 'all' || p.role === userRoleFilter;
    return matchesSearch && matchesRole;
  };
  const visibleProfiles = userProfiles.filter(matchesFilter);
  const hiddenByFilter = userProfiles.length - visibleProfiles.length;

  return (
    <>
                {/* User & Role Management (Exclusive to Admin / Promoter / Dev settings) */}
                <div data-slot="settings-staff-access" className={`space-y-6 pt-8 border-t ${currentTheme.border}`}>
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                    <div>
                      <h4 className={`text-base font-black ${currentTheme.inkStrong} flex items-center gap-2`}>
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
                        className={`p-2.5 rounded-xl border ${currentTheme.border} ${currentTheme.card} ${currentTheme.hoverSurface} ${currentTheme.isDark ? 'text-[#E2E8F0]' : 'text-slate-600 hover:text-slate-900'} transition-all text-xs font-bold flex items-center gap-1.5 shadow-sm`}
                        title={t.refreshUserList}
                      >
                        <span>↻</span>
                        <span className="hidden sm:inline">{t.refresh}</span>
                      </button>

                      <button
                        onClick={() => {
                          setShowAddUserModal(true);
                        }}
                        className={`${currentTheme.accentBg} ${currentTheme.accentHover} ${currentTheme.accentText} px-4 py-2.5 rounded-xl text-xs font-black transition-all flex items-center gap-2 shadow-lg ${currentTheme.accentShadow} active:scale-95`}
                      >
                        <UserPlus size={16} />
                        <span>{t.addStaffAccount2}</span>
                      </button>
                    </div>
                  </div>

                  {accountGesturesNeedConnection && (
                    <div className={`flex items-start gap-2.5 p-3.5 rounded-2xl border text-2xs font-semibold leading-relaxed ${currentTheme.isDark ? 'bg-amber-950/30 border-amber-500/40 text-amber-200' : 'bg-amber-50 border-amber-300 text-amber-900'}`}>
                      <WifiOff size={16} className="flex-shrink-0 mt-0.5" />
                      <span>{t.accountGesturesOffline}</span>
                    </div>
                  )}

                  {/* Role Definitions & Stats Banner */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div className={`p-4 rounded-2xl border ${currentTheme.accentBorder} ${currentTheme.accentSoft}`}>
                      <div className="flex items-start justify-between gap-2 mb-1">
                        <span className={`text-2xs font-black uppercase tracking-wider leading-tight ${currentTheme.accentSoftText} flex min-w-0 items-center gap-1.5`}>
                          <Crown size={14} className="text-amber-500 flex-shrink-0" /> {t.promoterAdminsPlusGM}
                        </span>
                        <span className={`shrink-0 whitespace-nowrap text-xs font-black ${currentTheme.accentSoft} ${currentTheme.accentSoftText} px-2 py-0.5 rounded-full`}>
                          {userProfiles.filter(p => p.role === 'admin' || p.role === 'general_manager').length}
                        </span>
                      </div>
                      <p className={`text-2xs ${currentTheme.accentSoftText}`}>
                        {t.fullControlFeePolicyClosingSchoolYearsRoleAssignment}
                      </p>
                    </div>

                    <div className={`p-4 rounded-2xl border ${currentTheme.accentBorder} ${currentTheme.accentSoft}`}>
                      <div className="flex items-start justify-between gap-2 mb-1">
                        <span className={`text-2xs font-black uppercase tracking-wider leading-tight ${currentTheme.accentSoftText} flex min-w-0 items-center gap-1.5`}>
                          <Briefcase size={14} className="flex-shrink-0" /> {t.roleStaff}
                        </span>
                        <span className={`shrink-0 whitespace-nowrap text-xs font-black ${currentTheme.accentSoft} ${currentTheme.accentSoftText} px-2 py-0.5 rounded-full`}>
                          {userProfiles.filter(p => p.role === 'staff').length}
                        </span>
                      </div>
                      <p className={`text-2xs ${currentTheme.accentSoftText}`}>
                        {t.studentEnrollmentPaymentReceiptsPayrollDailyExpenses}
                      </p>
                    </div>

                    <div className={`p-4 rounded-2xl border ${currentTheme.border} ${currentTheme.isDark ? 'bg-teal-950/20 border-teal-500/30' : 'bg-teal-50/70 border-teal-200'}`}>
                      <div className="flex items-start justify-between gap-2 mb-1">
                        <span className="text-2xs font-black uppercase tracking-wider leading-tight text-teal-700 dark:text-teal-400 flex min-w-0 items-center gap-1.5">
                          <Receipt size={14} className="text-violet-500 flex-shrink-0" /> {t.roleEconome}
                        </span>
                        <span className="shrink-0 whitespace-nowrap text-xs font-black bg-teal-500/20 text-teal-800 dark:text-teal-400 px-2 py-0.5 rounded-full">
                          {userProfiles.filter(p => p.role === 'econome').length}
                        </span>
                      </div>
                      <p className={`text-2xs ${currentTheme.isDark ? 'text-teal-300/80' : 'text-teal-800'}`}>
                        {t.economeDailyFinancialEntries}
                      </p>
                    </div>

                    <div className={`p-4 rounded-2xl border ${currentTheme.border} ${currentTheme.isDark ? 'bg-purple-950/20 border-purple-500/30' : 'bg-purple-50/70 border-purple-200'}`}>
                      <div className="flex items-start justify-between gap-2 mb-1">
                        <span className="text-2xs font-black uppercase tracking-wider leading-tight text-purple-600 dark:text-purple-400 flex min-w-0 items-center gap-1.5">
                          <Zap size={14} className="text-amber-500 flex-shrink-0" /> {t.engineeringDev}
                        </span>
                        <span className="shrink-0 whitespace-nowrap text-xs font-black bg-purple-500/20 text-purple-700 dark:text-purple-400 px-2 py-0.5 rounded-full">
                          {userProfiles.filter(p => p.role === 'dev').length}
                        </span>
                      </div>
                      <p className={`text-2xs ${currentTheme.isDark ? 'text-purple-300/80' : 'text-purple-800'}`}>
                        {t.technicalSystemMaintenanceAndDatabaseMigrations}
                      </p>
                    </div>
                  </div>

                  {/* Filter & Search Bar */}
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                    <div className="relative min-w-0 flex-1">
                      {/* Un champ de RECHERCHE, et il le DIT. Un <input type="text">
                          voisin d'un champ mot de passe est, pour le gestionnaire de
                          mots de passe du navigateur, un champ « identifiant » : il y
                          versait l'e-mail du compte connecté, la liste se filtrait
                          dessus, et trois comptes paraissaient supprimés après un
                          « Définir mot de passe » annulé (2026-09-14). `type="search"`
                          et `autoComplete="off"` déclarent ce qu'il est : une recherche,
                          jamais une identité. */}
                      <input
                        type="search"
                        name="user-search"
                        autoComplete="off"
                        value={userSearchTerm}
                        onChange={(e) => setUserSearchTerm(e.target.value)}
                        placeholder={t.searchByNameOrEmail}
                        className={`w-full pl-10 pr-4 py-2.5 rounded-xl border ${currentTheme.border} ${currentTheme.isDark ? 'bg-white/5 text-white' : 'bg-slate-50 text-slate-800'} text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-emerald-500/30`}
                      />
                      <Users size={16} className={`pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 ${currentTheme.muted}`} />
                    </div>

                    <div className="flex max-w-full items-center gap-1 self-start overflow-x-auto p-1 bg-white/5 rounded-xl border border-white/10 sm:self-center">
                      {([
                        { id: 'all', label: t.all },
                        { id: 'admin', label: 'Admins' },
                        { id: 'staff', label: t.staff2 },
                        { id: 'econome', label: t.roleEconome },
                      ] as RoleTab[]).map((tab) => (
                        <button
                          key={tab.id}
                          onClick={() => setUserRoleFilter(tab.id)}
                          className={`whitespace-nowrap px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                            userRoleFilter === tab.id
                              ? `${currentTheme.accentBg} ${currentTheme.accentText} shadow-sm`
                              : `${currentTheme.muted} hover:text-white`
                          }`}
                        >
                          {tab.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Ce que le filtre MASQUE, dit au lieu d'être caché : une liste
                      filtrée ressemble à une liste amputée (ou vide), et « ils ont
                      disparu » a déjà été le verdict d'un écran qui ne disait rien.
                      Le bouton remet les deux filtres à zéro — la recherche ET
                      l'onglet de rôle, parce que les deux peuvent masquer. */}
                  {hiddenByFilter > 0 && (
                    <div className={`flex flex-wrap items-center justify-between gap-3 px-4 py-2.5 rounded-xl border ${currentTheme.border} ${currentTheme.card}`}>
                      <span className={`text-2xs font-bold ${currentTheme.muted}`}>
                        {t.usersHiddenByFilter.replace('{count}', String(hiddenByFilter))}
                      </span>
                      <button
                        onClick={() => { setUserSearchTerm(''); setUserRoleFilter('all'); }}
                        className={`text-2xs font-black uppercase tracking-wider ${currentTheme.accentSoftText} ${currentTheme.accentSoftTextHover} transition-colors`}
                      >
                        {t.clearUserFilter}
                      </button>
                    </div>
                  )}

                  {/* Registered Users Cards */}
                  <div className="space-y-3">
                    {visibleProfiles.length === 0 ? (
                      <div className={`text-xs ${currentTheme.muted} italic p-8 rounded-2xl text-center border ${currentTheme.border} ${currentTheme.card}`}>
                        {t.noUsersMatchingYourSearch}
                      </div>
                    ) : (
                      visibleProfiles
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
                                isCurrentUser ? currentTheme.accentBorder : currentTheme.border
                              } rounded-2xl gap-4 shadow-sm transition-all ${currentTheme.accentBorderHover}`}
                            >
                              <div className="flex items-center gap-4">
                                <div className={`w-12 h-12 rounded-2xl flex items-center justify-center font-black text-sm shadow-md flex-shrink-0 ${
                                  isDev ? 'bg-purple-600 text-white shadow-purple-500/20' :
                                  isAdmin ? `${currentTheme.accentBg} ${currentTheme.accentText} ${currentTheme.accentShadow}` :
                                  isGM ? 'bg-cyan-600 text-white shadow-cyan-500/20' :
                                  `${currentTheme.accentBg} ${currentTheme.accentText} ${currentTheme.accentShadow}`
                                }`}>
                                  {profile.fullName.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase()}
                                </div>
                                <div className="min-w-0">
                                  <div className="flex items-center gap-2 flex-wrap">
                                    <p className={`text-sm font-bold truncate ${currentTheme.isDark ? 'text-white' : 'text-slate-900'}`}>
                                      {profile.fullName}
                                    </p>
                                    {isCurrentUser && (
                                      <span className={`px-2 py-0.5 rounded-full text-3xs font-black uppercase tracking-wider ${currentTheme.accentSoft} ${currentTheme.accentSoftText} border ${currentTheme.accentBorder}`}>
                                        {t.you}
                                      </span>
                                    )}
                                    <span className={`px-2.5 py-0.5 rounded-full text-2xs font-black uppercase tracking-wider flex items-center gap-1 ${
                                      isDev
                                        ? 'bg-purple-500/20 text-purple-700 dark:text-purple-400 border border-purple-500/30'
                                        : isAdmin
                                        ? `${currentTheme.accentSoft} ${currentTheme.accentSoftText} border ${currentTheme.accentBorder}`
                                        : isGM
                                        ? 'bg-cyan-500/20 text-cyan-800 dark:text-cyan-400 border border-cyan-500/30'
                                        : `${currentTheme.accentSoft} ${currentTheme.accentSoftText} border ${currentTheme.accentBorder}`
                                    }`}>
                                      {isDev && <Zap size={12} className="text-amber-500 flex-shrink-0" />}
                                      {isAdmin && <Crown size={12} className="text-amber-500 flex-shrink-0" />}
                                      {isGM && <Compass size={12} className="text-violet-500 flex-shrink-0" />}
                                      {profile.role === 'staff' && <Briefcase size={12} className="flex-shrink-0" />}
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
                                    <label className={`text-2xs font-bold ${currentTheme.muted} hidden sm:inline`}>
                                      {t.role}
                                    </label>
                                    {/* Icône du rôle actif — hors <option> : le HTML interdit
                                        tout enfant non-texte dans <option> (erreur console
                                        « option cannot contain svg », icônes jamais rendues). */}
                                    {isAdmin ? <Crown size={14} className="text-amber-500 flex-shrink-0" />
                                      : isGM ? <Compass size={14} className="text-violet-500 flex-shrink-0" />
                                      : profile.role === 'econome' ? <Receipt size={14} className="text-violet-500 flex-shrink-0" />
                                      : <Briefcase size={14} className={`${currentTheme.accentSoftText} flex-shrink-0`} />}
                                    <select
                                      value={profile.role}
                                      disabled={updatingUserId === profile.id}
                                      onChange={(e) => handleUpdateRole(profile, e.target.value as AppRole)}
                                      className={`px-3 py-2 rounded-xl text-xs font-bold border transition-all cursor-pointer ${
                                        isAdmin
                                          ? `${currentTheme.accentSoft} ${currentTheme.accentBorder} ${currentTheme.accentSoftText} ${currentTheme.accentSoftHover}`
                                          : isGM
                                          ? 'bg-cyan-500/10 border-cyan-500/30 text-cyan-700 dark:text-cyan-300 hover:bg-cyan-500/20'
                                          : `${currentTheme.accentSoft} ${currentTheme.accentBorder} ${currentTheme.accentSoftText} ${currentTheme.accentSoftHover}`
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
                                  className={`px-3 py-2 bg-slate-800 ${currentTheme.hoverSurfaceStrong} text-white rounded-xl text-xs font-bold transition-all shadow-sm active:scale-95 flex items-center gap-1.5 border border-white/10`}
                                  title={t.setPassword}
                                >
                                  <Lock size={14} className="text-slate-400 flex-shrink-0" />
                                  <span>{t.setPassword}</span>
                                </button>

                                {/* Password Reset Email Button */}
                                <button
                                  onClick={() => handleSendPasswordReset(profile.email)}
                                  className={`px-3 py-2 bg-slate-800 ${currentTheme.hoverSurfaceStrong} text-white rounded-xl text-xs font-bold transition-all shadow-sm active:scale-95 flex items-center gap-1.5 border border-white/10`}
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
    </>
  );
}
