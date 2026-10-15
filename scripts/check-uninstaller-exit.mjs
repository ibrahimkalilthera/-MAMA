#!/usr/bin/env node
/**
 * ─── Le désinstalleur ÉMIS sort-il en 0 ? ────────────────────────────────────
 *
 * `npm run check:uninstaller-exit`   (Windows ; rien à installer à la main)
 *
 * POURQUOI CE CONTRÔLE EXISTE
 * ---------------------------
 * Le 2026-10-12, une mise à jour de poste s'est arrêtée net : le désinstalleur
 * des versions installées rendait `0xC0000374` (STATUS_HEAP_CORRUPTION) APRÈS
 * avoir vidé le dossier d'installation, donc l'installeur neuf refusait de
 * continuer — dossier vidé, poste sans application. La cause est nommée et
 * réparée dans `build/installer.nsh` (`StdUtils.TestParameter`, le greffon
 * qu'`app-builder-lib` emploie pour lire ses sept drapeaux, corrompait le tas).
 *
 * Cette réparation repose sur des détails de l'AMONT : l'ordre dans l'en-tête
 * commun (les `!define` des drapeaux avant l'`nsis.include` du dépôt), la forme du
 * gabarit `uninstaller.nsh`, la façon dont le script est envoyé à makensis, la
 * liste des sept drapeaux. Les deux suites de tests qui verrouillent
 * `build/installer.nsh` le LISENT : elles ne compilent rien et n'exécutent rien.
 * Une montée d'`electron-builder` peut donc tout déplacer en silence, et le
 * premier endroit où on l'apprendrait serait un poste d'école bloqué.
 *
 * Ce contrôle ferme ce trou par la seule mesure qui vaut ici : il COMPILE le
 * désinstalleur que l'installation courante d'`electron-builder` émet, il le fait
 * TOURNER sur un arbre de banc avec les arguments exacts d'`installUtil.nsh`, et
 * il exige une sortie `0` et un arbre vidé.
 *
 * CE QU'IL MESURE, EXACTEMENT
 * ---------------------------
 *   1. l'émetteur (`-DBUILD_UNINSTALLER`) est compilé par le makensis
 *      d'electron-builder, puis exécuté : il écrit le désinstalleur ;
 *   2. un arbre de banc est monté, et le registre du BANC (`HKCU`, GUID de banc,
 *      jamais l'`appId` réel) lui donne son `InstallLocation` — c'est cette clé
 *      que `initMultiUser` relit, donc l'arbre visé est le nôtre ;
 *   3. le désinstalleur est lancé comme `installUtil.nsh` le lance
 *      (`/S /KEEP_APP_DATA /currentuser --updated _?=<arbre>`), avec un délai ;
 *   4. verdict : sortie `0` ET arbre vidé. Toute autre sortie est rouge, et le
 *      code du plantage est NOMMÉ quand c'est lui qui revient.
 *
 * CE QU'IL NE FAIT PAS
 * --------------------
 * Il ne touche ni l'installation réelle ni son registre (GUID de banc, dossier
 * temporaire, nettoyage systématique), il ne ferme jamais l'application de
 * l'école (le nom d'exécutable surveillé est celui du banc), et il ne réécrit pas
 * le script à la main : l'en-tête et les gabarits viennent de l'installation
 * courante d'`app-builder-lib`, donc c'est bien la MONTÉE qui est mesurée.
 *
 * `--installer=<chemin>` : au lieu d'émettre, MESURER le désinstalleur EMBARQUÉ
 * dans un installeur déjà construit (extrait par `UninstallerReader`, l'outil
 * d'`app-builder-lib`) — c'est l'artefact qu'un poste reçoit vraiment.
 *
 * « Je n'ai pas pu mesurer » n'est pas un vert : hors Windows, sans
 * `app-builder-lib`, sans makensis ou sans installeur à lire, ce script sort en
 * 1 en nommant la raison.
 */
import { copyFileSync, existsSync, mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EVIDENCE_MANDATE_ENV, publishEvidence } from './lib/evidence-publisher.mjs';
import {
  BENCH_GUID,
  assertBenchGuid,
  benchCommands,
  benchDefines,
  benchUninstallerName,
  benchVerdict,
  buildEmissionScript,
  clearBenchRegistry,
  compileNsis,
  countEntries,
  describeExit,
  fileSize,
  loadElectronBuilder,
  makensisArguments,
  readProjectApp,
  removeBenchDir,
  runExecutable,
  uninstallArguments,
  writeBenchRegistry,
  writeBenchTree,
} from './lib/uninstaller-emission.mjs';

