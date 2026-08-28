// Simulates the Vercel build: no .env files available, env vars injected by the platform.
// 1. Reads expected values from the current .env files (for comparison only)
// 2. Moves .env* files out of the way
// 3. Builds with env vars injected via process.env (like Vercel does)
// 4. Verifies the bundles contain the expected values (all dist chunks)
// 5. Restores the .env files
import { execSync } from 'node:child_process';
import { existsSync, readFileSync, renameSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const envFiles = ['.env', '.env.production', '.env.staging'].filter((f) => existsSync(join(root, f)));
const bak = {};
for (const f of envFiles) {
  const dest = join(root, `${f}.sim-bak`);
  renameSync(join(root, f), dest);
  bak[f] = dest;
}

const parse = (p) => {
  const out = {};
  if (!existsSync(p)) return out;
  for (const line of readFileSync(p, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
  return out;
};

// Expected values: production env vars take priority (that's what Vercel injects for a prod deploy)
const expected = Object.assign(parse(bak['.env']), parse(bak['.env.production']));
expected.VITE_APP_ENV = 'production';

// Vercel injects these as real environment variables (config + secret types)
for (const k of ['VITE_SUPABASE_URL', 'VITE_SUPABASE_ANON_KEY', 'VITE_APP_ENV', 'APP_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'GEMINI_API_KEY']) {
  if (expected[k] !== undefined) process.env[k] = expected[k];
}

let ok = true;
try {
  console.log(`[1/3] .env files masqués (${envFiles.join(', ') || 'aucun'}) — build avec variables injectées…`);
  execSync('npm run build:production', { stdio: 'inherit', cwd: root });
  console.log('[2/3] Build OK');

  // Scan ALL dist JS chunks (entry + lazy) for the inlined values
  const distAssets = join(root, 'dist', 'assets');
  const all = readdirSync(distAssets)
    .filter((f) => f.endsWith('.js'))
    .map((f) => readFileSync(join(distAssets, f), 'utf8'))
    .join('\n');

  console.log('[3/3] Vérification du bundle (tous les chunks) :');
  const inBundle = (val) => !!val && all.includes(val);

  const checks = [
    ['VITE_SUPABASE_URL (prod)', expected.VITE_SUPABASE_URL, inBundle(expected.VITE_SUPABASE_URL)],
    ['VITE_SUPABASE_ANON_KEY (clé complète)', expected.VITE_SUPABASE_ANON_KEY, inBundle(expected.VITE_SUPABASE_ANON_KEY)],
    ['VITE_APP_ENV = production', 'production', all.includes('"production"')],
    // Variables non-client (serveur/seed) : pas attendues dans le bundle
    ['APP_URL (côté serveur uniquement — non attendu)', expected.APP_URL, true],
    ['SUPABASE_SERVICE_ROLE_KEY (côté serveur uniquement — non attendu)', expected.SUPABASE_SERVICE_ROLE_KEY, true],
  ];
  for (const [label, val, found] of checks) {
    const show = val && val.length > 30 ? val.slice(0, 22) + '…' : val;
    console.log(`  ${label} → ${found ? '✅' : '❌ ABSENT'} ${found ? '' : '(attendu: ' + show + ')'}`);
    if (!found) ok = false;
  }

  // Negative control: the staging ref must NOT be in the bundle
  const stagingUrl = parse(bak['.env.staging']).VITE_SUPABASE_URL;
  if (stagingUrl && stagingUrl !== expected.VITE_SUPABASE_URL && all.includes(stagingUrl)) {
    console.log(`  ⚠️ VALEUR STAGING TROUVÉE DANS LE BUNDLE (${stagingUrl.slice(0, 30)}…) — le build de prod est pollué !`);
    ok = false;
  } else {
    console.log(`  Contrôle négatif (aucune valeur staging dans le bundle) → ✅`);
  }
} finally {
  for (const f of envFiles) {
    renameSync(bak[f], join(root, f));
  }
  console.log(`\n.env restaurés : ${envFiles.join(', ') || 'aucun'}`);
}
process.exit(ok ? 0 : 1);
