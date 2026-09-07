// Create admin user account on live Supabase

import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const pg = require('pg');
const { Client } = pg;

const SUPABASE_URL = 'https://rpcjdohfxwukbqngbprw.supabase.co';
const SERVICE_ROLE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJwY2pkb2hmeHd1a2JxbmdicHJ3Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4NTYyNDE1MSwiZXhwIjoyMTAxMjAwMTUxfQ.SkN2utSPwRAER86DOmvFYPqb_obgZcZ-AX1m8e0gROo';

async function main() {
  // Step 1: Update schema to support 'dev' role
  console.log('📦 Step 1: Updating schema to support "dev" role...');
  const connectionString = `postgresql://postgres.rpcjdohfxwukbqngbprw:MamaFinance2024!Secure%23DB@aws-0-us-east-1.pooler.supabase.com:6543/postgres`;
  const client = new Client({ connectionString, ssl: { rejectUnauthorized: false } });
  
  try {
    await client.connect();
    
    // Update CHECK constraint to allow 'dev' role
    await client.query(`
      ALTER TABLE public.user_profiles DROP CONSTRAINT IF EXISTS user_profiles_role_check;
      ALTER TABLE public.user_profiles ADD CONSTRAINT user_profiles_role_check CHECK (role IN ('admin', 'staff', 'dev', 'general_manager', 'econome'));
    `);
    console.log('  ✅ CHECK constraint updated: admin | staff | dev | general_manager | econome');
    
    // Update is_admin() to treat 'dev' as admin-equivalent
    await client.query(`
      CREATE OR REPLACE FUNCTION public.is_admin()
      RETURNS BOOLEAN AS $$
      BEGIN
          RETURN EXISTS (
              SELECT 1 FROM public.user_profiles 
              WHERE id = auth.uid() AND role IN ('admin', 'dev')
          );
      END;
      $$ LANGUAGE plpgsql SECURITY DEFINER STABLE;
    `);
    console.log('  ✅ is_admin() updated: dev role has full admin privileges');
    
    await client.end();
  } catch (err) {
    console.error('  ❌ Schema update error:', err.message);
    await client.end();
    process.exit(1);
  }
  
  // Step 2: Create user via Supabase Auth Admin API
  console.log('');
  console.log('👤 Step 2: Creating user account...');
  
  const response = await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${SERVICE_ROLE_KEY}`,
      'apikey': SERVICE_ROLE_KEY,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      email: 'ibrahimkalilthera@mamathera.org',
      password: 'Matricule1667',
      email_confirm: true,
      user_metadata: {
        full_name: 'Ibrahim Thera',
        role: 'dev'
      }
    })
  });
  
  const data = await response.json();
  
  if (response.ok) {
    console.log('  ✅ User created successfully!');
    console.log('');
    console.log('  ═══════════════════════════════════════');
    console.log('  📧 Email:     ibrahimkalilthera@mamathera.org');
    console.log('  🔑 Password:  Matricule1667');
    console.log('  👤 Name:      Ibrahim Thera');
    console.log('  🏷️  Role:      dev (full admin privileges)');
    console.log('  🆔 User ID:   ' + data.id);
    console.log('  ═══════════════════════════════════════');
  } else {
    console.error('  ❌ Error creating user:', JSON.stringify(data, null, 2));
    if (data.msg && data.msg.includes('already been registered')) {
      console.log('');
      console.log('  ℹ️  This email is already registered. You can sign in with it directly.');
    }
  }
  
  // Step 3: Verify the user_profile was auto-created by the trigger
  console.log('');
  console.log('🔍 Step 3: Verifying user profile...');
  
  const client2 = new Client({ connectionString, ssl: { rejectUnauthorized: false } });
  try {
    await client2.connect();
    const result = await client2.query(`
      SELECT id, email, full_name, role, created_at 
      FROM public.user_profiles 
      ORDER BY created_at DESC 
      LIMIT 5
    `);
    
    if (result.rows.length > 0) {
      console.log('  📋 User profiles in database:');
      result.rows.forEach(row => {
        const roleIcon = row.role === 'dev' ? '🟣' : row.role === 'admin' ? '🔴' : '🔵';
        console.log(`    ${roleIcon} ${row.full_name} (${row.email}) — role: ${row.role}`);
      });
    } else {
      console.log('  ⚠️  No user profiles found yet.');
    }
    
    await client2.end();
  } catch (err) {
    console.error('  ❌ Verification error:', err.message);
    await client2.end();
  }
  
  console.log('');
  console.log('🎉 Done! You can now sign in at http://localhost:3000');
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
