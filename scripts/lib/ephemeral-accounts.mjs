// ─────────────────────────────────────────────────────────────────────────────
// scripts/lib/ephemeral-accounts.mjs — single source of truth for throwaway
// Supabase auth accounts used by the E2E / audit scripts.
//
// Every script that creates an ephemeral admin (verify-pdf-download,
// verify-csp-guard, verify-desktop-app, e2e-business, verify-anon-rls) MUST
// build its email with ephemeralEmail(). The theme contrast audit is no longer
// one of them: it drives a fixture backend instead of an account
// (scripts/lib/audit-fixtures.mjs). The CI guard
// scripts/verify-ephemeral-cleanup.mjs imports EPHEMERAL_PATTERNS from here
// and fails the run if any matching account survives a script's finally.
//
// The factory asserts its own output against the patterns and throws if a
// caller tries to emit an email the guard would miss — so a NEW script can
// never silently create an account that escapes the cleanup gate. The first
// line of defence is the throw at creation time; the guard is the second.
// ─────────────────────────────────────────────────────────────────────────────

// Patterns matched ANYWHERE/with anchors on the full email. `audit-` is
// matched anywhere in the email (covers contrast-audit-*, icon-audit-*,
// audit-*); the real production accounts contain no such marker. `.test` is
// a reserved TLD and never used by a real account.
export const EPHEMERAL_PATTERNS = [
  /^verify-/i, // verify-pdf-download / verify-csp-guard → verify-*@audit.local
  /^e2e-/i, // e2e-business → e2e-*@mamathera.org
  /audit-/i, // any *-audit-*@… account (the contrast audit no longer emits one)
  /^ci-probe-/i, // verify-anon-rls → ci-probe-*@example.test
  /@audit\.local$/i, // reserved mailbox domain for audit accounts
  /@example\.test$/i, // reserved TLD for probe accounts
];

export const isEphemeralEmail = (email) =>
  EPHEMERAL_PATTERNS.some((re) => re.test(email || ''));

// Build a unique ephemeral email for a script account. `domain` defaults to
// the reserved @audit.local — the only domains that guarantee a match. The
// result is asserted against the guard patterns: a prefix/domain combination
// the guard would miss throws immediately instead of leaking an account.
export const ephemeralEmail = (prefix, domain = 'audit.local') => {
  const cleanPrefix = String(prefix || '').trim();
  if (!cleanPrefix) throw new Error('ephemeralEmail: préfixe requis');
  const email = `${cleanPrefix}-${Date.now().toString().slice(-6)}@${domain}`;
  if (!isEphemeralEmail(email)) {
    throw new Error(
      `ephemeralEmail: « ${email} » n'est pas couvert par la garde anti-résidus — ` +
        `utilisez un préfixe (verify-, e2e-, audit-, ci-probe-) ou un domaine réservé ` +
        `(@audit.local, @example.test).`,
    );
  }
  return email;
};

// ── La cible d'écriture, et pourquoi elle est vérifiée deux fois ─────────────
//
// MESURÉ le 2026-09-13, contre la production : `GET /auth/v1/admin/users?email=X`
// **ignore le filtre**. La réponse était la première page de TOUS les comptes,
// quel que soit X — y compris pour un email inexistant. Six scripts lisaient
// donc `users[0]` en croyant lire LEUR compte jetable : ils tombaient sur un
// compte réel, le promouvaient admin (`PATCH user_profiles?id=eq.uid`) et le
// **supprimaient** au nettoyage (`DELETE admin/users/{uid}`). C'est ce qui a fait
// disparaître `ibrahimkalilthera@mamathera.org` (rôle dev, présent dans
// `audit_logs` avant sa suppression) et `aggeediarra@mamathera.org`, sans qu'aucun
// mot de passe ne soit touché : le compte n'existait simplement plus.
//
// Deux gardes, parce qu'une seule ne suffit pas : la RÉSOLUTION ne fait plus
// confiance au filtre (comparaison exacte côté client) et l'ÉCRITURE refuse toute
// cible qui n'est pas jetable (assertEphemeralTarget). Un filtre ignoré ne peut
// donc plus désigner un compte réel, même si un futur script l'oubliait.

/**
 * Le compte jetable portant EXACTEMENT cet email, dans une liste rendue par
 * l'API — jamais « le premier de la liste ».
 *
 * @param {Array<{email?: string}>} users la réponse brute (`body.users`)
 * @param {string} email l'email du compte jetable attendu
 * @returns {object|null} le compte correspondant, ou null s'il est absent
 */
export function pickEphemeralUser(users, email) {
  assertEphemeralTarget(email);
  const target = String(email).trim().toLowerCase();
  const matches = (Array.isArray(users) ? users : []).filter(
    (u) => String(u?.email ?? '').trim().toLowerCase() === target,
  );
  if (matches.length > 1) {
    throw new Error(
      `pickEphemeralUser: ${matches.length} comptes portent « ${target} » — ` +
        `l'email est unique côté GoTrue, donc cette réponse est incohérente : rien n'est touché.`,
    );
  }
  return matches[0] ?? null;
}

/**
 * Refuse une cible d'écriture qui n'est pas un compte jetable.
 *
 * C'est la garde qui rend la panne de 2026-09-13 impossible par construction :
 * un compte réel ne peut plus être promu ni supprimé, même si l'appelant se
 * trompe de cible.
 *
 * @param {string} email l'email visé par l'écriture
 * @returns {string} l'email, quand il est jetable
 */
export function assertEphemeralTarget(email) {
  const clean = String(email ?? '').trim();
  if (!clean) {
    throw new Error(
      'assertEphemeralTarget: cible sans email — on ne modifie ni ne supprime un compte qu’on ne peut pas identifier',
    );
  }
  if (!isEphemeralEmail(clean)) {
    throw new Error(
      `assertEphemeralTarget: « ${clean} » n'est pas un compte jetable ` +
        `(préfixe verify-/e2e-/audit-/ci-probe-, ou domaine @audit.local / @example.test) : ` +
        `écriture refusée — un compte réel ne doit jamais être promu ni supprimé par un script jetable.`,
    );
  }
  return clean;
}