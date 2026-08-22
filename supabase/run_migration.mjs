// Run pending migrations against live Supabase via direct PostgreSQL connection
// Uses the service_role credentials for admin-level SQL execution

import { createRequire } from 'module';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const require = createRequire(import.meta.url);
const pg = require('pg');
const { Client } = pg;

const __dirname = dirname(fileURLToPath(import.meta.url));

async function runMigration() {
  console.log('🔌 Connecting to Supabase PostgreSQL...');
  console.log('');
  
  const connectionString = `postgresql://postgres.rpcjdohfxwukbqngbprw:MamaFinance2024!Secure%23DB@aws-0-us-east-1.pooler.supabase.com:6543/postgres`;
  
  const client = new Client({ connectionString, ssl: { rejectUnauthorized: false } });
  
  try {
    await client.connect();
    console.log('✅ Connected to Supabase PostgreSQL');
    console.log('');
    
    const sql = readFileSync(join(__dirname, 'FULL_SETUP_MIGRATION.sql'), 'utf-8');
    console.log(`📋 Running full migration (${sql.length} chars)...`);
    console.log('');
    
    await client.query(sql);
    
    console.log('✅ MIGRATION COMPLETED SUCCESSFULLY!');
    console.log('');
    
    // Verify tables
    const result = await client.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
      ORDER BY table_name
    `);
    
    console.log('📋 Tables in public schema:');
    result.rows.forEach(row => {
      console.log(`  ✅ ${row.table_name}`);
    });
    
    // Verify RLS is enabled
    console.log('');
    const rlsResult = await client.query(`
      SELECT tablename, rowsecurity 
      FROM pg_tables 
      WHERE schemaname = 'public' 
      ORDER BY tablename
    `);
    
    console.log('🔒 RLS Status:');
    rlsResult.rows.forEach(row => {
      const status = row.rowsecurity ? '🟢 ENABLED' : '🔴 DISABLED';
      console.log(`  ${status} ${row.tablename}`);
    });

    // Verify academic_years seed data
    console.log('');
    const yearsResult = await client.query(`SELECT year_name, is_current FROM public.academic_years ORDER BY year_name`);
    console.log('📅 Academic Years:');
    yearsResult.rows.forEach(row => {
      console.log(`  ${row.is_current ? '🟢' : '⚪'} ${row.year_name}${row.is_current ? ' (CURRENT)' : ''}`);
    });
    
    // Verify functions exist
    console.log('');
    const fnResult = await client.query(`
      SELECT routine_name 
      FROM information_schema.routines 
      WHERE routine_schema = 'public' 
      AND routine_type = 'FUNCTION'
      ORDER BY routine_name
    `);
    console.log('⚙️  Functions:');
    fnResult.rows.forEach(row => {
      console.log(`  ✅ ${row.routine_name}()`);
    });
    
    // Count RLS policies
    console.log('');
    const policyResult = await client.query(`
      SELECT COUNT(*) as count FROM pg_policies WHERE schemaname = 'public'
    `);
    console.log(`🛡️  RLS Policies: ${policyResult.rows[0].count} policies active`);
    
  } catch (err) {
    console.error('❌ Migration error:', err.message);
    if (err.message.includes('already exists')) {
      console.log('');
      console.log('ℹ️  Some objects already exist — this is expected for idempotent migrations.');
    }
    throw err;
  } finally {
    await client.end();
    console.log('');
    console.log('🔌 PostgreSQL connection closed');
  }
}

runMigration().catch(err => {
  process.exit(1);
});
