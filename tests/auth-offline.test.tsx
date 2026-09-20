/**
 * Offline sign-in regression suite for useAuth.
 *
 * The rule this locks is an ORDER, and it is the whole point of the feature:
 *
 *   1. when the SERVER answers, the server decides — a refused password is
 *      reported and the station's local verifier is NEVER consulted (answering
 *      it locally would turn a stale record into a way in);
 *   2. when the server is UNREACHABLE, the account is checked against the
 *      verifier this station kept from an earlier online sign-in;
 *   3. a session opened that way is marked (`isOfflineSession`), so the domain
 *      layer queues writes instead of losing them, and its password — kept in
 *      memory only — is replayed the moment `online` fires, which is what makes
 *      a station that worked through an outage transfer everything by itself.
 *
 * The supabase client module is mocked before the hook is imported, so both the
 * outcome of a sign-in and the reachability of the server are scriptable.
 */
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { act } from 'react';
import { installDomGlobals, renderHook } from './harness';
import { mockModule } from './module-mock';

const win = installDomGlobals();

// ── fake supabase client ─────────────────────────────────────────────────────
type Answer = 'accept' | 'refuse' | 'unreachable';

const state = {
  answer: 'accept' as Answer,
  signInCalls: [] as { email: string; password: string }[],
  profileRow: { id: 'u1', email: 'aggee@mamathera.org', full_name: 'Aggee Diarra', role: 'staff' },
  // Ce que les gestes de COMPTE ont réellement tenté : hors ligne, ce journal
  // doit rester vide — c'est la différence entre « mis en file » et « perdu ».
  writes: [] as { op: string; table: string; payload?: unknown }[],
  resetCalls: [] as string[],
  rpcCalls: [] as string[],
  /** Lignes que la policy laisse passer sur la mise à jour d'un rôle. */
  roleUpdateRows: 1,
};

const fakeSupabase = {
  auth: {
    signInWithPassword: async ({ email, password }: { email: string; password: string }) => {
      state.signInCalls.push({ email, password });
      if (state.answer === 'unreachable') throw new TypeError('Failed to fetch');
      if (state.answer === 'refuse') {
        return { data: { user: null, session: null }, error: { message: 'Invalid login credentials', status: 400 } };
      }
      return { data: { user: { id: 'u1', email }, session: { user: { id: 'u1', email } } }, error: null };
    },
    getSession: async () => ({ data: { session: null }, error: null }),
    getUser: async () => ({ data: { user: null }, error: null }),
    signOut: async () => ({ error: null }),
    resetPasswordForEmail: async (email: string) => {
      state.resetCalls.push(email);
      return { error: null };
    },
    refreshSession: async () => ({ data: { session: null }, error: null }),
    onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }),
  },
  from: (table: string) => ({
    select: () => ({
      eq: () => ({
        single: async () => ({ data: state.profileRow, error: null }),
        maybeSingle: async () => ({ data: state.profileRow, error: null }),
      }),
      // La liste des comptes (fetchAllProfiles) lit sans filtre.
      order: async () => ({ data: [state.profileRow], error: null }),
    }),
    update: (payload: unknown) => ({
      eq: () => {
        state.writes.push({ op: 'update', table, payload });
        const rows = state.roleUpdateRows > 0 ? [{ id: 'u1' }] : [];
        return { select: async () => ({ data: rows, error: null }) };
      },
    }),
  }),
  rpc: async (name: string) => {
    state.rpcCalls.push(name);
    return { data: true, error: null };
  },
};

mockModule('../src/lib/supabaseClient', { supabase: fakeSupabase });

const { useAuth } = await import('../src/lib/useAuth');
const { ACCOUNT_NEEDS_CONNECTION, isConnectionRequiredError } = await import('../src/lib/accountGestures');
const { listOfflineAccounts, rememberOfflineAccount } = await import('../src/lib/offlineCredentials');
const { getOfflineQueue } = await import('../src/lib/offlineQueue');
const { useUsers } = await import('../src/app/useUsers');
const { translations } = await import('../src/i18n/translations');
import type { TranslationDict } from '../src/i18n/translations';

