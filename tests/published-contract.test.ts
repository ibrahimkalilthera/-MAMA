// Suite for scripts/lib/published-contract.mjs (+ the off-Windows refusal of
// scripts/lib/windows-signature.mjs).
//
// WHY THIS EXISTS
// ---------------
// Ce module décide si le contrat de mise à jour EMBARQUÉ dans les octets publiés
// du canal est bien celui que le build a scellé. Il a été écrit après avoir
// mesuré, sur la 1.0.18 publiée, que le fichier extrait faisait 104 octets et
// portait le sha256 que le manifeste d'arborescence publie — et la même mesure,
// faite à la main sur la 1.0.8, dit l'inverse : le contrat promettait
// « Mama Thera Finance (test) », donc un parc gelé.
//
// Les formes reproduites ici sont celles MESURÉES : la sortie `7z l -slt` d'un
// installeur NSIS, celle de sa charge utile, et les 104 octets exacts du contrat
// publié dans la 1.0.18. C'est leur forme qui compte, pas une forme inventée.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { describe, it } from 'node:test';

import {
  CONTRACT_IN_APP,
  archivePaths,
  compareContractBytes,
  compareInstallerBytes,
  contractEntryFromManifest,
  contractFromArchiveListing,
  manifestDigestVerdict,
  normaliseEntryPath,
  payloadArchiveFromListing,
} from '../scripts/lib/published-contract.mjs';
import { SIGNATURE_CMDLET, signatureMeasurementRefusal } from '../scripts/lib/windows-signature.mjs';

/** Le contrat publié dans la 1.0.18, octet pour octet (104 octets, LF). */
const CONTRACT_1_0_18 = [
  'owner: ibrahimkalilthera',
  "repo: '-MAMA'",
  'provider: github',
  'updaterCacheDirName: mama-thera-finance-updater',
  '',
].join('\n');
const CONTRACT_1_0_18_SHA256 = 'b9cefbcaa012c8060a578790658118690ca7cd7f48361cd9fe6c664628df4674';

/** La forme `-slt` que 7-Zip rend sur un installeur NSIS d'electron-builder. */
const INSTALLER_LISTING = [
  'Path = MamaTheraFinance-1.0.18-setup.exe',
  'Type = Nsis',
  'Physical Size = 129051043',
  '----------',
  'Path = $PLUGINSDIR\\app-64.7z',
  'Size = 10414247',
  '----------',
  'Path = $PLUGINSDIR\\nsExec.dll',
  'Size = 22784',
  '',
].join('\n');

/** La forme `-slt` de la charge utile : c'est là que le contrat vit. */
const PAYLOAD_LISTING = [
  'Path = app-64.7z',
  'Type = 7z',
  '----------',
  'Path = resources\\app-update.yml',
  'Size = 104',
  '----------',
  'Path = MamaTheraFinance.exe',
  'Size = 188923904',
  '',
].join('\n');

const manifest = {
  dir: 'win-unpacked',
  bytes: 531000000,
  files: [
    { path: 'resources\\app-update.yml', size: 104, sha256: CONTRACT_1_0_18_SHA256 },
    { path: 'MamaTheraFinance.exe', size: 188923904, sha256: 'a'.repeat(64) },
  ],
};

const entry = contractEntryFromManifest(manifest);

describe('le chemin du contrat se compare comme un chemin, pas comme une chaîne', () => {
  it('normalise les séparateurs, donc `resources\\app-update.yml` et sa forme POSIX sont le même fichier', () => {
    assert.equal(normaliseEntryPath('resources\\app-update.yml'), CONTRACT_IN_APP);
    assert.equal(normaliseEntryPath('resources/app-update.yml'), CONTRACT_IN_APP);
    assert.equal(normaliseEntryPath('$PLUGINSDIR\\app-64.7z'), '$PLUGINSDIR/app-64.7z');
  });

  it('trouve l’entrée du manifeste publié, taille et empreinte comprises', () => {
    assert.deepEqual(entry, { path: CONTRACT_IN_APP, size: 104, sha256: CONTRACT_1_0_18_SHA256 });
  });

  it('refuse l’absence d’entrée au lieu de rendre un objet vide', () => {
    assert.equal(contractEntryFromManifest({ files: [{ path: 'resources/other.yml' }] }), null);
    assert.equal(contractEntryFromManifest(null), null);
  });
});

