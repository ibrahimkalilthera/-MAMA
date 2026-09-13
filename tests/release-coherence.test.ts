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

import { EVIDENCE_STEP_NAME } from '../scripts/lib/automation-evidence.mjs';
import {
  assetsToPublish,
  compareLatest,
  compareRelease,
  nameCarriesVersion,
  parseHoldsFile,
  parseLatestYml,
  pickLatestPublished,
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
    assert.match(pkg.scripts['electron:release'], /npm run check:release && npm run release:publish/, 'le gate local précède la publication, le brouillon est vérifié par le publieur');
    assert.match(pkg.scripts['electron:dist'], /npm run electron:build && npm run check:release/, 'un build local refuse aussi un flux incohérent');
    assert.equal(pkg.scripts['check:release:tag'], 'node scripts/check-release-coherence.mjs --tag');
    assert.equal(pkg.scripts['check:release:live'], 'node scripts/check-release-coherence.mjs --live');
  });

  it('electron-builder ne publie PLUS : c’est le publieur qui ouvre l’unique release', () => {
    const pkg = JSON.parse(read('package.json'));
    // C'est la cause du défaut, retirée à la source : tant que le build peut
    // ouvrir un release par cible, deux brouillons peuvent réapparaître, et
    // promouvoir le mauvais publie un release sans latest.yml.
    assert.doesNotMatch(pkg.scripts['electron:build'], /--publish always/, 'le build ne téléverse rien');
    assert.match(pkg.scripts['electron:build'], /--publish never/, 'et il le dit explicitement');
    assert.equal(pkg.scripts['release:publish'], 'node scripts/publish-release.mjs');
    assert.equal(pkg.scripts['release:promote'], 'node scripts/publish-release.mjs --promote');
    assert.match(read('electron-builder.yml'), /--publish never/, 'la raison est écrite là où on configure le packaging');
  });

  it('le workflow refuse de promouvoir avant que le brouillon soit vérifié', () => {
    const workflow = read('.github/workflows/desktop-release.yml');
    const tag = workflow.indexOf('npm run check:release:tag');
    const publish = workflow.indexOf('npm run electron:release');
    const promote = workflow.indexOf('npm run release:promote');
    assert.ok(tag > 0 && publish > tag, 'le tag est vérifié AVANT le téléversement');
    assert.ok(promote > publish, 'la promotion est un pas à part, après la publication en brouillon');
    // Le geste manuel (`gh release edit --draft=false`) est ce qui a permis de
    // promouvoir un brouillon incomplet : le même programme doit promouvoir ET
    // relire le canal, sans quoi la preuve peut être sautée ou oubliée.
    assert.doesNotMatch(workflow, /gh release edit/, 'la promotion n’est plus un ordre séparé, hors du publieur');
    assert.doesNotMatch(workflow, /--draft=false/, 'et un brouillon ne se promeut plus à la main');
    assert.match(workflow, /c'est le\s*\n?\s*#?\s*contrôle qui sert de passeport, pas de conseil/, 'la raison du pas séparé est dite dans le workflow');
  });

  it('la publication n’attend plus de clic : la qualité verte déclenche, l’état du canal décide', () => {
    const workflow = read('.github/workflows/desktop-release.yml');
    const pkg = JSON.parse(read('package.json'));
    // Le déclencheur a remplacé le geste humain. La seule décision qui reste est
    // de MONTER LA VERSION — un commit, relisible — et non un clic ni un appel
    // d'API : téléversement, consolidation des brouillons en double et promotion
    // s'enchaînent seuls une fois le gate ouvert.
    assert.match(workflow, /workflow_run:\s*workflows: \["Quality & performance guard"\]/, 'la qualité verte déclenche la publication');
    assert.match(workflow, /branches: \[main\]/, 'et seulement pour main');
    assert.match(workflow, /workflow_dispatch:/, 'la reprise explicite reste possible');
    assert.match(workflow, /npm run check:release:needed/, 'la décision passe par le mode `needed`, testé avec le reste');
    assert.equal(pkg.scripts['check:release:needed'], 'node scripts/check-release-coherence.mjs --needed');
    assert.match(workflow, /needs\.gate\.outputs\.proceed == 'true'/, 'sans gate vert, le job de publication ne démarre pas');
    assert.match(workflow, /npm run electron:release[\s\S]*npm run release:promote/, 'téléversement puis promotion, dans le même job');
    assert.doesNotMatch(workflow, /api\.github\.com/, 'aucun appel d’API manuel dans la chaîne');
    assert.doesNotMatch(workflow, /gh release/, 'et aucun `gh release` à la main');
  });

  it('sans certificat, le run ne peut pas annoncer une publication : c’est une INACTION', () => {
    const workflow = read('.github/workflows/desktop-release.yml');
    // Le job ne démarre que si le gate a ouvert — donc parce qu'il y avait un
    // release à faire. Un build non signé est alors une publication qui N'A PAS
    // EU LIEU : la déclarer `--acted` (en décrivant des artefacts que personne ne
    // recevra) serait exactement le vert sans action que l'audit pourchasse.
    assert.match(workflow, /signed=true/, 'le build signé se déclare');
    assert.match(workflow, /signed=false/, 'et son absence aussi');
    assert.match(
      workflow,
      /steps\.build\.outputs\.signed[\s\S]{0,240}--inert/,
      'sans certificat, la preuve est une inaction — et elle fait rougir le run',
    );
  });

  it('le gate s’exécute sans jeton et sans réseau en mode local', () => {
    const source = read('scripts/check-release-coherence.mjs');
    assert.match(source, /if \(MODE === 'local'\)[\s\S]*process\.exit\(0\)/, 'le mode local rend son verdict avant tout appel réseau');
    assert.match(source, /un dépôt qu'on ne peut pas interroger n'est pas un feu vert/, 'une panne de l’API est un échec, jamais un vert');
  });
});

