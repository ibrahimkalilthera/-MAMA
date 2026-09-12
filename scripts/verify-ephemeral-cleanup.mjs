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
// Usage:
//   node scripts/verify-ephemeral-cleanup.mjs              → détecte (exit 1 si résidus)
//   node scripts/verify-ephemeral-cleanup.mjs --cleanup-only → purge les résidus (maintenance)
// Reads .env (VITE_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY), same as the
// other E2E scripts. Exit 0 = base propre, exit 1 = résidus trouvés (ou
// purge incomplète). Le mode purge est EXPLICITE (--cleanup-only) : la CI
// reste en détection pure pour qu'un nettoyage cassé fasse toujours rouge.
// ─────────────────────────────────────────────────────────────────────────────
import { existsSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { EPHEMERAL_PATTERNS } from './lib/ephemeral-accounts.mjs';
import { withTransientRetry } from './lib/transient-http.mjs';
import { publishEvidence } from './lib/evidence-publisher.mjs';

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

/** Le corps non-JSON (page HTML d'une passerelle) reste un statut, pas une erreur de syntaxe. */
const parseBody = (text) => {
  if (!text) return null;
  try { return JSON.parse(text); } catch { return { _nonJson: text.slice(0, 200) }; }
};

// Même règle que les scripts E2E (scripts/lib/transient-http.mjs) : une coupure
// de passerelle (504) n'est pas un verdict. Ici elle compte DOUBLE — mesuré le
// 2026-09-12 : c'est une suppression qui a pris un 504, donc le résidu est resté
// en base ; une détection seule n'aurait rien purgé, et une purge qui renonce au
// premier hoquet laisse le résidu exactement là où il était.
const api = (path, opts = {}) => withTransientRetry(async () => {
  const r = await fetch(`${supabaseBase}${path}`, { headers: HDR, ...opts });
  const t = await r.text();
  return { status: r.status, body: parseBody(t) };
}, { label: `${opts.method || 'GET'} ${path} — `, log: (m) => console.log(`  ↻ ${m}`) });

// --cleanup-only : purge mode. Deletes every residue found instead of only
// reporting them, then exits 0 when the base is clean. This is an EXPLICIT
// maintenance step (run by hand after a broken cleanup); the CI final guard
// stays detect-only so a broken cleanup is always a red run, never silently
// masked by an auto-fix.
const CLEANUP_ONLY = process.argv.includes('--cleanup-only');

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
// Ce que ce contrôle a RÉELLEMENT parcouru : la preuve d'automatisation qui
// porte ce nombre vient d'ici, pas d'une phrase écrite dans le workflow —
// « j'ai agi » sans rien à compter serait une preuve vide.
const scanned = (users.body?.users || []).length + (profiles.body || []).length;
if (leftoverProfiles.length) {
  console.error(`❌ ${leftoverProfiles.length} profil(s) éphémère(s) résiduel(s) dans public.user_profiles :`);
  for (const p of leftoverProfiles) console.error(`   ${p.email} | ${p.id}`);
  fail = true;
} else {
  console.log('✅ aucun profil éphémère résiduel dans user_profiles');
}

// ── 3. Purge mode (--cleanup-only) ─────────────────────────────────────────
// Un 404 a DEUX causes, et une seule est un échec : le compte n'était déjà plus
// là (une reprise a réussi après un 504 — le but est atteint) ou l'id a disparu
// entre la lecture et la suppression. Dans les deux cas, « plus rien en base »
// est exactement ce que ce mode demande : refuser ici ferait ROUGIR une purge
// qui a fait son travail, et une alerte fausse est pire que pas d'alerte.
const deleted = (status) => status === 204 || status === 200 || status === 404;

if (CLEANUP_ONLY) {
  let ok = true;
  // Delete the accounts; ON DELETE CASCADE removes their user_profiles row.
  for (const u of leftoverUsers) {
    const del = await api(`/auth/v1/admin/users/${u.id}`, { method: 'DELETE' });
    const fine = deleted(del.status);
    const what = del.status === 404 ? 'déjà absent' : 'supprimé';
    console.log(`${fine ? '🧹' : '❌'} compte ${what} ${u.email} (HTTP ${del.status})`);
    ok = ok && fine;
  }
  // Orphan profiles (no matching auth user left — cascade already gone) can
  // only be removed here.
  const orphanProfiles = leftoverProfiles.filter((p) => !leftoverUsers.some((u) => u.id === p.id));
  for (const p of orphanProfiles) {
    const del = await api(`/rest/v1/user_profiles?id=eq.${p.id}`, { method: 'DELETE' });
    const fine = deleted(del.status);
    const what = del.status === 404 ? 'déjà absent' : 'supprimé';
    console.log(`${fine ? '🧹' : '❌'} profil orphelin ${what} ${p.email} (HTTP ${del.status})`);
    ok = ok && fine;
  }
  if (!ok) {
    console.error('\n❌ Purge incomplète — relancez la vérification (mode détection) pour lister ce qui reste.');
    process.exit(1);
  }
  console.log('\n✅ Purge terminée — base exempte de comptes éphémères.');
  process.exit(0);
}

if (fail) {
  console.error('\n❌ Nettoyage cassé — un script E2E a laissé un résidu en base.');
  console.error('   → purge manuelle : node scripts/verify-ephemeral-cleanup.mjs --cleanup-only');
  process.exit(1);
}
console.log('\n✅ Base propre — tous les comptes éphémères ont été supprimés par leurs scripts.');
publishEvidence({
  acted: true,
  // Zéro enregistrement parcouru = rien à prouver : on n'imprime pas de compte,
  // parce qu'une preuve d'action sur zéro chose se contredit (voir
  // parseEvidenceArgs).
  count: scanned > 0 ? scanned : null,
  reason: `base propre : ${scanned} enregistrement(s) parcouru(s) (comptes auth + profils), aucun compte éphémère résiduel`,
});
process.exit(0);