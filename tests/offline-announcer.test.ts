/**
 * Ce que le poste ANNONCE quand il bascule — et ce qu'il tait.
 *
 * Le bandeau hors ligne est visuel ; `aria-live` n'existait nulle part dans
 * `src/` (mesure du 2026-11-08 : 0 occurrence). Ces cas tiennent la moitié qui
 * manquait : la phrase est décidée par le CHANGEMENT, jamais par l'état courant
 * — sinon la région parlerait à chaque rendu, et une région qui parle tout le
 * temps ne s'écoute plus.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { announcementFor } from '../src/lib/offlineAnnouncement';

const t = {
  offlinePendingCount: 'Hors ligne — {count} modification(s) enregistrée(s) localement',
  offlineChangesWillBeQueuedLocally: 'Hors ligne — Les modifications seront enregistrées localement',
  offlinePendingSync: '{count} transaction(s) hors-ligne en attente de synchronisation',
  offlinePendingFailures: '{count} modification(s) refusée(s) par la base',
  offlineFailureReason: 'motif : {reason}',
  offlineBackOnline: 'Connexion rétablie — les modifications en attente vont être envoyées',
  offlineQueueSynced: '{count} modification(s) envoyée(s) à la base',
};

const state = (online: boolean, pendingCount = 0, pendingFailures = 0) => ({ online, pendingCount, pendingFailures });

describe('région live hors ligne — annoncer le changement, pas l’état', () => {
  it('se tait au montage : une annonce d’ouverture se confondrait avec un changement', () => {
    assert.equal(announcementFor(null, state(false, 3), t), '');
  });

  it('annonce la PERTE de la ligne, et ce que le poste fera des gestes suivants', () => {
    assert.match(announcementFor(state(true, 0), state(false, 0), t), /enregistrées localement/);
    assert.match(announcementFor(state(true, 2), state(false, 2), t), /Hors ligne — 2 modification/);
  });

  it('annonce le RETOUR de la ligne', () => {
    assert.match(announcementFor(state(false, 4), state(true, 4), t), /Connexion rétablie/);
  });

  it('annonce la file qui se VIDE — c’est la fin d’une attente', () => {
    assert.match(announcementFor(state(true, 5), state(true, 0), t), /^5 modification\(s\) envoyée\(s\) à la base$/);
  });

  it('un refus NOUVEAU de la base passe avant tout le reste, et nomme son motif', () => {
    const refused = announcementFor(state(true, 2, 0), state(true, 2, 1), t, 'doublon de reçu');
    assert.match(refused, /1 modification\(s\) refusée/);
    assert.match(refused, /doublon de reçu/);
  });

  it('un état INCHANGÉ ne redit rien — la région ne radote pas', () => {
    assert.equal(announcementFor(state(true, 2), state(true, 2), t), '');
    assert.equal(announcementFor(state(false, 2), state(false, 2), t), '');
    assert.equal(announcementFor(state(true, 1, 2), state(true, 1, 2), t), '');
  });

  it('une clé de traduction ABSENTE rend le silence, jamais le nom de la clé', () => {
    assert.equal(announcementFor(state(false, 0), state(true, 0), {}), '');
    assert.equal(announcementFor(state(true, 0), state(false, 0), {}), '');
    assert.equal(announcementFor(state(true, 3), state(true, 0), {}), '');
    assert.equal(announcementFor(state(true, 0, 0), state(true, 0, 1), {}), '');
  });

  it('les compteurs illisibles ne fabriquent pas de nombre', () => {
    const said = announcementFor(state(true, 0), state(true, 0), t, null);
    assert.equal(said, '', 'aucun changement lisible : rien à dire');
  });
});
