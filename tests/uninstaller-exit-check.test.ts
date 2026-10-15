// Suite du contrôle `scripts/check-uninstaller-exit.mjs` — le seul endroit du
// dépôt qui COMPILE et EXÉCUTE le désinstalleur émis par electron-builder.
//
// Pourquoi elle existe à côté des deux autres suites de l'installateur
// (`installer-uninstaller-crash.test.ts`, `installer-uninstall-tolerance.test.ts`) :
// celles-là LISENT `build/installer.nsh`, donc elles verrouillent la réparation
// telle qu'elle est ÉCRITE. Aucune ne la COMPILE, aucune n'exécute ce qui en
// sort. Or la réparation tient à des détails de l'amont — l'ordre de l'en-tête
// commun (les `!define` des drapeaux avant l'`nsis.include` du dépôt), la forme du
// gabarit `uninstaller.nsh`, la liste des sept drapeaux, la façon dont le script
// part à makensis. Une montée d'`electron-builder` peut déplacer tout cela sans
// qu'un seul cas de ces deux suites ne rougisse, et le premier endroit où on
// l'apprendrait serait un poste d'école bloqué en pleine mise à jour.
//
// Ce que cette suite juge, faute de pouvoir compiler dans une suite unitaire :
//   1. la DÉCISION (`benchVerdict`) — pure, donc jugée sur des cas, pas crue ;
//   2. les ARGUMENTS de l'essai, ceux d'`installUtil.nsh` (`/S`, `--updated`, `_?=`) ;
//   3. la SÛRETÉ — le banc ne peut pas viser l'installation de l'école (GUID de
//      banc, nom d'exécutable du banc, jamais l'`appId` ni le nom de produit réels) ;
//   4. la FIDÉLITÉ — le script est assemblé par les fonctions d'`app-builder-lib`
//      installé, jamais recopié, et makensis vient de son résolveur ;
//   5. le BRANCHEMENT — package.json, et un workflow qui se déclenche sur les
//      fichiers qu'une montée d'electron-builder déplace ;
//   6. le REFUS DU SILENCE — « je n'ai pas pu mesurer » sort en 1 en le nommant,
//      et le drapeau de diagnostic ne se confond pas avec une mesure.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  BENCH_GUID,
  CRASH_EXIT_CODE,
  FLAG_NAMES,
  assertBenchGuid,
  benchCommands,
  benchDefines,
  benchNaming,
  benchRegistryPaths,
  benchUninstallerName,
  benchVerdict,
  describeExit,
  makensisArguments,
  readProjectApp,
  uninstallArguments,
  windowsVersion,
} from '../scripts/lib/uninstaller-emission.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel: string) => readFileSync(join(root, rel), 'utf8');

const app = readProjectApp(root);
const checkSource = read('scripts/check-uninstaller-exit.mjs');
const libSource = read('scripts/lib/uninstaller-emission.mjs');
const workflowPath = '.github/workflows/uninstaller-exit-watch.yml';

const definesForBench = () =>
  benchDefines({
    app,
    benchDir: 'C:\\banc',
    templatesDir: 'C:\\gabarits',
    buildResourcesDir: join(root, 'build'),
    uninstallerOut: 'C:\\banc\\desinstalleur.exe',
    buildUninstaller: true,
  });

