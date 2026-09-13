// Suite for scripts/lib/owner-accounts.mjs — the roster of OWNER accounts, and
// the verdict that says whether one of them has disappeared.
//
// Why each assertion exists (incident of 2026-09-13): the dev account
// `ibrahimkalilthera@mamathera.org` had been deleted from the shared database by
// a throwaway script that read `users[0]` of an API response. Every local check
// was green — what was missing was not in a file — and the loss was discovered
// when its owner tried to log in. So this module's contracts are:
//   • an ABSENT required account is RED, never a silent gap;
//   • a PRESENT account in a broken state (unconfirmed, banned, soft-deleted,
//     no email identity, wrong role) is RED too — presence alone is a false green;
//   • an optional/historical account that is absent is NAMED, not punished;
//   • a login probe that did not receive a session is RED, whatever the HTTP
//     status, and a "no session but 200" response cannot pass.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  KNOWN_ROLES,
  OWNER_ROSTER,
  loginProbeVerdict,
  ownerAccountsVerdict,
} from '../scripts/lib/owner-accounts.mjs';

const user = (over: Record<string, unknown> = {}) => ({
  id: 'u-1',
  email: 'ibrahimkalilthera@mamathera.org',
  email_confirmed_at: '2026-08-21T01:51:09.454719Z',
  deleted_at: null,
  banned_until: null,
  // Forme RÉELLE de la réponse mesurée le 2026-09-13 : `app_metadata.provider`
  // est là, `identities` ne l'est pas.
  app_metadata: { provider: 'email' },
  ...over,
});

const profile = (over: Record<string, unknown> = {}) => ({ id: 'u-1', role: 'dev', ...over });

describe('le roster des comptes propriétaires', () => {
  it('contient le compte dev avec son rôle — c’est le compte de l’incident', () => {
    const dev = OWNER_ROSTER.find((e) => e.email === 'ibrahimkalilthera@mamathera.org');
    assert.ok(dev, 'le compte dev documenté doit rester surveillé');
    assert.equal(dev?.role, 'dev');
    assert.equal(dev?.required, true, 'sa disparition doit être ROUGE');
  });

  it('ne surveille que des rôles que la base accepte', () => {
    for (const entry of OWNER_ROSTER) {
      assert.ok(KNOWN_ROLES.includes(entry.role), `${entry.email} : rôle inconnu « ${entry.role} »`);
    }
  });

  it('n’écrit aucun mot de passe : il nomme la variable d’environnement', () => {
    for (const entry of OWNER_ROSTER) {
      if (!entry.required) continue;
      assert.match(
        String(entry.passwordEnv ?? ''),
        /^OWNER_[A-Z_]+_PASSWORD$/,
        `${entry.email} doit nommer le secret qui porte son mot de passe, jamais le mot de passe`,
      );
    }
  });
});

