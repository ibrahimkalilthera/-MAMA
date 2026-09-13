// Suite for scripts/lib/ephemeral-accounts.mjs — the throwaway accounts the E2E
// and audit scripts create, and the ONE thing a mistake there can destroy.
//
// Every assertion here exists because of a real incident, measured on production
// on 2026-09-13:
//   `GET /auth/v1/admin/users?email=X` IGNORES the filter for this GoTrue
//   version — an inexistant email returned the first page of ALL accounts. Six
//   scripts read `users[0]` believing it was their own throwaway account: they
//   promoted a REAL account to admin and DELETED it at cleanup. That is how
//   `ibrahimkalilthera@mamathera.org` (role dev, still present in audit_logs)
//   and `aggeediarra@mamathera.org` disappeared — no password was ever changed,
//   the accounts simply were not there any more.
//
// So the two contracts locked here are:
//   • RESOLUTION never trusts the filter: it matches the email exactly, and an
//     unreadable/absent match is `null` — never "the first of the list";
//   • WRITING refuses any target that is not throwaway, whatever the caller does.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel: string) => readFileSync(join(root, rel), 'utf8');

const { assertEphemeralTarget, isEphemeralEmail, pickEphemeralUser } = await import(
  '../scripts/lib/ephemeral-accounts.mjs'
);

type Userish = { id?: string; email?: string };

const PROBE = 'ci-probe-admin-123456@example.test';
const real = (email: string): Userish => ({ id: `id-${email}`, email });

// Le module est en JS : sa signature est déduite des JSDoc, donc les cas limites
// (réponse absente, objet sans email) se vérifient par assertion locale plutôt
// qu'en élargissant le contrat de production à des entrées impossibles.
const pick = (users: unknown, email: string): Userish | null =>
  pickEphemeralUser(users as Userish[], email) as Userish | null;

describe('pickEphemeralUser — le filtre ignoré ne désigne plus un compte réel', () => {
  it('un filtre ignoré (la liste ne contient que des comptes réels) rend null, pas le premier', () => {
    // C'est le cas mesuré : la réponse à `?email=<jetable>` était la première
    // page de tous les comptes. Lire `users[0]` désignait un vrai compte.
    const ignoredFilterResponse = [
      real('mamadoulaminethera@mamathera.org'),
      real('fantathera2002@mamathera.org'),
    ];
    assert.equal(pick(ignoredFilterResponse, PROBE), null);
  });

  it('trouve le compte jetable où qu’il soit dans la liste, et pas un autre', () => {
    const users = [real('a@mamathera.org'), real(PROBE), real('b@mamathera.org')];
    assert.equal(pick(users, PROBE)?.email, PROBE);
  });

  it('compare l’email sans tenir compte de la casse ni des espaces', () => {
    assert.equal(pick([real(PROBE.toUpperCase())], ` ${PROBE} `)?.email, PROBE.toUpperCase());
  });

  it('une réponse vide ou mal formée rend null (jamais une exception silencieuse)', () => {
    assert.equal(pick([], PROBE), null);
    assert.equal(pick(undefined, PROBE), null);
    assert.equal(pick([{ id: 'x' }], PROBE), null);
  });

  it('deux comptes portant le même email sont une incohérence : rien n’est désigné', () => {
    // L'email est unique côté GoTrue : deux correspondances signifient que la
    // réponse n'est pas celle qu'on croit, donc on refuse au lieu de choisir.
    assert.throws(() => pick([real(PROBE), real(PROBE)], PROBE), /2 comptes/);
  });

  it('un email non jetable est refusé AVANT même de chercher', () => {
    assert.throws(
      () => pick([real('ibrahimkalilthera@mamathera.org')], 'ibrahimkalilthera@mamathera.org'),
      /n'est pas un compte jetable/,
    );
  });
});

describe('assertEphemeralTarget — la garde qui rend la suppression d’un compte réel impossible', () => {
  it('accepte les préfixes et domaines réservés', () => {
    for (const email of [
      'verify-pdf-123456@audit.local',
      'e2e-123456@mamathera.org',
      'contrast-audit-x@example.com',
      'ci-probe-admin@example.test',
    ]) {
      assert.equal(assertEphemeralTarget(email), email, `${email} doit être accepté`);
    }
  });

  it('refuse les comptes réels — y compris ceux que l’incident a détruits', () => {
    for (const email of [
      'ibrahimkalilthera@mamathera.org',
      'aggeediarra@mamathera.org',
      'mamadoulaminethera@mamathera.org',
      'fantathera2002@mamathera.org',
    ]) {
      assert.equal(isEphemeralEmail(email), false);
      assert.throws(() => assertEphemeralTarget(email), /écriture refusée/);
    }
  });

  it('refuse une cible sans email : on ne supprime pas ce qu’on ne peut pas identifier', () => {
    for (const empty of ['', '   ', undefined, null]) {
      assert.throws(() => assertEphemeralTarget(empty as string), /cible sans email/);
    }
  });
});

// ── L'immunité : la panne ne peut pas revenir par un nouveau script ──────────
// Ces deux règles sont des propriétés du DÉPÔT, pas d'un module : un script
// ajouté demain doit échouer ici s'il refait la faute.
describe('le dépôt ne peut plus refaire la faute', () => {
  const scripts = (() => {
    const dir = join(root, 'scripts');
    const out: string[] = [];
    const walk = (rel: string) => {
      for (const entry of readdirSync(join(root, rel))) {
        const path = `${rel}/${entry}`;
        const st = statSync(join(root, path));
        if (st.isDirectory()) walk(path);
        else if (/\.(mjs|cjs|js)$/.test(entry)) out.push(path);
      }
    };
    walk('scripts');
    return out;
  })();

  it('aucun script ne lit un compte par le filtre `?email=` (ignoré par GoTrue)', () => {
    // La vraie faute est un APPEL : `?...?email=${…}`. (La prose des commentaires
    // a le droit de nommer la panne.)
    const offenders = scripts.filter((rel) => /admin\/users\?email=\$\{/.test(read(rel)));
    assert.deepEqual(
      offenders,
      [],
      'ce filtre est ignoré : la réponse est la première page de TOUS les comptes',
    );
  });

  it('aucun script ne désigne un compte par `.users[0]`', () => {
    // Un ACCÈS au champ `users` d'une réponse d'API — pas une variable locale
    // homonyme (`migrate-auth-users.mjs` lit `users[0]` d'un résultat SQL, c'est
    // légitime et sans rapport).
    const offenders = scripts.filter((rel) => /\.users\[0\]|\.users\?\.\[0\]/.test(read(rel)));
    assert.deepEqual(
      offenders,
      [],
      'le premier de la liste est un compte RÉEL quand le filtre est ignoré — utilisez pickEphemeralUser',
    );
  });

  it('chaque script qui supprime un compte passe par la garde', () => {
    const deleters = scripts.filter(
      (rel) => /admin\/users\/\$\{/.test(read(rel)) && /method: 'DELETE'/.test(read(rel)),
    );
    assert.ok(deleters.length >= 4, `attendu plusieurs scripts de nettoyage, vu ${deleters.length}`);
    for (const rel of deleters) {
      // Deux gardes légitimes : les helpers du module, ou le filtre de modèle
      // lui-même (`verify-ephemeral-cleanup` ne supprime QUE ce qui matche
      // EPHEMERAL_PATTERNS — sa garde est sa liste).
      assert.match(
        read(rel),
        /assertEphemeralTarget|pickEphemeralUser|EPHEMERAL_PATTERNS/,
        `${rel} supprime un compte sans vérifier qu’il est jetable`,
      );
    }
  });
});
