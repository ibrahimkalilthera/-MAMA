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
// Module SANS dépendance à Supabase (voir son en-tête) : l'importer depuis
// `useAuth` tirerait le client, que le runner de tests ne peut pas charger.
import { isConnectionRequiredError } from '../lib/accountGestures';
import { isStationOffline } from '../lib/networkUtils';

export type UserRoleFilter = 'all' | 'admin' | 'staff' | 'dev' | 'general_manager' | 'econome';

export interface UseUsersDeps {
  t: TranslationDict;
  auth: Pick<AuthState, 'updateUserRole' | 'sendPasswordReset' | 'setUserPassword'>;
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
  /** Target of the direct password-set modal (null = modal closed). */
  const [passwordTarget, setPasswordTarget] = useState<UserProfile | null>(null);
  const [passwordInput, setPasswordInput] = useState('');

  const handleUpdateRole = async (targetProfile: UserProfile, newRole: AppRole) => {
    if (targetProfile.role === newRole) return;
    setUpdatingUserId(targetProfile.id);
    const ok = await auth.updateUserRole(targetProfile.id, newRole);
    if (ok) {
      setUserProfiles(prev => prev.map(p => p.id === targetProfile.id ? { ...p, role: newRole } : p));
      const roleLabel = newRole === 'admin' ? t.roleAdminPromoter : newRole === 'dev' ? t.roleDeveloper : newRole === 'general_manager' ? t.roleGeneralManager : newRole === 'econome' ? t.roleEconome : t.roleStaff;
      // Hors ligne le rôle part en file : le dire, sinon l'utilisateur croit que
      // c'est déjà dans la base (ce qui est exactement le malentendu à éviter).
      const message = isStationOffline() ? t.roleUpdatedOffline : t.roleUpdated;
      toast.success(message.replace('{name}', targetProfile.fullName).replace('{role}', roleLabel));
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
      // « Nécessite la connexion » plutôt que le code brut : ce geste ne peut pas
      // attendre la ligne, et l'écran doit le dire dans la langue de l'école.
      toast.error(isConnectionRequiredError(res.error) ? t.accountNeedsConnection : (res.error || t.failedToSendResetEmail));
    }
  };

  const handleSetPassword = async () => {
    if (!passwordTarget || passwordInput.trim().length < 6) return;
    const res = await auth.setUserPassword(passwordTarget.id, passwordInput.trim());
    if (res.success) {
      toast.success(t.passwordUpdated.replace('{name}', passwordTarget.fullName));
      setPasswordTarget(null);
      setPasswordInput('');
    } else {
      toast.error(isConnectionRequiredError(res.error) ? t.accountNeedsConnection : (res.error || t.failedToSetPassword));
    }
  };

  return {
    showAddUserModal, setShowAddUserModal,
    userSearchTerm, setUserSearchTerm,
    userRoleFilter, setUserRoleFilter,
    updatingUserId, setUpdatingUserId,
    passwordTarget, setPasswordTarget,
    passwordInput, setPasswordInput,
    handleUpdateRole,
    handleToggleRole,
    handleSendPasswordReset,
    handleSetPassword,
  };
}
