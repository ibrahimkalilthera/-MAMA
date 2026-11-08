/**
 * La porte `pre-push` — ce que le dépôt peut tenir lui-même sur `main`.
 *
 * La protection de branche GitHub rend `404` pour le compte qui pousse
 * (`viewerPermission: READ`), mesuré le 2026-11-08. Le garde de CI constate donc
 * APRÈS coup. Ce module est la seule vérification qui arrive AVANT que le commit
 * ne quitte la machine — et il doit refuser précisément ce qu'il prétend
 * refuser : `main` par un push direct, sans attraper les branches de travail ni
 * bloquer l'automatisation de release.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { MAIN_REF, parsePushLines, pushVerdict } from '../scripts/lib/push-target.mjs';

const ZERO = '0000000000000000000000000000000000000000';
const SHA = 'd21e521675f687a337207152c9287cd1d0dee050';

describe('parsePushLines — le protocole de git, pas une convention à nous', () => {
  it('lit les quatre champs de chaque ligne', () => {
    const pushes = parsePushLines(`${SHA} refs/heads/fix/x ${ZERO} ${MAIN_REF}\n`);
    assert.deepEqual(pushes, [
      { localSha: SHA, localRef: 'refs/heads/fix/x', remoteSha: ZERO, remoteRef: MAIN_REF },
    ]);
  });

  it('ignore une ligne incomplète au lieu d’inventer une référence', () => {
    assert.deepEqual(parsePushLines('sha refs/heads/main\n\n'), []);
    assert.deepEqual(parsePushLines(''), []);
  });
});

describe('pushVerdict — refuser main, laisser passer le reste', () => {
  it('une branche de travail passe', () => {
    const verdict = pushVerdict({ remoteRef: 'refs/heads/fix/y', localSha: SHA });
    assert.equal(verdict.ok, true);
  });

  it('un push direct sur main est refusé, avec le chemin de remplacement', () => {
    const verdict = pushVerdict({ remoteRef: MAIN_REF, localSha: SHA, tipSubject: 'fix: corrige un solde' });
    assert.equal(verdict.ok, false);
    assert.match(verdict.reason, /refusé/);
    assert.match(verdict.reason, /ouvrez une PR/);
  });

  it('un commit de release passe — exception nommée, pas un trou', () => {
    const verdict = pushVerdict({ remoteRef: MAIN_REF, localSha: SHA, tipSubject: 'chore(release): 1.0.44' });
    assert.equal(verdict.ok, true);
    assert.match(verdict.reason, /exception nommée/);
  });

  it('ALLOW_MAIN_PUSH=1 est une décision annoncée, jamais un silence', () => {
    const verdict = pushVerdict({ remoteRef: MAIN_REF, localSha: SHA, tipSubject: 'fix: x', allowMain: true });
    assert.equal(verdict.ok, true);
    assert.match(verdict.reason, /ALLOW_MAIN_PUSH=1/);
    assert.match(verdict.reason, /décision humaine/);
  });

  it('supprimer main est refusé', () => {
    const verdict = pushVerdict({ remoteRef: MAIN_REF, localSha: ZERO, tipSubject: null });
    assert.equal(verdict.ok, false);
    assert.match(verdict.reason, /ne se supprime pas/);
  });

  it('un sujet illisible ne fabrique pas un passe-droit', () => {
    const verdict = pushVerdict({ remoteRef: MAIN_REF, localSha: SHA, tipSubject: null });
    assert.equal(verdict.ok, false);
  });
});
