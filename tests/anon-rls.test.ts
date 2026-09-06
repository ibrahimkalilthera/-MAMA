// Tests for scripts/verify-anon-rls.mjs — the CI guard that proves the anon
// role can neither read nor write any business table after migrations, and
// that the auth surface is correct: user_profiles locked for anon, the
// admin_set_user_password RPC refused for anon, while the legitimate email
// reset (GoTrue recover) stays reachable.
// A stub PostgREST + GoTrue twin simulates the worlds:
//   • healthy   — service_role full access, anon reads empty, anon writes refused
//   • breached  — an anon INSERT policy exists / reads leak / the password RPC
//     is callable by anon / the recover endpoint is over-locked
// The guard must pass in the first world and fail loudly in every breached one.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { verifyAnonRls, verifyAnonRemote, PROBE_NAME } from '../scripts/verify-anon-rls.mjs';

const TABLES = ['students', 'payments', 'expenses', 'todos', 'user_profiles'];

interface StubRow {
  id: string;
  name: string;
}

interface StubProfile {
  id: string;
  full_name: string;
  role: string;
}

interface StubOptions {
  /** anon INSERT returns 201 and really stores the row (breach world). */
  allowAnonInsert?: boolean;
  /** anon GET returns the real rows (read breach world). */
  leakAnonReads?: boolean;
  /** anon can execute admin_set_user_password (breach world). */
  allowAnonRpc?: boolean;
  /** GoTrue recover refuses anon — the app's reset flow would break (breach world). */
  lockRecover?: boolean;
  /** an authenticated staff user can read every profile (breach world). */
  seeAllProfiles?: boolean;
  /** an authenticated staff user's password-RPC call succeeds and really changes the target's password (breach world). */
  allowStaffRpc?: boolean;
  /** admins can no longer read other profiles — the app's settings screen would break (breach world). */
  lockAdminReads?: boolean;
  /** admins can no longer reset passwords — the app's reset flow would break (breach world). */
  lockAdminRpc?: boolean;
}

