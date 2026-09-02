/**
 * Supabase Auth Hook for MAMA THERA Finance Suite
 * 
 * Provides authentication state, sign in/out, session restoration,
 * and user profile management (role-based access).
 */

import { useState, useEffect, useCallback } from 'react';
import { supabase } from './supabaseClient';
import type { User as SupabaseUser, Session } from '@supabase/supabase-js';

// ─── Types ───────────────────────────────────────────────────────────────────

/**
 * Account roles, from most to least privileged:
 *  - dev            system developer, full technical access
 *  - admin          promoter / direction, full administrative access
 *  - general_manager Gestionnaire Principal: full FINANCE administration
 *                    (vendor expenses, scholarships, imports, staff & salary
 *                    writes) but NOT user management, settings or audit
 *  - staff          accountant: daily entries only
 */
export type AppRole = 'admin' | 'staff' | 'dev' | 'general_manager';

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
  /** Sign in with email and password */
  signIn: (email: string, password: string) => Promise<{ success: boolean; error?: string }>;
  /** Sign out and clear session */
  signOut: () => Promise<void>;
  /** Fetch all user profiles (admin only) */
  fetchAllProfiles: () => Promise<UserProfile[]>;
  /** Update user role (admin only) */
  updateUserRole: (userId: string, newRole: AppRole) => Promise<boolean>;
  /** Create a new staff or admin user account */
  createStaffUser: (email: string, password: string, fullName: string, role: Extract<AppRole, 'admin' | 'staff' | 'general_manager'>) => Promise<{ success: boolean; error?: string }>;
  /** Trigger password reset email */
  sendPasswordReset: (email: string) => Promise<{ success: boolean; error?: string }>;
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
          role: (['admin', 'dev', 'general_manager'].includes(meta.role) ? meta.role : 'staff') as UserProfile['role'],
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

    const { data, error: signInError } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (signInError) {
      const msg = signInError.message;
      setError(msg);
      return { success: false, error: msg };
    }

    if (data.user) {
      setUser(data.user);
      const userProfile = await fetchProfile(data.user.id);
      setProfile(userProfile);
    }

    return { success: true };
  }, [fetchProfile]);

  // ── Sign Out ────────────────────────────────────────────────────────────

  const signOut = useCallback(async () => {
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
    const { error: updateError } = await supabase
      .from('user_profiles')
      .update({ role: newRole })
      .eq('id', userId);

    if (updateError) {
      console.error('[MAMA THERA Auth] Failed to update role:', updateError.message);
      return false;
    }
    return true;
  }, []);

  const createStaffUser = useCallback(async (
    email: string,
    password: string,
    fullName: string,
    role: 'admin' | 'staff' | 'general_manager'
  ): Promise<{ success: boolean; error?: string }> => {
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
    const { error: resetError } = await supabase.auth.resetPasswordForEmail(email);
    if (resetError) {
      console.error('[MAMA THERA Auth] Reset password error:', resetError.message);
      return { success: false, error: resetError.message };
    }
    return { success: true };
  }, []);

  // ── Return ──────────────────────────────────────────────────────────────

  return {
    user,
    profile,
    loading,
    error,
    isAdmin: profile?.role === 'admin' || profile?.role === 'dev',
    signIn,
    signOut,
    fetchAllProfiles,
    updateUserRole,
    createStaffUser,
    sendPasswordReset,
  };
}