describe('ownerAccountsVerdict — un compte absent est le rouge de l’incident', () => {
  it('un compte requis absent est rouge, et son absence est nommée', () => {
    // Le cas mesuré : la base ne portait plus que deux des quatre comptes.
    const verdict = ownerAccountsVerdict({
      users: [user({ email: 'fantathera2002@mamathera.org', id: 'u-2' })],
      profiles: [profile({ id: 'u-2', role: 'admin' })],
    });
    assert.equal(verdict.ok, false);
    assert.ok(verdict.absent.includes('ibrahimkalilthera@mamathera.org'));
    assert.ok(verdict.problems.some((p) => /ABSENT/.test(p)));
  });

  it('tous présents et conformes : vert, et le compte mesuré est compté', () => {
    const users = [
      user(),
      user({ id: 'u-2', email: 'fantathera2002@mamathera.org' }),
      user({ id: 'u-3', email: 'mamadoulaminethera@mamathera.org' }),
      user({ id: 'u-4', email: 'aggeediarra@mamathera.org' }),
    ];
    const profiles = [
      profile(),
      profile({ id: 'u-2', role: 'admin' }),
      profile({ id: 'u-3', role: 'general_manager' }),
      profile({ id: 'u-4', role: 'staff' }),
    ];
    const verdict = ownerAccountsVerdict({ users, profiles });
    assert.equal(verdict.ok, true, verdict.problems.join(' | '));
    assert.equal(verdict.measured, 4, 'les quatre comptes requis sont réellement jugés');
    assert.deepEqual(verdict.optionalAbsent, ['ibrahimkalilthera@yahoo.com'], 'l’historique absent est nommé');
  });

  it('un compte présent mais suspendu est rouge : présent n’est pas utilisable', () => {
    const verdict = ownerAccountsVerdict({
      users: [user({ banned_until: '2099-01-01T00:00:00Z' })],
      profiles: [profile()],
      roster: [OWNER_ROSTER[0]],
    });
    assert.equal(verdict.ok, false);
    assert.ok(verdict.problems.some((p) => /suspendu/.test(p)));
  });

  it('un compte non confirmé, supprimé en douceur ou sans identité email est rouge', () => {
    const cases: [Record<string, unknown>, RegExp][] = [
      [{ email_confirmed_at: null }, /n'est pas confirmé/],
      [{ deleted_at: '2026-09-13T00:00:00Z' }, /supprimé en douceur/],
      [{ app_metadata: { provider: 'google' }, identities: [] }, /ne se connecte pas par mot de passe/],
      [{ app_metadata: {}, identities: [] }, /ne déclare aucun fournisseur/],
    ];
    for (const [override, expected] of cases) {
      const verdict = ownerAccountsVerdict({
        users: [user(override)],
        profiles: [profile()],
        roster: [OWNER_ROSTER[0]],
      });
      assert.equal(verdict.ok, false, JSON.stringify(override));
      assert.ok(
        verdict.problems.some((p) => expected.test(p)),
        `${JSON.stringify(override)} → ${verdict.problems.join(' | ')}`,
      );
    }
  });

  it('un rôle qui a dérivé est rouge : les pouvoirs ne sont plus ceux documentés', () => {
    const verdict = ownerAccountsVerdict({
      users: [user()],
      profiles: [profile({ role: 'staff' })],
      roster: [OWNER_ROSTER[0]],
    });
    assert.equal(verdict.ok, false);
    assert.ok(verdict.problems.some((p) => /« staff » au lieu de « dev »/.test(p)));
  });

  it('un compte sans ligne de profil est rouge (le trigger aurait dû la créer)', () => {
    const verdict = ownerAccountsVerdict({ users: [user()], profiles: [], roster: [OWNER_ROSTER[0]] });
    assert.equal(verdict.ok, false);
    assert.ok(verdict.problems.some((p) => /user_profiles/.test(p)));
  });

  it('l’absence d’un compte HISTORIQUE est nommée sans être un échec', () => {
    const historique = OWNER_ROSTER.find((e) => e.required === false);
    assert.ok(historique, 'le roster doit garder un compte historique hors service');
    const verdict = ownerAccountsVerdict({ users: [], profiles: [], roster: [historique] });
    assert.equal(verdict.ok, true, 'un compte hors service supprimé volontairement ne rougit pas à vie');
    assert.deepEqual(verdict.optionalAbsent, [historique?.email]);
  });

  it('un roster vide est un refus, pas un vert', () => {
    assert.throws(() => ownerAccountsVerdict({ users: [], profiles: [], roster: [] }), /roster vide/);
  });
});

describe('loginProbeVerdict — une session, ou rien', () => {
  it('une session délivrée est le seul vert : c’est ce qu’un poste obtient', () => {
    const v = loginProbeVerdict({ ok: true, status: 200, body: { access_token: 'jwt', user: { id: 'u-1' } } });
    assert.deepEqual(v, { ok: true, problem: null, tokenIssued: true });
  });

  it('un 200 sans jeton est rouge — une réponse polie n’est pas une session', () => {
    const v = loginProbeVerdict({ ok: true, status: 200, body: {} });
    assert.equal(v.ok, false);
    assert.equal(v.tokenIssued, false);
  });

  it('un refus nomme la cause exacte du serveur, jamais un statut nu', () => {
    const v = loginProbeVerdict({
      ok: false,
      status: 400,
      body: { error_description: 'Invalid login credentials' },
      label: 'login réel de a@b.c',
    });
    assert.equal(v.ok, false);
    assert.match(String(v.problem), /Invalid login credentials/);
    assert.match(String(v.problem), /login réel de a@b\.c/);
  });

  it('une page non-JSON d’une passerelle est un échec lisible, pas une exception', () => {
    const v = loginProbeVerdict({ ok: false, status: 504, body: { _nonJson: '<html>504</html>' } });
    assert.equal(v.ok, false);
    assert.match(String(v.problem), /réponse non-JSON/);
  });
});