const root = process.cwd();

/** Les options de ligne de commande (aucune n'est devinée). */
function cliOptions(argv = process.argv.slice(2)) {
  const value = (prefix) => {
    const hit = argv.find((a) => a.startsWith(`${prefix}=`));
    return hit ? hit.slice(prefix.length + 1) : '';
  };
  const seconds = Number.parseInt(value('--timeout'), 10);
  return {
    installer: value('--installer'),
    keep: argv.includes('--keep'),
    dryRun: argv.includes('--dry-run'),
    timeoutMs: Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : 60_000,
  };
}

/** Un rapport lisible, et une sortie rouge qui dit TOUJOURS pourquoi. */
function fail(reason, { verdict = 'NON MESURÉ' } = {}) {
  console.error(`\n❌ ${verdict} — ${reason}`);
  console.error(
    '\n   Ce contrôle n’admet pas de « vert sans mesure » : sans makensis, sans amont\n' +
      '   installé ou hors Windows, il le dit et sort en 1. Le remède est nommé ci-dessus.',
  );
  process.exit(1);
}

/** La non-mesure, sous la forme d'un verdict — donc jamais confondue avec un vert. */
const unmeasured = (reason) => ({ ...benchVerdict({ measurable: false, reason }), measured: null });

/**
 * La mesure, de bout en bout. Elle ne lève jamais : toute panne devient un verdict
 * NON MESURÉ qui nomme sa raison — un contrôle qui ne peut pas regarder doit le
 * dire, pas mourir en laissant croire à autre chose.
 *
 * @returns {Promise<{ ok: boolean, verdict: string, reason: string, measured: object|null }>}
 */
async function measureBench({ app, eb, options }) {
  const benchDir = mkdtempSync(join(tmpdir(), 'mama-uninstaller-bench-'));
  const treeDir = join(benchDir, 'tree');
  const messagesDir = join(benchDir, 'messages');
  const runDir = join(benchDir, 'run');
  const uninstallerPath = join(benchDir, benchUninstallerName(app));
  let registryPosed = false;

  try {
    for (const dir of [treeDir, messagesDir, runDir]) mkdirSync(dir, { recursive: true });

    // ── D'où vient le désinstalleur mesuré ────────────────────────────────
    let makensis = null;
    let source = '';
    let emitterCode = null;
    if (options.installer) {
      // Le désinstalleur EMBARQUÉ de l'installeur fourni : l'artefact du poste.
      await eb.UninstallerReader.exec(options.installer, uninstallerPath);
      source = `extrait de ${options.installer}`;
    } else {
      makensis = await eb.getMakeNsisPath(undefined, undefined);
      const emitterPath = join(benchDir, 'emitter.exe');
      const defines = benchDefines({
        app,
        benchDir,
        templatesDir: eb.nsisTemplatesDir,
        buildResourcesDir: join(root, 'build'),
        uninstallerOut: uninstallerPath,
        buildUninstaller: true,
      });
      const commands = benchCommands({ outFile: emitterPath, app });
      const script = await buildEmissionScript({ eb, root, app, messagesDir });
      await compileNsis({ eb, makensis, script, args: makensisArguments({ eb, defines, commands }) });
      const emitter = await runExecutable(emitterPath, [], { timeoutMs: options.timeoutMs });
      emitterCode = emitter.timedOut ? null : emitter.code;
      source = 'émis par l’installation courante d’app-builder-lib';
      if (emitter.timedOut) {
        return {
          ...benchVerdict({ timedOut: true, reason: 'l’émetteur du désinstalleur ne s’est pas terminé — tué par le délai' }),
          measured: { emitterTimedOut: true },
        };
      }
    }

    const size = fileSize(uninstallerPath);
    if (emitterCode !== null && emitterCode !== 0) {
      return { ...benchVerdict({ emitterCode }), measured: { emitterCode, emitterExitText: describeExit(emitterCode) } };
    }
    if (!existsSync(uninstallerPath) || !size) {
      return { ...benchVerdict({ uninstallerWritten: false }), measured: { uninstallerSize: size } };
    }

    // ── L'arbre et le registre du BANC ────────────────────────────────────
    const treeFiles = writeBenchTree(treeDir, app);
    await writeBenchRegistry({ guid: BENCH_GUID, treeDir, app });
    registryPosed = true;
    // Un désinstalleur lancé EN PLACE ne peut pas se renommer lui-même (mesuré) :
    // `uninstallOldVersion` en copie donc d'abord une, et lance la COPIE — c'est
    // ce que ce banc reproduit.
    const runner = join(runDir, 'old-uninstaller.exe');
    copyFileSync(uninstallerPath, runner);
    copyFileSync(uninstallerPath, join(treeDir, benchUninstallerName(app)));

    const result = await runExecutable(runner, uninstallArguments(treeDir), { timeoutMs: options.timeoutMs });
    const filesLeft = countEntries(treeDir);
    const verdict = benchVerdict({ code: result.code, timedOut: result.timedOut, filesLeft });

    console.log(`\n🧪 désinstalleur ${source}`);
    console.log(`   makensis          : ${makensis?.path ?? '(lecture d’un installeur existant)'}`);
    console.log(`   désinstalleur     : ${size} octets — ${uninstallerPath}`);
    console.log(`   arbre de banc     : ${treeFiles.length} fichier(s) sous ${treeDir}`);
    console.log(`   arguments         : ${uninstallArguments(treeDir).join(' ')}`);
    console.log(`   SORTIE            : ${describeExit(result.code)}`);
    console.log(`   arbre après essai : ${filesLeft} entrée(s) restante(s)`);

    return {
      ...verdict,
      measured: {
        source,
        installerRead: options.installer || null,
        makensis: makensis?.path ?? null,
        uninstallerBytes: size,
        treeFiles: treeFiles.length,
        uninstallerExit: result.code,
        uninstallerExitText: describeExit(result.code),
        timedOut: result.timedOut,
        filesLeft,
        benchDir: options.keep ? benchDir : null,
      },
    };
  } catch (error) {
    return unmeasured(String(error?.message ?? error));
  } finally {
    if (registryPosed) await clearBenchRegistry(BENCH_GUID);
    removeBenchDir(benchDir, { keep: options.keep });
  }
}

