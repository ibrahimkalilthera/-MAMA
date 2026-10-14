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
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { declaredTables, verifyAnonRls, verifyAnonRemote, PROBE_NAME } from '../scripts/verify-anon-rls.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

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
  /**
   * Une table EXPOSÉE par PostgREST que les migrations ne déclarent PAS, et sur
   * laquelle la RLS n'a jamais été activée — l'artefact du 2026-10-11
   * (`students_dupe_backup_20261005`, créé par un `CREATE TABLE … AS`).
   */
  exposedNoRls?: string[];
  /** …et elle est VIDE : la lecture anon rend 0 ligne, seule la sonde d'écrit la trahit. */
  exposedNoRlsEmpty?: boolean;
  /**
   * Le GRANT EXECUTE de `record_station_beat` a disparu : plus AUCUN poste ne
   * peut déclarer sa version (brèche du relevé de parc — la panne la plus
   * coûteuse de ce canal, parce qu'elle est silencieuse).
   */
  lockAnonBeat?: boolean;
  /**
   * La fonction accepte un battement HORS BORNES : sa validation a disparu, et
   * le relevé compterait des lignes qui ne disent rien d'exploitable (brèche).
   */
  lenientBeat?: boolean;
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
  exposedNoRls = [],
  exposedNoRlsEmpty = false,
  lockAnonBeat = false,
  lenientBeat = false,
}: StubOptions = {}) {
  const rows: StubRow[] = [{ id: 'stu-seed', name: PROBE_NAME }];
  const profiles: StubProfile[] = [];
  const users: Array<{ id: string; email: string; password: string }> = [];
  // Le relevé de parc du stub : une ligne par poste, comme la table réelle.
  const beats = new Map<string, Record<string, unknown>>();
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

    // ─── Racine PostgREST : le document OpenAPI, donc la surface EXPOSÉE ─────
    // Le vrai PostgREST répond la même chose (mesuré : 21 chemins, 15 tables),
    // et c'est lui qui rend l'énumération possible sans liste tenue à la main.
    if (method === 'GET' && restPath === '') {
      if (anon) return json({ message: 'permission denied' }, 401);
      const paths = Object.fromEntries([...TABLES, ...exposedNoRls].map((t) => [`/${t}`, {}]));
      return json({ openapi: '3.0.0', paths }, 200);
    }

    // ─── Table exposée SANS RLS (l'artefact du 2026-10-11) ───────────────────
    // Un `CREATE TABLE … AS` n'active pas la sécurité par ligne : anon LIT et
    // ÉCRIT. Quand elle est vide, la lecture ne dit rien — l'écrit, si.
    const exposedTable = exposedNoRls.find((t) => restPath === t || restPath!.startsWith(`${t}?`));
    if (exposedTable) {
      if (method === 'GET') {
        return exposedNoRlsEmpty ? json([], 200) : json([{ id: 'dupe-1', name: 'Eleve' }], 200);
      }
      if (method === 'POST') return json([{ id: 'dupe-2' }], 201);
      return json([], 204);
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

    // ─── RPC du BATTEMENT DE VERSION (§7 du canal) ───────────────────────────
    // La fonction est SECURITY DEFINER et son EXECUTE n'est accordé qu'à `anon` :
    // un payload HORS BORNES doit rendre 400 — la fonction s'exécute (le
    // privilège passe) PUIS refuse. C'est exactement ce que la sonde du dépôt
    // envoie, et c'est ce qui lui permet de prouver le GRANT sans écrire la
    // moindre ligne dans une table que `npm run fleet:versions` compte.
    if (method === 'POST' && restPath === 'rpc/record_station_beat') {
      // GRANT perdu (brèche) : les postes cesseraient de battre en silence.
      if (anon && lockAnonBeat) {
        return json({ message: 'permission denied for function record_station_beat' }, 401);
      }
      // Validation perdue (brèche) : un battement hors bornes serait accepté.
      if (anon && lenientBeat) return json(null, 204);
      const stationId = String(body.p_station_id ?? '');
      if (anon && (stationId.length < 8 || stationId.length > 64)) {
        return json(
          { code: '23514', message: `station_id invalide : longueur ${stationId.length} hors bornes (8..64)` },
          400,
        );
      }
      // Chemin de SUCCÈS : une ligne par poste (ON CONFLICT (station_id) DO UPDATE).
      beats.set(stationId, { ...body, seen_at: 'probe' });
      return json(null, 204);
    }

    // ─── students (REST) ─────────────────────────────────────────────────────
    const idMatch = restPath!.match(/^students\?id=eq\.([\w-]+)$/);
    // La sonde de `replayableWrite` : retrouver la ligne de CE run par son nom
    // (`students?select=*&name=eq.<PROBE_NAME>&limit=1`), pour ne pas la recréer.
    const nameMatch = restPath!.match(/^students\?select=\*&name=eq\.([^&]+)/);
    if (method === 'GET' && (idMatch || nameMatch || restPath === 'students')) {
      if (anon && leakAnonReads) return json(rows, 200);
      if (anon) return json([], 200); // RLS filters everything
      if (nameMatch) return json(rows.filter((r) => r.name === decodeURIComponent(nameMatch[1])), 200);
      const row = idMatch ? rows.find((r) => r.id === idMatch[1]) : undefined;
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

/**
 * La cadence de reprise, INJECTÉE : trois essais, aucune attente réelle.
 *
 * Les scripts attendent 700 ms puis 1,4 s entre deux essais (c'est voulu en
 * production : on laisse passer un hoquet du gateway). Un test qui les paierait
 * transformerait chaque scénario de panne en trois secondes de suite — donc la
 * cadence est un paramètre, et la reprise se prouve sans l'attendre.
 */
const FAST_RETRY = { attempts: 3, waitMs: 0, sleep: async () => {} };

/** Le monde qui hoquette : un 504 du gateway, pas une policy qui parle. */
const flakyGateway = (
  inner: typeof fetch,
  hit: (url: string, init: RequestInit) => boolean,
  times: number,
) => {
  let seen = 0;
  const wrapper: typeof fetch = (input, init = {}) => {
    if (hit(String(input), init) && ++seen <= times) {
      return Promise.resolve(new Response('gateway timeout', { status: 504 }));
    }
    return inner(input, init);
  };
  return wrapper;
};

/** Compte les appels visés, pour prouver qui a été repris — et qui ne l'a pas été. */
const counting = (inner: typeof fetch, hit: (url: string, init: RequestInit) => boolean) => {
  let seen = 0;
  const wrapper: typeof fetch = (input, init = {}) => {
    if (hit(String(input), init)) seen += 1;
    return inner(input, init);
  };
  return { wrapper, count: () => seen };
};

/** La lecture anon d'une table entière : `/rest/v1/students`, sans requête. */
const isPlainGet = (table: string) => (url: string, init: RequestInit) =>
  url.endsWith(`/rest/v1/${table}`) && (init.method ?? 'GET') === 'GET';

/** L'en-tête d'authentification d'un appel, pour distinguer anon / service / session. */
const authOf = (init: RequestInit) => String((init.headers as Record<string, string>)?.Authorization ?? '');

const run = (opts: StubOptions = {}, fetchImpl: typeof fetch = stubSupabase(opts)) =>
  verifyAnonRls({
    base: 'http://stub',
    anonKey: 'anon-key',
    serviceKey: 'service-key',
    fetchImpl,
    tables: TABLES,
    retry: FAST_RETRY,
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

  it('refuse le monde sain quand une table EXPOSÉE hors migrations laisse lire anon (l’artefact du 2026-10-11)', async () => {
    const { ok, failures } = await run({ exposedNoRls: ['students_dupe_backup_20261005'] });
    assert.equal(ok, false, 'une table que le dépôt ne déclare pas doit être nommée, même si les 16 autres sont saines');
    assert.ok(
      failures.some((f) => f.includes('hors des migrations') && f.includes('students_dupe_backup_20261005')),
      failures.join(' | '),
    );
  });

  it('la prend aussi quand elle est VIDE : la lecture ne dit rien, la sonde d’écriture si', async () => {
    const { ok, failures } = await run({ exposedNoRls: ['students_dupe_backup_20261005'], exposedNoRlsEmpty: true });
    assert.equal(ok, false, 'sans RLS, un insert anon passe même sur une table vide');
    assert.ok(
      failures.some((f) => f.includes('insert anon refusé sur students_dupe_backup_20261005 (hors dépôt)')),
      failures.join(' | '),
    );
  });

  it('refuse le monde sain quand anon peut exécuter la RPC admin_set_user_password', async () => {
    const { ok, failures } = await run({ allowAnonRpc: true });
    assert.equal(ok, false, 'le garde-fou doit échouer si la RPC de mot de passe est appelable par anon');
    assert.ok(failures.some((f) => f.includes('rpc admin_set_user_password refusé pour anon')), failures.join(' | '));
  });

  // ─── Le BATTEMENT DE VERSION (§7) : la seule écriture anon qui DOIT passer ─
  // Ces deux cas prouvent que la sonde est VIVANTE : un garde-fou qui ne
  // saurait pas rougir sur son propre objet ne prouverait rien. Le cas sain est
  // couvert par le premier test du fichier (la sonde y tourne et passe).
  it('refuse le monde sain quand le GRANT du battement a disparu (plus aucun poste ne peut déclarer sa version)', async () => {
    const { ok, failures } = await run({ lockAnonBeat: true });
    assert.equal(ok, false, 'un GRANT perdu ferait cesser les battements en silence — le relevé du parc se viderait');
    assert.ok(failures.some((f) => f.includes('record_station_beat')), failures.join(' | '));
  });

  it('refuse le monde sain quand la fonction accepte un battement HORS BORNES', async () => {
    const { ok, failures } = await run({ lenientBeat: true });
    assert.equal(ok, false, 'le relevé accepterait une ligne qui ne dit rien au lieu de la refuser');
    assert.ok(failures.some((f) => f.includes('record_station_beat')), failures.join(' | '));
  });

  it('un transport inconclusif sur le battement est SKIPPÉ, jamais compté comme une brèche', async () => {
    // Un 504 du gateway n'est pas un verdict sur le GRANT : la sonde est sautée,
    // la passe se déclare inconclusive, et AUCUNE brèche n'est nommée — un faux
    // rouge ferait révoquer un GRANT sain. C'est la convention du fichier pour
    // une coupure qui survit à la reprise (`ok: false`, `skipped: true`), et ce
    // cas-ci prouve qu'elle vaut aussi sur la sonde du battement : sans le
    // garde de la sonde, un 504 deviendrait `check(false, …)` et le rapport
    // porterait une brèche qui n'a jamais eu lieu.
    const flaky = flakyGateway(
      stubSupabase({}),
      (url, init) => url.includes('rpc/record_station_beat') && (init.method ?? 'GET') === 'POST',
      3,
    );
    const { ok, failures, skipped } = await run({}, flaky);
    assert.equal(skipped, true, 'une coupure qui survit à la reprise rend la passe inconclusive');
    assert.equal(ok, false, 'on ne juge pas ce qu’on n’a pas pu mesurer');
    // `failures` vide EST la preuve : rien n'est nommé — donc `record_station_beat`
    // n'est pas déclaré perdu sur une coupure de transport.
    assert.deepEqual(failures, [], `aucune brèche inventée : ${failures.join(' | ')}`);
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

describe('la liste des tables sondées vient du parseur du dépôt, pas d’une regex', () => {
  it('un DROP TABLE ÉCRIT EN COMMENTAIRE ne retire plus la table des sondes', () => {
    // Le cas mesuré : `20261005000001_dedupe_students.sql` finit par
    // « --   DROP TABLE public.students_dupe_backup_20261005; ». La regex d'avant
    // lisait cette ligne commentée comme un geste, retirait la table de la liste
    // des sondes, et 14 lignes sont restées lisibles à la clé publique.
    const dir = mkdtempSync(join(tmpdir(), 'mama-migrations-'));
    try {
      writeFileSync(
        join(dir, '20260101000000_a.sql'),
        'CREATE TABLE IF NOT EXISTS public.artefact AS SELECT 1;\r\n--   DROP TABLE public.artefact;\r\n',
      );
      assert.deepEqual(declaredTables(dir), ['artefact'], 'un commentaire n’est pas un geste');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('et une table VRAIMENT dropée par une migration ultérieure ne revient pas', () => {
    const dir = mkdtempSync(join(tmpdir(), 'mama-migrations-'));
    try {
      writeFileSync(join(dir, '20260101000000_a.sql'), 'CREATE TABLE IF NOT EXISTS public.ancienne (a int);\r\n');
      writeFileSync(join(dir, '20260102000000_b.sql'), 'DROP TABLE IF EXISTS public.ancienne;\r\n');
      assert.deepEqual(declaredTables(dir), [], 'le retrait est un geste, et il compte');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('la liste réelle du dépôt est celle des 16 tables, artefact retiré', () => {
    const tables = declaredTables(join(ROOT, 'supabase/migrations'));
    assert.ok(tables.includes('students'), 'les tables métier sont là');
    // La seizième, et elle est SONDÉE : le relevé du parc (§7 du canal) est lu
    // par la même passe que les autres tables — un dépôt qui la déclarerait
    // sans la sonder laisserait la seule écriture anon de l'application hors
    // de la veille.
    assert.ok(tables.includes('station_versions'), 'le relevé du parc est déclaré, donc sondé');
    assert.ok(!tables.includes('students_dupe_backup_20261005'), 'la migration de retrait l’a sortie du dépôt');
    assert.ok(!tables.includes('custom_grades'), 'et la table vraiment dropée ne revient pas');
    assert.equal(tables.length, 16, `16 tables déclarées, mesuré : ${tables.join(', ')}`);
  });
});

describe('verifyAnonRemote (garde-fou prod, anon seul, fail-on-breach)', () => {
  const runRemote = (opts: StubOptions = {}) =>
    verifyAnonRemote({
      base: 'http://stub',
      anonKey: 'anon-key',
      fetchImpl: stubSupabase(opts),
      tables: TABLES,
      retry: FAST_RETRY,
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
      retry: FAST_RETRY,
    });
    assert.equal(ok, false, 'une table absente de la base distante doit rendre le job rouge (dérive)');
    assert.ok(failures.some((f) => f.includes('table ghost_table absente de la base distante')), failures.join(' | '));
    // Pas de fausse brèche : aucune plainte « insert/lecture anon » sur la table absente.
    assert.ok(!failures.some((f) => f.includes('ghost_table') && f.includes('anon refusé')), failures.join(' | '));
  });
});

describe('détection d\'absence de backend — skip propre, jamais une brèche', () => {
  const unreachable: typeof fetch = async () => {
    throw new TypeError('fetch failed');
  };

  it('verifyAnonRls SKIP quand le backend local est injoignable (aucune fausse brèche)', async () => {
    const { ok, failures, skipped } = await verifyAnonRls({
      base: 'http://down',
      anonKey: 'anon-key',
      serviceKey: 'service-key',
      fetchImpl: unreachable,
      tables: TABLES,
      retry: FAST_RETRY,
    });
    assert.equal(skipped, true, 'backend absent → skipped, pas un échec rouge');
    assert.equal(ok, false);
    assert.deepEqual(failures, [], 'aucune vérification inventée sur un backend mort');
  });

  it('verifyAnonRls SKIP quand le backend meurt en cours de route (blip réseau)', async () => {
    let calls = 0;
    const flaky: typeof fetch = async () => {
      calls += 1;
      if (calls > 1) throw new TypeError('fetch failed');
      return new Response('{}', { status: 404 }); // ping OK, la suite tombe
    };
    const { ok, skipped } = await verifyAnonRls({
      base: 'http://flaky',
      anonKey: 'anon-key',
      serviceKey: 'service-key',
      fetchImpl: flaky,
      tables: TABLES,
      retry: FAST_RETRY,
    });
    assert.equal(skipped, true, 'panne en cours de run → skip, pas une brèche');
    assert.equal(ok, false);
  });

  it('verifyAnonRemote SKIP quand la base distante est injoignable', async () => {
    const { ok, failures, skipped } = await verifyAnonRemote({
      base: 'http://down',
      anonKey: 'anon-key',
      fetchImpl: unreachable,
      tables: TABLES,
      retry: FAST_RETRY,
    });
    assert.equal(skipped, true, 'base distante absente → skip propre');
    assert.equal(ok, false);
    assert.deepEqual(failures, [], 'aucune fausse brèche sur la base distante morte');
  });
});

describe('double brique du transport — un 504 du gateway n\'est pas un verdict', () => {
  it('une coupure passagère sur une LECTURE est reprise, et la lecture reste jugée', async () => {
    const counted = counting(flakyGateway(stubSupabase(), isPlainGet('students'), 1), isPlainGet('students'));
    const { ok, skipped } = await run({}, counted.wrapper);
    assert.equal(skipped, false, 'un hoquet absorbé par la reprise ne rend pas la passe inconclusive');
    assert.equal(ok, true, 'après reprise, la lecture anon est bien refusée');
    assert.equal(counted.count(), 2, 'une tentative 504 + une reprise — le hoquet a bien été rejoué');
  });

  it('une coupure qui SURVIT à la reprise rend la passe inconclusive, pas verte', async () => {
    const { ok, failures, skipped } = await run({}, flakyGateway(stubSupabase(), isPlainGet('students'), 99));
    // Avant la double brique, un 504 vivant était lu comme `!res.ok` : la lecture
    // passait pour « refusée » et la passe sortait VERTE sans avoir rien prouvé.
    assert.equal(ok, false, 'une lecture qu\'on n\'a pas pu juger ne vaut pas un vert');
    assert.equal(skipped, true, 'elle vaut un SKIP explicite (exit 0) — jamais une brèche');
    assert.deepEqual(failures, [], 'un 504 lu comme un refus anon aurait été le faux vert à éviter');
  });

  it('un VERDICT n\'est jamais repris : le refus 401 de la RPC est compté une fois', async () => {
    const isAnonRpc = (url: string, init: RequestInit) =>
      url.endsWith('/rest/v1/rpc/admin_set_user_password') && authOf(init).includes('anon-key');
    const counted = counting(stubSupabase(), isAnonRpc);
    const { ok } = await run({}, counted.wrapper);
    assert.equal(ok, true);
    assert.equal(counted.count(), 1, 'un 401 est une réponse, pas un hoquet : aucune reprise');
  });

  it('un 504 sur l\'ÉCRITURE de sonde ne double pas la ligne (sonde avant rejeu)', async () => {
    let seedPosts = 0;
    const inner = stubSupabase();
    const isSeedPost = (url: string, init: RequestInit) =>
      url.endsWith('/rest/v1/students') && (init.method ?? 'GET') === 'POST' && authOf(init).includes('service');
    const losesTheAnswer: typeof fetch = (input, init = {}) => {
      if (!isSeedPost(String(input), init)) return inner(input, init);
      seedPosts += 1;
      // Le gateway perd la réponse APRÈS avoir appliqué l'écriture : c'est le
      // scénario exact où un rejeu à l'aveugle créerait une seconde ligne.
      if (seedPosts === 1) return inner(input, init).then(() => new Response('gateway timeout', { status: 504 }));
      return inner(input, init);
    };
    const { ok, skipped } = await run({}, losesTheAnswer);
    assert.equal(skipped, false);
    assert.equal(ok, true);
    assert.equal(seedPosts, 1, 'la sonde a retrouvé la ligne déjà appliquée — aucun second POST');
  });

  it('en mode remote aussi : une coupure persistante SKIP au lieu de juger', async () => {
    const { ok, failures, skipped } = await verifyAnonRemote({
      base: 'http://stub',
      anonKey: 'anon-key',
      fetchImpl: flakyGateway(stubSupabase(), isPlainGet('students'), 99),
      tables: TABLES,
      retry: FAST_RETRY,
    });
    assert.equal(ok, false);
    assert.equal(skipped, true, 'base distante qu\'on n\'a pas pu lire → inconclusif, pas un verdict');
    assert.deepEqual(failures, []);
  });
});