/**
 * Users/settings domain hook — extracted verbatim from App.tsx.
 *
 * Owns the user-management (settings tab) state: the add-user modal flag, the
 * list search/role filter and the in-flight update id — plus the three
 * handlers (`handleUpdateRole`, `handleToggleRole`,
 * `handleSendPasswordReset`) with their toast feedback. Deps injected:
 * the auth API (role update, password reset), the profiles slice + setter
 * (from useAuthWelcome) and the toast API.
 */
import { useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import type { AuthState, UserProfile } from '../lib/useAuth';
import type { useToast } from '../lib/useToast';
import type { TranslationDict } from '../i18n/translations';

import type { AppRole } from '../lib/useAuth';

export type UserRoleFilter = 'all' | 'admin' | 'staff' | 'dev' | 'general_manager' | 'econome';

export interface UseUsersDeps {
  t: TranslationDict;
  auth: Pick<AuthState, 'updateUserRole' | 'sendPasswordReset'>;
  userProfiles: UserProfile[];
  setUserProfiles: Dispatch<SetStateAction<UserProfile[]>>;
  toast: Pick<ReturnType<typeof useToast>, 'success' | 'error'>;
}

export function useUsers(deps: UseUsersDeps) {
  const { t, auth, userProfiles, setUserProfiles, toast } = deps;

  const [showAddUserModal, setShowAddUserModal] = useState(false);
  const [userSearchTerm, setUserSearchTerm] = useState('');
  const [userRoleFilter, setUserRoleFilter] = useState<UserRoleFilter>('all');
  const [updatingUserId, setUpdatingUserId] = useState<string | null>(null);

  const handleUpdateRole = async (targetProfile: UserProfile, newRole: AppRole) => {
    if (targetProfile.role === newRole) return;
    setUpdatingUserId(targetProfile.id);
    const ok = await auth.updateUserRole(targetProfile.id, newRole);
    if (ok) {
      setUserProfiles(prev => prev.map(p => p.id === targetProfile.id ? { ...p, role: newRole } : p));
      const roleLabel = newRole === 'admin' ? t.roleAdminPromoter : newRole === 'dev' ? t.roleDeveloper : newRole === 'general_manager' ? t.roleGeneralManager : newRole === 'econome' ? t.roleEconome : t.roleStaff;
      toast.success(t.roleUpdated.replace('{name}', targetProfile.fullName).replace('{role}', roleLabel));
    } else {
      toast.error(t.failedToUpdateRole);
    }
    setUpdatingUserId(null);
  };

  const handleToggleRole = async (targetProfile: UserProfile) => {
    const newRole = targetProfile.role === 'admin' ? 'staff' : 'admin';
    await handleUpdateRole(targetProfile, newRole);
  };

  const handleSendPasswordReset = async (email: string) => {
    const res = await auth.sendPasswordReset(email);
    if (res.success) {
      toast.success(t.passwordResetEmailSent.replace('{email}', email));
    } else {
      toast.error(res.error || (t.failedToSendResetEmail));
    }
  };

  return {
    showAddUserModal, setShowAddUserModal,
    userSearchTerm, setUserSearchTerm,
    userRoleFilter, setUserRoleFilter,
    updatingUserId, setUpdatingUserId,
    handleUpdateRole,
    handleToggleRole,
    handleSendPasswordReset,
  };
}
