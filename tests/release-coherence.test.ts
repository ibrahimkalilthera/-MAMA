// Suite for the update-feed coherence gate (scripts/lib/release-coherence.mjs +
// scripts/check-release-coherence.mjs).
//
// WHY THIS EXISTS
// ---------------
// Un poste se met à jour sur une PROMESSE D'OCTETS : `latest.yml` annonce une
// taille et un sha512, et `electron-updater` refuse tout ce qui n'y répond pas.
// Le dépôt a payé trois fois le fait de ne pas vérifier cette promesse :
//
//   • 1.0.1 publiée sans release existant — un flux vide, donc tout le monde à
//     jour de rien (canal muet, mécanisme vert) ;
//   • `electron-builder --publish always` créant DEUX brouillons pour le même
//     tag (une passe par cible) : l'un portait latest.yml, l'autre le blockmap,
//     et un brouillon n'est lu par aucun poste ;
//   • un installeur reconstruit sous un numéro déjà publié — une republication
//     n'atteint AUCUN poste, puisqu'un même numéro ne se voit pas changer.
//
// Ces cas protègent les trois, séparément, parce qu'ils se réparent
// différemment : ce qui doit être incohérent est refusé, et ce qui doit passer
// (un correctif récent, un dossier qui accumule d'anciens installeurs) passe.
import { strict as assert } from 'node:assert';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

import {
  assetsToPublish,
  compareLatest,
  compareRelease,
  nameCarriesVersion,
  parseLatestYml,
  publishDecision,
  releaseTag,
} from '../scripts/lib/release-coherence.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel: string) => readFileSync(join(root, rel), 'utf8');
const hash = (text: string) => createHash('sha512').update(Buffer.from(text)).digest('base64');

/** Un latest.yml tel qu'electron-builder l'écrit, pour une version donnée. */
function latestYml(
  { version = '1.0.4', file = null, size = 100, sha = null, extra = '' }:
  { version?: string, file?: string | null, size?: number, sha?: string | null, extra?: string } = {},
) {
  const name = file ?? `MamaTheraFinance-${version}-setup.exe`;
  const digest = sha ?? hash(`octets:${version}`);
  return [
    `version: ${version}`,
    'files:',
    `  - url: ${name}`,
    `    sha512: ${digest}`,
    `    size: ${size}`,
    `path: ${name}`,
    `sha512: ${digest}`,
    `releaseDate: '2026-09-12T10:00:00.000Z'`,
    extra,
    '',
  ].join('\n');
}

const PACKAGE = '1.0.4';
const FILE = `MamaTheraFinance-${PACKAGE}-setup.exe`;

/** Les faits d'un dossier `release/` cohérent, prêts à faire varier. */
function coherentDir() {
  const sha = hash('octets:1.0.4');
  return {
    latestText: latestYml({ version: PACKAGE, sha, size: 100 }),
    assets: new Map([[FILE, { size: 100, sha512: sha }]]),
    dirNames: ['latest.yml', FILE, `${FILE}.blockmap`, `MamaTheraFinance-${PACKAGE}-portable.exe`],
  };
}

describe('lire le flux de mise à jour', () => {
  it('extrait la version, la liste des fichiers et le path', () => {
    const parsed = parseLatestYml(latestYml({ version: '1.0.4' }));
    assert.equal(parsed?.version, '1.0.4');
    assert.equal(parsed?.path, FILE);
    assert.equal(parsed?.files.length, 1);
    assert.equal(parsed?.files[0].size, 100);
    assert.equal(parsed?.sha512, parsed?.files[0].sha512, 'les deux empreintes du yml sont lues');
  });

  it('un flux sans version ou sans path est illisible, pas « vide mais acceptable »', () => {
    assert.equal(parseLatestYml('files: []'), null);
    assert.equal(parseLatestYml('version: 1.0.4'), null);
    assert.equal(parseLatestYml(''), null);
    assert.equal(parseLatestYml('version: 1.0.4\nfiles:\n  - sha512: x\npath: a.exe')?.files.length, 0, 'un fichier sans url n’est pas un fichier');
  });

  it('le nom d’artefact doit porter la version annoncée', () => {
    assert.equal(nameCarriesVersion('MamaTheraFinance-1.0.4-setup.exe', '1.0.4'), true);
    assert.equal(nameCarriesVersion('MamaTheraFinance-1.0.3-setup.exe', '1.0.4'), false);
    assert.equal(nameCarriesVersion('MamaTheraFinance-1.0.40-setup.exe', '1.0.4'), false, 'pas de préfixe qui se prend pour une version');
  });
});