/** Minimal PostgREST + GoTrue twin: students + user_profiles, RLS semantics per world. */
function stubSupabase({
  allowAnonInsert = false,
  leakAnonReads = false,
  allowAnonRpc = false,
  lockRecover = false,
  seeAllProfiles = false,
  allowStaffRpc = false,
  lockAdminReads = false,
  lockAdminRpc = false,
}: StubOptions = {}) {
  const rows: StubRow[] = [{ id: 'stu-seed', name: PROBE_NAME }];
  const profiles: StubProfile[] = [];
  const users: Array<{ id: string; email: string; password: string }> = [];
  const tokenByUserId: Record<string, string> = {}; // token-1 → premier utilisateur (A)
  let seq = 1;
  let authSeq = 0;

  return async (input: Parameters<typeof fetch>[0], init: RequestInit = {}) => {
    const url = String(input);
    const restPath = url.includes('/rest/v1/') ? url.slice(url.indexOf('/rest/v1/') + 9) : null;
    const authPath = url.includes('/auth/v1/') ? url.slice(url.indexOf('/auth/v1/') + 9) : null;
    const method = init.method ?? 'GET';
    const headers = init.headers as Record<string, string>;
    const isService = headers?.Authorization?.includes('service') ?? false;
    const anon = !isService;
    const tokenMatch = /Bearer (token-\d+)/.exec(headers?.Authorization ?? '');
    const authedUserId = tokenMatch
      ? Object.entries(tokenByUserId).find(([, t]) => t === tokenMatch[1])?.[0]
      : undefined;
    const body = init.body ? JSON.parse(init.body as string) : {};

    const json = (data: unknown, status: number, extra: Record<string, string> = {}) =>
      // 204 No Content interdit tout corps — les réponses vides anon (RLS qui
      // filtre 0 ligne) sont donc sans body, comme le vrai PostgREST.
      status === 204
        ? new Response(null, { status, headers: extra })
        : new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json', ...extra } });

    // ─── GoTrue (auth/v1) ────────────────────────────────────────────────────
    if (authPath) {
      if (authPath === 'token?grant_type=password' && method === 'POST') {
        const u = users.find((x) => x.email === body.email);
        if (u && u.password === body.password) {
          return json({ access_token: tokenByUserId[u.id], user: u }, 200);
        }
        return json({ error: 'Invalid login credentials', code: 400 }, 400);
      }
      if (authPath === 'admin/users' && method === 'GET') {
        // Routes admin : jamais pour anon.
        if (anon) return json({ message: 'not allowed' }, 401);
        return json(users, 200);
      }
      if (authPath === 'admin/users' && method === 'POST') {
        if (anon) return json({ message: 'not allowed' }, 401);
        const user = { id: `auth-${users.length + 1}`, email: body.email, password: body.password ?? 'probe-pass-123' };
        users.push(user);
        // handle_new_user trigger : la création auth crée la ligne user_profiles.
        profiles.push({ id: user.id, full_name: 'New User', role: 'staff' });
        tokenByUserId[user.id] = `token-${++authSeq}`;
        return json(user, 201);
      }
      const adminDelete = authPath.match(/^admin\/users\/([\w-]+)$/);
      if (adminDelete && method === 'DELETE') {
        if (anon) return json({ message: 'not allowed' }, 401);
        const idx = users.findIndex((u) => u.id === adminDelete[1]);
        if (idx >= 0) users.splice(idx, 1);
        const pIdx = profiles.findIndex((p) => p.id === adminDelete[1]);
        if (pIdx >= 0) profiles.splice(pIdx, 1); // ON DELETE CASCADE
        return json({}, 200);
      }
      if (authPath === 'recover' && method === 'POST') {
        if (lockRecover) return json({ message: 'recover disabled' }, 401);
        return json({}, 200); // GoTrue répond 200 même pour un email inconnu
      }
      return json({ message: 'not stubbed' }, 404);
    }

    // ─── user_profiles (REST) ────────────────────────────────────────────────
    const profileIdMatch = restPath!.match(/^user_profiles\?id=eq\.([\w-]+)$/);
    if (method === 'GET' && (profileIdMatch || restPath === 'user_profiles')) {
      if (authedUserId) {
        const caller = profiles.find((p) => p.id === authedUserId);
        const isAdmin = caller?.role === 'admin' || caller?.role === 'dev';
        if (isAdmin && lockAdminReads) return json([], 200); // sur-verrouillage (brèche)
        if (isAdmin) {
          const row = profileIdMatch ? profiles.find((p) => p.id === profileIdMatch[1]) : undefined;
          return json(profileIdMatch ? (row ? [row] : []) : profiles, 200);
        }
        // Policy « view own profile » : l'authentifié ne voit que sa ligne.
        if (seeAllProfiles) return json(profiles, 200); // fuite (brèche)
        const row = profileIdMatch ? profiles.find((p) => p.id === profileIdMatch[1]) : undefined;
        if (profileIdMatch) return json(row && row.id === authedUserId ? [row] : [], 200);
        return json(profiles.filter((p) => p.id === authedUserId), 200);
      }
      if (anon && leakAnonReads) return json(profiles, 200);
      if (anon) return json([], 200); // RLS filters everything
      const row = profileIdMatch ? profiles.find((p) => p.id === profileIdMatch[1]) : undefined;
      return json(profileIdMatch ? (row ? [row] : []) : profiles, 200);
    }
    if (method === 'POST' && restPath === 'user_profiles') {
      if (anon && allowAnonInsert) {
        profiles.push({ id: `prof-${seq++}`, full_name: body.full_name ?? 'New User', role: 'staff' });
        return json(profiles.slice(-1), 201);
      }
      if (anon) return json({ message: 'new row violates row-level security policy' }, 403);
      profiles.push({ id: `prof-${seq++}`, full_name: body.full_name ?? 'New User', role: 'staff' });
      return json(profiles.slice(-1), 201);
    }
    if (method === 'PATCH' && profileIdMatch) {
      if (anon) return json([], 204); // RLS matches 0 rows: empty success
      const row = profiles.find((p) => p.id === profileIdMatch[1]);
      if (row) {
        row.full_name = body.full_name ?? row.full_name;
        if (body.role) row.role = body.role; // promotion via service_role
      }
      return json(row ? [row] : [], 200);
    }
    if (method === 'DELETE' && profileIdMatch) {
      if (anon) return json([], 204);
      const idx = profiles.findIndex((p) => p.id === profileIdMatch[1]);
      if (idx >= 0) profiles.splice(idx, 1);
      return json([], 204);
    }

    // ─── RPC mot de passe ────────────────────────────────────────────────────
    if (method === 'POST' && restPath === 'rpc/admin_set_user_password') {
      if (authedUserId) {
        const caller = profiles.find((p) => p.id === authedUserId);
        const isAdmin = caller?.role === 'admin' || caller?.role === 'dev';
        if (isAdmin && lockAdminRpc) {
          // Sur-verrouillage (brèche) : la RPC refuse aussi les admins.
          return json({ message: 'only admin or dev can set passwords' }, 400);
        }
        if (isAdmin) {
          // Contrôle positif : l'admin change VRAIMENT le mot de passe.
          const target = users.find((u) => u.id === body.target_user_id);
          if (target) target.password = body.new_password;
          return json(true, 200);
        }
        if (allowStaffRpc) {
          // Fuite (brèche) : le staff réussit VRAIMENT à changer le mot de passe.
          const target = users.find((u) => u.id === body.target_user_id);
          if (target) target.password = body.new_password;
          return json(true, 200);
        }
        // GRANT authenticated : la fonction s'exécute puis lève l'exception
        // métier (rôle staff) → 400. C'est le comportement sain.
        return json({ message: 'only admin or dev can set passwords' }, 400);
      }
      if (anon && allowAnonRpc) {
        // GRANT anon ajouté : la fonction s'exécute puis lève l'exception
        // métier (auth.uid() null) → 400. C'est le signal réaliste d'une fuite.
        return json({ message: 'only admin or dev can set passwords' }, 400);
      }
      if (anon) return json({ message: 'permission denied for function admin_set_user_password' }, 401);
      return json(true, 200);
    }

    // ─── students (REST) ─────────────────────────────────────────────────────
    const idMatch = restPath!.match(/^students\?id=eq\.([\w-]+)$/);
    if (method === 'GET' && (idMatch || restPath === 'students')) {
      const row = idMatch ? rows.find((r) => r.id === idMatch[1]) : undefined;
      if (anon && leakAnonReads) return json(rows, 200);
      if (anon) return json([], 200); // RLS filters everything
      return json(idMatch ? (row ? [row] : []) : rows, 200);
    }

    // POST students (seed / probes)
    if (method === 'POST' && restPath === 'students') {
      if (anon && allowAnonInsert) {
        const row: StubRow = { id: `stu-${seq++}`, name: body.name };
        rows.push(row);
        return json([row], 201);
      }
      if (anon) return json({ message: 'new row violates row-level security policy' }, 403);
      const row: StubRow = { id: `stu-${seq++}`, name: body.name };
      rows.push(row);
      return json([row], 201);
    }

    // POST {} sweep on other tables (inconnues → 404, comme PostgREST)
    if (method === 'POST' && ['students', 'user_profiles', 'payments', 'expenses', 'todos'].includes(restPath!)) {
      if (anon) return json({ message: 'new row violates row-level security policy' }, 403);
      return json([{ id: `row-${seq++}` }], 201);
    }

    // GET sweep sur les tables connues restantes (RLS : vide pour anon)
    if (method === 'GET' && ['payments', 'expenses', 'todos'].includes(restPath!)) {
      if (anon && leakAnonReads) return json(rows, 200);
      return json([], 200);
    }

    // PATCH students?id=eq.<id>
    if (method === 'PATCH' && idMatch) {
      if (anon) return json([], 204); // RLS matches 0 rows: empty success
      const row = rows.find((r) => r.id === idMatch[1]);
      if (row) row.name = body.name ?? row.name;
      return json(row ? [row] : [], 200);
    }

    // DELETE students?id=eq.<id>
    if (method === 'DELETE' && idMatch) {
      if (anon) return json([], 204);
      const idx = rows.findIndex((r) => r.id === idMatch[1]);
      if (idx >= 0) rows.splice(idx, 1);
      return json([], 204);
    }

    return json({ message: 'not stubbed' }, 404);
  };
}

