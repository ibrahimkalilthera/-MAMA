// Garde-fou CI : après application des migrations sur une instance Supabase
// locale, prouve par l'API REST (le canal réel de l'app) que le rôle anon ne
// LIT ni n'ÉCRIT aucune ligne métier, alors que le rôle service_role a plein
// accès. Sans données visibles au service, un tableau vide côté anon ne
// prouverait rien (tables vides) — d'où le seed via service_role en amont.
//
// Probes :
//   1. seed d'une ligne students via service_role (nom = seule colonne NOT NULL)
//   2. lecture anon refusée sur CHAQUE table (vide ou 4xx)
//   3. INSERT anon refusé sur CHAQUE table (payload valide sur students, `{}`
//      ailleurs — une réponse 2xx signifie qu'un policy anon d'insert existe)
//   4. UPDATE / DELETE anon refusés sur la ligne seedée : PostgREST répond 204
//      même quand RLS masque la ligne, donc la preuve est la RE-LECTURE
//      service_role : la ligne doit être inchangée et toujours présente après
//      chaque tentative anon. Nettoyage final via service_role.
//
// Usage (CI, après `supabase start`) :
//   eval "$(supabase status -o env)" && node scripts/verify-anon-rls.mjs

import { readdirSync, readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export const PROBE_NAME = 'CI Probe — anon RLS';
const HACKED_NAME = `${PROBE_NAME} (hacked)`;

const readBody = async (res) => {
  try {
    const text = await res.text();
    return text ? JSON.parse(text) : [];
  } catch {
    return [];
  }
};

/**
 * @param {object} opts
 * @param {string} opts.base
 * @param {string} opts.anonKey
 * @param {string} opts.serviceKey
 * @param {typeof fetch} [opts.fetchImpl]
 * @param {string[]} opts.tables
 */
export async function verifyAnonRls({ base, anonKey, serviceKey, fetchImpl = fetch, tables }) {
  const failures = [];
  const check = (cond, label) => {
    console.log(`${cond ? '✓' : '✖'} ${label}`);
    if (!cond) failures.push(label);
  };

  const api = (path, key, init = {}) =>
    fetchImpl(`${base}/rest/v1/${path}`, {
      ...init,
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        ...(init.headers ?? {}),
      },
    });

  const REP = 'return=representation';

  check(anonKey && serviceKey, 'clés anon / service_role présentes (SUPABASE_ANON_KEY|ANON_KEY, SUPABASE_SERVICE_ROLE_KEY|SERVICE_ROLE_KEY)');
  check(tables.length > 0, `${tables.length} tables publiques découvertes dans les migrations`);

  // 1. Seed d'une ligne métier via service_role.
  const seed = await api('students', serviceKey, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: PROBE_NAME }),
  });
  // PostgREST renvoie un tableau (Prefer: return=representation) — normaliser.
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
  // (un 2xx — table à colonnes optionnelles + policy anon — échoue aussi).
  const anonInsert = await api('students', anonKey, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: `${PROBE_NAME} (anon)` }),
  });
  check(!anonInsert.ok, `insert anon refusé sur students (${anonInsert.status})`);

  for (const table of tables) {
    const res = await api(table, anonKey, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    });
    check(!res.ok, `insert anon refusé sur ${table} (${res.status})`);
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

  return { ok: failures.length === 0, failures };
}

// ─── CLI (CI) ────────────────────────────────────────────────────────────────
const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  // Toutes les tables publiques déclarées par les migrations ordonnées : une
  // table ajoutée demain est couverte automatiquement, sans mise à jour du script.
  const tables = [
    ...new Set(
      readdirSync('supabase/migrations')
        .sort()
        .flatMap((f) =>
          [
            ...readFileSync(`supabase/migrations/${f}`, 'utf8').matchAll(
              /CREATE TABLE (?:IF NOT EXISTS )?public\.(\w+)/g,
            ),
          ].map((m) => m[1]),
        ),
    ),
  ];

  // La CLI supabase ≥ 2.116.0 exporte ANON_KEY/SERVICE_ROLE_KEY ; les versions
  // antérieures et l'API officielle utilisent SUPABASE_ANON_KEY/
  // SUPABASE_SERVICE_ROLE_KEY — accepter les deux conventions.
  const { ok, failures } = await verifyAnonRls({
    base: process.env.SUPABASE_URL ?? process.env.API_URL ?? 'http://127.0.0.1:54321',
    anonKey: process.env.SUPABASE_ANON_KEY ?? process.env.ANON_KEY,
    serviceKey: process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SERVICE_ROLE_KEY,
    tables,
  });
  if (!ok) {
    console.error(`\n${failures.length} vérification(s) échouée(s) — RLS anon ou migrations cassées.`);
    process.exit(1);
  }
  console.log('\nLectures ET écritures anon refusées après migrations.');
}