describe('le désinstalleur ÉMIS est compilé et exécuté, pas seulement relu', () => {
  it('juge la sortie du désinstalleur, et le code du plantage en décimal signé', () => {
    // Le piège mesuré deux fois dans ce dépôt (voir
    // `installer-uninstall-tolerance.test.ts`) : NSIS rend le code en 32 bits
    // SIGNÉ, donc `0xC0000374` se lit `-1073740940` et une comparaison écrite en
    // hexadécimal serait fausse sans que rien ne rougisse. Ici le verdict exige
    // ZÉRO — la tolérance appartient au VIEUX désinstalleur, pas à celui-ci.
    const clean = benchVerdict({ code: 0, filesLeft: 0 });
    assert.equal(clean.ok, true);
    assert.match(clean.verdict, /0/);

    const crashed = benchVerdict({ code: CRASH_EXIT_CODE, filesLeft: 0 });
    assert.equal(crashed.ok, false, 'le plantage mesuré doit être rouge');
    assert.match(crashed.reason, /0xC0000374/, 'le verdict doit NOMMER le code du plantage');
    assert.match(String(crashed.verdict), /PLANTAGE/i);
    assert.equal(CRASH_EXIT_CODE, -1073740940, 'le code mesuré est le décimal signé');
    assert.match(describeExit(CRASH_EXIT_CODE), /-1073740940/, 'un humain doit lire le décimal signé');

    // Aucun code non nul n'est toléré, et chacun est nommé.
    for (const code of [1, 2, 5, -1073741819]) {
      const other = benchVerdict({ code });
      assert.equal(other.ok, false, `la sortie ${code} doit être rouge`);
      assert.match(other.reason, new RegExp(String(code)));
    }
    // Un désinstalleur qui sort en 0 sans rien retirer n'a pas fait son travail :
    // ce n'est pas le plantage, mais ce n'est pas un vert non plus.
    const lazy = benchVerdict({ code: 0, filesLeft: 3 });
    assert.equal(lazy.ok, false);
    assert.match(lazy.reason, /3 entrée/);
  });

  it('refuse de compter « je n’ai pas pu mesurer » comme un vert', () => {
    // Le défaut que ce dépôt pourchasse : un contrôle qui n'a rien regardé et qui
    // se lit vert. Chaque cause de non-mesure a son verdict, et tous sont rouges.
    const unmeasured = benchVerdict({ measurable: false, reason: 'makensis introuvable' });
    assert.equal(unmeasured.ok, false);
    assert.equal(unmeasured.verdict, 'NON MESURÉ');
    assert.match(unmeasured.reason, /makensis introuvable/);
    assert.equal(benchVerdict({ measurable: false }).ok, false, 'sans raison non plus, jamais vert');

    const stuck = benchVerdict({ code: null, timedOut: true });
    assert.equal(stuck.ok, false);
    assert.equal(stuck.verdict, 'BLOQUÉ');

    const emitterFailed = benchVerdict({ emitterCode: -1073740940 });
    assert.equal(emitterFailed.ok, false, 'un émetteur en échec ne peut pas produire un vert');

    const noUninstaller = benchVerdict({ uninstallerWritten: false });
    assert.equal(noUninstaller.ok, false);
    assert.equal(noUninstaller.verdict, 'AUCUN DÉSINSTALLEUR ÉMIS');
  });

  it('lance le désinstalleur avec les arguments EXACTS d’installUtil.nsh', () => {
    // `uninstallOldVersion` relance le désinstalleur de la version installée avec
    // ces cinq arguments ; un banc qui en oublierait un mesurerait un autre
    // chemin que celui du poste — et c'est ce chemin-là qui plantait.
    const tree = 'C:\\arbre';
    assert.deepEqual(uninstallArguments(tree), [
      '/S', // silencieux, comme la mise à jour d'un poste
      '/KEEP_APP_DATA', // les données de l'école ne sont jamais effacées
      '/currentuser',
      '--updated',
      `_?=${tree}`, // ne pas effacer le dossier du désinstalleur : il se copie d'abord
    ]);
    for (const flag of ['/S', '--updated', '_?=']) {
      assert.ok(uninstallArguments(tree).some((a) => a.startsWith(flag)), `${flag} doit être passé`);
    }
  });

  it('ne peut pas viser l’installation de l’école', () => {
    // La sûreté du contrôle tient à trois séparations, et chacune se mesure :
    //   • le GUID de registre — c'est lui qui décide ce que le désinstalleur
    //     supprime (`initMultiUser` relit `InstallLocation`) et quelles clés il efface ;
    //   • l'`APP_ID` — `WinShell::UninstAppUserModelId` défait l'enregistrement AUMID ;
    //   • le nom de produit — `common.nsh` en engendre `APP_EXECUTABLE_FILENAME`,
    //     le processus que le désinstalleur silencieux cherche puis FERME.
    assert.equal(assertBenchGuid(BENCH_GUID), BENCH_GUID);
    assert.throws(() => assertBenchGuid(app.appId, app.appId), /appId réel|école/);
    assert.throws(() => assertBenchGuid('mamathera-finance'), /application réelle/);
    assert.throws(() => assertBenchGuid(''), /invalide/);

    const defines = definesForBench();
    assert.notEqual(defines.APP_ID, app.appId, 'le banc ne porte jamais l’appId réel');
    assert.equal(defines.APP_ID, `${app.appId}.bench`);
    assert.equal(defines.PRODUCT_FILENAME, `${app.productName}Bench`);
    assert.equal(defines.PRODUCT_NAME, `${app.productName}Bench`);
    assert.ok(
      !Object.values(defines).some((v) => typeof v === 'string' && v === app.productName),
      'aucune définition du banc ne porte le nom de produit réel',
    );
    assert.ok(
      benchRegistryPaths(BENCH_GUID).every((p) => p.startsWith('HKCU\\') && p.includes(BENCH_GUID)),
      'le registre n’est touché que sous HKCU et sous le GUID de banc',
    );
    assert.ok(
      benchRegistryPaths(BENCH_GUID).every((p) => !p.includes(app.appId)),
      'aucune clé de registre du banc ne nomme l’application',
    );
    assert.equal(benchUninstallerName(app), `Uninstall ${benchNaming(app).productFilename}.exe`);

    // Mesuré : `common.nsh` écrit `!define APP_EXECUTABLE_FILENAME
    // "${PRODUCT_FILENAME}.exe"`, et passer la sienne par `-D` fait ABANDONNER
    // makensis (« already defined »). Le seul levier est donc le nom de produit,
    // ci-dessus — et ce contrôle ne doit pas retenter la définition.
    assert.equal('APP_EXECUTABLE_FILENAME' in defines, false);
  });

  it('assemble le script par l’amont INSTALLÉ, et ne recopie rien', () => {
    // La fidélité est ce qui rend ce contrôle capable de voir une montée : les
    // gabarits, la fabrique des drapeaux, les messages et makensis viennent tous
    // de l'installation courante d'`app-builder-lib`, jamais d'une copie posée
    // dans le dépôt (une copie ne bougerait pas quand l'amont bouge).
    for (const api of ['loadElectronBuilder', 'getMakeNsisPath', 'buildEmissionScript', 'compileNsis']) {
      assert.match(checkSource, new RegExp(`\\b${api}\\b`), `${api} doit être employé par le contrôle`);
    }
    // Les quatre modules d'`app-builder-lib` dont le banc dépend : la fabrique des
    // drapeaux, les messages, les gabarits, le résolveur de makensis. Les nommer
    // ici fige ce que le banc suit — et ce qu'une montée peut déplacer.
    for (const module of [
      'app-builder-lib/out/targets/nsis/nsisScriptGenerator.js',
      'app-builder-lib/out/targets/nsis/nsisLang.js',
      'app-builder-lib/out/targets/nsis/nsisUtil.js',
      'app-builder-lib/out/toolsets/windows.js',
    ]) {
      assert.ok(libSource.includes(module), `le banc doit lire l’amont par ${module}`);
    }
    assert.match(libSource, /generator\.flags\(FLAG_NAMES\)/, 'les drapeaux viennent de la fabrique d’app-builder-lib');
    assert.equal(FLAG_NAMES.length, 7, 'sept drapeaux, ceux que computeCommonInstallerScriptHeader engendre');
    assert.match(libSource, /nsisTemplatesDir/, 'les gabarits viennent du paquet installé');
    // Ni chemin de makensis recopié d'un poste, ni script d'essai gardé dans le dépôt.
    assert.doesNotMatch(checkSource, /makensis\.exe/i, 'le chemin de makensis ne se recopie pas');
    assert.doesNotMatch(checkSource, /electron-builder[\\/]+Cache/i, 'le cache non plus');
    assert.doesNotMatch(libSource, /nsis-3\.\d/, 'aucune version de NSIS n’est figée dans le banc');
    // L'include du dépôt est celui que `nsis.include` nomme — donc la réparation
    // est bien DANS l'artefact mesuré (un include absent compilerait sans elle).
    assert.equal(app.customInclude, 'build/installer.nsh');
    assert.match(libSource, /app\.customInclude/, 'le banc inclut le script nommé par electron-builder.yml');
  });

  it('donne à makensis les mêmes arguments qu’en production', () => {
    // `NsisTarget.executeMakensis` : `-WX` (les avertissements sont des erreurs),
    // l'entrée en UTF8, un `-D` par définition (sans valeur pour les `!define`
    // nus), un `-X` par commande, puis `-` — le script arrive sur l'entrée standard.
    const eb = { nsisEscapeString: (s: string) => s };
    const commands = benchCommands({ outFile: 'C:\\banc\\emetteur.exe', app });
    const args = makensisArguments({
      eb,
      defines: { INSTALL_MODE_PER_ALL_USERS_REQUIRED: null, VERSION: app.version, BUILD_UNINSTALLER: null },
      commands,
    });
    assert.deepEqual(args.slice(0, 3), ['-WX', '-INPUTCHARSET', 'UTF8']);
    assert.equal(args[args.length - 1], '-', 'le script part par l’entrée standard');
    assert.ok(args.includes('-DINSTALL_MODE_PER_ALL_USERS_REQUIRED'), 'une définition nulle reste nue');
    assert.ok(args.includes(`-DVERSION=${app.version}`));
    assert.ok(args.includes('-DBUILD_UNINSTALLER'), 'l’émetteur est compilé avec BUILD_UNINSTALLER');
    assert.ok(args.includes(`-XOutFile "${'C:\\banc\\emetteur.exe'}"`));
    // Chaque clé de version est préfixée du langage, `LegalCopyright` comprise :
    // sans elle makensis avertit (warning 9100) et `-WX` en fait une erreur —
    // le banc ne compilerait alors même pas ce que la production compile.
    // Six clés : les cinq de `computeVersionKey()` plus `CompanyName`, que le
    // gabarit exige (mesuré : sans `LegalCopyright`, makensis avertit — 9100 — et
    // `-WX` en fait une erreur, donc le banc ne compilerait pas ce que la
    // production compile).
    const keys = commands.VIAddVersionKey as string[];
    assert.equal(keys.length, 6);
    assert.ok(keys.every((k) => k.startsWith('/LANG=1033 ')));
    assert.ok(keys.some((k) => k.includes('LegalCopyright')));
    assert.equal(windowsVersion(app.version), `${app.version}.0`);
  });

  it('est BRANCHÉ, et se déclenche sur ce qu’une montée déplace', () => {
    const pkg = JSON.parse(read('package.json')) as { scripts: Record<string, string> };
    assert.equal(pkg.scripts['check:uninstaller-exit'], 'node scripts/check-uninstaller-exit.mjs');

    const workflow = read(workflowPath);
    assert.match(workflow, /runs-on:\s*windows-latest/, 'un désinstalleur NSIS ne s’exécute que sous Windows');
    assert.match(workflow, /npm run check:uninstaller-exit/, 'le workflow appelle le script PAR SON NOM');
    assert.doesNotMatch(
      workflow,
      /node scripts\/check-uninstaller-exit\.mjs/,
      'recopier la commande de package.json la ferait diverger en silence',
    );
    assert.doesNotMatch(workflow, /--dry-run/, 'un diagnostic n’est pas une mesure : la CI ne le prend pas');
    // Les déclencheurs : c'est tout l'objet du contrôle — une montée
    // d'electron-builder ne touche AUCUN code de ce dépôt, seulement le
    // lockfile et les paquets installés.
    for (const path of [
      'package.json',
      'package-lock.json',
      'build/installer.nsh',
      'electron-builder.yml',
      'scripts/check-uninstaller-exit.mjs',
      'scripts/lib/uninstaller-emission.mjs',
    ]) {
      assert.ok(workflow.includes(`- '${path}'`), `le workflow doit se déclencher sur ${path}`);
    }
    assert.match(workflow, /schedule:/, 'une dérive du côté de l’amont ne fait aucun commit');
  });

  it('sort en 1 quand il ne peut pas mesurer, et le dit', () => {
    // Mesure réelle, en sous-processus : un installeur à lire qui n'existe pas.
    // Aucun vert, aucun silence — et la raison est nommée. Hors Windows, le
    // contrôle refuse aussi (la mesure n'existe pas ailleurs) : dans les deux cas
    // la sortie est rouge, donc ce cas est stable sur toutes les plateformes.
    const missing = join(root, 'release', 'aucun-installeur-de-ce-nom.exe');
    const run = spawnSync(process.execPath, ['scripts/check-uninstaller-exit.mjs', `--installer=${missing}`], {
      cwd: root,
      encoding: 'utf8',
    });
    assert.equal(run.status, 1, 'un contrôle qui ne mesure pas ne finit pas en 0');
    assert.match(`${run.stdout}${run.stderr}`, /NON MESURÉ/);
    assert.match(`${run.stdout}${run.stderr}`, /aucun installeur à lire|mesure un binaire Windows/);
  });
});