const run = (opts: StubOptions = {}) =>
  verifyAnonRls({
    base: 'http://stub',
    anonKey: 'anon-key',
    serviceKey: 'service-key',
    fetchImpl: stubSupabase(opts),
    tables: TABLES,
  });

describe('verifyAnonRls (garde-fou CI RLS anon)', () => {
  it('passe dans le monde sain : lecture ET écritures anon refusées (métier + auth)', async () => {
    const { ok, failures } = await run();
    assert.equal(ok, true, failures.join(' | '));
  });

  it('refuse le monde sain quand INSERT anon réussit (policy anon ajoutée)', async () => {
    const { ok, failures } = await run({ allowAnonInsert: true });
    assert.equal(ok, false, 'le garde-fou doit échouer si un insert anon passe');
    assert.ok(failures.some((f) => f.includes('insert anon refusé sur students')), failures.join(' | '));
  });

  it('refuse le monde sain quand les lectures anon fuient', async () => {
    const { ok, failures } = await run({ leakAnonReads: true });
    assert.equal(ok, false, 'le garde-fou doit échouer si une lecture anon remonte des lignes');
    assert.ok(failures.some((f) => f.includes('lecture anon refusée sur students')), failures.join(' | '));
  });

  it('refuse le monde sain quand anon peut exécuter la RPC admin_set_user_password', async () => {
    const { ok, failures } = await run({ allowAnonRpc: true });
    assert.equal(ok, false, 'le garde-fou doit échouer si la RPC de mot de passe est appelable par anon');
    assert.ok(failures.some((f) => f.includes('rpc admin_set_user_password refusé pour anon')), failures.join(' | '));
  });

  it('refuse le monde sain quand le reset par email est verrouillé (recover refusé pour anon)', async () => {
    const { ok, failures } = await run({ lockRecover: true });
    assert.equal(ok, false, 'le garde-fou doit échouer si le flux de reset légitime casse');
    assert.ok(failures.some((f) => f.includes('recover (reset par email) joignable pour anon')), failures.join(' | '));
  });

  it('refuse le monde sain quand un staff peut lire le profil des autres', async () => {
    const { ok, failures } = await run({ seeAllProfiles: true });
    assert.equal(ok, false, 'le garde-fou doit échouer si un staff lit les profils des autres');
    assert.ok(
      failures.some((f) => f.includes("profil d'autrui invisible") || f.includes('lecture user_profiles entière')),
      failures.join(' | '),
    );
  });

  it('refuse le monde sain quand un staff peut réinitialiser un mot de passe', async () => {
    const { ok, failures } = await run({ allowStaffRpc: true });
    assert.equal(ok, false, 'le garde-fou doit échouer si un staff change un mot de passe');
    assert.ok(
      failures.some(
        (f) => f.includes('RPC mot de passe refusée pour un staff') || f.includes('mot de passe « hacké » refusé'),
      ),
      failures.join(' | '),
    );
  });

  it('refuse le monde sain quand l\'admin ne peut plus lire les profils (fonctionnalité Paramètres cassée)', async () => {
    const { ok, failures } = await run({ lockAdminReads: true });
    assert.equal(ok, false, 'le garde-fou doit échouer si l\'admin ne lit plus les profils');
    assert.ok(
      failures.some((f) => f.includes('admin lit tous les profils') || f.includes("admin lit le profil d'un autre")),
      failures.join(' | '),
    );
  });

  it('refuse le monde sain quand l\'admin ne peut plus réinitialiser un mot de passe (reset cassé)', async () => {
    const { ok, failures } = await run({ lockAdminRpc: true });
    assert.equal(ok, false, 'le garde-fou doit échouer si l\'admin ne peut plus changer un mot de passe');
    assert.ok(
      failures.some(
        (f) => f.includes('RPC mot de passe réussie pour un admin') || f.includes('réellement changé par l\'admin'),
      ),
      failures.join(' | '),
    );
  });
});