describe('la référence publiée doit être scellée par le canal', () => {
  it('accepte un manifeste dont les octets répondent à l’empreinte annoncée', () => {
    const digest = `sha256:${CONTRACT_1_0_18_SHA256}`;
    const verdict = manifestDigestVerdict({ assetDigest: digest, text: CONTRACT_1_0_18 });
    assert.equal(verdict.ok, true);
    assert.equal(verdict.digest, CONTRACT_1_0_18_SHA256);
    assert.deepEqual(verdict.problems, []);
  });

  it('refuse un manifeste que le canal sert dans une autre version que celle annoncée', () => {
    const verdict = manifestDigestVerdict({ assetDigest: `sha256:${'0'.repeat(64)}`, text: CONTRACT_1_0_18 });
    assert.equal(verdict.ok, false);
    assert.match(verdict.problems[0], /ne répond pas à l’empreinte que le canal annonce/);
  });

  it('NOMME l’actif sans empreinte au lieu de le faire passer pour scellé', () => {
    const verdict = manifestDigestVerdict({ assetDigest: null, text: CONTRACT_1_0_18 });
    assert.equal(verdict.ok, true);
    assert.match(verdict.warnings[0], /n’annonce aucune empreinte/);
  });
});

describe('les listes de 7-Zip se lisent par leur dernier jeton', () => {
  it('rend les chemins, séparateurs normalisés', () => {
    const paths = archivePaths(INSTALLER_LISTING);
    assert.ok(paths.includes('$PLUGINSDIR/app-64.7z'));
    assert.ok(paths.includes('$PLUGINSDIR/nsExec.dll'));
  });

  it('choisit la charge utile 64 bits, celle que le parc installe', () => {
    const verdict = payloadArchiveFromListing(INSTALLER_LISTING);
    assert.equal(verdict.ok, true);
    assert.equal(verdict.name, '$PLUGINSDIR/app-64.7z');
    assert.deepEqual(verdict.candidates, ['$PLUGINSDIR/app-64.7z']);
  });

  it('accepte la seule charge utile quand elle ne porte pas le nom 64 bits', () => {
    const verdict = payloadArchiveFromListing('Path = $PLUGINSDIR\\app-32.7z\n');
    assert.equal(verdict.ok, true);
    assert.equal(verdict.name, '$PLUGINSDIR/app-32.7z');
  });

  it('REFUSE l’ambiguïté : deux charges utiles et pas de nom 64 bits', () => {
    const verdict = payloadArchiveFromListing('Path = $PLUGINSDIR\\app-32.7z\nPath = $PLUGINSDIR\\app-arm64.7z\n');
    assert.equal(verdict.ok, false);
    assert.equal(verdict.name, null);
    assert.match(verdict.problems[0], /2 archives/);
  });

  it('REFUSE un binaire qui n’est pas un installeur NSIS', () => {
    const verdict = payloadArchiveFromListing('Path = notes.txt\nPath = readme.md\n');
    assert.equal(verdict.ok, false);
    assert.match(verdict.problems[0], /AUCUNE archive `7z`/);
  });

  it('trouve le contrat dans la charge utile, et refuse son absence', () => {
    assert.deepEqual(contractFromArchiveListing(PAYLOAD_LISTING), {
      ok: true,
      name: 'resources/app-update.yml',
      problems: [],
    });
    const refused = contractFromArchiveListing('Path = resources\\other.yml\n');
    assert.equal(refused.ok, false);
    assert.match(refused.problems[0], /ne porte pas `resources\/app-update.yml`/);
  });
});

describe('les octets téléchargés doivent répondre à la promesse du flux', () => {
  it('accepte des octets conformes à la taille et au sha512 annoncés', () => {
    const verdict = compareInstallerBytes({
      expected: { size: 129051043, sha512: 'd8qV3EfTmAReRq6eYm1cfnl/3gnBgRpwhtKUL1OCQ20UOpBIxDzChS1JtQOus8Axv+zRNo2N3hOorOSi8k6Hlw==' },
      served: { size: 129051043, sha512: 'd8qV3EfTmAReRq6eYm1cfnl/3gnBgRpwhtKUL1OCQ20UOpBIxDzChS1JtQOus8Axv+zRNo2N3hOorOSi8k6Hlw==' },
    });
    assert.equal(verdict.ok, true);
    assert.deepEqual(verdict.problems, []);
  });

  it('refuse une taille ou une empreinte qui ne sont pas celles annoncées', () => {
    const verdict = compareInstallerBytes({
      expected: { size: 129051043, sha512: 'AAAA' },
      served: { size: 129051044, sha512: 'BBBB' },
    });
    assert.equal(verdict.ok, false);
    assert.equal(verdict.problems.length, 2);
    assert.match(verdict.problems[0], /taille de l’installeur/);
    assert.match(verdict.problems[1], /sha512 de l’installeur/);
  });

  it('refuse de juger des octets illisibles — une mesure absente n’est pas un vert', () => {
    const verdict = compareInstallerBytes({ expected: { size: 1, sha512: 'x' }, served: null });
    assert.equal(verdict.ok, false);
    assert.match(verdict.problems[0], /n’ont pas pu être lus/);
  });
});

