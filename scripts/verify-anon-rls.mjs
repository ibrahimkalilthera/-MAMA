// Garde-fou CI : après application des migrations sur une instance Supabase
// locale, prouve par l'API REST (le canal réel de l'app) que le rôle anon ne
// LIT ni n'ÉCRIT aucune ligne métier, alors que le rôle service_role a plein
// accès. Sans données visibles au service, un tableau vide côté anon ne
// prouverait rien (tables vides) — d'où le seed via service_role en amont.
//
// Probes (mode local, `supabase start`) :
//   1. seed d'une ligne students via service_role (nom = seule colonne NOT NULL)
//   2. lecture anon refusée sur CHAQUE table (vide ou 4xx)
//   3. INSERT anon refusé sur CHAQUE table (payload valide sur students, `{}`
//      ailleurs — une réponse 2xx signifie qu'un policy anon d'insert existe)
//   4. UPDATE / DELETE anon refusés sur la ligne seedée : PostgREST répond 204
//      même quand RLS masque la ligne, donc la preuve est la RE-LECTURE
//      service_role : la ligne doit être inchangée et toujours présente après
//      chaque tentative anon. Nettoyage final via service_role.
//   5. Auth — user_profiles : création d'un VRAI utilisateur auth via l'API
//      admin GoTrue (service_role) → le trigger handle_new_user crée sa ligne
//      → lecture / UPDATE / DELETE anon refusés, preuve par re-lecture service.
//   6. RPC mot de passe admin_set_user_password : refusé pour anon (accordé
//      uniquement à authenticated) ; le reset par email (recover GoTrue)
//      reste joignable pour anon — le garde-fou ne « réussit » pas en
//      verrouillant tout l'auth.
//
// Mode remote (`node scripts/verify-anon-rls.mjs --remote`, base DISTANTE) :
//   7. probes STRICTEMENT anon — aucun service_role (le script refuse de
//      tourner si une clé service est présente). Pas de seed possible, donc
//      pas de preuve par re-lecture : lectures vides/4xx, INSERT `{}` et RPC
//      de mot de passe doivent répondre 401/403 STRICTEMENT (un 400 = policy
//      ou GRANT franchi, une brèche masquée par un simple `!ok`), admin
//      GoTrue refusé, recover joignable (email inconnu → aucun envoi). Une
//      table absente (404) est signalée comme DÉRIVE de schéma, pas comme
//      brèche. La découverte des tables soustrait les DROP TABLE des
//      migrations (custom_grades est dropée par 20260828000004).
//
// Usage (CI, après `supabase start`) :
//   eval "$(supabase status -o env)" && node scripts/verify-anon-rls.mjs
// Usage (production, clé anon seule) :
//   SUPABASE_URL=… ANON_KEY=… node scripts/verify-anon-rls.mjs --remote

