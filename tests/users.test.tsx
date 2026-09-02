/**
 * happy-dom unit tests for the useUsers domain hook (settings / role management).
 *
 * The hook is rendered for real (spy auth API + toast, happy-dom globals):
 *   1. handleUpdateRole is a no-op when the target already has the role;
 *   2. success — auth.updateUserRole is called, the local profile is updated
 *      through setUserProfiles and a localized success toast names the user
 *      and the role (label mapping verified for all 4 roles);
 *   3. failure — the profile keeps its old role and an error toast is shown,
 *      updatingUserId is always reset to null;
 *   4. handleToggleRole flips admin ⇄ staff through handleUpdateRole;
 *   5. handleSendPasswordReset success / failure (with and without a server
 *      error message) produce the right toast;
 *   6. the search/filter/add-user-modal state exposes working defaults.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import { Window } from 'happy-dom';
import { translations } from '../src/i18n/translations';
import type { TranslationDict } from '../src/i18n/translations';
import type { UserProfile } from '../src/lib/useAuth';
import { useUsers } from '../src/app/useUsers';

const t = translations.fr as TranslationDict;

/** Install happy-dom's window/document (and friends) on globalThis. */
function installDomGlobals(): Window {
  const win = new Window({ url: 'http://localhost/' });
  const define = (key: string, value: unknown): void => {
    Object.defineProperty(globalThis, key, { value, configurable: true, writable: true });
  };
  define('window', win);
  define('document', win.document);
  define('navigator', win.navigator);
  define('HTMLElement', win.HTMLElement);
  define('Element', win.Element);
  define('Node', win.Node);
  define('Event', win.Event);
  define('CustomEvent', win.CustomEvent);
  define('getComputedStyle', win.getComputedStyle.bind(win));
  define('localStorage', win.localStorage);
  define('IS_REACT_ACT_ENVIRONMENT', true);
  return win;
}

const win = installDomGlobals();

type UsersApi = ReturnType<typeof useUsers>;
type ApiRef = { current: UsersApi | null };

/** Renders the hook inside a component and keeps a live ref to its API. */
function Harness(props: { args: Parameters<typeof useUsers>[0]; api: ApiRef }): null {
  props.api.current = useUsers(props.args);
  return null;
}

// ── fixtures ─────────────────────────────────────────────────────────────────

const admin: UserProfile = { id: 'u1', email: 'awa@x.org', fullName: 'Awa Ndiaye', role: 'admin' };
const staffU: UserProfile = { id: 'u2', email: 'sekou@x.org', fullName: 'Sékou Traoré', role: 'staff' };
const gm: UserProfile = { id: 'u3', email: 'mamadou@x.org', fullName: 'Mamadou Lamine Thera', role: 'general_manager' };

interface Spies {
  updateRoleCalls: Array<{ id: string; role: string }>;
  updateRoleResults: boolean[];
  resetCalls: string[];
  resetResults: Array<{ success: boolean; error?: string }>;
  toasts: Array<{ kind: 'success' | 'error'; msg: string }>;
  profiles: UserProfile[];
}

interface DepsOverrides {
  profiles?: UserProfile[];
  updateRoleResults?: boolean[];
  resetResults?: Array<{ success: boolean; error?: string }>;
}

function baseDeps(overrides: DepsOverrides = {}): {
  args: Parameters<typeof useUsers>[0];
  spies: Spies;
} {
  const spies: Spies = {
    updateRoleCalls: [],
    updateRoleResults: overrides.updateRoleResults ?? [true],
    resetCalls: [],
    resetResults: overrides.resetResults ?? [{ success: true }],
    toasts: [],
    profiles: [...(overrides.profiles ?? [admin, staffU, gm])],
  };
  const args = {
    t,
    auth: {
      updateUserRole: async (id: string, role: string) => {
        spies.updateRoleCalls.push({ id, role });
        return spies.updateRoleResults[spies.updateRoleCalls.length - 1] ?? true;
      },
      sendPasswordReset: async (email: string) => {
        spies.resetCalls.push(email);
        return spies.resetResults[spies.resetCalls.length - 1] ?? { success: true };
      },
    },
    userProfiles: [...(overrides.profiles ?? [admin, staffU, gm])],
    setUserProfiles: (action: unknown) => {
      spies.profiles = typeof action === 'function'
        ? (action as (prev: UserProfile[]) => UserProfile[])(spies.profiles)
        : (action as UserProfile[]);
    },
    toast: {
      success: (msg: string) => { spies.toasts.push({ kind: 'success', msg }); return 'toast-id'; },
      error: (msg: string) => { spies.toasts.push({ kind: 'error', msg }); return 'toast-id'; },
    },
  };
  return { args: args as Parameters<typeof useUsers>[0], spies };
}

async function setup(args: Parameters<typeof useUsers>[0]): Promise<{ ref: ApiRef; root: Root }> {
  const container = win.document.createElement('div');
  win.document.body.appendChild(container);
  const root = createRoot(container as unknown as Element);
  const ref: ApiRef = { current: null };
  act(() => {
    root.render(createElement(Harness, { args, api: ref }));
  });
  return { ref, root };
}

