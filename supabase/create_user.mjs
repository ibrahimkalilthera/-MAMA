// Create an admin/dev user account on a live Supabase project.
//
// ⚠️  RECONCILIÉ (2026-09-05) — à lire avant exécution :
//
//  1. Plus aucune mutation de schéma. L'ancienne « Step 1 » de ce script
//     DROPait et recréait la contrainte user_profiles_role_check avec
//     UNIQUEMENT ('admin','staff','dev') — ce qui aurait silencieusement
//     effacé les rôles general_manager et econome du modèle actuel si ce
//     script avait été relancé contre la base de production. Le schéma est
//     désormais la propriété exclusive de supabase/migrations/ (18
//     migrations ordonnées) ; ce script ne fait QUE créer un compte.
//
//  2. Plus aucune information d'identification en dur. L'ancienne version
//     embarquait la vraie clé service_role et le mot de passe de la base
//     dans le source. Tout est lu depuis l'environnement (.env) — voir
//     .env.example — et le script refuse de démarrer si une variable
//     requise manque.
//
//  3. Le rôle est posé EXPLICITEMENT après la création. Le trigger
//     handle_new_user retombe volontairement sur 'staff' (promotion
//     jamais déduite du metadata, par sécurité — voir
//     supabase/migrations/20260829000000_handle_new_user_guard.sql).
//     Ce script corrige donc le profil immédiatement via la clé
//     service_role (contourne RLS), comme le fait le flux admin
//     updateUserRole de l'application.
//
// Usage :
//   node --env-file=.env supabase/create_user.mjs
//
// Variables lues (voir .env.example) :
//   VITE_SUPABASE_URL          requis — URL du projet Supabase
//   SUPABASE_SERVICE_ROLE_KEY  requis — clé service_role (jamais dans le repo)
//   ADMIN_EMAIL                requis — email du compte à créer
//   ADMIN_PASSWORD             requis — mot de passe initial du compte
//   ADMIN_FULL_NAME            optionnel — nom affiché (défaut « New User »
//                               dérivé de l'email par handle_new_user)
//   ADMIN_ROLE                 optionnel — admin | dev | general_manager |
//                               staff | econome (défaut : dev)

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ADMIN_EMAIL = process.env.ADMIN_EMAIL;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
const ADMIN_FULL_NAME = process.env.ADMIN_FULL_NAME || null;
const ADMIN_ROLE = process.env.ADMIN_ROLE || 'dev';

const VALID_ROLES = new Set(['admin', 'staff', 'dev', 'general_manager', 'econome']);

function fatal(message) {
  console.error(`❌ ${message}`);
  console.error('');
  console.error('Rappel : exécuter avec node --env-file=.env supabase/create_user.mjs');
  process.exit(1);
}

if (!SUPABASE_URL) fatal('VITE_SUPABASE_URL absent de l’environnement (.env)');
if (!SERVICE_ROLE_KEY) fatal('SUPABASE_SERVICE_ROLE_KEY absent de l’environnement (.env)');
if (!ADMIN_EMAIL) fatal('ADMIN_EMAIL absent de l’environnement (.env)');
if (!ADMIN_PASSWORD) fatal('ADMIN_PASSWORD absent de l’environnement (.env)');
if (!VALID_ROLES.has(ADMIN_ROLE)) {
  fatal(`ADMIN_ROLE « ${ADMIN_ROLE} » invalide — attendu : ${[...VALID_ROLES].join(', ')}`);
}

const HEADERS = {
  'apikey': SERVICE_ROLE_KEY,
  'Authorization': `Bearer ${SERVICE_ROLE_KEY}`,
  'Content-Type': 'application/json',
};

async function main() {
  // ── Étape 1 : créer le compte via l'Admin API (email confirmé) ────────────
  console.log('👤 Étape 1 : création du compte via l’Admin API…');
  const createRes = await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
    method: 'POST',
    headers: HEADERS,
    body: JSON.stringify({
      email: ADMIN_EMAIL,
      password: ADMIN_PASSWORD,
      email_confirm: true,
      user_metadata: ADMIN_FULL_NAME ? { full_name: ADMIN_FULL_NAME } : {},
    }),
  });
  const created = await createRes.json();

  if (!createRes.ok) {
    if (created.msg && created.msg.includes('already been registered')) {
      console.log('  ℹ️  Ce compte existe déjà — on passe à la promotion du rôle.');
    } else {
      console.error('  ❌ Erreur Admin API :', JSON.stringify(created, null, 2));
      process.exit(1);
    }
  } else {
    console.log(`  ✅ Compte créé : ${created.email} (${created.id})`);
  }

  const userId = created.id ?? (await findUserIdByEmail());
  if (!userId) {
    console.error('  ❌ Impossible de résoudre l’id du compte. Vérifiez ADMIN_EMAIL.');
    process.exit(1);
  }

  // ── Étape 2 : poser le rôle sur le profil (service_role contourne RLS) ────
  console.log(`🏷️  Étape 2 : promotion du profil en « ${ADMIN_ROLE} »…`);
  const patchRes = await fetch(`${SUPABASE_URL}/rest/v1/user_profiles?id=eq.${userId}`, {
    method: 'PATCH',
    headers: HEADERS,
    body: JSON.stringify({ role: ADMIN_ROLE }),
  });

  if (!patchRes.ok) {
    const text = await patchRes.text();
    console.error(`  ❌ Promotion impossible (${patchRes.status}): ${text}`);
    process.exit(1);
  }
  console.log('  ✅ Profil promu.');

  // ── Étape 3 : vérification via l'Admin API ─────────────────────────────────
  console.log('🔍 Étape 3 : vérification…');
  const listRes = await fetch(`${SUPABASE_URL}/auth/v1/admin/users?per_page=5`, {
    headers: HEADERS,
  });
  if (listRes.ok) {
    const { users } = await listRes.json();
    for (const u of users) {
      console.log(`    • ${u.email} (${u.id})`);
    }
  }

  console.log('');
  console.log('🎉 Terminé ! Le compte peut maintenant se connecter.');
  console.log(`   Émail : ${ADMIN_EMAIL}`);
  console.log(`   Rôle  : ${ADMIN_ROLE}`);
  console.log('');
  console.log('Rappel : le schéma (tables, RLS, rôles, fonctions) est géré par');
  console.log('supabase/migrations/ — ce script ne modifie que ce compte.');
}

async function findUserIdByEmail() {
  // L'Admin API GoTrue ne garantit pas de filtre ?email= ; on liste et on
  // cherche côté client (per_page élevé — le volume de comptes est faible).
  const res = await fetch(
    `${SUPABASE_URL}/auth/v1/admin/users?per_page=1000`,
    { headers: HEADERS },
  );
  if (!res.ok) return null;
  const { users } = await res.json();
  return users?.find((u) => u.email?.toLowerCase() === ADMIN_EMAIL.toLowerCase())?.id ?? null;
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});