describe('le contrat extrait est confronté au manifeste publié, empreinte comprise', () => {
  it('accepte les 104 octets publiés dans la 1.0.18', () => {
    const verdict = compareContractBytes({
      entry,
      extracted: { size: 104, sha256: CONTRACT_1_0_18_SHA256 },
    });
    assert.equal(verdict.ok, true);
    assert.deepEqual(verdict.problems, []);
    assert.match(verdict.warnings[0], /est celui du build scellé/);
  });

  it('REFUSE un contrat de 149 octets (la promesse de test de la 1.0.8)', () => {
    const verdict = compareContractBytes({
      entry: { path: CONTRACT_IN_APP, size: 104, sha256: CONTRACT_1_0_18_SHA256 },
      extracted: { size: 149, sha256: 'f'.repeat(64) },
    });
    assert.equal(verdict.ok, false);
    assert.equal(verdict.problems.length, 2);
    assert.match(verdict.problems[0], /le manifeste publié en annonce 104/);
    assert.match(verdict.problems[1], /ne portent pas le contrat que le build a scellé/);
  });

  it('REFUSE une extraction vide, et une extraction sans référence scellée', () => {
    const empty = compareContractBytes({ entry, extracted: { size: 0, sha256: '' } });
    assert.equal(empty.ok, false);
    assert.match(empty.problems[0], /n’a pas pu être EXTRAIT/);
    const unreferenced = compareContractBytes({ entry: null, extracted: { size: 104, sha256: 'x' } });
    assert.equal(unreferenced.ok, false);
    assert.match(unreferenced.problems[0], /ne décrit pas le contrat embarqué/);
  });

  it('REFUSE une entrée de manifeste sans empreinte : elle ne scelle rien', () => {
    const verdict = compareContractBytes({
      entry: { path: CONTRACT_IN_APP, size: 104, sha256: '' },
      extracted: { size: 104, sha256: CONTRACT_1_0_18_SHA256 },
    });
    assert.equal(verdict.ok, false);
    assert.match(verdict.problems[0], /sans empreinte/);
  });
});

describe('hors Windows, la signature n’est pas mesurable — et le refus est LIVRÉ', () => {
  it('refuse de conclure sur une plateforme qui ne peut pas interroger le cmdlet', () => {
    const refusal = signatureMeasurementRefusal({ platform: 'linux', tests: 'tests/x.test.ts' });
    assert.equal(refusal.measurable, false);
    assert.match(refusal.title, /non mesurable hors Windows/);
    assert.match(refusal.problems[0], new RegExp(SIGNATURE_CMDLET));
    assert.match(refusal.problems.join(' '), /tests\/x\.test\.ts/);
  });

  it('ne refuse rien sur Windows : la mesure y est possible', () => {
    assert.deepEqual(signatureMeasurementRefusal({ platform: 'win32' }), {
      measurable: true,
      title: '',
      problems: [],
    });
  });

  it('le CLI refuse AVANT toute mesure — donc avant de télécharger 129 Mo', () => {
    let code = 0;
    let stdout = '';
    let stderr = '';
    try {
      stdout = execFileSync(
        process.execPath,
        ['scripts/check-published-updater-contract.mjs', '--platform=linux'],
        { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
      );
    } catch (error) {
      const failure = error as { status?: number; stdout?: string; stderr?: string };
      code = failure.status ?? 1;
      stdout = String(failure.stdout ?? '');
      stderr = String(failure.stderr ?? '');
    }
    assert.notEqual(code, 0, 'un contrôle qui ne peut pas mesurer ne doit pas sortir en 0');
    assert.match(stderr, /non mesurable hors Windows/);
    assert.doesNotMatch(`${stdout}${stderr}`, /téléchargement de/, 'le refus doit tomber avant de descendre 129 Mo');
  });
});