describe('le frein d’urgence, tel qu’un poste le lit', () => {
  // Le frein est le SEUL mécanisme qui permet de retenir une version
  // défectueuse avant qu’elle n’atteigne tout le monde. Sa panne est silencieuse
  // par construction : un fichier illisible ne retient rien, la mise à jour reste
  // seulement proposée, et personne ne l’apprend. D’où ces refus — un frein qui
  // ne freine pas est pire qu’aucun frein, parce qu’on compte dessus.
  const file = (holds: unknown[]) => JSON.stringify({ _doc: ['FREIN D’URGENCE'], holds });

  it('accepte le frein au repos, et nomme les retenues', () => {
    const empty = parseHoldsFile(file([]));
    assert.equal(empty.ok, true);
    assert.deepEqual(empty.holds, []);
    const held = parseHoldsFile(file([{ version: '1.0.4', reason: 'plantage au démarrage' }]));
    assert.equal(held.ok, true);
    assert.deepEqual(held.holds, ['1.0.4']);
    assert.deepEqual(held.entries, [{ version: '1.0.4', reason: 'plantage au démarrage' }]);
  });

  it('refuse un frein illisible — c’est la façon silencieuse de ne plus retenir', () => {
    for (const broken of ['', '   ', 'pas du json', '[]', 'null', '{"_doc":["x"]}', '{"holds":"1.0.4"}']) {
      const verdict = parseHoldsFile(broken);
      assert.equal(verdict.ok, false, `« ${broken} » doit être refusé`);
      assert.ok(verdict.problems.length > 0, `« ${broken} » doit dire POURQUOI`);
    }
  });

  it('refuse une retenue qui ne nomme rien, ou qui nomme ce qui n’est pas un numéro', () => {
    const noVersion = parseHoldsFile(file([{ reason: 'oublie la version' }]));
    assert.equal(noVersion.ok, false);
    assert.match(noVersion.problems.join(' '), /ne nomme AUCUNE version/);
    const notAVersion = parseHoldsFile(file([{ version: 'dernière' }]));
    assert.equal(notAVersion.ok, false);
    assert.match(notAVersion.problems.join(' '), /jamais à un release/);
    const notAnObject = parseHoldsFile(file(['1.0.4']));
    assert.equal(notAnObject.ok, false);
  });

  it('NOMME un motif absent au lieu de le refuser : le frein tient quand même', () => {
    const verdict = parseHoldsFile(file([{ version: '1.0.4' }]));
    assert.equal(verdict.ok, true, 'un motif manquant n’empêche pas la retenue de mordre');
    assert.deepEqual(verdict.holds, ['1.0.4']);
    assert.match(verdict.warnings.join(' '), /sans motif/);
  });

  it('le frein du dépôt est lisible, et au repos', () => {
    const verdict = parseHoldsFile(read('updates/holds.json'));
    assert.equal(verdict.ok, true, verdict.problems.join(' · '));
    assert.equal(verdict.entries.length, 0, 'au repos, aucune version n’est retenue');
  });
});

describe('le canal tel que la CI doit le voir', () => {
  const rel = (tag: string, draft: boolean, when: string, created = when) => ({
    tag_name: tag,
    draft,
    published_at: when,
    created_at: created,
  });

  it('prend le release PUBLIÉ le plus récent — un brouillon n’est vu par aucun poste', () => {
    const picked = pickLatestPublished([
      rel('v1.0.9', true, '2026-09-13T00:00:00Z'),
      rel('v1.0.4', false, '2026-09-12T21:00:00Z'),
      rel('v1.0.3', false, '2026-09-12T19:00:00Z'),
    ]);
    assert.equal(picked?.tag_name, 'v1.0.4');
  });

  it('rend null quand rien n’est publié — le canal est muet', () => {
    assert.equal(pickLatestPublished([]), null);
    assert.equal(pickLatestPublished([rel('v2.0.0', true, '2026-09-13T00:00:00Z')]), null);
  });

  it('le câblage : le canal est vérifié SANS jeton, et tous les jours', () => {
    const pkg = JSON.parse(read('package.json'));
    assert.equal(pkg.scripts['check:release:channel'], 'node scripts/check-release-coherence.mjs --channel');
    const workflow = read('.github/workflows/release-channel-watch.yml');
    assert.match(workflow, /npm run check:release:channel/, 'le workflow appelle le script par son nom');
    assert.match(workflow, /\r?\n\s*schedule:/, 'un canal se casse sans commit : le cron est le vrai déclencheur');
    assert.doesNotMatch(workflow, /secrets\./, 'aucun secret : le canal est lu comme un poste le lit');
    assert.match(workflow, /AUTOMATION_EVIDENCE: '1'/);
    assert.ok(workflow.includes(EVIDENCE_STEP_NAME), 'l’étape de preuve porte le nom que l’audit lit');
    assert.match(workflow, /publish-automation-evidence\.mjs/);
  });

  it('le mode channel refuse le jeton de l’environnement, et lit le frein où un poste le lit', () => {
    const source = read('scripts/check-release-coherence.mjs');
    assert.match(source, /const useToken = MODE !== 'channel'/, 'un canal relu authentifié n’est pas prouvé pour un poste');
    assert.match(source, /raw\.githubusercontent\.com\/\$\{repo\}\/\$\{branch\}\/updates\/holds\.json/);
    assert.match(source, /const branch = args\.find/, '--branch permet de vérifier une branche, et de PROUVER le rouge');
    assert.match(source, /canal cassé/, 'un canal cassé doit rendre un rouge nommé');
  });
});