describe('useUsers', () => {
  it('skips the auth call when the target already has the role', async () => {
    const { args, spies } = baseDeps();
    const { ref, root } = await setup(args);
    try {
      await act(async () => { await ref.current!.handleUpdateRole(admin, 'admin'); });

      assert.equal(spies.updateRoleCalls.length, 0, 'no updateUserRole call for a same-role request');
      assert.equal(spies.toasts.length, 0, 'no toast for a no-op');
      assert.equal(ref.current!.updatingUserId, null);
    } finally {
      act(() => root.unmount());
    }
  });

  it('updates the profile, toasts the localized label and clears updatingUserId on success', async () => {
    const { args, spies } = baseDeps();
    const { ref, root } = await setup(args);
    try {
      await act(async () => { await ref.current!.handleUpdateRole(staffU, 'general_manager'); });

      assert.deepEqual(spies.updateRoleCalls, [{ id: 'u2', role: 'general_manager' }]);
      const promoted = spies.profiles.find((p) => p.id === 'u2');
      assert.equal(promoted?.role, 'general_manager', 'the local profile slice is updated');
      assert.deepEqual(spies.toasts, [
        { kind: 'success', msg: t.roleUpdated.replace('{name}', 'Sékou Traoré').replace('{role}', t.roleGeneralManager) },
      ]);
      assert.equal(ref.current!.updatingUserId, null, 'the in-flight flag is cleared');
    } finally {
      act(() => root.unmount());
    }
  });

  it('toasts the right label for every role', async () => {
    const cases = [
      ['admin', t.roleAdminPromoter],
      ['dev', t.roleDeveloper],
      ['general_manager', t.roleGeneralManager],
      ['econome', t.roleEconome],
      ['staff', t.roleStaff],
    ] as const;
    for (const [role, label] of cases) {
      // gm is already general_manager — use staffU for every role except that one
      const target = role === 'general_manager' ? staffU : gm;
      const { args, spies } = baseDeps();
      const { ref, root } = await setup(args);
      try {
        await act(async () => { await ref.current!.handleUpdateRole(target, role); });
        assert.ok(spies.toasts[0]?.msg.includes(label), `the toast names the label for ${role}`);
      } finally {
        act(() => root.unmount());
      }
    }
  });

  it('keeps the old role and error-toasts when the auth call fails', async () => {
    const { args, spies } = baseDeps({ updateRoleResults: [false] });
    const { ref, root } = await setup(args);
    try {
      await act(async () => { await ref.current!.handleUpdateRole(staffU, 'admin'); });

      assert.equal(spies.updateRoleCalls.length, 1, 'the auth call was attempted');
      assert.equal(spies.profiles.find((p) => p.id === 'u2')?.role, 'staff', 'the profile is untouched');
      assert.deepEqual(spies.toasts, [{ kind: 'error', msg: t.failedToUpdateRole }]);
      assert.equal(ref.current!.updatingUserId, null, 'the in-flight flag is cleared even on failure');
    } finally {
      act(() => root.unmount());
    }
  });

  it('handleToggleRole flips admin → staff and staff → admin', async () => {
    const { args, spies } = baseDeps();
    const { ref, root } = await setup(args);
    try {
      await act(async () => { await ref.current!.handleToggleRole(admin); });
      await act(async () => { await ref.current!.handleToggleRole(staffU); });

      assert.deepEqual(spies.updateRoleCalls, [
        { id: 'u1', role: 'staff' },
        { id: 'u2', role: 'admin' },
      ]);
    } finally {
      act(() => root.unmount());
    }
  });

  it('sends the password reset and toasts the email on success', async () => {
    const { args, spies } = baseDeps();
    const { ref, root } = await setup(args);
    try {
      await act(async () => { await ref.current!.handleSendPasswordReset('awa@x.org'); });

      assert.deepEqual(spies.resetCalls, ['awa@x.org']);
      assert.deepEqual(spies.toasts, [
        { kind: 'success', msg: t.passwordResetEmailSent.replace('{email}', 'awa@x.org') },
      ]);
    } finally {
      act(() => root.unmount());
    }
  });

  it('error-toasts the server message, or the default when none is given', async () => {
    // with a server error message
    {
      const { args, spies } = baseDeps({ resetResults: [{ success: false, error: 'user not found' }] });
      const { ref, root } = await setup(args);
      try {
        await act(async () => { await ref.current!.handleSendPasswordReset('ghost@x.org'); });
        assert.deepEqual(spies.toasts, [{ kind: 'error', msg: 'user not found' }]);
      } finally {
        act(() => root.unmount());
      }
    }
    // without one
    {
      const { args, spies } = baseDeps({ resetResults: [{ success: false }] });
      const { ref, root } = await setup(args);
      try {
        await act(async () => { await ref.current!.handleSendPasswordReset('ghost@x.org'); });
        assert.deepEqual(spies.toasts, [{ kind: 'error', msg: t.failedToSendResetEmail }]);
      } finally {
        act(() => root.unmount());
      }
    }
  });

  it('exposes working defaults for the modal/search/filter state', async () => {
    const { args } = baseDeps();
    const { ref, root } = await setup(args);
    try {
      assert.equal(ref.current!.showAddUserModal, false);
      assert.equal(ref.current!.userSearchTerm, '');
      assert.equal(ref.current!.userRoleFilter, 'all');
      assert.equal(ref.current!.updatingUserId, null);

      await act(async () => {
        ref.current!.setShowAddUserModal(true);
        ref.current!.setUserSearchTerm('awa');
        ref.current!.setUserRoleFilter('general_manager');
      });
      assert.equal(ref.current!.showAddUserModal, true);
      assert.equal(ref.current!.userSearchTerm, 'awa');
      assert.equal(ref.current!.userRoleFilter, 'general_manager');
    } finally {
      act(() => root.unmount());
    }
  });
});