// ── helpers ──────────────────────────────────────────────────────────────────
const flush = async () => {
  for (let i = 0; i < 10; i++) {
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
  }
};

/**
 * Wait for a condition the code reaches through a DERIVATION (PBKDF2 at the
 * real cost — 210 000 iterations — is deliberately slow, and the hook writes
 * the station record in the background so a sign-in is never delayed by it).
 * Iterating on a condition rather than sleeping a fixed time keeps the suite
 * honest about what it waits for.
 */
async function waitFor(condition: () => boolean, what: string, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (condition()) return;
    await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
  }
  assert.fail(`attendu : ${what}`);
}

/** Fire the `online` event the way the browser does, and let React flush it. */
async function goBackOnline() {
  await act(async () => {
    win.dispatchEvent(new win.Event('online'));
    await new Promise((r) => setTimeout(r, 0));
  });
  await flush();
}

let realOnLine: boolean;

function setOnline(value: boolean) {
  Object.defineProperty(window.navigator, 'onLine', { value, configurable: true });
}

/** A station where this account already signed in once, with internet. */
async function stationKnowsTheAccount(password = 'Bamako-2026!') {
  await rememberOfflineAccount({
    email: 'aggee@mamathera.org',
    password,
    userId: 'u1',
    fullName: 'Aggee Diarra',
    role: 'staff',
  }, localStorage, 1000);
}

