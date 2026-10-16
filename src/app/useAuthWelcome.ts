/**
 * Auth/welcome domain hook — extracted verbatim from App.tsx.
 *
 * Owns everything session-and-greeting: the useAuth instance (with the
 * currentUser derivation, promoter flag and loading state), the first
 * sign-in welcome banner (message state, 5s auto-dismiss, re-arm when the
 * profile changes), the admin-only user-profiles list fetch, and the tab
 * guard that keeps RESERVED tabs out of reach of a role whose right does not
 * open them. App.tsx only consumes the returned API; the Settings user-manager
 * UI state stays in App.tsx.
 */
import { useEffect, useMemo, useState } from 'react';
import type { TranslationDict } from '../i18n/translations';
import { useAuth } from '../lib/useAuth';
import type { UserProfile } from '../lib/useAuth';
import { canOpenTab, isReservedTab } from './tabRights';
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
  | 'silentReceipts'
  | 'audit'
  | 'paymentHistory';

interface AuthWelcomeDeps {
  t: TranslationDict;
  activeTab: MainTab;
  setActiveTab: (tab: MainTab) => void;
}

export function useAuthWelcome(deps: AuthWelcomeDeps) {
  const { t, activeTab, setActiveTab } = deps;

  // ── Supabase Auth ──────────────────────────────────────────────────────
  const auth = useAuth();

  // Derive currentUser from auth profile for backward compatibility.
  // Memoized on the profile: a fresh object literal per render would break
  // every effect keyed on currentUser (the calendar-notes fetch used to loop
  // endlessly — one GET per render).
  const currentUser: User | null = useMemo(
    () => auth.profile
      ? {
          username: auth.profile.fullName,
          role: auth.profile.role,
          name: auth.profile.fullName,
        }
      : null,
    [auth.profile],
  );
  const isPromoter = auth.isAdmin;
  // Gestionnaire Principal: finance admin without user-management/settings/audit.
  const isGeneralManager = auth.profile?.role === 'general_manager';

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
      // Session ended — hide the greeting so it cannot linger on the login
      // screen, and the next login shows it again (hasShownWelcome re-armed).
      setWelcomeMessage(null);
    }
    // setActiveTab is the useState setter App passes in — stable, listed for
    // exhaustive-deps since it arrives as a prop here, not from a local useState.
  }, [authProfile, hasShownWelcome, authIsAdmin, fetchAllProfiles, t.welcomeBackName, setActiveTab]);

  // ── Le filet d'onglet : UNE question, et la table y répond ────────────────
  //
  // CE QU'IL FAISAIT, ET POURQUOI CE N'EST PLUS ÉCRIT ICI. Il portait sa PROPRE
  // liste — « `!auth.isAdmin` ⇒ settings, audit ET paymentHistory » — et la
  // ligne du rail la sienne. Les deux ont divergé le 2026-10-15 : la migration
  // `20261020000000_econome_payment_history.sql` a ouvert la lecture à l'économe,
  // le rail a suivi, ce filet non. L'économe voyait la ligne, cliquait, et
  // l'onglet revenait au tableau de bord dans la même seconde : la
  // fonctionnalité était morte À L'ÉCRAN tout en paraissant ouverte, et aucun des
  // cas verts de la veille ne le disait — le rail et l'écran étaient mesurés, ce
  // filet ne l'était pas.
  //
  // Il ne décide donc plus : il DEMANDE aux trois fonctions de
  // `src/app/tabRights.ts` (la seule table qui nomme un onglet réservé et son
  // droit, dont les listes de rôles viennent de `src/lib/*Rights.ts`). Un onglet
  // neuf n'ajoute aucune ligne ici : la boucle le couvre, et les trois surfaces
  // (rail, barre, filet) suivent ensemble parce qu'elles lisent la même table.
  //
  // Un rôle absent (profil pas encore chargé) n'ouvre aucun onglet réservé : le
  // doute ne s'écrit pas comme un droit.
  const role = auth.profile?.role;
  useEffect(() => {
    if (isReservedTab(activeTab) && !canOpenTab(activeTab, role)) {
      setActiveTab('dashboard');
    }
  }, [activeTab, role, setActiveTab]);

  return {
    auth,
    currentUser,
    isPromoter,
    isGeneralManager,
    authLoading,
    userProfiles,
    setUserProfiles,
    welcomeMessage,
    setWelcomeMessage,
  };
}