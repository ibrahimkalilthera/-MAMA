#!/usr/bin/env node
/**
 * ─── Les comptes propriétaires existent-ils encore, et peut-on s'y connecter ? ─
 *
 *   npm run check:owners                        (avec les secrets dans l'environnement)
 *   node scripts/check-owner-accounts.mjs       (lu depuis .env en local)
 *
 * Ce que ce contrôle lit, et pourquoi ce n'est pas un fichier : l'état de la
 * BASE. Le 2026-09-13, `ibrahimkalilthera@mamathera.org` — le compte dev,
 * documenté dans ce dépôt depuis le premier jour — n'existait plus. Le dépôt
 * était vert, la chaîne qualité était verte, et la panne n'a été découverte qu'au
 * moment où son propriétaire a voulu se connecter. Aucun contrôle local ne
 * pouvait la voir : ce qui manquait n'était pas dans un fichier.
 *
 * Trois preuves, et chacune dit ce qu'elle a mesuré :
 *   1. PRÉSENCE — chaque compte du roster (scripts/lib/owner-accounts.mjs)
 *      existe dans `auth.users`. Son absence est l'incident, et elle est rouge.
 *   2. ÉTAT — confirmé, non suspendu, non supprimé en douceur, identité « email »
 *      présente, et rôle de `user_profiles` conforme à la documentation. Un
 *      compte présent mais inutilisable serait un faux vert.
 *   3. LOGIN RÉEL — un compte jetable est créé, on s'y connecte pour de vrai
 *      (`POST /auth/v1/token?grant_type=password`, clé anon — le chemin EXACT de
 *      l'application), puis il est supprimé. C'est la seule mesure qui attrape
 *      « la base répond mais l'authentification ne délivre plus de session ».
 *
 * Pour les comptes du roster eux-mêmes, le login réel est fait quand le mot de
 * passe est fourni par l'environnement (`OWNER_*_PASSWORD`) : aucun mot de passe
 * n'est écrit dans ce dépôt. Sans la variable, ce login est annoncé comme NON
 * MESURÉ — une absence nommée, jamais comptée comme un vert.
 *
 * Codes de sortie : 0 vert · 1 rouge (compte absent, état cassé, login refusé) ·
 * 2 indécis (secrets absents — un contrôle qui ne peut pas regarder ne félicite
 * pas).
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { publishEvidence } from './lib/evidence-publisher.mjs';
import {
  assertEphemeralTarget,
  ephemeralDeleteVerdict,
  ephemeralEmail,
  pickEphemeralUser,
} from './lib/ephemeral-accounts.mjs';
import { replayableWrite, withTransientRetry } from './lib/transient-http.mjs';
import { OWNER_ROSTER, ownerAccountsVerdict, loginProbeVerdict } from './lib/owner-accounts.mjs';

const root = dirname(dirname(fileURLToPath(import.meta.url)));

/** Lit .env sans jamais écraser une variable déjà posée par l'environnement. */
function readEnvFile(pathname) {
  const out = {};
  if (!existsSync(pathname)) return out;
  for (const line of readFileSync(pathname, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, '').trim();
  }
  return out;
}

const fileEnv = readEnvFile(join(root, '.env'));
const env = { ...fileEnv, ...process.env };
const pick = (...names) => names.map((n) => env[n]).find((v) => v && String(v).trim()) ?? '';

const BASE = pick('SUPABASE_URL', 'VITE_SUPABASE_URL').replace(/\/$/, '');
const SERVICE = pick('SUPABASE_SERVICE_ROLE_KEY', 'SERVICE_ROLE_KEY');
const ANON = pick('SUPABASE_ANON_KEY', 'ANON_KEY', 'VITE_SUPABASE_ANON_KEY');

// ── Non-vacuité : sans liste, ce contrôle ne juge rien, et le dire est un refus.
if (!OWNER_ROSTER.length) {
  console.error('❌ roster vide — un contrôle sans liste de comptes ne prouve rien.');
  process.exit(2);
}
if (!BASE || !SERVICE || !ANON) {
  console.error(
    '⚠️  secrets absents (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY / ANON_KEY) — ' +
      'l’état des comptes propriétaires n’a PAS été mesuré. Ce n’est pas un vert.',
  );
  process.exit(2);
}

