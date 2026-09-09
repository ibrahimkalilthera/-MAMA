#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// verify-ephemeral-cleanup.mjs — final "no residue" guard for the PDF E2E job.
//
// Every E2E script (verify-csp-guard.mjs, verify-pdf-download.mjs --mode auto
// and --mode recu-parent) creates an ephemeral admin account and deletes it in
// a finally block — but a broken cleanup (early crash, error swallowed) leaves
// a residue behind. This guard runs LAST in the job and fails the run if any
// ephemeral account is still present after all the checks have run:
//
//   auth.users         — emails matching ^verify-, ^e2e-, ^audit- or
//                        ending in @audit.local (the CSP guard's pattern);
//   public.user_profiles — rows whose email matches the same patterns (the
//                        FK to auth.users is ON DELETE CASCADE, so a leftover
//                        profile row also means a broken cleanup).
//
// The Supabase admin API deletes the auth user; the cascade handles the
// profile. A residue here means the cleanup chain is broken → red run.
//
// Usage: node scripts/verify-ephemeral-cleanup.mjs
// Reads .env (VITE_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY), same as the
// other E2E scripts. Exit 0 = base propre, exit 1 = résidus trouvés.
// ─────────────────────────────────────────────────────────────────────────────
import { existsSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { EPHEMERAL_PATTERNS } from './lib/ephemeral-accounts.mjs';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const isEphemeral = (email) => EPHEMERAL_PATTERNS.some((re) => re.test(email || ''));
const parseEnv = (p) => {
  const o = {};
  for (const l of readFileSync(p, 'utf8').split(/\r?\n/)) {
    const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (m) o[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
  return o;
};
const envFile = join(root, '.env');
if (!existsSync(envFile)) {
  console.error('Introuvable: .env (SUPABASE_SERVICE_ROLE_KEY requis).');
  process.exit(1);
}
const env = parseEnv(envFile);
const supabaseBase = (env.VITE_SUPABASE_URL || '').replace(/\/$/, '');
const SERVICE_KEY = env.SUPABASE_SERVICE_ROLE_KEY;
if (!supabaseBase || !SERVICE_KEY) {
  console.error('❌ VITE_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY manquants dans .env');
  process.exit(1);
}
const HDR = { apikey: SERVICE_KEY, Authorization: 'Bearer ' + SERVICE_KEY, 'Content-Type': 'application/json' };

// Ephemeral patterns now live in scripts/lib/ephemeral-accounts.mjs — the
// single source of truth imported by every E2E script AND this guard, so a
// new script cannot silently create an account that escapes the gate.

const api = async (path) => {
  const r = await fetch(`${supabaseBase}${path}`, { headers: HDR });
  const t = await r.text();
  return { status: r.status, body: t ? JSON.parse(t) : null };
};

let fail = false;

// 1. auth.users — every ephemeral account created by the E2E scripts.
const users = await api('/auth/v1/admin/users?per_page=1000');
const leftoverUsers = (users.body?.users || []).filter((u) => isEphemeral(u.email));
if (leftoverUsers.length) {
  console.error(`❌ ${leftoverUsers.length} compte(s) éphémère(s) encore présent(s) dans auth.users :`);
  for (const u of leftoverUsers) console.error(`   ${u.email} | ${u.id} | ${u.created_at}`);
  fail = true;
} else {
  console.log('✅ aucun compte éphémère résiduel dans auth.users');
}

// 2. user_profiles — the trigger inserts one row per new user; the FK
//    (ON DELETE CASCADE) removes it with the account. A leftover row here
//    also means a broken cleanup.
const profiles = await api('/rest/v1/user_profiles?select=id,email&limit=1000');
const leftoverProfiles = (profiles.body || []).filter((p) => isEphemeral(p.email));
if (leftoverProfiles.length) {
  console.error(`❌ ${leftoverProfiles.length} profil(s) éphémère(s) résiduel(s) dans public.user_profiles :`);
  for (const p of leftoverProfiles) console.error(`   ${p.email} | ${p.id}`);
  fail = true;
} else {
  console.log('✅ aucun profil éphémère résiduel dans user_profiles');
}

if (fail) {
  console.error('\n❌ Nettoyage cassé — un script E2E a laissé un résidu en base.');
  process.exit(1);
}
console.log('\n✅ Base propre — tous les comptes éphémères ont été supprimés par leurs scripts.');
process.exit(0);