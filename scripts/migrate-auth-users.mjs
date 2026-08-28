// Migrate auth.users + auth.identities from PRODUCTION to STAGING Supabase.
// Passwords (bcrypt hashes) are copied as-is → the same logins work on staging.
// Prod DB password: read from .env (SUPABASE_DB_PASSWORD). Staging password: env var STAGING_DB_PASSWORD.
import pg from 'pg';
import { readFileSync } from 'node:fs';

const parse = (p) => {
  const o = {};
  for (const l of readFileSync(p, 'utf8').split(/\r?\n/)) {
    const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (m) o[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
  return o;
};

const prodEnv = parse('.env');
const PROD_PW = prodEnv.SUPABASE_DB_PASSWORD;
const STAG_PW = process.env.STAGING_DB_PASSWORD;
if (!PROD_PW) throw new Error('SUPABASE_DB_PASSWORD absent de .env');
if (!STAG_PW) throw new Error('STAGING_DB_PASSWORD manquant (env var)');

const prodConn = `postgresql://postgres.rpcjdohfxwukbqngbprw:${encodeURIComponent(PROD_PW)}@aws-0-us-east-1.pooler.supabase.com:5432/postgres`;
const stagConn = `postgresql://postgres.vulbmmzhcmnzswcvswfk:${encodeURIComponent(STAG_PW)}@aws-1-eu-west-1.pooler.supabase.com:5432/postgres`;

const colsOf = async (client, table) => {
  const r = await client.query(
    `SELECT column_name FROM information_schema.columns WHERE table_schema='auth' AND table_name=$1 AND is_generated='NEVER'`,
    [table]
  );
  return r.rows.map((x) => x.column_name);
};

const insert = async (client, table, rows, cols) => {
  if (!rows.length) return 0;
  const colList = cols.join(', ');
  const placeholders = rows.map((_, i) => `(${cols.map((_, j) => `$${i * cols.length + j + 1}`).join(', ')})`).join(', ');
  const values = rows.flatMap((r) => cols.map((c) => (r[c] === undefined ? null : r[c])));
  const res = await client.query(
    `INSERT INTO auth.${table} (${colList}) VALUES ${placeholders} ON CONFLICT DO NOTHING`,
    values
  );
  return res.rowCount;
};

(async () => {
  const prod = new pg.Client({ connectionString: prodConn, ssl: { rejectUnauthorized: false } });
  const stag = new pg.Client({ connectionString: stagConn, ssl: { rejectUnauthorized: false } });
  await prod.connect();
  await stag.connect();
  console.log('connecté aux deux bases ✅');

  // 1. Read users + identities from production
  const users = (await prod.query('SELECT * FROM auth.users')).rows;
  const ids = (await prod.query('SELECT * FROM auth.identities')).rows;
  console.log(`prod: ${users.length} user(s), ${ids.length} identité(s)`);

  // 2. Insert into staging (keep only non-generated columns present on both sides)
  const uColsSafe = (await colsOf(stag, 'users')).filter((c) => c in users[0]);
  const iColsSafe = (await colsOf(stag, 'identities')).filter((c) => c in ids[0]);

  const uIns = await insert(stag, 'users', users, uColsSafe);
  const iIns = await insert(stag, 'identities', ids, iColsSafe);
  console.log(`staging: ${uIns} user(s) insérés, ${iIns} identité(s) insérées`);

  // 3. Verify
  const check = await stag.query("SELECT email, email_confirmed_at IS NOT NULL AS confirmed FROM auth.users ORDER BY email");
  for (const r of check.rows) console.log(`  → ${r.email} (confirmé: ${r.confirmed})`);

  await prod.end();
  await stag.end();
})().catch((e) => {
  console.error('ERREUR:', e.message);
  process.exit(1);
});