const HDR = { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, 'Content-Type': 'application/json' };
const PROBLEMS = [];

/** Un corps non-JSON (page d'une passerelle) reste un statut, pas une exception. */
const json = async (res) => {
  const text = await res.text();
  try {
    return { status: res.status, ok: res.ok, body: text ? JSON.parse(text) : null };
  } catch {
    return { status: res.status, ok: res.ok, body: { _nonJson: text.slice(0, 200) } };
  }
};

/** Les mots de passe ne sont PAS ici : ils viennent de l'environnement, ou rien. */
const realLogin = async (entry) => {
  const password = entry.passwordEnv ? pick(entry.passwordEnv) : '';
  if (!password) {
    console.log(
      `   ➖ login réel de « ${entry.email} » NON MESURÉ — posez ${entry.passwordEnv} ` +
        '(secret d’Actions, ou variable locale) pour que ce login soit mesuré lui aussi',
    );
    return null;
  }
  const res = await fetch(`${BASE}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: ANON, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: entry.email, password }),
  });
  const probe = await json(res);
  const verdict = loginProbeVerdict({ ...probe, label: `login réel de ${entry.email}` });
  if (!verdict.ok) PROBLEMS.push(verdict.problem);
  else console.log(`   ✅ login réel de « ${entry.email} » (session délivrée)`);
  return verdict;
};

/**
 * Le login « chemin de l'app », mesuré sur un compte jetable : on crée, on se
 * connecte, on supprime. C'est la preuve que l'authentification délivre encore
 * des sessions — un compte propriétaire pourrait exister avec le bon rôle et un
 * GoTrue cassé ; ce probe-là le verrait.
 */
async function loginPathProbe() {
  const email = ephemeralEmail('verify-ownerwatch');
  assertEphemeralTarget(email);
  const password = `OwnerWatch-${Date.now().toString().slice(-6)}`;
  let uid = null;
  let loginOk = false;
  try {
    // Une réponse perdue (504 de passerelle) ne doit pas laisser un compte en
    // base : sans uid, le nettoyage n'aurait RIEN à supprimer. L'email est
    // unique côté GoTrue, donc la sonde le retrouve et le rejeu réutilise le
    // compte au lieu d'en créer un second.
    const created = await replayableWrite(
      async () => {
        const res = await json(
          await fetch(`${BASE}/auth/v1/admin/users`, {
            method: 'POST',
            headers: HDR,
            body: JSON.stringify({ email, password, email_confirm: true }),
          }),
        );
        return { status: res.status, body: res.body };
      },
      async () => {
        // Sonde de réconciliation : comparaison EXACTE côté client — le filtre
        // `?email=` de GoTrue est ignoré (mesuré le 2026-09-13), et s'y fier est
        // précisément l'incident que ce module de comptes jetables a fermé.
        const probe = await json(
          await fetch(`${BASE}/auth/v1/admin/users?per_page=1000`, { headers: HDR }),
        );
        const found = pickEphemeralUser(probe.body?.users, email);
        return found?.id ? { status: 200, body: found } : null;
      },
      { label: 'POST /auth/v1/admin/users — ', log: (m) => console.log(`  ↻ ${m}`) },
    );
    uid = created.body?.id ?? null;
    if (!uid) {
      PROBLEMS.push(`création du compte de contrôle échouée (HTTP ${created.status})`);
      return false;
    }
    const probe = await json(
      await fetch(`${BASE}/auth/v1/token?grant_type=password`, {
        method: 'POST',
        headers: { apikey: ANON, 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      }),
    );
    const verdict = loginProbeVerdict({ ...probe, label: 'login réel (compte de contrôle)' });
    if (!verdict.ok) PROBLEMS.push(verdict.problem);
    loginOk = verdict.ok;
  } finally {
    if (uid) {
      // La cible est jetable, vérifiée avant l'écriture — la suppression d'un
      // compte réel n'est pas possible depuis ce chemin (voir l'incident du
      // 2026-09-13 : c'est exactement ainsi qu'un compte propriétaire était né).
      assertEphemeralTarget(email);
      // Deux moitiés, et la seconde manquait le 2026-09-14 : la suppression est
      // REJOUÉE (un 504 de passerelle n'est pas une décision) puis son ABSENCE est
      // RELUE. La ligne verte n'est plus imprimée avant la suppression mais après
      // sa preuve — c'est ce qui distingue une phrase d'un fait.
      const del = await withTransientRetry(
        async () => {
          const res = await fetch(`${BASE}/auth/v1/admin/users/${uid}`, { method: 'DELETE', headers: HDR });
          return { status: res.status };
        },
        { label: 'DELETE /auth/v1/admin/users — ', log: (m) => console.log(`  ↻ ${m}`) },
      );
      const after = await json(await fetch(`${BASE}/auth/v1/admin/users?per_page=1000`, { headers: HDR }));
      const gone = ephemeralDeleteVerdict({
        status: del.status,
        stillPresent: Boolean(pickEphemeralUser(after.body?.users, email)),
        email,
      });
      if (!gone.ok) PROBLEMS.push(gone.problem);
      else if (loginOk) {
        console.log(
          `   ✅ chemin de login vivant (compte de contrôle : création → session → suppression, ${gone.note})`,
        );
      }
    }
  }
  return loginOk;
}

const users = await json(await fetch(`${BASE}/auth/v1/admin/users?per_page=1000`, { headers: HDR }));
if (!users.ok) {
  console.error(`⚠️  la liste des comptes n’a pas été lue (HTTP ${users.status}) — rien n’est jugé, ce n’est pas un vert.`);
  process.exit(2);
}
const profiles = await json(await fetch(`${BASE}/rest/v1/user_profiles?select=id,email,role`, { headers: HDR }));
if (!profiles.ok) {
  console.error(`⚠️  les profils n’ont pas été lus (HTTP ${profiles.status}) — les rôles ne sont donc pas jugés.`);
  process.exit(2);
}

console.log(`🔎 comptes propriétaires — ${BASE}`);
const verdict = ownerAccountsVerdict({ users: users.body?.users ?? [], profiles: profiles.body ?? [] });
PROBLEMS.push(...verdict.problems);
for (const { email, label, required } of OWNER_ROSTER) {
  const present = (users.body?.users ?? []).some((u) => String(u.email).toLowerCase() === email.toLowerCase());
  console.log(`   ${present ? '✅' : required ? '❌' : '➖'} ${email} (${label})`);
}
if (verdict.optionalAbsent.length) {
  console.log(`   ➖ hors service (absence sans conséquence, historique) : ${verdict.optionalAbsent.join(', ')}`);
}

console.log('🧪 login réel');
const pathAlive = await loginPathProbe();
let logins = pathAlive ? 1 : 0;
for (const entry of OWNER_ROSTER) {
  if (!entry.required) continue;
  if (await realLogin(entry)) logins += 1;
}

if (PROBLEMS.length) {
  console.error(`\n❌ ${PROBLEMS.length} problème(s) sur les comptes propriétaires :`);
  for (const p of PROBLEMS) console.error(`   • ${p}`);
  console.error(
    '\n   Un compte propriétaire qui disparaît ou perd son rôle se répare par l’API admin ' +
      '(scripts de restauration dans le journal du développement, entrée du 2026-09-13).',
  );
  process.exit(1);
}

console.log(
  `\n✅ ${verdict.measured} compte(s) propriétaire(s) présents et conformes` +
    (verdict.optionalAbsent.length ? `, ${verdict.optionalAbsent.length} hors service` : '') +
    `, ${logins} login(s) réel(s) aboutis`,
);
publishEvidence({
  acted: true,
  count: verdict.measured + logins,
  reason:
    `état des comptes propriétaires mesuré sur la base réelle : ${verdict.measured} compte(s) présent(s) ` +
    `avec le rôle attendu, ${logins} login(s) réel(s) abouti(s) (chemin de l’app, clé anon)`,
});
