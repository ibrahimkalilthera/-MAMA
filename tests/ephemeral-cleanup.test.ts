// ─────────────────────────────────────────────────────────────────────────────
// Le défaut mesuré le 2026-09-14, en deux moitiés, et ce que chacune coûtait :
//
//   1. Le veilleur des comptes propriétaires supprimait son compte de contrôle
//      sans lire la réponse (`.catch(() => null)`) et imprimait « création →
//      session → suppression » AVANT cette suppression. Le compte est resté en
//      base, et la phrase verte était fausse depuis le début : `ephemeralDeleteVerdict`
//      verrouille les deux règles qui manquaient — un statut ne suffit pas, et
//      l'absence doit être relue.
//
//   2. Le garde-fou de résidus jugeait tout compte jetable comme un nettoyage
//      cassé, alors que deux workflows du même push écrivent dans la même base :
//      le compte de contrôle du voisin, âgé de douze secondes, a fait rougir le
//      E2E métier ET le E2E PDF. `classifyEphemeral` sépare le résidu (rouge) du
//      vol en cours (nommé, non jugé).
//
// Les deux fonctions sont pures et l'horloge est injectée : sans cela, le cas
// « créé il y a 2 minutes » dépendrait de la vitesse de la machine, et un test
// qui dépend de l'heure ne prouve rien.
// ─────────────────────────────────────────────────────────────────────────────
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { ephemeralDeleteVerdict, isEphemeralEmail } from '../scripts/lib/ephemeral-accounts.mjs';
import { classifyEphemeral, DEFAULT_IN_FLIGHT_MS } from '../scripts/lib/ephemeral-cleanup.mjs';

const NOW = Date.parse('2026-09-14T05:00:00.000Z');
const at = (secondsAgo: number) => new Date(NOW - secondsAgo * 1000).toISOString();

// Le module est du JS pur (aucun type exporté) : ce harnais nomme ce qu'il
// reçoit, sinon les cas ci-dessous liraient `object` et ne prouveraient rien.
type Row = { id: string; email: string; created_at?: string; ageMs?: number };
type Classified = { residues: { users: Row[]; profiles: Row[] }; inFlight: { users: Row[]; profiles: Row[] } };
const classify = (all: {
  users: Row[];
  profiles: Row[];
  now?: number;
  graceMs?: number;
  isEphemeral?: (email: string) => boolean;
}): Classified =>
  classifyEphemeral({ isEphemeral: isEphemeralEmail, now: NOW, ...all } as never) as Classified;

describe('ephemeralDeleteVerdict — une suppression se prouve, elle ne se déclare pas', () => {
  it('204 + absence relue → la suppression est tenue', () => {
    const v = ephemeralDeleteVerdict({ status: 204, stillPresent: false, email: 'verify-x@audit.local' });
    assert.equal(v.ok, true);
    assert.equal(v.note, 'HTTP 204');
  });

  it('404 → but atteint : « plus rien en base » est ce qu’on demande', () => {
    const v = ephemeralDeleteVerdict({ status: 404, stillPresent: false, email: 'verify-x@audit.local' });
    assert.equal(v.ok, true);
    assert.equal(v.note, 'déjà absent');
  });

  it('un statut transitoire (504) n’est pas un verdict — et le dit avec son code', () => {
    const v = ephemeralDeleteVerdict({ status: 504, stillPresent: true, email: 'verify-x@audit.local' });
    assert.equal(v.ok, false);
    assert.match(v.problem!, /HTTP 504/);
    assert.match(v.problem!, /verify-x@audit\.local/);
  });

  it('LE cas du 2026-09-14 : 200 annoncé, compte encore là → échec nommé', () => {
    // Exactement ce qui a laissé « verify-ownerwatch-703282@audit.local » en base
    // pendant que le script se déclarait vert.
    const v = ephemeralDeleteVerdict({ status: 200, stillPresent: true, email: 'verify-ownerwatch-703282@audit.local' });
    assert.equal(v.ok, false);
    assert.match(v.problem!, /TOUJOURS en base/);
    assert.match(v.problem!, /relire l’absence/);
  });
});

