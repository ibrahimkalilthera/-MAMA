// Suite de scripts/lib/signing-transition.mjs.
//
// WHY THIS EXISTS
// ---------------
// Ce module décide si une BASCULE de signature coupe le parc de sa prochaine
// mise à jour — la seule question qu'aucun autre contrôle ne pose, et celle
// dont la mauvaise réponse coûte un parc entier (mesuré le 2026-09-13 : la
// 1.0.8 a gravé « Mama Thera Finance (test) » dans les postes, et chacun d'eux
// refusait dès lors TOUTES les versions suivantes).
//
// Les contrats reproduits ici sont ceux que le dépôt a réellement mesurés :
//   • 1.0.9 → 1.0.18 : 104 octets, AUCUN `publisherName` (le parc se met à jour
//     par le `sha512` du flux) ;
//   • 1.0.6 → 1.0.8 : 149 octets, `publisherName: [ "Mama Thera Finance (test)" ]`
//     (contrat de gel, réparable poste par poste).
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  TRANSITION,
  TRANSITION_DETAIL,
  contractFingerprint,
  contractPromise,
  fieldContractGroups,
  signingTransitionVerdict,
} from '../scripts/lib/signing-transition.mjs';

/**
 * Le contrat des 1.0.9 → 1.0.18 : les octets EXACTS, pas une reconstitution.
 *
 * La preuve n'est pas la forme écrite mais l'empreinte : ces 104 octets font
 * `b9cefbcaa012c806…`, qui est le sha256 que le manifeste publié scelle pour
 * `resources/app-update.yml` de la 1.0.18 — vérifié sur le canal le 2026-09-22.
 * C'est ce qui autorise à dire « cette promesse-là est celle du parc » : une
 * empreinte identique veut dire des octets identiques.
 */
const UNSIGNED = [
  'owner: ibrahimkalilthera',
  "repo: '-MAMA'",
  'provider: github',
  'updaterCacheDirName: mama-thera-finance-updater',
  '',
].join('\n');

/** L'empreinte du contrat publié de la 1.0.18 (104 octets). */
const UNSIGNED_SHA256 = 'b9cefbcaa012c8060a578790658118690ca7cd7f48361cd9fe6c664628df4674';

/** L'empreinte du contrat publié de la 1.0.8 (149 octets, promesse de test). */
const TEST_SIGNED_SHA256 = 'b8c880ad9c06e5da1715dc7d7273ea38c71e1bdf9bbc61d32c8b8b52e1a0c13d';

/**
 * Le contrat des 1.0.6 → 1.0.8, mesuré (149 octets) : promesse de test.
 *
 * L'indentation n'est pas cosmétique : c'est la forme que `electron-builder`
 * écrit (une liste YAML sous la clé), et 104 octets + `publisherName:` + cette
 * ligne indentée donnent exactement les **149** octets mesurés sur la 1.0.8.
 */
const TEST_SIGNED = [
  'owner: ibrahimkalilthera',
  "repo: '-MAMA'",
  'provider: github',
  'updaterCacheDirName: mama-thera-finance-updater',
  'publisherName:',
  '  - Mama Thera Finance (test)',
  '',
].join('\n');

/** Le contrat d'une version signée par un vrai certificat (CN gravé). */
const REAL_SIGNED = (cn: string) =>
  [
    'owner: ibrahimkalilthera',
    "repo: '-MAMA'",
    'provider: github',
    'updaterCacheDirName: mama-thera-finance-updater',
    'publisherName:',
    `  - ${cn}`,
    '',
  ].join('\n');

const fingerprintOf = (text: string) => contractFingerprint(text);

