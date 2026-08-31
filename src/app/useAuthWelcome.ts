/**
 * Auth/welcome domain hook — extracted verbatim from App.tsx.
 *
 * Owns everything session-and-greeting: the useAuth instance (with the
 * currentUser derivation, promoter flag and loading state), the first
 * sign-in welcome banner (message state, 5s auto-dismiss, re-arm when the
 * profile changes), the admin-only user-profiles list fetch, and the tab
 * guard that keeps admin-only tabs out of reach for non-admins. App.tsx
 * only consumes the returned API; the Settings user-manager UI state stays
 * in App.tsx.
 */
import { useEffect, useState } from 'react';
import type { TranslationDict } from '../i18n/translations';
import { useAuth } from '../lib/useAuth';
import type { UserProfile } from '../lib/useAuth';
import type { User } from './types';

export type MainTab =
  | 'dashboard'
  | 'students'
  | 'parents'
  | 'payroll'
  | 'expenses'
  | 'settings'
  | 'calendar'
  | 'notes'
  | 'archives'
  | 'audit';

interface AuthWelcomeDeps {
  t: TranslationDict;
  activeTab: MainTab;
  setActiveTab: (tab: MainTab) => void;
}

export function useAuthWelcome(deps: AuthWelcomeDeps) {
  const { t, activeTab, setActiveTab } = deps;

  // ── Supabase Auth ──────────────────────────────────────────────────────
  const auth = useAuth();

  // Derive currentUser from auth profile for backward compatibility
  const currentUser: User | null = auth.profile
    ? {
        username: auth.profile.fullName,
        role: auth.profile.role,
        name: auth.profile.fullName,
      }
    : null;
  const isPromoter = auth.isAdmin;

  // Auth loading state (checking session on page load)
  const authLoading = auth.loading;

  // User profiles list (for user & role management in Settings)
  const [userProfiles, setUserProfiles] = useState<UserProfile[]>([]);

  const [welcomeMessage, setWelcomeMessage] = useState<string | null>(null);

  // Show welcome message when auth profile loads for the first time.
  // The stable pieces of `auth` are destructured so the effect can list precise
  // dependencies — the whole `auth` object is recreated on every render.
  const [hasShownWelcome, setHasShownWelcome] = useState(false);
  const { profile: authProfile, isAdmin: authIsAdmin, fetchAllProfiles } = auth;
  useEffect(() => {
    if (authProfile && !hasShownWelcome) {
      setHasShownWelcome(true);
      setActiveTab('dashboard');
      const displayName = authProfile.fullName || authProfile.email;
      setWelcomeMessage(t.welcomeBackName.replace('{name}', displayName));
      setTimeout(() => {
        setWelcomeMessage(null);
      }, 5000);

      // Fetch user profiles for admin
      if (authIsAdmin) {
        fetchAllProfiles().then(profiles => setUserProfiles(profiles));
      }
    }
    if (!authProfile) {
      setHasShownWelcome(false);
    }
    // setActiveTab is the useState setter App passes in — stable, listed for
    // exhaustive-deps since it arrives as a prop here, not from a local useState.
  }, [authProfile, hasShownWelcome, authIsAdmin, fetchAllProfiles, t.welcomeBackName, setActiveTab]);

  // Safety net: keep admin-only tabs (System Settings / Audit Trail) out of reach
  // for non-admin, non-dev accounts
  useEffect(() => {
    if (!auth.isAdmin && (activeTab === 'settings' || activeTab === 'audit')) {
      setActiveTab('dashboard');
    }
  }, [activeTab, auth.isAdmin, setActiveTab]);

  return {
    auth,
    currentUser,
    isPromoter,
    authLoading,
    userProfiles,
    setUserProfiles,
    welcomeMessage,
    setWelcomeMessage,
  };
}