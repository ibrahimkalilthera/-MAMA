import { createClient } from '@supabase/supabase-js';

const defaultUrl = 'https://rpcjdohfxwukbqngbprw.supabase.co';
const defaultAnonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJwY2pkb2hmeHd1a2JxbmdicHJ3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODU2MjQxNTEsImV4cCI6MjEwMTIwMDE1MX0.kbRyapKoWueAOneDlTF73fxv88RloJNsygT8acIkycQ';

const rawUrl = import.meta.env.VITE_SUPABASE_URL;
const rawKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

const supabaseUrl = (rawUrl && !rawUrl.includes('your-production-project')) ? rawUrl : defaultUrl;
const supabaseAnonKey = (rawKey && !rawKey.includes('your-production-anon-key')) ? rawKey : defaultAnonKey;

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
});
