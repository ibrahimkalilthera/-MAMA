/**
 * Supabase Auth Hook for MAMA THERA Finance Suite
 * 
 * Provides authentication state, sign in/out, session restoration,
 * and user profile management (role-based access).
 *
 * ── Sign-in with no network (offline session) ───────────────────────────────
 * `signInWithPassword` is a network call, so a station whose line is down used
 * to be unable to open the application at all. This hook therefore has two
 * paths, and the ORDER between them is the whole rule:
 *
 *   1. the server answers → it decides. Its verdict is final, and a correct
 *      password makes this station REMEMBER the account (a PBKDF2 verifier,
 *      never the password — see src/lib/offlineCredentials.ts);
 *   2. the server is UNREACHABLE (never a refusal — a refused password is
 *      reported, never answered locally) → the account is checked against the
 *      verifier kept by this station from an earlier online sign-in.
 *
 * Such a session has no token, so nothing can be sent while it is active: the
 * domain layer queues every write (see `isOffline` in useSupabaseData) and the
 * password typed here is kept IN MEMORY ONLY, so that the moment the line
 * returns the hook silently signs in for real and the queue drains itself.
 */

import { useState, useEffect, useCallback } from 'react';
import { supabase } from './supabaseClient';
import { isAdminRole } from './deleteRights';
import { isConnectivityFailure, isStationOffline, setOfflineSessionActive } from './networkUtils';
import { setAuditActor } from './auditLogger';
import { enqueueOfflineAction } from './offlineQueue';
import { ACCOUNT_NEEDS_CONNECTION } from './accountGestures';
import {
  OFFLINE_ACCOUNT_LOCKED,
  OFFLINE_CRYPTO_UNAVAILABLE,
  OFFLINE_UNKNOWN_ACCOUNT,
  OFFLINE_WRONG_PASSWORD,
  rememberOfflineAccount,
  verifyOfflineAccount,
} from './offlineCredentials';
import type { User as SupabaseUser, Session, AuthError } from '@supabase/supabase-js';

// ─── Types ───────────────────────────────────────────────────────────────────

/**
 * Account roles, from most to least privileged:
 *  - dev            system developer, full technical access
 *  - admin          promoter / direction, full administrative access
 *  - general_manager Gestionnaire Principal: full FINANCE administration
 *                    (vendor expenses, scholarships, imports, staff & salary
 *                    writes) but NOT user management, settings or audit
 *  - staff / econome positions: daily entries only — two distinct job
 *    titles sharing the exact same (baseline) authority in the app
 */
export type AppRole = 'admin' | 'staff' | 'dev' | 'general_manager' | 'econome';

export interface UserProfile {
  id: string;
  email: string;
  fullName: string;
  role: AppRole;
}

export interface AuthState {
  /** The Supabase Auth user (null if not logged in) */
  user: SupabaseUser | null;
  /** The user's profile from user_profiles table (null if not loaded) */
  profile: UserProfile | null;
  /** True while checking session on initial page load */
  loading: boolean;
  /** Auth error message */
  error: string | null;
  /** Convenience: true if user is logged in and has admin role */
  isAdmin: boolean;
  /**
   * True when the open session came from THIS station's offline verifier: the
   * user is legitimately connected, but there is no token — so no server
   * round-trip is possible and every write is queued until the line returns.
   */
  isOfflineSession: boolean;
  /**
   * True when the connection came back but the automatic sign-in was REFUSED
   * (password changed server-side, account disabled, …). No automation can get
   * past that: someone has to sign in again.
   */
  reauthFailed: boolean;
  /** Sign in with email and password */
  signIn: (email: string, password: string) => Promise<{ success: boolean; error?: string }>;
  /** Sign out and clear session */
  signOut: () => Promise<void>;
  /** Fetch all user profiles (admin only) */
  fetchAllProfiles: () => Promise<UserProfile[]>;
  /** Update user role (admin only) */
  updateUserRole: (userId: string, newRole: AppRole) => Promise<boolean>;
  /** Create a new staff or admin user account */
  createStaffUser: (email: string, password: string, fullName: string, role: Extract<AppRole, 'admin' | 'staff' | 'general_manager' | 'econome'>) => Promise<{ success: boolean; error?: string }>;
  /** Trigger password reset email */
  sendPasswordReset: (email: string) => Promise<{ success: boolean; error?: string }>;
  /** Admin/dev only: set any account's password directly (no email). */
  setUserPassword: (userId: string, newPassword: string) => Promise<{ success: boolean; error?: string }>;
}

// ─── Helper: Map DB row to UserProfile ───────────────────────────────────────

