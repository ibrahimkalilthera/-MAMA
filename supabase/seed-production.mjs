/**
 * Production Seed Script for MAMA THERA Finance Suite
 * 
 * Seeds ONLY structural/reference data needed for a fresh production deployment.
 * Does NOT create fake students, parents, or financial records.
 * 
 * Run with: node --env-file=.env.production supabase/seed-production.mjs
 * Or via:   npm run seed:production
 */

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('❌ Missing VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in environment');
  process.exit(1);
}

const API = `${SUPABASE_URL}/rest/v1`;
const HEADERS = {
  'apikey': SUPABASE_KEY,
  'Authorization': `Bearer ${SUPABASE_KEY}`,
  'Content-Type': 'application/json',
  'Prefer': 'return=representation',
};

async function post(table, rows) {
  const res = await fetch(`${API}/${table}`, {
    method: 'POST',
    headers: HEADERS,
    body: JSON.stringify(rows),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`POST /${table} failed (${res.status}): ${text}`);
  }
  return res.json();
}

async function main() {
  console.log('🏫 MAMA THERA — Production Database Setup\n');
  console.log('⚠️  This script creates structural data ONLY.');
  console.log('   No fake students, parents, or financial records will be created.\n');

  // 1. Create a sample todo to verify connectivity
  console.log('  → Verifying database connectivity...');
  const todoData = [
    { text: 'Setup complete — Welcome to MAMA THERA Finance Suite!', completed: true },
  ];
  const todoRows = await post('todos', todoData);
  console.log(`    ✅ Database connection verified (${todoRows.length} welcome todo created)`);

  console.log('\n🎉 Production database is ready!');
  console.log('');
  console.log('Next steps:');
  console.log('  1. Log in to the app and add your first real parent and student records');
  console.log('  2. Add staff members and set their salary information');
  console.log('  3. Configure academic year settings in the app');
  console.log('');
}

main().catch(err => {
  console.error('❌ Production seed failed:', err);
  process.exit(1);
});
