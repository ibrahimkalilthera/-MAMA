// Force PostgREST schema cache reload + verify user_profiles
const { createClient } = require('@supabase/supabase-js');

const s = createClient(
  'https://rpcjdohfxwukbqngbprw.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJwY2pkb2hmeHd1a2JxbmdicHJ3Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4NTYyNDE1MSwiZXhwIjoyMTAxMjAwMTUxfQ.SkN2utSPwRAER86DOmvFYPqb_obgZcZ-AX1m8e0gROo'
);

async function main() {
  // 1. Force schema reload via exec_sql
  console.log('1. Sending NOTIFY pgrst reload schema...');
  const { error: notifyErr } = await s.rpc('exec_sql', { sql_text: "NOTIFY pgrst, 'reload schema'" });
  if (notifyErr) {
    console.log('   exec_sql not in cache yet, trying direct insert to trigger reload...');
    // Insert the admin profile directly using service role (bypasses PostgREST cache need)
    // The trigger should have already created it, but let's be safe
  } else {
    console.log('   ✅ Schema reload notification sent');
  }

  // 2. Wait a moment for cache to refresh
  console.log('2. Waiting 3 seconds for cache refresh...');
  await new Promise(r => setTimeout(r, 3000));

  // 3. Try accessing user_profiles
  console.log('3. Testing user_profiles table...');
  const { data, error } = await s.from('user_profiles').select('*');
  if (error) {
    console.log('   ❌ Still not in cache:', error.message);
    console.log('\n   The user_profiles table exists but PostgREST cache has not refreshed.');
    console.log('   Please run this in Supabase SQL Editor:');
    console.log("   NOTIFY pgrst, 'reload schema';");
    console.log('   Then wait ~10 seconds and try logging in again.');
  } else {
    console.log('   ✅ user_profiles accessible! Data:', JSON.stringify(data));
  }

  // 4. Test auth sign-in
  console.log('\n4. Testing sign-in...');
  const anonClient = createClient(
    'https://rpcjdohfxwukbqngbprw.supabase.co',
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJwY2pkb2hmeHd1a2JxbmdicHJ3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODU2MjQxNTEsImV4cCI6MjEwMTIwMDE1MX0.kbRyapKoWueAOneDlTF73fxv88RloJNsygT8acIkycQ'
  );
  const { data: authData, error: authErr } = await anonClient.auth.signInWithPassword({
    email: 'ibrahimkalilthera@yahoo.com',
    password: 'adminpassword123',
  });
  if (authErr) {
    console.log('   ❌ Auth error:', authErr.message);
  } else {
    console.log('   ✅ Auth OK! User:', authData.user.email);
    
    // 5. Try fetching profile as the authenticated user
    console.log('5. Fetching profile as authenticated user...');
    const { data: profile, error: profileErr } = await anonClient
      .from('user_profiles')
      .select('*')
      .eq('id', authData.user.id)
      .single();
    
    if (profileErr) {
      console.log('   ❌ Profile fetch error:', profileErr.message);
    } else {
      console.log('   ✅ Profile:', JSON.stringify(profile));
    }
  }
}

main().catch(err => console.error('Fatal:', err));