describe('le dossier local contre le paquet et ses octets', () => {
  it('cohérent : le flux, le paquet et les octets disent la même chose', () => {
    const dir = coherentDir();
    const verdict = compareLatest({ latestText: dir.latestText, packageVersion: PACKAGE, assets: dir.assets, dirNames: dir.dirNames });
    assert.equal(verdict.ok, true);
    assert.deepEqual(verdict.problems, []);
    assert.deepEqual(verdict.warnings, []);
  });

  it('refuse une version annoncée qui n’est pas celle du paquet', () => {
    const dir = coherentDir();
    const verdict = compareLatest({
      latestText: latestYml({ version: '1.0.3', file: 'MamaTheraFinance-1.0.3-setup.exe', sha: hash('octets:1.0.4') }),
      packageVersion: PACKAGE,
      assets: new Map([[`MamaTheraFinance-1.0.3-setup.exe`, { size: 100, sha512: hash('octets:1.0.4') }]]),
      dirNames: dir.dirNames,
    });
    assert.equal(verdict.ok, false);
    assert.match(verdict.problems[0], /latest\.yml annonce 1\.0\.3, package\.json déclare 1\.0\.4/);
  });

  it('refuse des octets qui ne répondent pas au sha512 promis — et le dit en clair', () => {
    const dir = coherentDir();
    const verdict = compareLatest({
      latestText: dir.latestText,
      packageVersion: PACKAGE,
      assets: new Map([[FILE, { size: 100, sha512: hash('un autre binaire') }]]),
      dirNames: dir.dirNames,
    });
    assert.equal(verdict.ok, false);
    assert.match(verdict.problems.join('\n'), /sha512 incohérent pour « MamaTheraFinance-1\.0\.4-setup\.exe »/);
  });

  it('refuse une taille qui ment et un installeur annoncé mais absent', () => {
    const dir = coherentDir();
    const wrongSize = compareLatest({
      latestText: dir.latestText,
      packageVersion: PACKAGE,
      assets: new Map([[FILE, { size: 99, sha512: hash('octets:1.0.4') }]]),
      dirNames: dir.dirNames,
    });
    assert.match(wrongSize.problems.join('\n'), /taille incohérente .*annonce 100 octet\(s\), le fichier en fait 99/);

    const missing = compareLatest({ latestText: dir.latestText, packageVersion: PACKAGE, assets: new Map(), dirNames: dir.dirNames });
    assert.match(missing.problems.join('\n'), /artefact manquant/);
  });

  it('refuse un blockmap absent : le poste retéléchargerait tout', () => {
    const dir = coherentDir();
    const verdict = compareLatest({
      latestText: dir.latestText,
      packageVersion: PACKAGE,
      assets: dir.assets,
      dirNames: ['latest.yml', FILE],
    });
    assert.equal(verdict.ok, false);
    assert.match(verdict.problems.join('\n'), /blockmap manquant/);
  });

  it('refuse un `path` qui n’est pas dans `files` — sinon on ne sait pas ce qu’on a haché', () => {
    const sha = hash('octets:1.0.4');
    const text = [
      `version: ${PACKAGE}`,
      'files:',
      `  - url: MamaTheraFinance-${PACKAGE}-portable.exe`,
      `    sha512: ${sha}`,
      `    size: 100`,
      `path: ${FILE}`,
      `sha512: ${sha}`,
    ].join('\n');
    const verdict = compareLatest({ latestText: text, packageVersion: PACKAGE, assets: new Map(), dirNames: [] });
    assert.match(verdict.problems.join('\n'), /n'est pas dans `files`/);
  });

  it('les installeurs d’AUTRES versions ne sont pas une erreur, mais ils sont nommés', () => {
    const dir = coherentDir();
    const verdict = compareLatest({
      latestText: dir.latestText,
      packageVersion: PACKAGE,
      assets: dir.assets,
      dirNames: [...dir.dirNames, 'MamaTheraFinance-1.0.3-setup.exe', 'MamaTheraFinance-1.0.2-portable.exe'],
    });
    assert.equal(verdict.ok, true, 'release/ accumule : ce n’est pas une incohérence');
    assert.equal(verdict.warnings.length, 1);
    assert.match(verdict.warnings[0], /1\.0\.3-setup\.exe.*1\.0\.2-portable\.exe/);
    assert.match(verdict.warnings[0], /ne les publiez pas/);
  });

  it('un latest.yml illisible est un refus, jamais un vert par défaut', () => {
    const verdict = compareLatest({ latestText: 'n’importe quoi', packageVersion: PACKAGE });
    assert.equal(verdict.ok, false);
    assert.match(verdict.problems[0], /illisible/);
  });
});

describe('ce qui doit partir dans le release', () => {
  it('latest.yml, l’installeur annoncé, son blockmap et le portable', () => {
    const dir = coherentDir();
    const latest = parseLatestYml(dir.latestText);
    assert.deepEqual(assetsToPublish({ latest, dirNames: dir.dirNames }), [
      'latest.yml',
      FILE,
      `${FILE}.blockmap`,
      `MamaTheraFinance-${PACKAGE}-portable.exe`,
    ]);
  });

  it('un portable d’une AUTRE version n’est pas proposé à la publication', () => {
    const dir = coherentDir();
    const latest = parseLatestYml(dir.latestText);
    const names = [...dir.dirNames, 'MamaTheraFinance-1.0.3-portable.exe'];
    assert.equal(assetsToPublish({ latest, dirNames: names }).includes('MamaTheraFinance-1.0.3-portable.exe'), false);
  });

  it('sans flux lisible, rien n’est publié', () => {
    assert.deepEqual(assetsToPublish({ latest: null }), []);
  });
});

describe('le release distant', () => {
  const local = coherentDir();

  it('un release qui contient tout, brouillon, et téléversé tel quel : autorisé', () => {
    const verdict = compareRelease({
      mode: 'draft',
      version: PACKAGE,
      expected: ['latest.yml', FILE, `${FILE}.blockmap`],
      localLatestText: local.latestText,
      remote: {
        count: 1,
        isDraft: true,
        tag: releaseTag(PACKAGE),
        assets: [{ name: 'latest.yml' }, { name: FILE }, { name: `${FILE}.blockmap` }],
        latestText: local.latestText,
        announced: parseLatestYml(local.latestText),
        installer: { name: FILE, size: 100, sha512: hash('octets:1.0.4') },
      },
    });
    assert.deepEqual(verdict.problems, []);
    assert.equal(verdict.ok, true);
  });

  it('DEUX releases pour le même tag : refusé (les artefacts sont éparpillés)', () => {
    const verdict = compareRelease({
      mode: 'draft',
      version: PACKAGE,
      expected: ['latest.yml', FILE],
      localLatestText: local.latestText,
      remote: {
        count: 2,
        isDraft: true,
        tag: releaseTag(PACKAGE),
        assets: [{ name: 'latest.yml' }],
        latestText: local.latestText,
        announced: parseLatestYml(local.latestText),
        installer: null,
      },
    });
    assert.equal(verdict.ok, false);
    assert.match(verdict.problems[0], /2 releases portent le tag « v1\.0\.4 »/);
    assert.match(verdict.problems[0], /répartis/);
  });

  it('un brouillon ne livre RIEN : la promotion est le seul geste qui rend visible', () => {
    const live = compareRelease({
      mode: 'live',
      version: PACKAGE,
      expected: ['latest.yml'],
      remote: { count: 1, isDraft: true, tag: releaseTag(PACKAGE), assets: [{ name: 'latest.yml' }], latestText: local.latestText },
    });
    assert.equal(live.ok, false);
    assert.match(live.problems[0], /BROUILLON : aucun poste ne le voit/);

    // Et inversement : promouvoir une fois qu'un poste peut déjà le lire est
    // précisément la vérification qui arrive trop tard.
    const late = compareRelease({
      mode: 'draft',
      version: PACKAGE,
      expected: ['latest.yml'],
      remote: { count: 1, isDraft: false, tag: releaseTag(PACKAGE), assets: [{ name: 'latest.yml' }], latestText: local.latestText },
    });
    assert.equal(late.ok, false);
    assert.match(late.problems[0], /DÉJÀ publié/);
  });

  it('des octets publiés qui ne répondent pas à la promesse : refusé', () => {
    const verdict = compareRelease({
      mode: 'live',
      version: PACKAGE,
      expected: ['latest.yml', FILE],
      remote: {
        count: 1,
        isDraft: false,
        tag: releaseTag(PACKAGE),
        assets: [{ name: 'latest.yml' }, { name: FILE }],
        latestText: local.latestText,
        announced: parseLatestYml(local.latestText),
        installer: { name: FILE, size: 99, sha512: hash('un tout autre binaire') },
      },
    });
    assert.equal(verdict.ok, false);
    assert.match(verdict.problems.join('\n'), /les octets PUBLIÉS ne sont pas ceux annoncés/);
  });

  it('un installeur annoncé mais introuvable parmi les artefacts : refusé (rien à prouver)', () => {
    const verdict = compareRelease({
      mode: 'live',
      version: PACKAGE,
      expected: ['latest.yml'],
      remote: {
        count: 1,
        isDraft: false,
        tag: releaseTag(PACKAGE),
        assets: [{ name: 'latest.yml' }],
        latestText: local.latestText,
        announced: parseLatestYml(local.latestText),
        installer: null,
      },
    });
    assert.equal(verdict.ok, false);
    assert.match(verdict.problems.join('\n'), /introuvable parmi les artefacts/);
  });

  it('un installeur d’une AUTRE version dans le release : refusé', () => {
    const verdict = compareRelease({
      mode: 'live',
      version: PACKAGE,
      expected: ['latest.yml'],
      remote: {
        count: 1,
        isDraft: false,
        tag: releaseTag(PACKAGE),
        assets: [{ name: 'latest.yml' }, { name: 'MamaTheraFinance-1.0.3-setup.exe', size: 10 }],
        latestText: local.latestText,
        announced: parseLatestYml(local.latestText),
        installer: { name: FILE, size: 100, sha512: hash('octets:1.0.4') },
      },
    });
    assert.equal(verdict.ok, false);
    assert.match(verdict.problems.join('\n'), /installeurs d'une autre version/);
  });

  it('aucun release : le canal est muet, ce n’est pas un détail', () => {
    const verdict = compareRelease({ mode: 'live', version: PACKAGE, expected: ['latest.yml'], remote: { count: 0 } });
    assert.equal(verdict.ok, false);
    assert.match(verdict.problems[0], /aucun release « v1\.0\.4 »/);

    const absent = compareRelease({ mode: 'live', version: PACKAGE, expected: ['latest.yml'], remote: null });
    assert.equal(absent.ok, false);
  });

  it('le latest.yml du brouillon doit être CELUI du dossier, octet pour octet', () => {
    const verdict = compareRelease({
      mode: 'draft',
      version: PACKAGE,
      expected: ['latest.yml'],
      localLatestText: local.latestText,
      remote: {
        count: 1,
        isDraft: true,
        tag: releaseTag(PACKAGE),
        assets: [{ name: 'latest.yml' }],
        latestText: latestYml({ version: PACKAGE, sha: hash('octets:1.0.4'), size: 100, file: FILE }) + '\n# retouché\n',
        announced: parseLatestYml(local.latestText),
        installer: { name: FILE, size: 100, sha512: hash('octets:1.0.4') },
      },
    });
    assert.equal(verdict.ok, false);
    assert.match(verdict.problems.join('\n'), /pas celui du dossier local/);
  });

  it('un tag qui ne correspond pas à la version est refusé', () => {
    const verdict = compareRelease({
      mode: 'live',
      version: PACKAGE,
      expected: ['latest.yml'],
      remote: { count: 1, isDraft: false, tag: 'v1.0.3', assets: [{ name: 'latest.yml' }], latestText: local.latestText },
    });
    assert.equal(verdict.ok, false);
    assert.match(verdict.problems.join('\n'), /tag incohérent/);
  });
});

describe('publier un numéro déjà publié', () => {
  it('refuse un tag existant — un même numéro ne peut pas changer de contenu', () => {
    const decision = publishDecision({ version: PACKAGE, existingTag: true });
    assert.equal(decision.publish, false);
    assert.match(decision.reason, /le tag v1\.0\.4 existe déjà/);
    assert.match(decision.reason, /Montez la version/);
  });

  it('refuse un flux incohérent, même si le numéro est inédit', () => {
    const decision = publishDecision({ version: PACKAGE, existingTag: false, latestOk: false, problems: ['sha512 incohérent'] });
    assert.equal(decision.publish, false);
    assert.match(decision.reason, /flux incohérent — sha512 incohérent/);
  });

  it('autorise un numéro inédit au flux cohérent', () => {
    assert.equal(publishDecision({ version: PACKAGE }).publish, true);
  });
});

describe('le câblage du contrôle', () => {
  it('la publication passe par le gate, pas à côté', () => {
    const pkg = JSON.parse(read('package.json'));
    assert.match(pkg.scripts['electron:release'], /npm run check:release &&.*--publish always &&.*check:release:draft/, 'le gate local précède la publication, celui du brouillon la suit');
    assert.match(pkg.scripts['electron:dist'], /npm run electron:build && npm run check:release/, 'un build local refuse aussi un flux incohérent');
    assert.equal(pkg.scripts['check:release:tag'], 'node scripts/check-release-coherence.mjs --tag');
    assert.equal(pkg.scripts['check:release:live'], 'node scripts/check-release-coherence.mjs --live');
  });

  it('le workflow refuse de promouvoir avant que le brouillon soit vérifié', () => {
    const workflow = read('.github/workflows/desktop-release.yml');
    const tag = workflow.indexOf('npm run check:release:tag');
    const publish = workflow.indexOf('npm run electron:release');
    const promote = workflow.indexOf('--draft=false');
    const live = workflow.indexOf('npm run check:release:live');
    assert.ok(tag > 0 && publish > tag, 'le tag est vérifié AVANT le téléversement');
    assert.ok(promote > publish, 'la promotion est un pas à part, après la publication en brouillon');
    assert.ok(live > promote, 'et le flux publié est vérifié après la promotion');
    assert.match(workflow, /c'est le\s*\n?\s*#?\s*contrôle qui sert de passeport, pas de conseil/, 'la raison du pas séparé est dite dans le workflow');
  });

  it('le gate s’exécute sans jeton et sans réseau en mode local', () => {
    const source = read('scripts/check-release-coherence.mjs');
    assert.match(source, /if \(MODE === 'local'\)[\s\S]*process\.exit\(0\)/, 'le mode local rend son verdict avant tout appel réseau');
    assert.match(source, /un dépôt qu'on ne peut pas interroger n'est pas un feu vert/, 'une panne de l’API est un échec, jamais un vert');
  });
});
