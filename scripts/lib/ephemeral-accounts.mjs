// ─────────────────────────────────────────────────────────────────────────────
// scripts/lib/ephemeral-accounts.mjs — single source of truth for throwaway
// Supabase auth accounts used by the E2E / audit scripts.
//
// Every script that creates an ephemeral admin (verify-pdf-download,
// verify-csp-guard, theme-contrast-audit, e2e-business, verify-anon-rls) MUST
// build its email with ephemeralEmail(). The CI guard
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
  /audit-/i, // theme-contrast-audit → contrast-audit-*@mamathera.org
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