describe('useAuth — connexion hors ligne', () => {
  beforeEach(async () => {
    realOnLine = window.navigator.onLine;
    setOnline(true);
    state.answer = 'accept';
    state.signInCalls = [];
    localStorage.clear();
  });

  it("garde l'empreinte du compte après une connexion EN LIGNE réussie", async () => {
    const r = renderHook(useAuth, undefined);
    await flush();

    const result = await act(async () => r.api.current!.signIn('aggee@mamathera.org', 'Bamako-2026!'));

    assert.equal(result.success, true);
    assert.equal(r.api.current?.profile?.fullName, 'Aggee Diarra');
    assert.equal(r.api.current?.isOfflineSession, false);
    await waitFor(
      () => listOfflineAccounts().length === 1,
      'l’empreinte du compte sur le poste (pour pouvoir le rouvrir sans réseau)',
    );
    assert.equal(listOfflineAccounts()[0].email, 'aggee@mamathera.org');
    r.unmount();
    setOnline(realOnLine);
  });

  it('ne consulte JAMAIS le vérificateur local quand le serveur REFUSE', async () => {
    await stationKnowsTheAccount('Bamako-2026!'); // le poste connaît le bon mot de passe
    state.answer = 'refuse';
    const r = renderHook(useAuth, undefined);
    await flush();

    const result = await act(async () => r.api.current!.signIn('aggee@mamathera.org', 'Bamako-2026!'));

    assert.equal(result.success, false, "le refus du serveur fait foi");
    assert.equal(result.error, 'Invalid login credentials');
    assert.equal(state.signInCalls.length, 1, 'un seul essai réseau : pas de rattrapage local');
    assert.equal(r.api.current?.profile, null);
    assert.equal(r.api.current?.isOfflineSession, false);
    r.unmount();
    setOnline(realOnLine);
  });

  it('bascule sur le vérificateur local quand le serveur est INJOIGNABLE', async () => {
    await stationKnowsTheAccount('Bamako-2026!');
    state.answer = 'unreachable';
    const r = renderHook(useAuth, undefined);
    await flush();

    const result = await act(async () => r.api.current!.signIn('aggee@mamathera.org', 'Bamako-2026!'));

    assert.equal(result.success, true);
    assert.equal(r.api.current?.isOfflineSession, true, 'session hors ligne : aucun jeton, donc rien ne part');
    assert.equal(r.api.current?.user, null, 'aucune session Supabase n’a été émise');
    assert.equal(r.api.current?.profile?.role, 'staff');
    r.unmount();
    setOnline(realOnLine);
  });

  it('se connecte hors ligne sans même tenter le réseau', async () => {
    await stationKnowsTheAccount('Bamako-2026!');
    setOnline(false);
    const r = renderHook(useAuth, undefined);
    await flush();

    const result = await act(async () => r.api.current!.signIn('aggee@mamathera.org', 'Bamako-2026!'));

    assert.equal(result.success, true);
    assert.equal(state.signInCalls.length, 0, 'inutile de tenter une requête sans réseau');
    assert.equal(r.api.current?.isOfflineSession, true);
    r.unmount();
    setOnline(realOnLine);
  });

  it('refuse un mot de passe faux hors ligne — le poste ne laisse pas entrer', async () => {
    await stationKnowsTheAccount('Bamako-2026!');
    setOnline(false);
    const r = renderHook(useAuth, undefined);
    await flush();

    const result = await act(async () => r.api.current!.signIn('aggee@mamathera.org', 'mauvais'));

    assert.equal(result.success, false);
    assert.equal(result.error, 'OFFLINE_WRONG_PASSWORD');
    assert.equal(r.api.current?.profile, null);
    r.unmount();
    setOnline(realOnLine);
  });

  it("refuse un compte que ce poste n'a jamais vu, et le dit clairement", async () => {
    setOnline(false);
    const r = renderHook(useAuth, undefined);
    await flush();

    const result = await act(async () => r.api.current!.signIn('inconnu@mamathera.org', 'peu-importe'));

    assert.equal(result.success, false);
    assert.equal(result.error, 'OFFLINE_UNKNOWN_ACCOUNT');
    r.unmount();
    setOnline(realOnLine);
  });

  it('rouvre une VRAIE session dès que la ligne revient (et se marque reconnectée)', async () => {
    await stationKnowsTheAccount('Bamako-2026!');
    state.answer = 'unreachable';
    const r = renderHook(useAuth, undefined);
    await flush();
    const authApi = r.api.current!;
    await act(async () => authApi.signIn('aggee@mamathera.org', 'Bamako-2026!'));
    assert.equal(r.api.current?.isOfflineSession, true);

    // La ligne revient : le poste rejoue le mot de passe qu'il a en mémoire.
    state.answer = 'accept';
    await goBackOnline();

    assert.equal(r.api.current?.isOfflineSession, false, 'la session est redevenue une vraie session');
    assert.equal(r.api.current?.reauthFailed, false);
    assert.deepEqual(state.signInCalls.at(-1), { email: 'aggee@mamathera.org', password: 'Bamako-2026!' });
    r.unmount();
    setOnline(realOnLine);
  });

  it('DIT quand la base refuse la reconnexion (mot de passe changé ailleurs)', async () => {
    await stationKnowsTheAccount('Bamako-2026!');
    state.answer = 'unreachable';
    const r = renderHook(useAuth, undefined);
    await flush();
    const authApi = r.api.current!;
    await act(async () => authApi.signIn('aggee@mamathera.org', 'Bamako-2026!'));
    assert.equal(r.api.current?.isOfflineSession, true);

    // Le mot de passe a été changé côté serveur : insister ne produirait que le
    // même refus, donc on le signale au lieu de boucler en silence.
    state.answer = 'refuse';
    await goBackOnline();

    assert.equal(r.api.current?.reauthFailed, true);
    assert.equal(r.api.current?.isOfflineSession, true, 'la session hors ligne reste ouverte (le travail local reste accessible)');
    r.unmount();
    setOnline(realOnLine);
  });

  it('signOut referme aussi la session hors ligne', async () => {
    await stationKnowsTheAccount('Bamako-2026!');
    setOnline(false);
    const r = renderHook(useAuth, undefined);
    await flush();
    const authApi = r.api.current!;
    await act(async () => authApi.signIn('aggee@mamathera.org', 'Bamako-2026!'));
    assert.equal(r.api.current?.isOfflineSession, true);

    await act(async () => { await authApi.signOut(); });

    assert.equal(r.api.current?.isOfflineSession, false);
    assert.equal(r.api.current?.profile, null, 'un poste quitté ne doit pas rester ouvert');
    r.unmount();
    setOnline(realOnLine);
  });
});

