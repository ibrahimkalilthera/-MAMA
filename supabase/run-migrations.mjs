/**
 * Run migrations against Supabase using @supabase/supabase-js admin client.
 * The service_role key bypasses RLS, allowing us to execute DDL via rpc.
 * 
 * Strategy: Create a temporary exec_sql function, use it, then drop it.
 */

import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const SUPABASE_URL = 'https://rpcjdohfxwukbqngbprw.supabase.co';
const SERVICE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJwY2pkb2hmeHd1a2JxbmdicHJ3Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4NTYyNDE1MSwiZXhwIjoyMTAxMjAwMTUxfQ.SkN2utSPwRAER86DOmvFYPqb_obgZcZ-AX1m8e0gROo';

const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

async function createExecFunction() {
  console.log('📦 Creating exec_sql helper function...');
  // Use the REST API to call a bootstrap RPC. 
  // Actually, we can't create functions via REST either.
  // Let's use a different approach: execute each statement individually via the REST API
}

// Split SQL into individual statements, handling $$ blocks
function splitStatements(sql) {
  const statements = [];
  let current = '';
  let inDollarQuote = false;
  
  const lines = sql.split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    
    // Skip empty lines and comments
    if (!trimmed || trimmed.startsWith('--')) {
      if (inDollarQuote) current += line + '\n';
      continue;
    }
    
    // Track $$ blocks
    const dollarCount = (line.match(/\$\$/g) || []).length;
    if (dollarCount % 2 === 1) {
      inDollarQuote = !inDollarQuote;
    }
    
    current += line + '\n';
    
    // If we hit a semicolon and we're not in a $$ block, that's a statement boundary
    if (trimmed.endsWith(';') && !inDollarQuote) {
      const stmt = current.trim();
      if (stmt && stmt.length > 1) {
        statements.push(stmt);
      }
      current = '';
    }
  }
  
  // Don't forget any trailing statement
  if (current.trim()) {
    statements.push(current.trim());
  }
  
  return statements;
}

async function runStatements(label, sql) {
  console.log(`\n⏳ ${label}...`);
  const statements = splitStatements(sql);
  console.log(`   Found ${statements.length} SQL statements`);
  
  let success = 0;
  let errors = 0;
  
  for (let i = 0; i < statements.length; i++) {
    const stmt = statements[i];
    const preview = stmt.substring(0, 70).replace(/\n/g, ' ');
    
    try {
      // For CREATE TABLE, ALTER TABLE, CREATE POLICY etc., 
      // we need to use the raw SQL endpoint.
      // The supabase-js client doesn't support DDL.
      // Let's try the /rest/v1/ endpoint with a hack:
      // create an rpc function first.
      
      // Actually, the simplest approach: use fetch directly to the 
      // Supabase SQL API endpoint that the dashboard uses internally.
      // The dashboard calls: POST https://<ref>.supabase.co/query
      // with the service role key.
      
      const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/exec_sql`, {
        method: 'POST',
        headers: {
          'apikey': SERVICE_KEY,
          'Authorization': `Bearer ${SERVICE_KEY}`,
          'Content-Type': 'application/json',
          'Prefer': 'return=minimal',
        },
        body: JSON.stringify({ sql_text: stmt }),
      });
      
      if (res.ok || res.status === 204) {
        success++;
        process.stdout.write('.');
      } else {
        const text = await res.text();
        if (text.includes('already exists') || text.includes('duplicate')) {
          success++;
          process.stdout.write('s'); // skipped
        } else if (text.includes('does not exist') && stmt.includes('DROP POLICY')) {
          success++;
          process.stdout.write('s'); // skipped, policy didn't exist
        } else {
          errors++;
          console.log(`\n   ❌ [${i+1}] ${preview}`);
          console.log(`      Error: ${text.substring(0, 200)}`);
        }
      }
    } catch (err) {
      errors++;
      console.log(`\n   ❌ [${i+1}] Network error: ${err.message}`);
    }
  }
  
  console.log(`\n   Results: ${success} OK, ${errors} errors`);
  return errors === 0;
}

async function main() {
  console.log('🏫 MAMA THERA — Database Migration Runner\n');
  
  // Step 0: Create the exec_sql function using the supabase-js admin client
  console.log('Step 0: Creating exec_sql RPC function...');
  
  // We need to create this function first so we can use rpc() for DDL
  // The only way to create it is... we need raw SQL access.
  // 
  // ALTERNATIVE: Use the supabase-js admin client to call the 
  // Management API v1/projects/{ref}/database/query endpoint.
  // But that needs a different token (access token from supabase login).
  //
  // SIMPLEST SOLUTION: Just ask the user to paste ONE small SQL in the dashboard
  // that creates the exec_sql function, then we can do everything else.
  
  const bootstrapSQL = `
CREATE OR REPLACE FUNCTION exec_sql(sql_text TEXT) RETURNS void AS $$
BEGIN
  EXECUTE sql_text;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
`;
  
  console.log('\n⚠️  BOOTSTRAP REQUIRED');
  console.log('Please paste this ONE query into your Supabase SQL Editor and run it:');
  console.log('────────────────────────────────────────────────────────────────────');
  console.log(bootstrapSQL);
  console.log('────────────────────────────────────────────────────────────────────');
  console.log('Then re-run this script.\n');
  
  // Check if exec_sql exists by trying to call it
  const { error: testError } = await supabase.rpc('exec_sql', { sql_text: 'SELECT 1;' });
  
  if (testError) {
    console.log('❌ exec_sql function not found. Please create it first (see above).');
    console.log(`   Error: ${testError.message}`);
    process.exit(1);
  }
  
  console.log('✅ exec_sql function found! Running migrations...\n');
  
  // Read migration files
  const initSql = readFileSync(join(__dirname, 'migrations', '20260801000000_init.sql'), 'utf8');
  const authSql = readFileSync(join(__dirname, 'migrations', '20260809000000_auth_and_rls.sql'), 'utf8');
  
  // Add the admin insert
  const adminInsert = `
INSERT INTO public.user_profiles (id, email, full_name, role)
SELECT id, email, 'Ibrahim Thera', 'admin'
FROM auth.users
WHERE email = 'ibrahimkalilthera@yahoo.com'
ON CONFLICT (id) DO UPDATE SET role = 'admin', full_name = 'Ibrahim Thera';
`;

  // Run step 1
  await runStatements('Step 1: Base Schema (tables + temp RLS)', initSql);
  
  // Run step 2
  await runStatements('Step 2: Auth + RLS Lockdown', authSql + '\n' + adminInsert);
  
  // Cleanup
  console.log('\n🧹 Cleaning up exec_sql function...');
  await supabase.rpc('exec_sql', { sql_text: 'DROP FUNCTION IF EXISTS exec_sql(TEXT);' });
  
  console.log('\n🎉 Migrations completed!');
  console.log('→ Log in at http://localhost:3000 with ibrahimkalilthera@yahoo.com');
}

main().catch(err => {
  console.error('\n❌ Fatal error:', err.message);
  process.exit(1);
});
