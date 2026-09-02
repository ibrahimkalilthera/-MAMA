/**
 * Add Staff / User Account modal extracted from App.tsx.
 *
 * Owns the new-user form state and the user-creation flow; App.tsx only
 * toggles visibility and passes the auth service + toast helpers.
 */

import { useState, useRef, FormEvent } from 'react';
import { motion } from 'motion/react';
import { UserPlus } from 'lucide-react';
import type { TranslationDict } from '../i18n/translations';
import type { UserProfile } from '../lib/useAuth';
import { useEscapeToClose } from '../lib/useEscapeToClose';
import { useFocusTrap } from '../lib/focusStack';

export interface NewUserForm {
  fullName: string;
  email: string;
  password: string;
  role: 'admin' | 'staff' | 'general_manager' | 'econome';
}

export interface AddUserModalProps {
  onClose: () => void;
  onCreated: (profiles: UserProfile[]) => void;
  createStaffUser: (
    email: string,
    password: string,
    fullName: string,
    role: 'admin' | 'staff' | 'general_manager' | 'econome',
  ) => Promise<{ success: boolean; error?: string }>;
  fetchAllProfiles: () => Promise<UserProfile[]>;
  t: TranslationDict;
  themeCard: string;
  themeBorder: string;
  themeMuted: string;
  themeIsDark: boolean;
  toastError: (msg: string) => void;
  toastSuccess: (msg: string) => void;
}

const EMPTY_FORM: NewUserForm = {
  fullName: '',
  email: '',
  password: '',
  role: 'staff',
};

