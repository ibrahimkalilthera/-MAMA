const pg = require('pg');
const c = new pg.Client({
  connectionString: 'postgresql://postgres.rpcjdohfxwukbqngbprw:MamaFinance2024!Secure%23DB@aws-0-us-east-1.pooler.supabase.com:6543/postgres',
  ssl: { rejectUnauthorized: false }
});

c.connect()
  .then(() => c.query("UPDATE public.user_profiles SET role = 'staff' WHERE email = 'mamadoulaminethera@mamathera.org' RETURNING email, full_name, role"))
  .then(r => {
    if (r.rows.length) {
      console.log('✅ ' + r.rows[0].full_name + ' -> role: ' + r.rows[0].role);
    } else {
      console.log('❌ User not found');
    }
  })
  .then(() => c.end());