describe('classifyEphemeral — l’âge départage le résidu du vol en cours', () => {
  const users = [
    { id: 'u-old', email: 'verify-ownerwatch-703282@audit.local', created_at: at(300) }, // 5 min
    { id: 'u-fresh', email: 'e2e-766880@mamathera.org', created_at: at(12) }, // 12 s
    { id: 'u-real', email: 'ibrahimkalilthera@mamathera.org', created_at: at(9000) },
  ];
  const profiles = [
    { id: 'u-old', email: 'verify-ownerwatch-703282@audit.local', created_at: at(300) },
    { id: 'u-fresh', email: 'e2e-766880@mamathera.org', created_at: at(12) },
    { id: 'u-real', email: 'ibrahimkalilthera@mamathera.org', created_at: at(9000) },
  ];

  const classifyAll = () => classify({ users, profiles });

  it('un compte ancien est un RÉSIDU, un compte de douze secondes est EN VOL', () => {
    const { residues, inFlight } = classifyAll();
    assert.deepEqual(
      residues.users.map((u) => u.email),
      ['verify-ownerwatch-703282@audit.local'],
      'le compte de cinq minutes est le résidu — c’est celui qui a fait rougir deux workflows',
    );
    assert.deepEqual(
      inFlight.users.map((u) => u.email),
      ['e2e-766880@mamathera.org'],
      'le compte du voisin, créé douze secondes plus tôt, n’est pas jugé',
    );
    assert.equal(inFlight.users[0]!.ageMs, 12_000, 'l’âge est publié, pas caché : un vol en cours se relit');
  });

  it('un profil suit son compte : en vol avec lui, résidu avec lui', () => {
    const { residues, inFlight } = classifyAll();
    assert.deepEqual(residues.profiles.map((p) => p.id), ['u-old'], 'la cascade le condamne avec son compte');
    assert.deepEqual(inFlight.profiles.map((p) => p.id), ['u-fresh'], 'et le sursoit avec lui');
  });

  it('un profil orphelin (aucun compte) est un résidu — la cascade a déjà eu lieu', () => {
    const { residues } = classify({
      users: [],
      profiles: [{ id: 'p-orphan', email: 'verify-pdf-1@audit.local', created_at: at(2) }],
    });
    assert.deepEqual(residues.profiles.map((p) => p.id), ['p-orphan'], 'jeune mais orphelin : rien ne l’effacera plus tard');
  });

  it('une date illisible n’est PAS un sursis — sans âge prouvé, c’est un résidu', () => {
    const { residues, inFlight } = classify({
      users: [
        { id: 'u-nodate', email: 'verify-x@audit.local' },
        { id: 'u-junk', email: 'verify-y@audit.local', created_at: 'hier' },
      ],
      profiles: [],
    });
    assert.deepEqual(residues.users.map((u) => u.id), ['u-nodate', 'u-junk']);
    assert.deepEqual(inFlight.users, []);
  });

  it('les comptes réels ne sont jamais classés — c’est ce qui rend le contrôle sûr', () => {
    const { residues, inFlight } = classify({
      users: [{ id: 'u-dev', email: 'ibrahimkalilthera@mamathera.org', created_at: at(9000) }],
      profiles: [{ id: 'u-dev', email: 'ibrahimkalilthera@mamathera.org', created_at: at(9000) }],
    });
    assert.deepEqual(residues.users, []);
    assert.deepEqual(residues.profiles, []);
    assert.deepEqual(inFlight.users, []);
    assert.equal(isEphemeralEmail('ibrahimkalilthera@mamathera.org'), false, 'le motif ne mord pas sur un compte réel');
  });

  it('la grâce est un paramètre, pas une constante cachée — et elle vaut deux minutes', () => {
    assert.equal(DEFAULT_IN_FLIGHT_MS, 120_000, 'deux minutes : assez pour un job voisin, trop court pour cacher une fuite');
    const { residues } = classify({
      users: [{ id: 'u', email: 'verify-x@audit.local', created_at: at(121) }],
      profiles: [],
    });
    assert.deepEqual(residues.users.map((u) => u.id), ['u'], 'une seconde au-delà de la grâce, le résidu est jugé');
  });

  it('sans motifs, le classement refuse de juger (pas de vert vacueux)', () => {
    assert.throws(
      () => classifyEphemeral({ users, profiles, now: NOW } as never),
      /isEphemeral est requis/,
      'un classement sans motifs ne classerait rien en prétendant avoir regardé',
    );
  });
});