function mapProfileRow(row: Record<string, unknown>): UserProfile {
  return {
    id: row.id as string,
    email: row.email as string,
    fullName: row.full_name as string,
    role: row.role as UserProfile['role'],
  };
}

// ─── Hook ────────────────────────────────────────────────────────────────────

export function useAuth(): AuthState {
  const [user, setUser] = useState<SupabaseUser | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // { email, secret }: the session opened by the local verifier, and the
  // password that opened it — kept in memory for the silent re-authentication.
  const [offlineSession, setOfflineSession] = useState<{ email: string; secret: string } | null>(null);
  const [reauthFailed, setReauthFailed] = useState(false);

  // ── Fetch profile from user_profiles table ──────────────────────────────

  const fetchProfile = useCallback(async (userId: string): Promise<UserProfile | null> => {
    const { data, error: profileError } = await supabase
      .from('user_profiles')
      .select('*')
      .eq('id', userId)
      .single();

    if (profileError) {
      console.warn('[MAMA THERA Auth] user_profiles query failed:', profileError.message);
      
      // Fallback: derive profile from Supabase Auth user metadata
      // This handles the case where PostgREST schema cache hasn't refreshed yet
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        const meta = user.user_metadata || {};
        console.info('[MAMA THERA Auth] Using auth metadata as fallback profile');
        return {
          id: user.id,
          email: user.email || '',
          fullName: meta.full_name || user.email || 'User',
          role: (['admin', 'dev', 'general_manager', 'econome'].includes(meta.role) ? meta.role : 'staff') as UserProfile['role'],
        };
      }
      return null;
    }

    return mapProfileRow(data);
  }, []);

  // ── Initialize: check existing session ──────────────────────────────────

  useEffect(() => {
    const initAuth = async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();

        if (session?.user) {
          setUser(session.user);
          const userProfile = await fetchProfile(session.user.id);
          setProfile(userProfile);
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error('[MAMA THERA Auth] Session init error:', msg);
      } finally {
        setLoading(false);
      }
    };

    initAuth();

    // Listen for auth state changes (login, logout, token refresh)
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, session) => {
        if (event === 'SIGNED_IN' && session?.user) {
          setUser(session.user);
          const userProfile = await fetchProfile(session.user.id);
          setProfile(userProfile);
          setError(null);
        } else if (event === 'SIGNED_OUT') {
          setUser(null);
          setProfile(null);
        } else if (event === 'TOKEN_REFRESHED' && session?.user) {
          setUser(session.user);
        }
      }
    );

    return () => {
      subscription.unsubscribe();
    };
  }, [fetchProfile]);

  // ── Sign In ─────────────────────────────────────────────────────────────

  const signIn = useCallback(async (
    email: string,
    password: string
  ): Promise<{ success: boolean; error?: string }> => {
    setError(null);
    const trimmedEmail = email.trim();

    // ── 1. La base d'abord, dès qu'un réseau existe ─────────────────────
    if (typeof navigator === 'undefined' || navigator.onLine) {
      // Un signInWithPassword peut AUSSI lever (panne réseau avant réponse) :
      // les deux formes sont ramenées à un `{ data, error }` unique.
      const outcome = await (async () => {
        try {
          return await supabase.auth.signInWithPassword({ email: trimmedEmail, password });
        } catch (thrown) {
          const message = thrown instanceof Error ? thrown.message : String(thrown);
          return {
            data: { user: null, session: null },
            error: { message, status: (thrown as { status?: number }).status ?? 0 } as unknown as AuthError,
          };
        }
      })();

      if (outcome.data?.user) {
        setUser(outcome.data.user);
        const userProfile = await fetchProfile(outcome.data.user.id);
        setProfile(userProfile);
        setOfflineSession(null);
        setReauthFailed(false);
        // L'empreinte hors ligne s'écrit APRÈS un succès RÉSEAU : c'est la base
        // qui a validé ce mot de passe, jamais cette vérification locale.
        if (userProfile) {
          void rememberOfflineAccount({
            email: userProfile.email || trimmedEmail,
            password,
            userId: userProfile.id,
            fullName: userProfile.fullName,
            role: userProfile.role,
          });
        }
        return { success: true };
      }

      // Un refus (mot de passe faux, compte désactivé) est RAPPORTÉ tel quel :
      // le vérificateur local ne doit jamais répondre à la place du serveur.
      if (!isConnectivityFailure(outcome.error, true)) {
        const msg = outcome.error?.message || 'Sign-in failed';
        setError(msg);
        return { success: false, error: msg };
      }
      // Sinon : serveur injoignable — c'est exactement le cas prévu plus bas.
    }

    // ── 2. Hors ligne : le vérificateur de CE poste ─────────────────────
    const result = await verifyOfflineAccount(trimmedEmail, password);
    if (result.status === 'ok') {
      setUser(null);
      setProfile({
        id: result.account.userId,
        email: result.account.email,
        fullName: result.account.fullName,
        role: result.account.role,
      });
      setReauthFailed(false);
      setOfflineSession({ email: result.account.email, secret: password });
      return { success: true };
    }

    const msg =
      result.status === 'wrong-password' ? OFFLINE_WRONG_PASSWORD :
      result.status === 'locked' ? OFFLINE_ACCOUNT_LOCKED :
      result.status === 'unavailable' ? OFFLINE_CRYPTO_UNAVAILABLE :
      OFFLINE_UNKNOWN_ACCOUNT;
    setError(msg);
    return { success: false, error: msg };
  }, [fetchProfile]);

  // ── Reconnexion silencieuse d'une session hors ligne ────────────────────
  // Le mot de passe tapé hors ligne vit en mémoire seulement, et c'est ce qui
  // permet à un poste qui a travaillé sans réseau de rejouer ses écritures tout
  // seul : dès que la ligne revient, une VRAIE session est rouverte, l'écran
  // rafraîchit ses données et la file hors ligne se vide.
  //
  // Un refus (mot de passe changé côté serveur, compte désactivé) n'est pas une
  // panne : insister ne produirait que le même refus, donc on le DIT.
  useEffect(() => {
    if (!offlineSession) return;
    const attempt = async () => {
      if (typeof navigator !== 'undefined' && !navigator.onLine) return;
      // Un signInWithPassword qui LÈVE (et non qui rend une erreur) arrive :
      // réponse coupée en cours de route, stockage indisponible… Un rejet non
      // capturé dans un gestionnaire d'événement ne réessaierait jamais et
      // ferait échouer l'application pour rien.
      let data: { user?: { id: string } | null } | null = null;
      let reauthError: unknown = null;
      try {
        const outcome = await supabase.auth.signInWithPassword({
          email: offlineSession.email,
          password: offlineSession.secret,
        });
        data = outcome.data;
        reauthError = outcome.error;
      } catch (thrown) {
        reauthError = thrown;
      }
      if (data?.user) {
        // Le listener SIGNED_IN charge le profil et lance le rafraîchissement :
        // ici on ne fait que refermer la session hors ligne.
        setReauthFailed(false);
        setOfflineSession(null);
        return;
      }
      // Une panne réseau n'est pas un refus : on attendra le prochain « online ».
      if (reauthError && !isConnectivityFailure(reauthError)) setReauthFailed(true);
    };
    void attempt();
    window.addEventListener('online', attempt);
    return () => window.removeEventListener('online', attempt);
  }, [offlineSession]);

  // ── Ce que le reste de l'app doit savoir de cette session ───────────────
  //
  // Deux faits, posés au niveau du MODULE — parce que les modules qui écrivent
  // en dehors du crochet de données (notes du calendrier, journal d'audit, année
  // scolaire) n'ont aucun autre moyen de les connaître :
  //
  //   • « cette station ne peut rien envoyer » — posé pour une session hors
  //     ligne, donc exactement la valeur passée à useSupabaseData : les deux ne
  //     peuvent pas diverger ;
  //   • QUI agit, pour que le journal nomme l'auteur d'un geste fait sans réseau
  //     (sans cela il était attribué à « System Staff », et le restait).
  useEffect(() => {
    setOfflineSessionActive(offlineSession !== null);
    setAuditActor(profile
      ? { id: profile.id, email: profile.email, full_name: profile.fullName, role: profile.role }
      : null);
  }, [offlineSession, profile]);

  // ── Sign Out ────────────────────────────────────────────────────────────

  const signOut = useCallback(async () => {
    // Ferme aussi la session hors ligne : sans cela, « se déconnecter » sur un
    // poste sans réseau laisserait l'application ouverte, ce qui est exactement
    // ce qu'un départ de poste ne doit pas faire.
    setOfflineSession(null);
    setReauthFailed(false);
    await supabase.auth.signOut();
    setUser(null);
    setProfile(null);
    setError(null);
  }, []);

  // ── Fetch All Profiles (Admin only) ─────────────────────────────────────

  const fetchAllProfiles = useCallback(async (): Promise<UserProfile[]> => {
    const { data, error: fetchError } = await supabase
      .from('user_profiles')
      .select('*')
      .order('created_at', { ascending: true });

    if (fetchError) {
      console.error('[MAMA THERA Auth] Failed to fetch profiles:', fetchError.message);
      return [];
    }

    return (data || []).map(mapProfileRow);
  }, []);

  const updateUserRole = useCallback(async (userId: string, newRole: AppRole): Promise<boolean> => {
    // Sans réseau (ou sans jeton), un rôle se MET EN FILE : c'est une ligne de
    // table, pas un appel d'authentification — rien ne justifie de le refuser.
    if (isStationOffline()) {
      enqueueOfflineAction('updateUserRole', { id: userId, role: newRole });
      return true;
    }
    // `.select('id')` et le contrôle de longueur : la policy réserve la
    // modification aux admins, et une requête retirée par la RLS revient en 200
    // avec un corps VIDE. L'ancienne version rendait `true` dans ce cas, donc
    // l'écran affichait un rôle que la base n'avait pas — la règle honnête que
    // portent déjà élèves, personnel, parents et dépenses.
    const { data: updated, error: updateError } = await supabase
      .from('user_profiles')
      .update({ role: newRole })
      .eq('id', userId)
      .select('id');

    if (updateError) {
      console.error('[MAMA THERA Auth] Failed to update role:', updateError.message);
      return false;
    }
    if (!updated || updated.length === 0) {
      console.error('[MAMA THERA Auth] Aucune ligne modifiée — cible filtrée par la policy RLS');
      return false;
    }
    return true;
  }, []);

  const createStaffUser = useCallback(async (
    email: string,
    password: string,
    fullName: string,
    role: 'admin' | 'staff' | 'general_manager' | 'econome'
  ): Promise<{ success: boolean; error?: string }> => {
    // Créer un COMPTE n'est pas écrire une ligne : c'est un appel à GoTrue
    // (signUp), qui n'a pas d'équivalent hors ligne. On le dit, au lieu de
    // laisser la tentative échouer avec un message de réseau.
    if (isStationOffline()) return { success: false, error: ACCOUNT_NEEDS_CONNECTION };
    try {
      const { createClient } = await import('@supabase/supabase-js');
      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
      const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

      const tempClient = createClient(supabaseUrl, supabaseAnonKey, {
        auth: {
          persistSession: false,
          autoRefreshToken: false,
        },
      });

      const { data, error: signUpError } = await tempClient.auth.signUp({
        email: email.trim(),
        password,
        options: {
          data: {
            full_name: fullName.trim(),
            role: role,
          },
        },
      });

      if (signUpError) {
        return { success: false, error: signUpError.message };
      }

      return { success: true };
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error creating user';
      return { success: false, error: msg };
    }
  }, []);

  const sendPasswordReset = useCallback(async (email: string): Promise<{ success: boolean; error?: string }> => {
    // Un courriel de réinitialisation part du SERVEUR : sans ligne, il n'y a
    // rien à mettre en file (et aucun mot de passe n'est stocké pour plus tard).
    if (isStationOffline()) return { success: false, error: ACCOUNT_NEEDS_CONNECTION };
    const { error: resetError } = await supabase.auth.resetPasswordForEmail(email);
    if (resetError) {
      console.error('[MAMA THERA Auth] Reset password error:', resetError.message);
      return { success: false, error: resetError.message };
    }
    return { success: true };
  }, []);

  // ── Admin/dev: set any account's password directly ──────────────────────
  // Backed by the SECURITY DEFINER RPC `admin_set_user_password` which
  // re-checks the caller's role server-side (only admin/dev profiles).

  const setUserPassword = useCallback(async (userId: string, newPassword: string): Promise<{ success: boolean; error?: string }> => {
    // Définir un mot de passe passe par le RPC `admin_set_user_password` : le
    // serveur seul peut le faire. Le code dit POURQUOI, ce qu'un « Failed to
    // fetch » ne dirait pas.
    if (isStationOffline()) return { success: false, error: ACCOUNT_NEEDS_CONNECTION };
    const { data, error: rpcError } = await supabase.rpc('admin_set_user_password', {
      target_user_id: userId,
      new_password: newPassword,
    });
    if (rpcError) {
      console.error('[MAMA THERA Auth] Set password error:', rpcError.message);
      return { success: false, error: rpcError.message };
    }
    return { success: data === true, error: data === true ? undefined : 'Failed to set password' };
  }, []);

  // ── Return ──────────────────────────────────────────────────────────────

  return {
    user,
    profile,
    loading,
    error,
    // La liste des rôles administrateurs vit dans src/lib/deleteRights.ts, à côté
    // de la règle de suppression qu'elle gouverne : deux listes écrites à la main
    // divergeraient, et la base, elle, n'en a qu'une (`public.is_admin()`).
    isAdmin: isAdminRole(profile?.role),
    isOfflineSession: offlineSession !== null,
    reauthFailed,
    signIn,
    signOut,
    fetchAllProfiles,
    updateUserRole,
    createStaffUser,
    sendPasswordReset,
    setUserPassword,
  };
}