describe('le contrat se lit pour ce qui décide, pas pour ce qu’il contient', () => {
  it('lit une promesse en bloc, en ligne, ou son absence', () => {
    assert.deepEqual(contractPromise(UNSIGNED), null);
    assert.deepEqual(contractPromise(TEST_SIGNED), ['Mama Thera Finance (test)']);
    assert.deepEqual(contractPromise('publisherName: MaMA THERA FINANCE\n'), ['MaMA THERA FINANCE']);
    // Une clé présente mais vide n'est PAS une absence : aucun certificat ne
    // satisfait une liste vide, donc le contrat est pire que sans promesse.
    assert.deepEqual(contractPromise('publisherName:\n'), []);
  });

  it('empreinte un contrat par sa taille et son sha256 — les deux formes mesurées diffèrent', () => {
    const unsigned = fingerprintOf(UNSIGNED);
    const signed = fingerprintOf(TEST_SIGNED);
    assert.notEqual(unsigned.sha256, signed.sha256);
    assert.notEqual(unsigned.size, signed.size);
    // Les deux contrats sont les octets EXACTS des versions publiées : leurs
    // empreintes sont celles que les manifestes du canal scellent (104 octets
    // pour la 1.0.18, 149 pour la 1.0.8). Un test qui n'exigerait que « elles
    // diffèrent » passerait encore si la forme écrite changeait silencieusement,
    // et c'est cette forme-là qui décide du sort du parc.
    assert.equal(unsigned.size, 104);
    assert.equal(unsigned.sha256, UNSIGNED_SHA256);
    assert.equal(signed.size, 149);
    assert.equal(signed.sha256, TEST_SIGNED_SHA256);
  });

  it('regroupe le parc par contrat RÉELLEMENT installé, sans lire 129 Mo par version', () => {
    const groups = fieldContractGroups({
      versions: [
        { version: '1.0.18', contract: { size: 104, sha256: 'aa' } },
        { version: '1.0.17', contract: { size: 104, sha256: 'aa' } },
        { version: '1.0.8', contract: { size: 149, sha256: 'bb' } },
        { version: '1.0.7', contract: { size: 149, sha256: 'bb' } },
        { version: '1.0.9', contract: null },
      ],
    });
    assert.equal(groups.length, 2);
    assert.deepEqual(groups[0].versions, ['1.0.18', '1.0.17']);
    assert.deepEqual(groups[1].versions, ['1.0.8', '1.0.7']);
  });
});

describe('le contrat livré est celui d’une version déjà publiée', () => {
  it('conclut SANS lire la promesse du parc : même empreinte = mêmes octets', () => {
    const verdict = signingTransitionVerdict({
      candidate: { promises: null, fingerprint: fingerprintOf(UNSIGNED) },
      field: { promises: null, digests: [fingerprintOf(UNSIGNED).sha256], evidence: 'canal' },
    });
    assert.equal(verdict.ok, true);
    assert.equal(verdict.cause, TRANSITION.UNCHANGED);
    assert.match(verdict.conclusion, /empreinte d’un contrat déjà publié/);
  });
});

describe('un contrat qui change sans que le parc ait été lu ne se conclut PAS', () => {
  it('refuse de trancher plutôt que de rendre un vert non mesuré', () => {
    const verdict = signingTransitionVerdict({
      candidate: { promises: null, fingerprint: fingerprintOf(UNSIGNED) },
      field: { promises: null, digests: ['autre-empreinte'], evidence: '' },
    });
    assert.equal(verdict.ok, false);
    assert.equal(verdict.cause, TRANSITION.UNPROVEN);
    assert.match(verdict.problems.join(' '), /n’a pas été lue/);
    assert.match(verdict.problems.join(' '), /--station=|--field-installer=|--channel/);
  });
});

