// Suite for scripts/lib/updater-trust.mjs (+ the CLI's refusal to conclude).
//
// WHY THIS EXISTS
// ---------------
// Ce module décide si un parc pourra encaisser sa PROCHAINE mise à jour. Il a
// été écrit après avoir mesuré, sur l'installeur publié le 2026-09-13, un
// `app-update.yml` promettant « Mama Thera Finance (test) » et une chaîne de
// certificats non approuvée — donc un parc qui refusait à jamais toutes les
// versions suivantes, sous un workflow vert.
//
// Le `app-update.yml` et la sortie PowerShell reproduits ici sont ceux MESURÉS :
// c'est leur forme qui compte, pas une forme inventée par le test.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { basename } from 'node:path';
import { describe, it } from 'node:test';

import {
  looksLikeTestSigner,
  parsePublisherNames,
  subjectMatchesPublisher,
  updaterTrustVerdict,
} from '../scripts/lib/updater-trust.mjs';

/** Le contrat EMBARQUÉ dans l'installeur publié, mot pour mot. */
const PUBLISHED_CONTRACT = [
  'owner: ibrahimkalilthera',
  "repo: '-MAMA'",
  'provider: github',
  'updaterCacheDirName: mama-thera-finance-updater',
  'publisherName:',
  '  - Mama Thera Finance (test)',
].join('\n');

/** La sortie de `Get-AuthenticodeSignature` sur cet installeur, mesurée. */
const UNTRUSTED_ROOT = {
  status: 'UnknownError',
  subject: 'CN=Mama Thera Finance (test), O=Complexe Scolaire Mama Thera, C=ML',
  statusMessage:
    "Une chaîne de certificats a été traitée mais s'est terminée par un certificat racine qui n'est pas approuvé par le fournisseur d'approbation",
};

describe('lire la promesse de signataire d’un app-update.yml', () => {
  it('lit la forme en bloc écrite par electron-builder', () => {
    assert.deepEqual(parsePublisherNames(PUBLISHED_CONTRACT), {
      promised: true,
      names: ['Mama Thera Finance (test)'],
    });
  });

  it('lit la forme en ligne', () => {
    assert.deepEqual(parsePublisherNames('publisherName: Mama Thera Finance\n'), {
      promised: true,
      names: ['Mama Thera Finance'],
    });
  });

  it('distingue « la clé est absente » de « la promesse est vide »', () => {
    // Deux états opposés : absent = le poste n'exigera rien ; vide = le poste
    // n'acceptera jamais rien. Les confondre rendrait un parc figé illisible.
    assert.deepEqual(parsePublisherNames('owner: ibrahimkalilthera\n'), { promised: false, names: [] });
    assert.deepEqual(parsePublisherNames('publisherName:\n'), { promised: true, names: [] });
  });

  it('retire les guillemets et les commentaires', () => {
    assert.deepEqual(parsePublisherNames("publisherName:\n  - 'Mama Thera Finance'  # le vrai\n"), {
      promised: true,
      names: ['Mama Thera Finance'],
    });
  });

  it('s’arrête au premier bloc et n’avale pas les clés suivantes', () => {
    const text = 'publisherName:\n  - Mama Thera\nprovider: github\n  - pas-une-entree\n';
    assert.deepEqual(parsePublisherNames(text).names, ['Mama Thera']);
  });
});

describe('le sujet porte-t-il le nom promis', () => {
  it('accepte un simple CN dans un DN complet', () => {
    assert.equal(subjectMatchesPublisher(UNTRUSTED_ROOT.subject, 'Mama Thera Finance (test)'), true);
  });

  it('compare champ par champ quand la promesse est un DN complet', () => {
    const subject = 'CN=Mama Thera Finance, O=Complexe Scolaire Mama Thera, C=ML';
    assert.equal(subjectMatchesPublisher(subject, 'CN=Mama Thera Finance, O=Complexe Scolaire Mama Thera'), true);
    assert.equal(subjectMatchesPublisher(subject, 'CN=Mama Thera Finance, O=Autre Ecole'), false);
  });

  it('refuse un nom vide plutôt que d’accepter n’importe quel certificat', () => {
    assert.equal(subjectMatchesPublisher(UNTRUSTED_ROOT.subject, ''), false);
  });
});