describe('verifyAnonRemote (garde-fou prod, anon seul, fail-on-breach)', () => {
  const runRemote = (opts: StubOptions = {}) =>
    verifyAnonRemote({
      base: 'http://stub',
      anonKey: 'anon-key',
      fetchImpl: stubSupabase(opts),
      tables: TABLES,
    });

  it('passe sur la base distante saine : aucune donnée ni accès pour anon', async () => {
    const { ok, failures } = await runRemote();
    assert.equal(ok, true, failures.join(' | '));
  });

  it('échoue quand une lecture anon remonte des lignes en prod', async () => {
    const { ok, failures } = await runRemote({ leakAnonReads: true });
    assert.equal(ok, false, 'le garde-fou doit échouer si la base distante fuit des lignes à anon');
    assert.ok(failures.some((f) => f.includes('lecture anon refusée sur students')), failures.join(' | '));
  });

  it('échoue quand un insert anon est accepté en prod', async () => {
    const { ok, failures } = await runRemote({ allowAnonInsert: true });
    assert.equal(ok, false, 'le garde-fou doit échouer si un insert anon passe en prod');
    assert.ok(failures.some((f) => f.includes('insert anon refusé sur students')), failures.join(' | '));
  });

  it('échoue quand la RPC de mot de passe est exécutable par anon (signal 400)', async () => {
    const { ok, failures } = await runRemote({ allowAnonRpc: true });
    assert.equal(ok, false, 'le garde-fou doit échouer si la RPC de mot de passe fuit en prod');
    assert.ok(failures.some((f) => f.includes('rpc admin_set_user_password refusé pour anon')), failures.join(' | '));
  });

  it('échoue quand le reset par email est verrouillé en prod', async () => {
    const { ok, failures } = await runRemote({ lockRecover: true });
    assert.equal(ok, false, 'le garde-fou doit échouer si le flux de reset légitime casse en prod');
    assert.ok(failures.some((f) => f.includes('recover (reset par email) joignable pour anon')), failures.join(' | '));
  });

  it('signale distinctement une table des migrations absente de la base distante (404, dérive de schéma)', async () => {
    const { ok, failures } = await verifyAnonRemote({
      base: 'http://stub',
      anonKey: 'anon-key',
      fetchImpl: stubSupabase(),
      tables: [...TABLES, 'ghost_table'],
    });
    assert.equal(ok, false, 'une table absente de la base distante doit rendre le job rouge (dérive)');
    assert.ok(failures.some((f) => f.includes('table ghost_table absente de la base distante')), failures.join(' | '));
    // Pas de fausse brèche : aucune plainte « insert/lecture anon » sur la table absente.
    assert.ok(!failures.some((f) => f.includes('ghost_table') && f.includes('anon refusé')), failures.join(' | '));
  });
});