describe('livrer NON signé alors que le parc promet un signataire', () => {
  it('REFUSE — c’est le gel du parc par la porte de derrière', () => {
    const verdict = signingTransitionVerdict({
      candidate: { promises: null, fingerprint: fingerprintOf(UNSIGNED) },
      field: { promises: [['MaMA THERA FINANCE']], evidence: 'poste' },
      target: '1.0.19',
    });
    assert.equal(verdict.ok, false);
    assert.equal(verdict.cause, TRANSITION.UNSIGNED_AFTER_COMMITMENT);
    assert.match(verdict.problems.join(' '), /des postes promettent « MaMA THERA FINANCE »/);
    assert.match(verdict.problems.join(' '), /ne pas couper la signature/);
    assert.equal(verdict.commitment, null);
  });

  it('accepte quand AUCUN contrat du parc ne promet rien — l’état de référence du dépôt', () => {
    const verdict = signingTransitionVerdict({
      candidate: { promises: null, fingerprint: fingerprintOf(UNSIGNED) },
      field: { promises: [null, null], evidence: 'poste' },
    });
    assert.equal(verdict.ok, true);
    assert.equal(verdict.cause, TRANSITION.UNSIGNED_UNCHANGED);
    assert.match(verdict.conclusion, /installeur non signé reste accepté/);
  });

  it('une promesse VIDE dans le contrat livré est un refus, pas une absence', () => {
    const verdict = signingTransitionVerdict({
      candidate: { promises: [], fingerprint: null },
      field: { promises: [null], evidence: 'poste' },
    });
    assert.equal(verdict.ok, false);
    assert.equal(verdict.cause, TRANSITION.PROMISE_EMPTY);
  });
});

describe('la première version signée : gratuite maintenant, engageante ensuite', () => {
  it('accepte, et DIT ce que le parc gravera — l’engagement vaut pour toutes les suivantes', () => {
    const verdict = signingTransitionVerdict({
      candidate: { promises: ['MaMA THERA FINANCE'], fingerprint: fingerprintOf(REAL_SIGNED('MaMA THERA FINANCE')) },
      field: { promises: [null, null], evidence: 'poste' },
      target: '1.0.19',
    });
    assert.equal(verdict.ok, true);
    assert.equal(verdict.cause, TRANSITION.FIRST_COMMITMENT);
    assert.deepEqual(verdict.commitment, ['MaMA THERA FINANCE']);
    assert.match(verdict.notes.join(' '), /engagement/);
    assert.match(verdict.notes.join(' '), /couper `SIGNING_ENABLED` gèlera/);
    assert.match(verdict.conclusion, /première version signée/);
  });

  it('refuse un signataire de TEST — c’est exactement le contrat qui a gelé la 1.0.8', () => {
    const verdict = signingTransitionVerdict({
      candidate: { promises: ['Mama Thera Finance (test)'], fingerprint: fingerprintOf(TEST_SIGNED) },
      field: { promises: [null], evidence: 'poste' },
    });
    assert.equal(verdict.ok, false);
    assert.equal(verdict.cause, TRANSITION.TEST_COMMITMENT);
    assert.match(verdict.problems.join(' '), /signataire de TEST/);
  });

  it('compte et NOMME les postes déjà gelés, sans en faire une faute du contrat livré', () => {
    const verdict = signingTransitionVerdict({
      candidate: { promises: ['MaMA THERA FINANCE'], fingerprint: fingerprintOf(REAL_SIGNED('MaMA THERA FINANCE')) },
      field: { promises: [null, ['Mama Thera Finance (test)']], evidence: 'poste' },
    });
    assert.equal(verdict.ok, true);
    assert.equal(verdict.frozen.length, 1);
    assert.match(verdict.notes.join(' '), /repair:frozen-updater/);
  });

  it('un parc dont TOUS les contrats sont gelés reste une PREMIÈRE signature', () => {
    // Ce que promet le parc est insatisfiable par un certificat publiable : il n'y
    // a donc aucune continuité à préserver. Lire ça comme « l'engagement existe
    // déjà » ferait passer la première signature réelle pour un renouvellement,
    // et cacherait l'engagement qu'elle vient de graver.
    const verdict = signingTransitionVerdict({
      candidate: { promises: ['MaMA THERA FINANCE'], fingerprint: fingerprintOf(REAL_SIGNED('MaMA THERA FINANCE')) },
      field: { promises: [['Mama Thera Finance (test)']], evidence: 'poste' },
    });
    assert.equal(verdict.ok, true);
    assert.equal(verdict.cause, TRANSITION.FIRST_COMMITMENT);
    assert.deepEqual(verdict.commitment, ['MaMA THERA FINANCE']);
    assert.equal(verdict.frozen.length, 1);
  });
});

