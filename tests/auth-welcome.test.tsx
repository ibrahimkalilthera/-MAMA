/**
 * happy-dom unit tests for the useAuthWelcome domain hook (session +
 * greeting shell). `useAuth` is mocked at the module level (node:test
 * --experimental-test-module-mocks) so the hook can be exercised without
 * Supabase; the mutable fixture lets tests flip the profile/role/loading
 * between renders:
 *   1. the welcome banner shows once the profile loads (name interpolated,
 *      tab reset to dashboard) and auto-dismisses after 5 s;
 *   2. it never shows before the profile is there, and re-arms when the
 *      session disappears;
 *   3. admins fetch the profile list into userProfiles;
 *   4. the tab guard bounces non-admin accounts out of settings/audit;
 *   5. the currentUser/isPromoter/isGeneralManager derivations.
 */
import { describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';
import { act } from 'react';
import { translations } from '../src/i18n/translations';
import type { TranslationDict } from '../src/i18n/translations';
import type { AuthState, UserProfile } from '../src/lib/useAuth';
import { installDomGlobals, renderHook } from './harness';

const t = translations.fr as TranslationDict;

installDomGlobals();

// ── module mock: useAuth (registered BEFORE importing the hook) ─────────────
let authFixture: AuthState = {
  user: null,
  profile: null,
  loading: false,
  error: null,
  isAdmin: false,
  signIn: async () => ({ success: true }),
  signOut: async () => {},
  fetchAllProfiles: async () => [],
  updateUserRole: async () => true,
  createStaffUser: async () => ({ success: true }),
  sendPasswordReset: async () => ({ success: true }),
  setUserPassword: async () => ({ success: true }),
};

mock.module('../src/lib/useAuth', {
  namedExports: {
    useAuth: () => authFixture,
  },
});

const { useAuthWelcome } = await import('../src/app/useAuthWelcome');
import type { MainTab } from '../src/app/useAuthWelcome';

const profile = (overrides: Partial<UserProfile> = {}): UserProfile => ({
  id: 'u1', email: 'ibrahim@mamathera.org', fullName: 'Ibrahim Thera', role: 'dev', ...overrides,
});

type Api = ReturnType<typeof useAuthWelcome>;

function render(activeTab: MainTab = 'dashboard') {
  const tabs: MainTab[] = [];
  const { api, unmount, rerender } = renderHook(
    useAuthWelcome,
    { t, activeTab, setActiveTab: (tab: MainTab) => { tabs.push(tab); } },
  );
  return { api, unmount, rerender, tabs };
}

function adminProfile(): AuthState {
  return {
    ...authFixture,
    profile: profile(),
    isAdmin: true,
    fetchAllProfiles: async () => [
      profile({ id: 'u1' }),
      profile({ id: 'u2', email: 'awa@x.org', fullName: 'Awa Ndiaye', role: 'staff' }),
    ],
  };
}

describe('useAuthWelcome', () => {
  it('shows the welcome banner once, resets the tab, and auto-dismisses after 5 s', (ctx) => {
    ctx.mock.timers.enable({ apis: ['setTimeout'] });
    authFixture = adminProfile();
    const { api, unmount, tabs } = render('students');
    assert.equal(api.current!.welcomeMessage, t.welcomeBackName.replace('{name}', 'Ibrahim Thera'));
    assert.deepEqual(tabs, ['dashboard'], 'tab reset to dashboard on first profile load');

    act(() => { ctx.mock.timers.tick(5000); });
    assert.equal(api.current!.welcomeMessage, null, 'banner auto-dismissed');
    act(() => unmount());
    ctx.mock.timers.reset();
  });

  it('does not greet before the profile loads and re-arms when the session drops', (ctx) => {
    ctx.mock.timers.enable({ apis: ['setTimeout'] });
    authFixture = { ...authFixture, profile: null, isAdmin: false };
    const { api, unmount, rerender } = render();
    assert.equal(api.current!.welcomeMessage, null, 'no banner while logged out');

    // profile arrives → banner appears
    authFixture = { ...authFixture, profile: profile(), isAdmin: true };
    rerender({ t, activeTab: 'dashboard', setActiveTab: () => {} });
    assert.equal(api.current!.welcomeMessage, t.welcomeBackName.replace('{name}', 'Ibrahim Thera'));

    // session drops → banner cleared, re-armed for the next login
    act(() => { authFixture = { ...authFixture, profile: null, isAdmin: false }; });
    rerender({ t, activeTab: 'dashboard', setActiveTab: () => {} });
    assert.equal(api.current!.welcomeMessage, null);
    act(() => unmount());
    ctx.mock.timers.reset();
  });

  it('admins fetch the profile list into userProfiles', async () => {
    authFixture = adminProfile();
    const { api, unmount, rerender } = render();
    rerender({ t, activeTab: 'dashboard', setActiveTab: () => {} }); // re-fire the effect with the admin profile
    await act(async () => {});
    assert.equal(api.current!.userProfiles.length, 2);
    assert.deepEqual(api.current!.userProfiles.map((p) => p.role).sort(), ['dev', 'staff']);
    act(() => unmount());
  });

  it('bounces non-admin accounts out of settings and audit', () => {
    // No profile (fresh session check) so the welcome effect cannot fire
    // and muddy the guard's tab-reset count.
    authFixture = { ...authFixture, profile: null, isAdmin: false };
    const { api, unmount, tabs } = render('settings');
    assert.deepEqual(tabs, ['dashboard'], 'settings forced back to dashboard exactly once');
    assert.equal(api.current!.isGeneralManager, false);
    act(() => unmount());

    const { unmount: unmount2, tabs: tabs2 } = render('audit');
    assert.deepEqual(tabs2, ['dashboard'], 'audit forced back to dashboard exactly once');
    act(() => unmount2());
  });

  it('derives currentUser, promoter flag and general-manager flag from the profile', () => {
    authFixture = { ...authFixture, profile: profile({ role: 'general_manager' }), isAdmin: false };
    const { api, unmount } = render();
    assert.deepEqual(api.current!.currentUser, { username: 'Ibrahim Thera', role: 'general_manager', name: 'Ibrahim Thera' });
    assert.equal(api.current!.isPromoter, false);
    assert.equal(api.current!.isGeneralManager, true);
    act(() => unmount());

    authFixture = { ...authFixture, profile: profile({ role: 'dev' }), isAdmin: true };
    const { api: api2, unmount: unmount2 } = render();
    assert.equal(api2.current!.isPromoter, true);
    assert.equal(api2.current!.isGeneralManager, false);
    act(() => unmount2());
  });
});