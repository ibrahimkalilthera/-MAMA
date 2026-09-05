/**
 * user_profiles — server-side export / restore (service role).
 *
 * Closes the "roles on an empty base" gap: the in-app backup deliberately
 * excludes `user_profiles` (identity data, RLS-locked), so after a fresh-DB
 * migration the restored data has no roles and the admin is locked out of
 * their own permissions. This script talks to the REST API with the SERVICE
 * ROLE KEY (bypasses RLS) and either:
 *
 *   export:   reads every row of `user_profiles` into a JSON file
 *   restore:  upserts rows from that file back into `user_profiles`
 *
 * Run (service key lives in .env):
 *   export:  node --env-file=.env supabase/restore-profiles.mjs export [--out FILE]
 *   restore: node --env-file=.env supabase/restore-profiles.mjs restore --file FILE [--yes]
 * via npm:   npm run db:profiles:export
 *            npm run db:profiles:restore -- --file mama-thera-profiles.json
 *
 * Restore safety:
 *   - explicit --file (or npm `-- --file`) is required;
 *   - without --yes an interactive "yes" confirmation is asked;
 *   - rows are upserted PER ROW on `id` (merge-duplicates), so a profile whose
 *     `auth.users` account does not exist yet (FK id → auth.users) fails alone
 *     instead of sinking the batch — recreate those accounts first (signup
 *     auto-creates a staff profile, which the restore then upgrades);
 *   - only the known columns (id/email/full_name/role/created_at) are written;
 *     unknown keys from future formats are dropped, invalid roles are skipped.
 */
import { writeFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';

// Env is validated LAZILY (on first CLI use), never at module load, so the
// pure helpers stay importable from tests without a .env present.
let env = null;
function requireEnv() {
  if (!env) {
    const url = process.env.VITE_SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) {
      console.error('❌ Missing VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env');
      process.exit(1);
    }
    env = { url, key };
  }
  return env;
}

const api = () => `${requireEnv().url}/rest/v1`;
const headers = () => ({
  apikey: requireEnv().key,
  Authorization: `Bearer ${requireEnv().key}`,
  'Content-Type': 'application/json',
});

/** Roles the schema accepts today (migrations up to econome). */
export const ALLOWED_ROLES = ['admin', 'staff', 'dev', 'general_manager', 'econome'];

const ROW_COLUMNS = ['id', 'email', 'full_name', 'role', 'created_at'];

// ── pure helpers (unit-tested) ───────────────────────────────────────────────

/**
 * Extract the profile rows from any accepted payload:
 *   - a bare array of rows;
 *   - a full app snapshot whose `tables.user_profiles` exists (a future
 *     service-key export shape);
 *   - this script's own export format ({ exportedAt, rows }).
 * Throws on anything else, so restore never silently restores nothing.
 */
export function pickProfilesRows(parsed) {
  if (Array.isArray(parsed)) return parsed;
  if (
    typeof parsed === 'object' &&
    parsed !== null &&
    parsed.tables &&
    Array.isArray(parsed.tables.user_profiles)
  ) {
    return parsed.tables.user_profiles;
  }
  if (
    typeof parsed === 'object' &&
    parsed !== null &&
    parsed.app === 'mama-thera-finance' &&
    Array.isArray(parsed.rows)
  ) {
    return parsed.rows;
  }
  throw new Error(
    'no user_profiles found in the file: expected a bare array of rows, this script\'s export format, or a snapshot with tables.user_profiles',
  );
}

/**
 * Normalize raw rows to the writable shape: keep only known columns, require
 * id + email, validate the role against ALLOWED_ROLES (drop unknown roles and
 * malformed rows). Returns { rows, skipped: [{ id, reason }] }.
 */
export function normalizeProfileRows(rawRows) {
  const rows = [];
  const skipped = [];
  for (const raw of rawRows) {
    const row = (typeof raw === 'object' && raw !== null && !Array.isArray(raw)) ? raw : null;
    if (!row || typeof row.id !== 'string' || row.id.trim() === '') {
      skipped.push({ id: null, reason: 'row is not an object with a string id' });
      continue;
    }
    if (typeof row.email !== 'string' || row.email.trim() === '') {
      skipped.push({ id: row.id, reason: 'missing email (NOT NULL)' });
      continue;
    }
    if (typeof row.role !== 'string' || !ALLOWED_ROLES.includes(row.role)) {
      skipped.push({ id: row.id, reason: `unknown role ${JSON.stringify(row.role)}` });
      continue;
    }
    const clean = {
      id: row.id,
      email: row.email,
      full_name: typeof row.full_name === 'string' ? row.full_name : 'New User',
      role: row.role,
      // created_at is optional: the column has a default, so a row without a
      // valid date simply lets the DB apply it.
      ...(typeof row.created_at === 'string' && !Number.isNaN(Date.parse(row.created_at))
        ? { created_at: row.created_at }
        : {}),
    };
    rows.push(clean);
  }
  return { rows, skipped };
}