import { readdirSync, readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export const PROBE_NAME = 'CI Probe — anon RLS';
const HACKED_NAME = `${PROBE_NAME} (hacked)`;

// 401 (permission denied) et 403 (policy RLS) sont le refus anon attendu.
// Toute AUTRE réponse à une écriture anon est une brèche — y compris un 400 :
// une erreur de contrainte ne survient qu'APRÈS le passage d'une policy
// d'insert (ou l'exécution d'une fonction), donc un 400 prouve un accès.
const RLS_REFUSAL = (res) => res.status === 401 || res.status === 403;

const readBody = async (res) => {
  try {
    const text = await res.text();
    return text ? JSON.parse(text) : [];
  } catch {
    return [];
  }
};

const makeCheck = () => {
  const failures = [];
  return {
    failures,
    check: (cond, label) => {
      console.log(`${cond ? '✓' : '✖'} ${label}`);
      if (!cond) failures.push(label);
    },
  };
};

const makeApi = (base, fetchImpl) => (path, key, init = {}) =>
  fetchImpl(`${base}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      ...(init.headers ?? {}),
    },
  });

const makeAuthApi = (base, fetchImpl) => (path, key, init = {}) =>
  fetchImpl(`${base}/auth/v1/${path}`, {
    ...init,
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      ...(init.headers ?? {}),
    },
  });

/**
 * @param {object} opts
 * @param {string} opts.base
 * @param {string} opts.anonKey
 * @param {string} opts.serviceKey
 * @param {typeof fetch} [opts.fetchImpl]
 * @param {string[]} opts.tables
 */
export async function verifyAnonRls({ base, anonKey, serviceKey, fetchImpl = fetch, tables }) {
  const { failures, check } = makeCheck();
  const api = makeApi(base, fetchImpl);
  const authApi = makeAuthApi(base, fetchImpl);

  const REP = 'return=representation';

  check(anonKey && serviceKey, 'clés anon / service_role présentes (SUPABASE_ANON_KEY|ANON_KEY, SUPABASE_SERVICE_ROLE_KEY|SERVICE_ROLE_KEY)');
  check(tables.length > 0, `${tables.length} tables publiques découvertes dans les migrations`);

  // 1. Seed d'une ligne métier via service_role.
  const seed = await api('students', serviceKey, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Prefer: REP },
    body: JSON.stringify({ name: PROBE_NAME }),
  });
  // Sans Prefer: return=representation, PostgREST répond 201 avec un corps
  // VIDE (return=minimal) — le header est requis pour récupérer l'id seedé.
  const seedBody = seed.ok ? await readBody(seed) : null;
  const inserted = Array.isArray(seedBody) ? seedBody[0] : seedBody;
  check(seed.ok, `insert service_role dans students (${seed.status})`);
  check(inserted?.id != null, 'ligne seedée avec un id');
  if (!inserted?.id) return { ok: false, failures };

  // 2. Le service_role voit bien la ligne : la base contient des données.
  const viaService = await api(`students?id=eq.${inserted.id}`, serviceKey);
  const serviceRows = viaService.ok ? await readBody(viaService) : [];
  check(viaService.ok && serviceRows.length === 1, 'service_role lit la ligne seedée');

  // 3. Le rôle anon ne lit RIEN : soit réponse vide (RLS filtre tout), soit
  // refus pur (4xx) — les deux sont une lecture refusée. Vérifié sur chaque
  // table, y compris celle qui contient la ligne seedée.
  for (const table of tables) {
    const res = await api(table, anonKey);
    const body = res.ok ? await readBody(res) : [];
    const refused = !res.ok || (Array.isArray(body) && body.length === 0);
    check(refused, `lecture anon refusée sur ${table} (${res.status}, ${Array.isArray(body) ? body.length : 'non-tableau'} ligne(s))`);
  }

  // 4. INSERT anon refusé : payload valide sur la table seedée (un policy
  // anon d'insert produirait un 201), puis balayage `{}` sur chaque table
  // (un 2xx — table à colonnes optionnelles + policy anon — échoue aussi ;
  // un 400 = contrainte atteinte APRÈS passage de la policy = brèche).
  const anonInsert = await api('students', anonKey, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: `${PROBE_NAME} (anon)` }),
  });
  check(RLS_REFUSAL(anonInsert), `insert anon refusé sur students (${anonInsert.status})`);

  for (const table of tables) {
    const res = await api(table, anonKey, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    });
    check(RLS_REFUSAL(res), `insert anon refusé sur ${table} (${res.status})`);
  }

  // 5. UPDATE anon refusé : 204 masque « 0 ligne affectée », donc la preuve
  // est la re-lecture service_role — la ligne doit être inchangée.
  const anonUpd = await api(`students?id=eq.${inserted.id}`, anonKey, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Prefer: REP },
    body: JSON.stringify({ name: HACKED_NAME }),
  });
  const updBody = anonUpd.ok ? await readBody(anonUpd) : [];
  check(!(anonUpd.ok && Array.isArray(updBody) && updBody.length > 0), `update anon refusé sur students (${anonUpd.status})`);
  const afterUpd = await api(`students?id=eq.${inserted.id}`, serviceKey);
  const updRows = afterUpd.ok ? await readBody(afterUpd) : [];
  check(updRows[0]?.name === PROBE_NAME, 'ligne seedée inchangée après update anon');

  // 6. DELETE anon refusé : même principe — la ligne doit survivre.
  const anonDel = await api(`students?id=eq.${inserted.id}`, anonKey, {
    method: 'DELETE',
    headers: { Prefer: REP },
  });
  const delBody = anonDel.ok ? await readBody(anonDel) : [];
  check(!(anonDel.ok && Array.isArray(delBody) && delBody.length > 0), `delete anon refusé sur students (${anonDel.status})`);
  const afterDel = await api(`students?id=eq.${inserted.id}`, serviceKey);
  const delRows = afterDel.ok ? await readBody(afterDel) : [];
  check(delRows.length === 1, 'ligne seedée présente après delete anon');

  // 7. Nettoyage via service_role.
  const cleanup = await api(`students?id=eq.${inserted.id}`, serviceKey, { method: 'DELETE' });
  check(cleanup.ok, `nettoyage service_role (${cleanup.status})`);

  // ─── Auth : user_profiles + RPC mot de passe ───────────────────────────────

  // 8. Créer un VRAI utilisateur auth via l'API admin GoTrue (service_role) :
  // le trigger handle_new_user doit produire sa ligne user_profiles. Sans
  // cette ligne (FK vers auth.users), PATCH/DELETE anon seraient vides — le
  // même piège 204 que pour students.
  const probeEmail = `ci-probe-${Date.now()}@example.test`;
  const adminCreate = await authApi('admin/users', serviceKey, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: probeEmail, password: 'probe-pass-123', email_confirm: true }),
  });
  const createdUser = adminCreate.ok ? await readBody(adminCreate) : null;
  check(adminCreate.ok && createdUser?.id != null, `création utilisateur auth via service_role (${adminCreate.status})`);
  if (!createdUser?.id) return { ok: false, failures };

  // 9. Le trigger handle_new_user a bien créé la ligne user_profiles.
  const profile = await api(`user_profiles?id=eq.${createdUser.id}`, serviceKey);
  const profileRows = profile.ok ? await readBody(profile) : [];
  check(profileRows.length === 1, 'trigger handle_new_user a créé la ligne user_profiles');

  // 10. anon ne lit pas user_profiles, même avec une ligne réelle en base.
  const anonProfileRead = await api(`user_profiles?id=eq.${createdUser.id}`, anonKey);
  const anonProfileRows = anonProfileRead.ok ? await readBody(anonProfileRead) : [];
  check(
    !anonProfileRead.ok || anonProfileRows.length === 0,
    `lecture anon refusée sur user_profiles (${anonProfileRead.status}, ${Array.isArray(anonProfileRows) ? anonProfileRows.length : 'non-tableau'} ligne(s))`,
  );

  // 11. UPDATE / DELETE anon sur user_profiles : la ligne doit survivre.
  const anonProfileUpd = await api(`user_profiles?id=eq.${createdUser.id}`, anonKey, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Prefer: REP },
    body: JSON.stringify({ full_name: HACKED_NAME }),
  });
  const updB = anonProfileUpd.ok ? await readBody(anonProfileUpd) : [];
  check(!(anonProfileUpd.ok && Array.isArray(updB) && updB.length > 0), `update anon refusé sur user_profiles (${anonProfileUpd.status})`);
  const profileAfterUpd = await api(`user_profiles?id=eq.${createdUser.id}`, serviceKey);
  const afterUpdRows = profileAfterUpd.ok ? await readBody(profileAfterUpd) : [];
  check(afterUpdRows[0]?.full_name !== HACKED_NAME, 'user_profiles inchangée après update anon');

  const anonProfileDel = await api(`user_profiles?id=eq.${createdUser.id}`, anonKey, {
    method: 'DELETE',
    headers: { Prefer: REP },
  });
  const delB = anonProfileDel.ok ? await readBody(anonProfileDel) : [];
  check(!(anonProfileDel.ok && Array.isArray(delB) && delB.length > 0), `delete anon refusé sur user_profiles (${anonProfileDel.status})`);
  const profileAfterDel = await api(`user_profiles?id=eq.${createdUser.id}`, serviceKey);
  const afterDelRows = profileAfterDel.ok ? await readBody(profileAfterDel) : [];
  check(afterDelRows.length === 1, 'user_profiles présente après delete anon');

  // 12. RPC de mot de passe : admin_set_user_password n'est accordé qu'à
  // authenticated — un appel anon doit être refusé (401/403).
  const anonRpc = await api('rpc/admin_set_user_password', anonKey, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ target_user_id: createdUser.id, new_password: 'hacked-pass-1' }),
  });
  check(RLS_REFUSAL(anonRpc), `rpc admin_set_user_password refusé pour anon (${anonRpc.status})`);

  // 13. Le flux de reset légitime (recover GoTrue) reste joignable pour anon :
  // un garde-fou qui « réussirait » en verrouillant tout l'auth casserait
  // l'app tout en restant vert.
  const recover = await authApi('recover', anonKey, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: probeEmail }),
  });
  check(recover.status < 400, `recover (reset par email) joignable pour anon (${recover.status})`);

  // 14. Nettoyage : suppression de l'utilisateur auth (cascade → user_profiles).
  const adminDelete = await authApi(`admin/users/${createdUser.id}`, serviceKey, { method: 'DELETE' });
  check(adminDelete.ok, `nettoyage utilisateur auth (${adminDelete.status})`);

  return { ok: failures.length === 0, failures };
}

/**
 * Mode remote (production) : probes STRICTEMENT anon, aucun service_role.
 * Sans service_role on ne peut ni seeder ni créer d'utilisateur GoTrue : la
 * preuve par re-lecture (UPDATE/DELETE) n'existe pas ici. Le mode remote
 * n'accepte AUCUNE écriture : toute réponse 2xx ou 400 à une tentative
 * d'écriture échoue le job — et rien n'est jamais écrit (le `{}` ne passe
 * aucune contrainte sur les tables NOT NULL, la RPC lève avant l'UPDATE).
 *
 * @param {object} opts
 * @param {string} opts.base
 * @param {string} opts.anonKey
 * @param {typeof fetch} [opts.fetchImpl]
 * @param {string[]} opts.tables
 */
export async function verifyAnonRemote({ base, anonKey, fetchImpl = fetch, tables }) {
  const { failures, check } = makeCheck();
  const api = makeApi(base, fetchImpl);
  const authApi = makeAuthApi(base, fetchImpl);

  check(anonKey, 'clé anon présente (mode remote)');
  check(tables.length > 0, `${tables.length} tables publiques découvertes dans les migrations`);

  // Lectures : la moindre ligne visible par anon sur la base distante = brèche.
  // Dérive de schéma : une table des migrations ABSENTE de la base distante
  // (404) n'est pas une brèche anon mais une alerte — prod derrière les
  // migrations ou table supprimée en direct. Marquée distinctement, et les
  // probes d'écriture sont sautées (une table inexistante ne peut pas fuir).
  const missing = new Set();
  for (const table of tables) {
    const res = await api(table, anonKey);
    const body = res.ok ? await readBody(res) : [];
    if (res.status === 404) {
      missing.add(table);
      check(false, `table ${table} absente de la base distante — dérive de schéma (404)`);
      continue;
    }
    const refused = !res.ok || (Array.isArray(body) && body.length === 0);
    check(refused, `lecture anon refusée sur ${table} (${res.status}, ${Array.isArray(body) ? body.length : 'non-tableau'} ligne(s))`);
  }

  // INSERT `{}` sur CHAQUE table : refus RLS STRICT (401/403). Un 201 =
  // policy anon d'insert ; un 400 = contrainte atteinte APRÈS le passage de
  // la policy — les deux prouvent un accès anon.
  for (const table of tables) {
    if (missing.has(table)) continue;
    const res = await api(table, anonKey, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    });
    check(RLS_REFUSAL(res), `insert anon refusé sur ${table} (${res.status})`);
  }

  // RPC de mot de passe : refus STRICT. Un 400 = la fonction est exécutable
  // par anon et lève l'exception métier (auth.uid() null) — le GRANT fuit.
  const anonRpc = await api('rpc/admin_set_user_password', anonKey, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      target_user_id: '00000000-0000-0000-0000-000000000000',
      new_password: 'probe-remote',
    }),
  });
  if (anonRpc.status === 404) {
    check(false, 'rpc admin_set_user_password absente de la base distante — dérive de schéma (404)');
  } else {
    check(RLS_REFUSAL(anonRpc), `rpc admin_set_user_password refusé pour anon (${anonRpc.status})`);
  }

  // Admin GoTrue : aucune route admin pour anon (404 = endpoints absents,
  // toujours pas d'accès anon).
  const adminUsers = await authApi('admin/users', anonKey);
  check([401, 403, 404].includes(adminUsers.status), `admin GoTrue refusé pour anon (${adminUsers.status})`);

  // Reset par email : joignable — l'email inconnu ne déclenche aucun envoi.
  const recover = await authApi('recover', anonKey, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: `ci-remote-${Date.now()}@example.test` }),
  });
  check(recover.status < 400, `recover (reset par email) joignable pour anon (${recover.status})`);

  return { ok: failures.length === 0, failures };
}

// ─── CLI (CI) ────────────────────────────────────────────────────────────────
const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const remote = process.argv.includes('--remote');

  // Toutes les tables publiques déclarées par les migrations ordonnées, MOINS
  // celles qu'une migration ultérieure DROP (ex. custom_grades, supprimée par
  // 20260828000004) : une table ajoutée demain est couverte automatiquement,
  // sans mise à jour du script — et une table dropée n'est jamais sondée.
  const created = readdirSync('supabase/migrations')
    .sort()
    .flatMap((f) =>
      [
        ...readFileSync(`supabase/migrations/${f}`, 'utf8').matchAll(
          /CREATE TABLE (?:IF NOT EXISTS )?public\.(\w+)/g,
        ),
      ].map((m) => m[1]),
    );
  const dropped = readdirSync('supabase/migrations')
    .sort()
    .flatMap((f) =>
      [
        ...readFileSync(`supabase/migrations/${f}`, 'utf8').matchAll(
          /DROP TABLE (?:IF EXISTS )?public\.(\w+)/g,
        ),
      ].map((m) => m[1]),
    );
  const tables = [...new Set(created.filter((t) => !dropped.includes(t)))];

  // La CLI supabase ≥ 2.116.0 exporte ANON_KEY/SERVICE_ROLE_KEY ; les versions
  // antérieures et l'API officielle utilisent SUPABASE_ANON_KEY/
  // SUPABASE_SERVICE_ROLE_KEY — accepter les deux conventions.
  const base = process.env.SUPABASE_URL ?? process.env.API_URL ?? 'http://127.0.0.1:54321';
  const anonKey = process.env.SUPABASE_ANON_KEY ?? process.env.ANON_KEY;

  if (remote) {
    // Jamais de service_role contre la base distante : si une clé service est
    // présente dans l'environnement, c'est une erreur de configuration — on
    // refuse de tourner plutôt que de risquer une fuite.
    const servicePresent = !!(process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SERVICE_ROLE_KEY);
    if (servicePresent) {
      console.error('Mode --remote : une clé service_role est présente dans l\'environnement — jamais de service_role contre la base distante.');
      process.exit(2);
    }
    const { ok, failures } = await verifyAnonRemote({ base, anonKey, tables });
    if (!ok) {
      console.error(`\n${failures.length} brèche(s) anon détectée(s) sur la base distante — fail-on-breach.`);
      process.exit(1);
    }
    console.log('\nBase distante : aucune lecture ni écriture anon possible (métier + auth).');
  } else {
    const { ok, failures } = await verifyAnonRls({
      base,
      anonKey,
      serviceKey: process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SERVICE_ROLE_KEY,
      tables,
    });
    if (!ok) {
      console.error(`\n${failures.length} vérification(s) échouée(s) — RLS anon ou migrations cassées.`);
      process.exit(1);
    }
    console.log('\nMétier et auth (user_profiles, RPC mot de passe) : anon refusé après migrations.');
  }
}