export const AddUserModal = ({
  onClose,
  onCreated,
  createStaffUser,
  fetchAllProfiles,
  t,
  themeCard,
  themeBorder,
  themeMuted,
  themeIsDark,
  toastError,
  toastSuccess,
}: AddUserModalProps) => {
  const [newUserForm, setNewUserForm] = useState<NewUserForm>(EMPTY_FORM);
  const [isCreatingUser, setIsCreatingUser] = useState(false);

  // Escape behaves like the cancel button (mounted only while open).
  useEscapeToClose(true, onClose);
  // Tab is confined to the dialog; focus returns to the trigger on close.
  const rootRef = useRef<HTMLDivElement | null>(null);
  useFocusTrap(true, () => rootRef.current);

  const handleCreateUser = async (e: FormEvent) => {
    e.preventDefault();
    if (!newUserForm.email.trim() || !newUserForm.password || !newUserForm.fullName.trim()) {
      toastError(t.pleaseFillInAllFields);
      return;
    }
    if (newUserForm.password.length < 6) {
      toastError(t.passwordMustBeAtLeast6Characters);
      return;
    }
    setIsCreatingUser(true);
    const res = await createStaffUser(
      newUserForm.email,
      newUserForm.password,
      newUserForm.fullName,
      newUserForm.role
    );
    setIsCreatingUser(false);

    if (res.success) {
      toastSuccess(t.accountCreated.replace('{name}', newUserForm.fullName));
      setNewUserForm(EMPTY_FORM);
      onClose();
      // Reload profiles
      const profiles = await fetchAllProfiles();
      onCreated(profiles);
    } else {
      toastError(t.errorCreatingUser.replace('{error}', res.error || ''));
    }
  };

  return (
    <div ref={rootRef} role="dialog" aria-modal="true" aria-label={t.addStaffAccount} aria-labelledby="modal-title-add-staff-account" className="fixed inset-0 z-[120] flex items-center justify-center p-4">
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
        className="absolute inset-0 bg-slate-950/70 backdrop-blur-md"
      />
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 20 }}
        className={`relative w-full max-w-lg ${themeCard} rounded-3xl border ${themeBorder} shadow-2xl overflow-hidden`}
      >
        {/* Header */}
        <div className="p-6 border-b border-white/10 bg-[#0F172A] text-white flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-emerald-600 flex items-center justify-center shadow-lg shadow-emerald-600/30">
              <UserPlus size={20} className="text-white" />
            </div>
            <div>
              <h3 id="modal-title-add-staff-account" className="font-bold text-base">
                {t.addStaffAccount}
              </h3>
              <p className="text-[11px] text-white/50">
                {t.createALoginAndAssignInitialAccessRole}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-xl text-white/60 hover:text-white hover:bg-white/10 transition-all text-sm font-bold"
          >
            ✕
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleCreateUser} className="p-6 space-y-4">
          <div className="space-y-1.5">
            <label className={`text-[10px] font-black ${themeMuted} uppercase tracking-widest`}>
              {t.fullName2}
            </label>
            <input
              type="text"
              required
              value={newUserForm.fullName}
              onChange={(e) => setNewUserForm({ ...newUserForm, fullName: e.target.value })}
              placeholder={t.eGAminataTraor}
              className={`w-full px-4 py-3 rounded-xl border ${themeBorder} ${
                themeIsDark ? 'bg-white/5 text-white' : 'bg-slate-50 text-slate-900'
              } text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-emerald-500/30`}
            />
          </div>

          <div className="space-y-1.5">
            <label className={`text-[10px] font-black ${themeMuted} uppercase tracking-widest`}>
              {t.email}
            </label>
            <input
              type="email"
              required
              value={newUserForm.email}
              onChange={(e) => setNewUserForm({ ...newUserForm, email: e.target.value })}
              placeholder="nom@mamathera.org"
              className={`w-full px-4 py-3 rounded-xl border ${themeBorder} ${
                themeIsDark ? 'bg-white/5 text-white' : 'bg-slate-50 text-slate-900'
              } text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-emerald-500/30`}
            />
          </div>

          <div className="space-y-1.5">
            <label className={`text-[10px] font-black ${themeMuted} uppercase tracking-widest`}>
              {t.initialPasswordMin6Characters}
            </label>
            <input
              type="password"
              required
              minLength={6}
              value={newUserForm.password}
              onChange={(e) => setNewUserForm({ ...newUserForm, password: e.target.value })}
              placeholder="••••••••"
              className={`w-full px-4 py-3 rounded-xl border ${themeBorder} ${
                themeIsDark ? 'bg-white/5 text-white' : 'bg-slate-50 text-slate-900'
              } text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-emerald-500/30`}
            />
          </div>

          {/* Role selection */}
          <div className="space-y-2 pt-1">
            <label className={`text-[10px] font-black ${themeMuted} uppercase tracking-widest`}>
              {t.assignedRolePermissions}
            </label>
            <div className="grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => setNewUserForm({ ...newUserForm, role: 'staff' })}
                className={`p-3.5 rounded-2xl border text-left transition-all ${
                  newUserForm.role === 'staff'
                    ? 'border-blue-500 bg-blue-500/10 ring-2 ring-blue-500/30'
                    : `${themeBorder} hover:bg-white/5`
                }`}
              >
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-base">💼</span>
                  <span className={`text-xs font-bold ${newUserForm.role === 'staff' ? 'text-blue-500' : themeIsDark ? 'text-white' : 'text-slate-800'}`}>
                    {t.roleStaff}
                  </span>
                </div>
                <p className={`text-[10px] ${themeMuted} leading-snug`}>
                  {t.dailyEntriesFeesReceiptsStudentsExpenses}
                </p>
              </button>
              <button
                type="button"
                onClick={() => setNewUserForm({ ...newUserForm, role: 'econome' })}
                className={`p-3.5 rounded-2xl border text-left transition-all ${
                  newUserForm.role === 'econome'
                    ? 'border-blue-500 bg-blue-500/10 ring-2 ring-blue-500/30'
                    : `${themeBorder} hover:bg-white/5`
                }`}
              >
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-base">🧾</span>
                  <span className={`text-xs font-bold ${newUserForm.role === 'econome' ? 'text-blue-500' : themeIsDark ? 'text-white' : 'text-slate-800'}`}>
                    {t.roleEconome}
                  </span>
                </div>
                <p className={`text-[10px] ${themeMuted} leading-snug`}>
                  {t.dailyEntriesFeesReceiptsStudentsExpenses}
                </p>
              </button>
              <button
                type="button"
                onClick={() => setNewUserForm({ ...newUserForm, role: 'general_manager' })}
                className={`p-3.5 rounded-2xl border text-left transition-all ${
                  newUserForm.role === 'general_manager'
                    ? 'border-cyan-500 bg-cyan-500/10 ring-2 ring-cyan-500/30'
                    : `${themeBorder} hover:bg-white/5`
                }`}>
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-base">🧭</span>
                  <span className={`text-xs font-bold ${newUserForm.role === 'general_manager' ? 'text-cyan-500' : themeIsDark ? 'text-white' : 'text-slate-800'}`}>
                    {t.generalManager}
                  </span>
                </div>
                <p className={`text-[10px] ${themeMuted} leading-snug`}>
                  {t.generalManagerFullAdministrationFinancialAccess}
                </p>
              </button>

              <button
                type="button"
                onClick={() => setNewUserForm({ ...newUserForm, role: 'admin' })}
                className={`p-3.5 rounded-2xl border text-left transition-all ${
                  newUserForm.role === 'admin'
                    ? 'border-emerald-500 bg-emerald-500/10 ring-2 ring-emerald-500/30'
                    : `${themeBorder} hover:bg-white/5`
                }`}>
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-base">👑</span>
                  <span className={`text-xs font-bold ${newUserForm.role === 'admin' ? 'text-emerald-500' : themeIsDark ? 'text-white' : 'text-slate-800'}`}>
                    {t.promoterAdmin}
                  </span>
                </div>
                <p className={`text-[10px] ${themeMuted} leading-snug`}>
                  {t.fullAdministrativeControlClosingYearsRoleEdits}
                </p>
              </button>
            </div>
          </div>

          {/* Submit & Cancel */}
          <div className="flex items-center justify-end gap-3 pt-4 border-t border-white/10">
            <button
              type="button"
              onClick={onClose}
              className={`px-4 py-2.5 rounded-xl text-xs font-bold ${themeMuted} hover:text-white transition-all`}
            >
              {t.cancel}
            </button>
            <button
              type="submit"
              disabled={isCreatingUser}
              className="bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white px-6 py-2.5 rounded-xl text-xs font-black transition-all flex items-center gap-2 shadow-lg shadow-emerald-600/20 active:scale-95"
            >
              {isCreatingUser ? (
                <>
                  <div className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  <span>{t.creating}</span>
                </>
              ) : (
                <>
                  <UserPlus size={15} />
                  <span>{t.createAccount}</span>
                </>
              )}
            </button>
          </div>
        </form>
      </motion.div>
    </div>
  );
};