// ─── Les gestes de COMPTE : ce qui peut attendre la ligne, et ce qui ne peut pas
//
// Un RÔLE est une ligne de table : il part en file, exactement comme un élève ou
// un paiement. Un MOT DE PASSE ou une CRÉATION DE COMPTE passent par
// l'authentification du serveur (GoTrue, RPC) : aucune file ne peut les porter,
// donc le geste est REFUSÉ avec sa raison — « nécessite la connexion » — au lieu
// d'échouer sur un message de réseau que personne ne peut interpréter.

describe('useAuth — gestes de compte hors ligne', () => {
  beforeEach(async () => {
    realOnLine = window.navigator.onLine;
    setOnline(true);
    state.answer = 'accept';
    state.writes = [];
    state.resetCalls = [];
    state.rpcCalls = [];
    state.roleUpdateRows = 1;
    localStorage.clear();
  });

  /** Une station hors ligne, session ouverte : le cas réel du terrain. */
  async function stationOffline() {
    await stationKnowsTheAccount('Bamako-2026!');
    setOnline(false);
    const r = renderHook(useAuth, undefined);
    await flush();
    await act(async () => r.api.current!.signIn('aggee@mamathera.org', 'Bamako-2026!'));
    assert.equal(r.api.current?.isOfflineSession, true, 'la station doit être hors ligne pour ce test');
    return r;
  }

  it('un RÔLE change sans réseau : mis en file, aucune écriture tentée', async () => {
    const r = await stationOffline();
    try {
      const ok = await act(async () => r.api.current!.updateUserRole('u2', 'admin'));
      assert.equal(ok, true, 'l’écran peut appliquer le rôle tout de suite');
      assert.equal(state.writes.length, 0, 'rien n’est tenté sans ligne');

      const queue = getOfflineQueue();
      assert.equal(queue.length, 1);
      assert.equal(queue[0].type, 'updateUserRole');
      assert.deepEqual(queue[0].payload, { id: 'u2', role: 'admin' });
    } finally {
      r.unmount();
      setOnline(realOnLine);
    }
  });

  it('en ligne, un rôle qu’AUCUNE ligne n’a accepté n’est pas un succès (policy admin)', async () => {
    state.roleUpdateRows = 0;
    const r = renderHook(useAuth, undefined);
    await flush();
    try {
      const ok = await act(async () => r.api.current!.updateUserRole('u2', 'admin'));
      assert.equal(ok, false, 'la requête a « réussi » sans rien changer : elle est refusée');
      assert.equal(state.writes.length, 1);
    } finally {
      r.unmount();
      setOnline(realOnLine);
    }
  });

  it('créer un compte sans réseau : refusé, avec la raison', async () => {
    const r = await stationOffline();
    try {
      const res = await act(async () => r.api.current!.createStaffUser('nouveau@mamathera.org', 'MotDePasse1', 'Nouveau Compte', 'staff'));
      assert.equal(res.success, false);
      assert.equal(res.error, ACCOUNT_NEEDS_CONNECTION);
      assert.equal(isConnectionRequiredError(res.error), true);
      assert.equal(state.writes.length, 0, 'aucun compte n’est tenté sans ligne');
    } finally {
      r.unmount();
      setOnline(realOnLine);
    }
  });

  it('envoyer un lien de réinitialisation sans réseau : refusé, et rien n’est tenté', async () => {
    const r = await stationOffline();
    try {
      const res = await act(async () => r.api.current!.sendPasswordReset('awa@x.org'));
      assert.equal(res.success, false);
      assert.equal(isConnectionRequiredError(res.error), true);
      assert.deepEqual(state.resetCalls, [], 'le serveur seul envoie ce courriel');
    } finally {
      r.unmount();
      setOnline(realOnLine);
    }
  });

  it('définir un mot de passe sans réseau : refusé, et le RPC n’est pas appelé', async () => {
    const r = await stationOffline();
    try {
      const res = await act(async () => r.api.current!.setUserPassword('u2', 'MotDePasse1'));
      assert.equal(res.success, false);
      assert.equal(isConnectionRequiredError(res.error), true);
      assert.deepEqual(state.rpcCalls, [], 'admin_set_user_password exige le serveur');
    } finally {
      r.unmount();
      setOnline(realOnLine);
    }
  });

  it('l’écran TRADUIT le refus — le code brut n’atteint jamais le message affiché', async () => {
    // Le contrat traverse deux modules : useAuth renvoie un CODE (il n'a pas accès
    // à la langue), useUsers le traduit. Ce test tient les deux bouts ensemble,
    // et vérifie au passage qu'un échec ordinaire garde le message du serveur.
    const toasts: string[] = [];
    const t = translations.fr as TranslationDict;
    const needsConnection = { success: false, error: ACCOUNT_NEEDS_CONNECTION };
    const args = {
      t,
      auth: {
        updateUserRole: async () => true,
        sendPasswordReset: async () => needsConnection,
        setUserPassword: async () => needsConnection,
      },
      userProfiles: [{ id: 'u2', email: 'sekou@x.org', fullName: 'Sékou Traoré', role: 'staff' }],
      setUserProfiles: () => {},
      toast: {
        success: (msg: string) => { toasts.push(msg); return 'id'; },
        error: (msg: string) => { toasts.push(msg); return 'id'; },
      },
    } as Parameters<typeof useUsers>[0];
    const users = renderHook(useUsers, args);
    try {
      await act(async () => { await users.api.current!.handleSendPasswordReset('sekou@x.org'); });
      assert.deepEqual(toasts, [t.accountNeedsConnection]);
      assert.equal(toasts[0].includes('ACCOUNT_NEEDS_CONNECTION'), false, 'aucun code technique à l’écran');

      await act(async () => {
        users.api.current!.setPasswordTarget({ id: 'u2', email: 'sekou@x.org', fullName: 'Sékou Traoré', role: 'staff' });
        users.api.current!.setPasswordInput('MotDePasse1');
      });
      await act(async () => { await users.api.current!.handleSetPassword(); });
      assert.deepEqual(toasts, [t.accountNeedsConnection, t.accountNeedsConnection]);
      assert.ok(users.api.current!.passwordTarget, 'le modal reste ouvert : rien n’a été fait');
    } finally {
      act(() => users.unmount());
    }
  });

  it('un échec ORDINAIRE garde le message du serveur (le code ne masque rien)', async () => {
    const toasts: string[] = [];
    const t = translations.fr as TranslationDict;
    const args = {
      t,
      auth: {
        updateUserRole: async () => true,
        sendPasswordReset: async () => ({ success: false, error: 'user not found' }),
        setUserPassword: async () => ({ success: false, error: 'permission denied' }),
      },
      userProfiles: [],
      setUserProfiles: () => {},
      toast: {
        success: (msg: string) => { toasts.push(msg); return 'id'; },
        error: (msg: string) => { toasts.push(msg); return 'id'; },
      },
    } as Parameters<typeof useUsers>[0];
    const users = renderHook(useUsers, args);
    try {
      await act(async () => { await users.api.current!.handleSendPasswordReset('ghost@x.org'); });
      assert.deepEqual(toasts, ['user not found']);
    } finally {
      act(() => users.unmount());
    }
  });
});