describe('verdict : le parc pourra-t-il recevoir la version suivante', () => {
  it('aucune promesse + octets non signés = viable, et le prix est NOMMÉ', () => {
    const v = updaterTrustVerdict({ publisherNames: null, signature: { status: 'NotSigned', subject: null } });
    assert.equal(v.ok, true);
    assert.equal(v.problems.length, 0);
    assert.match(v.notes.join(' '), /éditeur inconnu/);
  });

  it('aucune promesse + octets signés = viable, mais la signature ne sert qu’à SmartScreen', () => {
    const v = updaterTrustVerdict({
      publisherNames: null,
      signature: { status: 'Valid', subject: 'CN=Mama Thera Finance, O=Complexe Scolaire Mama Thera, C=ML' },
    });
    assert.equal(v.ok, true);
    assert.match(v.notes.join(' '), /SmartScreen/);
  });

  it('une liste VIDE est refusée : aucune liste vide n’est satisfiable', () => {
    const v = updaterTrustVerdict({ publisherNames: [], signature: { status: 'Valid', subject: 'CN=Peu importe' } });
    assert.equal(v.ok, false);
    assert.match(v.problems.join(' '), /liste vide/i);
  });

  it('le signataire de TEST mesuré est refusé même si Windows le dit « Valid »', () => {
    // C'est le cœur du défaut : sur la machine qui a créé le certificat, la
    // chaîne peut être approuvée — et nulle part ailleurs. Un vert local y
    // aurait envoyé un parc entier dans le mur.
    const v = updaterTrustVerdict({
      publisherNames: parsePublisherNames(PUBLISHED_CONTRACT).names,
      signature: { ...UNTRUSTED_ROOT, status: 'Valid' },
    });
    assert.equal(v.ok, false);
    assert.match(v.problems.join(' '), /signataire de TEST/);
  });

  it('la chaîne non approuvée MESURÉE est refusée, avec son statut réel', () => {
    const v = updaterTrustVerdict({
      publisherNames: parsePublisherNames(PUBLISHED_CONTRACT).names,
      signature: UNTRUSTED_ROOT,
    });
    assert.equal(v.ok, false);
    assert.match(v.problems.join(' '), /UnknownError/);
    assert.match(v.problems.join(' '), /refusera cette mise à jour/);
  });

  it('une promesse sans aucune signature est refusée', () => {
    const v = updaterTrustVerdict({
      publisherNames: ['Mama Thera Finance'],
      signature: { status: 'NotSigned', subject: null },
    });
    assert.equal(v.ok, false);
    assert.match(v.problems.join(' '), /AUCUNE signature/);
  });

  it('une promesse sans signature lisible est refusée — non mesuré n’est pas vérifié', () => {
    const v = updaterTrustVerdict({ publisherNames: ['Mama Thera Finance'], signature: null });
    assert.equal(v.ok, false);
    assert.match(v.problems.join(' '), /n’est pas vérifiée/);
  });

  it('un sujet qui ne porte pas le nom promis est refusé, comme le poste le fera', () => {
    const v = updaterTrustVerdict({
      publisherNames: ['Mama Thera Finance'],
      signature: { status: 'Valid', subject: 'CN=Une Autre Societe, O=X, C=ML' },
    });
    assert.equal(v.ok, false);
    assert.match(v.problems.join(' '), /ne porte pas le nom promis/);
  });

  it('une signature approuvée qui porte le nom promis est le seul vrai vert', () => {
    const v = updaterTrustVerdict({
      publisherNames: ['Mama Thera Finance'],
      signature: { status: 'Valid', subject: 'CN=Mama Thera Finance, O=Complexe Scolaire Mama Thera, C=ML' },
    });
    assert.equal(v.ok, true);
    assert.match(v.notes.join(' '), /signature approuvée/);
  });
});

describe('les jetons de test ne débordent pas sur les vrais noms', () => {
  it('reconnaît les formes mesurées ou plausibles', () => {
    for (const name of ['Mama Thera Finance (test)', 'Mama Thera TEST', 'dev-signed', 'Mama Thera Demo']) {
      assert.equal(looksLikeTestSigner(name), true, name);
    }
  });

  it('ne condamne pas un nom qui contient ces lettres par hasard', () => {
    // « Contest » et « Devon » contiennent les jetons sans les porter : refuser
    // ces noms bloquerait de vraies écoles, donc le jeton se cherche en MOT.
    for (const name of ['Contest School', 'Devon Academy', 'Mama Thera Finance', 'Complexe Scolaire Mama Thera']) {
      assert.equal(looksLikeTestSigner(name), false, name);
    }
  });
});

describe('le CLI refuse de conclure plutôt que de rendre un vert non mesuré', () => {
  it('sans binaire construit (ou hors Windows), la sortie n’est jamais 0', () => {
    // Le dossier est FABRIQUÉ pour ce cas, jamais emprunté à `release/`. Depuis
    // qu'une publication laisse un build dans `release/` — le cas normal d'un
    // poste qui vient de livrer — ce cas mesurait le VRAI binaire et passait au
    // vert en n'éprouvant plus rien : exactement le faux vert que ce contrôle
    // existe pour refuser, cette fois dans sa propre suite.
    const dir = mkdtempSync('.probe-updater-trust-');
    let code = 0;
    let stderr = '';
    try {
      execFileSync(process.execPath, ['scripts/check-updater-trust.mjs', `--dir=${basename(dir)}`], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (error) {
      const failure = error as { status?: number; stderr?: string };
      code = failure.status ?? 1;
      stderr = String(failure.stderr ?? '');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
    assert.notEqual(code, 0, 'un contrôle qui ne peut pas mesurer ne doit pas sortir en 0');
    assert.match(stderr, /non mesurable|rien à juger|rien de vérifié/);
  });
});