async function main() {
  const options = cliOptions();

  if (process.platform !== 'win32') {
    // Un désinstalleur NSIS ne s'exécute que sous Windows : la mesure n'existe pas
    // ailleurs, et une suite qui l'aurait « sautée » ferait croire à un vert.
    fail(`ce contrôle mesure un binaire Windows ; la plateforme courante est ${process.platform}.`);
  }

  const app = readProjectApp(root);
  assertBenchGuid(BENCH_GUID, app.appId);
  if (!app.customInclude) {
    fail('electron-builder.yml ne nomme aucun `nsis.include` : la réparation ne serait PAS dans l’artefact mesuré.');
  }

  let eb;
  try {
    eb = loadElectronBuilder(root);
  } catch (error) {
    fail(String(error?.message ?? error));
  }

  if (options.installer && !existsSync(options.installer)) {
    fail(`aucun installeur à lire : ${options.installer}`);
  }

  if (options.dryRun) {
    // Un DIAGNOSTIC, pas une mesure : il dit ce qui serait compilé et ne prétend
    // rien. La CI ne s'en sert pas (verrouillé par tests/uninstaller-exit-check.test.ts).
    console.log('ℹ️  --dry-run : rien n’est compilé.');
    console.log(`   gabarits electron-builder : ${eb.nsisTemplatesDir}`);
    console.log(`   include du dépôt          : ${join(root, app.customInclude)}`);
    console.log(`   GUID de banc              : ${BENCH_GUID} (jamais l'appId ${app.appId})`);
    return;
  }

  const outcome = await measureBench({ app, eb, options });

  if (!outcome.ok) fail(outcome.reason, outcome);

  console.log(`\n✅ ${outcome.verdict} — ${outcome.reason}`);
  if (String(process.env[EVIDENCE_MANDATE_ENV] ?? '') === '1') {
    publishEvidence({
      acted: true,
      reason:
        'le désinstalleur émis par l’installation courante d’app-builder-lib a été COMPILÉ et EXÉCUTÉ sur un arbre de banc ' +
        '(registre de banc, GUID distinct de l’appId) : sortie 0 et arbre vidé — mesure publiée par scripts/check-uninstaller-exit.mjs',
      count: Number.isInteger(outcome.measured?.uninstallerBytes) ? outcome.measured.uninstallerBytes : null,
    });
  }
}

await main();
