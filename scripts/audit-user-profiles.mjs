// Audit + correction de public.user_profiles contre auth.users (production).
//
// Scan (lecture seule) :
//   node --env-file=.env scripts/audit-user-profiles.mjs
// Correction (transaction) :
//   node --env-file=.env scripts/audit-user-profiles.mjs --fix
//
// Détecte :
//   1. full_name « New User » (insensible casse), vide ou placeholder (null/undefined)
//   2. Rôles incohérents avec les métadonnées auth — avec la politique du repo :
//      le metadata "role" est contrôlé par le client (createStaffUser passe par
//      signUp anon), donc il n'est JAMAIS appliqué tel quel (auto-promotion).
//      → les mismatches sont signalés ; seuls les comptes propriétaires
//        documentés dans le repo (OWNER_ROLES) sont réalignés.
//   3. Email de profil ≠ email auth (l'auth fait foi)
//   4. Profils orphelins (sans auth.users) et comptes auth sans profil
//
// Le nom de remplacement suit exactement la logique de la migration
// handle_new_user_guard : metadata full_name si valide, sinon dérivé du
// local-part de l'email (jamais « New User »).

import pg from 'pg';
import { readFileSync } from 'node:fs';

// ── Connexion ────────────────────────────────────────────────────────────────
// Lire .env directement : le --env-file de Node tronque la valeur au premier
// « # » non quoté (MamaFinance2024!Secure#DB → coupé à « Secure »), alors que
// le vrai mot de passe contient un « # ». (migrate-auth-users.mjs fait pareil.)
import { readFileSync as _rf } from 'node:fs';
function _parseEnv(p) {
  const o = {};
  for (const l of _rf(p, 'utf8').split(/\r?\n/)) {
    const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (m) o[m[1]] = m[2].replace(/^["']|["']$/g, '').trim();
  }
  return o;
}
const _env = _parseEnv('.env');
const PW = process.env.SUPABASE_DB_PASSWORD || _env.SUPABASE_DB_PASSWORD;
if (!PW) throw new Error('SUPABASE_DB_PASSWORD absent — renseigner .env');
// Mot de passe brut (non URL-encodé) ; encodeURIComponent gère les caractères
// spéciaux (#, etc.). Port 5432 : le 6543 (PgBouncer) ne répond pas depuis
// ce réseau.
const PROJECT = 'rpcjdohfxwukbqngbprw';
const HOSTS = [
  `aws-0-us-east-1.pooler.supabase.com:5432`,
];
const CONNS = HOSTS.map((h) =>
  `postgresql://postgres.${PROJECT}:${encodeURIComponent(PW)}@${h}/postgres`
);

const FIX = process.argv.includes('--fix');

// ── Politique rôles : comptes propriétaires documentés dans le repo ─────────
// (supabase/create_user.mjs, supabase/run-migrations.mjs, supabase/_update_role.cjs)
const OWNER_ROLES = {
  'ibrahimkalilthera@mamathera.org': 'dev',
  'ibrahimkalilthera@yahoo.com': 'admin',
  'mamadoulaminethera@mamathera.org': 'staff',
};
const VALID_ROLES = new Set(['admin', 'staff', 'dev']);
const NAME_PLACEHOLDERS = new Set(['new user', 'nouvel utilisateur', 'null', 'undefined', 'user']);

// Dérive un nom lisible depuis le local-part de l'email
// (identique à la migration 20260829000000_handle_new_user_guard.sql).
function nameFromEmail(email) {
  try {
    let n = String(email).split('@')[0] || '';
    n = n.replace(/[-_.]+/g, ' ');
    n = n.replace(/([a-z0-9])([A-Z])/g, '$1 $2');
    n = n.trim().replace(/\s+/g, ' ');
    if (!n) throw new Error('vide');
    return n
      .split(' ')
      .map((w) => (w ? w[0].toUpperCase() + w.slice(1).toLowerCase() : w))
      .join(' ');
  } catch {
    return String(email || '').split('@')[0] || 'User';
  }
}

// Nom de remplacement : metadata full_name si crédible, sinon dérivé de l'email.
function replacementName(row) {
  const meta = row.metadata || {};
  const metaName = typeof meta.full_name === 'string' ? meta.full_name.trim() : '';
  if (metaName && metaName.toLowerCase() !== 'new user' && !NAME_PLACEHOLDERS.has(metaName.toLowerCase())) {
    return metaName;
  }
  return nameFromEmail(row.email || row.auth_email || '');
}

const norm = (s) => String(s ?? '').trim().toLowerCase();

async function connect() {
  let lastErr;
  for (let attempt = 1; attempt <= 3; attempt++) {
    for (const cs of CONNS) {
      try {
        const c = new pg.Client({
          connectionString: cs,
          ssl: { rejectUnauthorized: false },
          connectionTimeoutMillis: 15000,
          statement_timeout: 60000,
        });
        await c.connect();
        return c;
      } catch (e) {
        lastErr = e;
      }
    }
    await new Promise((r) => setTimeout(r, 2000 * attempt));
  }
  throw lastErr;
}

(async () => {
  const c = await connect();
  console.log(`connecté à la base ${PROJECT} ✅  (mode: ${FIX ? 'CORRECTION --fix' : 'scan lecture seule'})\n`);

  // 1. Données brutes
  const profiles = (await c.query(
    `SELECT p.id, p.email, p.full_name, p.role, p.created_at,
            u.email AS auth_email, u.email_confirmed_at,
            u.raw_user_meta_data AS metadata, u.created_at AS auth_created
       FROM public.user_profiles p
       LEFT JOIN auth.users u ON u.id = p.id
      ORDER BY p.created_at`
  )).rows;

  const authOnly = (await c.query(
    `SELECT u.id, u.email, u.raw_user_meta_data AS metadata
       FROM auth.users u
       LEFT JOIN public.user_profiles p ON p.id = u.id
      WHERE p.id IS NULL
      ORDER BY u.created_at`
  )).rows;

  const orphans = profiles.filter((p) => !p.auth_email);

  // 2. Détection
  const issues = [];
  const info = [];

  for (const p of profiles) {
    if (!p.auth_email) continue; // traité comme orphelin

    const nm = norm(p.full_name);
    if (!p.full_name || !String(p.full_name).trim() || NAME_PLACEHOLDERS.has(nm)) {
      issues.push({ kind: 'name', row: p, to: replacementName(p), why: `full_name « ${p.full_name} » (placeholder)` });
    }

    // Email de profil vs email auth (l'auth fait foi)
    if (p.email !== p.auth_email) {
      issues.push({ kind: 'email', row: p, to: p.auth_email, why: `email profil « ${p.email} » ≠ auth « ${p.auth_email} »` });
    }

    // Rôle hors ensemble valide (la CHECK devrait l'empêcher, on vérifie quand même)
    if (!VALID_ROLES.has(String(p.role))) {
      const target = OWNER_ROLES[norm(p.auth_email)] || 'staff';
      issues.push({ kind: 'role', row: p, to: target, why: `rôle invalide « ${p.role} »` });
      continue;
    }

    // Mismatch metadata role ↔ profil
    const metaRole = typeof p.metadata?.role === 'string' ? p.metadata.role.toLowerCase() : null;
    if (metaRole && metaRole !== p.role) {
      if (Object.prototype.hasOwnProperty.call(OWNER_ROLES, norm(p.auth_email))) {
        const target = OWNER_ROLES[norm(p.auth_email)];
        if (p.role !== target) {
          issues.push({ kind: 'role', row: p, to: target, why: `compte propriétaire documenté → rôle ${target} (profil: ${p.role}, metadata: ${metaRole})` });
        } else {
          info.push(`ℹ️  ${p.auth_email} : metadata « ${metaRole} » ≠ profil mais rôle déjà conforme à la documentation (${target})`);
        }
      } else {
        info.push(`ℹ️  ${p.auth_email} : metadata role « ${metaRole} » ≠ profil « ${p.role} » — IGNORENÉ (metadata contrôlée par le client ; promotion uniquement via updateUserRole admin)`);
      }
    }
  }

  // 3. Rapport
  console.log(`profils: ${profiles.length} | orphelins (sans auth.users): ${orphans.length} | auth sans profil: ${authOnly.length}`);
  if (orphans.length) {
    console.log('\n— Profils orphelins (à nettoyer manuellement, CASCADE normalement) :');
    for (const o of orphans) console.log(`   ${o.id} ${o.email} « ${o.full_name} » role=${o.role}`);
  }
  if (authOnly.length) {
    console.log('\n— Comptes auth SANS profil (le trigger aurait dû les créer) :');
    for (const a of authOnly) console.log(`   ${a.id} ${a.email}`);
  }
  for (const line of info) console.log('\n' + line);

  if (!issues.length) {
    console.log('\n✅ Aucun profil à corriger.');
    await c.end();
    return;
  }

  console.log(`\n— ${issues.length} correction(s) ${FIX ? 'appliquée(s)' : 'détectée(s)'} :`);
  for (const it of issues) {
    const col = it.kind === 'name' ? 'full_name' : it.kind === 'email' ? 'email' : 'role';
    console.log(`   [${it.kind}] ${it.row.auth_email} :: ${col} « ${it.row[col]} » → « ${it.to} »   (${it.why})`);
  }

  if (!FIX) {
    console.log('\n(lancement sans --fix : rien n’a été modifié)');
    await c.end();
    return;
  }

  // 4. Application en transaction
  const tx = new pg.Client({
    connectionString: c.connectionString,
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 10000,
    statement_timeout: 15000,
  });
  await tx.connect();
  try {
    await tx.query('BEGIN');
    let done = 0;
    for (const it of issues) {
      const col = it.kind === 'name' ? 'full_name' : it.kind === 'email' ? 'email' : 'role';
      const r = await tx.query(
        `UPDATE public.user_profiles SET ${col} = $1 WHERE id = $2 RETURNING id, email, ${col}`,
        [it.to, it.row.id]
      );
      if (r.rowCount) done++;
      else console.log(`   ⚠️  ligne disparue (${it.row.id}) — sautée`);
    }

    // 5. Créer les profils manquants (comportement du trigger : role staff, nom dérivé)
    for (const a of authOnly) {
      const name = replacementName({ metadata: a.metadata, email: a.email });
      await tx.query(
        `INSERT INTO public.user_profiles (id, email, full_name, role)
         VALUES ($1, $2, $3, 'staff')
         ON CONFLICT (id) DO NOTHING`,
        [a.id, a.email, name]
      );
      console.log(`   [profile] ${a.email} : profil créé (full_name « ${name} », role staff)`);
      done++;
    }

    await tx.query('COMMIT');
    console.log(`\n✅ ${done} correction(s) validée(s).`);
  } catch (e) {
    await tx.query('ROLLBACK');
    console.error('\n❌ Échec, rollback :', e.message);
    process.exitCode = 1;
  } finally {
    await tx.end();
    await c.end();
  }
})().catch((e) => {
  console.error('ERREUR:', e.message);
  process.exit(1);
});