// ── fetch helpers ────────────────────────────────────────────────────────────

async function fetchJson(url, options) {
  const res = await fetch(url, options);
  const text = await res.text();
  return { ok: res.ok, status: res.status, text };
}

async function exportProfiles(outPath) {
  const url = `${api()}/user_profiles?select=*`;
  const { ok, status, text } = await fetchJson(url, { headers: headers() });
  if (!ok) {
    throw new Error(`GET /user_profiles failed (${status}): ${text}`);
  }
  const rows = JSON.parse(text);
  const payload = {
    app: 'mama-thera-finance',
    table: 'user_profiles',
    exportedAt: new Date().toISOString(),
    rows,
  };
  writeFileSync(outPath, `${JSON.stringify(payload, null, 2)}\n`);
  console.log(`✅ Exported ${rows.length} profile(s) → ${outPath}`);
  return rows.length;
}

async function upsertRow(row) {
  const url = `${api()}/user_profiles`;
  return fetchJson(url, {
    method: 'POST',
    headers: { ...headers(), Prefer: 'return=minimal,resolution=merge-duplicates' },
    body: JSON.stringify([row]),
  });
}

async function confirmYes() {
  const readline = await import('readline');
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question('\n⚠️  Restore will upsert user_profiles rows (roles) into the database.\n   Type "yes" to confirm: ', (answer) => {
      rl.close();
      resolve(answer.trim().toLowerCase() === 'yes');
    });
  });
}

async function restoreProfiles(filePath, yes) {
  let parsed;
  try {
    parsed = JSON.parse(await readFile(filePath, 'utf8'));
  } catch (err) {
    throw new Error(`cannot read/parse ${filePath}: ${err.message}`);
  }

  const rawRows = pickProfilesRows(parsed);
  const { rows, skipped } = normalizeProfileRows(rawRows);

  for (const s of skipped) {
    console.warn(`  ⚠️  skipped ${s.id ?? '<no id>'}: ${s.reason}`);
  }
  if (rows.length === 0) {
    console.error('❌ No valid user_profiles rows to restore.');
    process.exit(1);
  }

  if (!yes) {
    const confirmed = await confirmYes();
    if (!confirmed) {
      console.log('❌ Restore cancelled. No changes made.');
      process.exit(0);
    }
  }

  console.log(`Restoring ${rows.length} profile(s)…`);
  let restored = 0;
  const failed = [];
  for (const row of rows) {
    const { ok, status, text } = await upsertRow(row);
    if (ok) {
      restored += 1;
    } else {
      failed.push({ id: row.id, status, detail: text.slice(0, 200) });
    }
  }

  console.log(`\n✅ ${restored}/${rows.length} profile(s) restored`);
  if (failed.length > 0) {
    console.error(`❌ ${failed.length} profile(s) failed (FK id → auth.users):`);
    for (const f of failed) {
      console.error(`   - ${f.id} (${f.status}): ${f.detail}`);
    }
    console.error('\n   Recreate those accounts first (signup auto-creates a staff\n   profile; the restore then upgrades it to the backed-up role).');
    process.exit(1);
  }
  return restored;
}

// ── CLI ──────────────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);
  const mode = args[0];
  const flag = (name) => {
    const i = args.indexOf(name);
    return i >= 0 && i + 1 < args.length ? args[i + 1] : undefined;
  };

  if (mode === 'export') {
    const out = flag('--out') ?? `mama-thera-profiles-${new Date().toISOString().slice(0, 10)}.json`;
    await exportProfiles(out);
    return;
  }
  if (mode === 'restore') {
    const file = flag('--file');
    if (!file) {
      console.error('❌ restore requires --file <backup.json> (or: npm run db:profiles:restore -- --file …)');
      process.exit(1);
    }
    await restoreProfiles(file, args.includes('--yes'));
    return;
  }
  console.error(`❌ unknown mode "${mode}" — use export or restore`);
  process.exit(1);
}

// Run only when executed directly (imports from tests stay side-effect free).
const isMain =
  typeof process !== 'undefined' &&
  process.argv[1] &&
  new URL(import.meta.url).href === new URL(`file://${process.argv[1].replace(/\\/g, '/')}`).href;

if (isMain) {
  main().catch((err) => {
    console.error(`❌ ${err.message}`);
    process.exit(1);
  });
}