describe('le nom promis a changé : le parc ne suivra pas un renommage', () => {
  it('REFUSE quand le CN livré n’est plus celui gravé chez les postes', () => {
    const verdict = signingTransitionVerdict({
      candidate: { promises: ['MaMA THERA FINANCE SARL'], fingerprint: fingerprintOf(REAL_SIGNED('MaMA THERA FINANCE SARL')) },
      field: { promises: [['MaMA THERA FINANCE']], evidence: 'poste' },
    });
    assert.equal(verdict.ok, false);
    assert.equal(verdict.cause, TRANSITION.PROMISE_CHANGED);
    assert.match(verdict.problems.join(' '), /sera comparé à l’ANCIEN nom/);
    assert.match(verdict.problems.join(' '), /garder le même CN/);
  });

  it('accepte le MÊME nom, à la casse et aux espaces près — le CN se compare, il ne se recopie pas', () => {
    const verdict = signingTransitionVerdict({
      candidate: { promises: ['  mama thera finance '], fingerprint: fingerprintOf(REAL_SIGNED('mama thera finance')) },
      field: { promises: [['MaMA THERA FINANCE']], evidence: 'poste' },
    });
    assert.equal(verdict.ok, true);
    assert.equal(verdict.cause, TRANSITION.SAME_COMMITMENT);
    assert.match(verdict.conclusion, /déjà gravé/);
  });

  it('accepte une promesse plus LARGE : un ancien nom satisfait reste satisfait', () => {
    const verdict = signingTransitionVerdict({
      candidate: { promises: ['MaMA THERA FINANCE', 'MaMA THERA FINANCE SARL'], fingerprint: null },
      field: { promises: [['MaMA THERA FINANCE']], evidence: 'poste' },
    });
    assert.equal(verdict.ok, true);
    assert.equal(verdict.cause, TRANSITION.SAME_COMMITMENT);
  });

  it('un parc MIXTE (gelés + libres) reste jugé sur ceux qui promettent', () => {
    const verdict = signingTransitionVerdict({
      candidate: { promises: null, fingerprint: fingerprintOf(UNSIGNED) },
      field: { promises: [null, ['Mama Thera Finance (test)']], evidence: 'poste' },
    });
    assert.equal(verdict.ok, false);
    assert.equal(verdict.cause, TRANSITION.UNSIGNED_AFTER_COMMITMENT);
    assert.match(verdict.problems.join(' '), /Mama Thera Finance \(test\)/);
  });
});

describe('une répétition le dit au lieu de laisser croire qu’elle a mesuré', () => {
  it('nomme `--publisher=` comme une simulation, dont la signature n’est pas mesurée', () => {
    const verdict = signingTransitionVerdict({
      candidate: { promises: ['MaMA THERA FINANCE'], fingerprint: null, simulated: true },
      field: { promises: [null], evidence: 'poste' },
    });
    assert.equal(verdict.ok, true);
    assert.equal(verdict.cause, TRANSITION.FIRST_COMMITMENT);
    assert.match(verdict.notes.join(' '), /SIGNATURE des octets n’est pas mesurée/);
    assert.match(verdict.notes.join(' '), /check:updater-trust/);
  });
});

describe('chaque cause porte son remède, et aucune ne reste muette', () => {
  it('toutes les causes ont un texte', () => {
    for (const cause of Object.values(TRANSITION)) {
      assert.equal(typeof TRANSITION_DETAIL[cause], 'string', cause);
      assert.ok(TRANSITION_DETAIL[cause].length > 30, cause);
    }
  });
});
