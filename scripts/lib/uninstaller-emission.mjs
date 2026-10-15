// ─────────────────────────────────────────────────────────────────────────────
// scripts/lib/uninstaller-emission.mjs — le banc qui COMPILE le désinstalleur
// qu'electron-builder émet, puis le fait TOURNER, sans rien rejouer à la main.
//
// ─── Pourquoi ce module existe ──────────────────────────────────────────────
// Le 2026-10-15, la cause du plantage de sortie `0xC0000374` a été supprimée dans
// `build/installer.nsh` : sept `!define` d'`app-builder-lib` redirigés vers une
// sonde écrite en script NSIS, parce que le greffon `StdUtils.TestParameter`
// corrompait le tas. Deux suites de tests verrouillent ce fichier — mais toutes
// les deux le LISENT. Aucune ne COMPILE, aucune n'EXÉCUTE. Une montée
// d'`electron-builder` peut donc changer les gabarits, la liste des drapeaux, la
// forme du script envoyé à makensis ou le passage d'un `!include`, et rien de
// tout cela n'apparaîtrait : le dépôt resterait vert avec, à l'arrivée sur un
// poste, un désinstalleur qui plante en sortant — donc une mise à jour qui
// s'arrête, exactement le défaut d'origine.
//
// ─── Ce que ce banc compile, et pourquoi c'est LUI ──────────────────────────
// Le script envoyé à makensis n'est pas recopié : il est ASSEMBLÉ à partir de
// l'installation courante d'`app-builder-lib`, par ses propres fonctions :
//   • `NsisScriptGenerator.flags([…])` — la fabrique exacte des sept macros de
//     drapeaux, celle qui employait le greffon fautif. Un huitième drapeau ajouté
//     en amont, ou un retour au greffon, entre donc dans le binaire compilé ;
//   • `createAddLangsMacro` / `addCustomMessageFileInclude` — les LangString, lues
//     dans les `messages.yml` du paquet installé (jamais recopiées) ;
//   • `nsisTemplatesDir` — les gabarits (`installer.nsi`, `uninstaller.nsh`,
//     `include/*`) du paquet installé, écrits sur l'entrée standard de makensis
//     exactement comme `NsisTarget.executeMakensis` le fait (`-INPUTCHARSET UTF8`,
//     un `-D` par définition, un `-X` par commande, puis `-`) ;
//   • `getMakeNsisPath` / `getNsisPluginsPath` — le makensis ET les greffons
//     qu'electron-builder emploierait, résolus (et téléchargés au besoin) par son
//     propre résolveur, jamais par un chemin recopié d'un poste.
// Le fichier `build/installer.nsh` du dépôt entre là où electron-builder l'inclut
// (`nsis.include`), donc la réparation est DANS l'artefact mesuré.
//
// ─── Ce que le banc ne fait JAMAIS ──────────────────────────────────────────
// Il ne touche ni l'installation réelle, ni le registre de l'application :
//   • tout vit sous un dossier temporaire, et le registre n'est écrit que sous
//     `HKCU\Software\<GUID DE BANC>` (`assertBenchGuid` refuse l'`appId` réel) ;
//   • le nom d'exécutable cherché par le désinstalleur silencieux est celui du
//     BANC, jamais celui de l'application : lancer ce contrôle sur un poste où
//     l'école travaille ne doit pas fermer son application.
// ─────────────────────────────────────────────────────────────────────────────

import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/** Le code que le désinstalleur fautif rendait : `0xC0000374`, en décimal SIGNÉ. */
export const CRASH_EXIT_CODE = -1073740940;

/** Le `GUID` de banc : il n'est pas celui de l'application, et il ne doit jamais l'être. */
export const BENCH_GUID = 'b0000000-0000-4000-8000-00000000000b';

/** L'architecture de greffons qu'`electron-builder` choisit pour un installeur Unicode. */
export const UNICODE_PLUGIN_ARCH = 'x86-unicode';

/** Les sept drapeaux que `NsisTarget.computeCommonInstallerScriptHeader()` engendre. */
export const FLAG_NAMES = [
  'updated',
  'force-run',
  'keep-shortcuts',
  'no-desktop-shortcut',
  'delete-app-data',
  'allusers',
  'currentuser',
];

/** Les deux clés de registre du banc, sous `HKCU` — donc sans élévation. */
export const benchRegistryPaths = (guid) => [
  `HKCU\\Software\\${guid}`,
  `HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\${guid}`,
];

/** Les arguments exacts d'`installUtil.nsh` (`uninstallOldVersion`). */
export const uninstallArguments = (treeDir) => [
  '/S',
  '/KEEP_APP_DATA',
  '/currentuser',
  '--updated',
  `_?=${treeDir}`,
];

/**
 * Refuse un identifiant de banc qui pourrait désigner l'application réelle.
 *
 * C'est la garde qui rend ce contrôle inoffensif sur un poste en service : le
 * désinstalleur retire l'arbre que `InstallLocation` lui désigne et efface les
 * clés de registre de son `GUID`. Avec l'`appId` réel, la même commande aurait
 * visé l'installation de l'école.
 *
 * @param {string} guid
 * @param {string} [appId] l'`appId` réel, refusé s'il est fourni
 */
export function assertBenchGuid(guid, appId = '') {
  const value = String(guid ?? '').trim();
  // Le refus DANGEREUX d'abord : un `appId` réel (`com.mamathera.finance`) n'a pas
  // la forme d'un GUID, donc l'ordre inverse le refuserait pour « forme invalide »
  // — c'est-à-dire en taisant la seule chose qui compte (le désinstalleur viserait
  // l'installation de l'école). Mesuré par la suite : le premier jet accusait la
  // forme et laissait la raison dangereuse dans l'ombre.
  if (String(appId ?? '').trim() && value.toLowerCase() === String(appId).trim().toLowerCase()) {
    throw new Error(
      `refus : le banc ne travaille pas sous l'appId réel (${appId}) — le désinstalleur viserait l'installation de l'école.`,
    );
  }
  if (/mamathera|finance/i.test(value)) {
    throw new Error(`refus : le GUID de banc « ${value} » évoque l'application réelle.`);
  }
  if (!/^[0-9a-fA-F-]{8,}$/.test(value)) {
    throw new Error(`GUID de banc invalide : ${JSON.stringify(guid)}`);
  }
  return value;
}

/**
 * Charge l'installation courante d'`app-builder-lib` — celle qu'utilise
 * `electron-builder`, donc celle qu'une montée de version déplace.
 *
 * @param {string} root la racine du dépôt (là où vit `node_modules/`)
 */
export function loadElectronBuilder(root) {
  const require = createRequire(join(root, 'package.json'));
  const load = (relative) => {
    try {
      return require(relative);
    } catch (cause) {
      throw new Error(
        `app-builder-lib introuvable (${relative}) : le contrôle ne peut pas compiler le désinstalleur ` +
          `qu'electron-builder émettrait. Lancez « npm ci » — ${cause?.message ?? cause}`,
        // La cause reste attachée : c'est elle qui dit si `npm ci` a été oublié ou
        // si la montée a déplacé le module — deux remèdes différents.
        { cause },
      );
    }
  };
  const scripts = load('app-builder-lib/out/targets/nsis/nsisScriptGenerator.js');
  const lang = load('app-builder-lib/out/targets/nsis/nsisLang.js');
  const util = load('app-builder-lib/out/targets/nsis/nsisUtil.js');
  const windows = load('app-builder-lib/out/toolsets/windows.js');
  return {
    NsisScriptGenerator: scripts.NsisScriptGenerator,
    nsisEscapeString: scripts.nsisEscapeString,
    LangConfigurator: lang.LangConfigurator,
    createAddLangsMacro: lang.createAddLangsMacro,
    addCustomMessageFileInclude: lang.addCustomMessageFileInclude,
    UninstallerReader: util.UninstallerReader,
    nsisTemplatesDir: util.nsisTemplatesDir,
    getMakeNsisPath: windows.getMakeNsisPath,
    getNsisPluginsPath: windows.getNsisPluginsPath,
  };
}

/**
 * Les valeurs du projet, lues là où elles vivent (jamais recopiées d'un poste) :
 * `electron-builder.yml` et `package.json` du dépôt.
 *
 * @param {string} root
 */
/**
 * @param {string} root
 * @returns {{ appId: string, productName: string, customInclude: string, shortcutName: string,
 *   copyright: string, version: string, description: string, packageName: string }}
 */
export function readProjectApp(root) {
  const yml = readFileSync(join(root, 'electron-builder.yml'), 'utf8');
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  const scalar = (key, { required = true } = {}) => {
    const m = yml.match(new RegExp(`^\\s*${key}:\\s*(.+?)\\s*$`, 'm'));
    if (!m) {
      if (required) throw new Error(`electron-builder.yml : clé « ${key} » introuvable`);
      return '';
    }
    return m[1].replace(/^["']|["']$/g, '');
  };
  return {
    appId: scalar('appId'),
    productName: scalar('productName'),
    /** Le script NSIS du dépôt, tel que `nsis.include` le nomme. */
    customInclude: scalar('include', { required: false }),
    shortcutName: scalar('shortcutName', { required: false }),
    copyright: scalar('copyright', { required: false }),
    version: String(pkg.version ?? ''),
    description: String(pkg.description ?? ''),
    packageName: String(pkg.name ?? ''),
  };
}

/** La version « à la Windows » (`1.0.35` → `1.0.35.0`), comme `getVersionInWeirdWindowsForm`. */
export const windowsVersion = (version) => {
  const parts = String(version)
    .split('.')
    .map((n) => Number.parseInt(n, 10) || 0);
  while (parts.length < 4) parts.push(0);
  return parts.slice(0, 4).join('.');
};

/**
 * Le script envoyé à makensis, assemblé par les fonctions d'`app-builder-lib` :
 * l'en-tête commun (celui de l'installeur ET du désinstalleur) suivi du gabarit
 * `installer.nsi` — ce que `computeCommonInstallerScriptHeader()` puis
 * `computeFinalScript()` produisent.
 */
/**
 * @param {{ eb: object, root: string, app: object, messagesDir: string }} input
 * @returns {Promise<string>} le script complet, à écrire sur l'entrée standard de makensis
 */
export async function buildEmissionScript({ eb, root, app, messagesDir }) {
  const { NsisScriptGenerator, LangConfigurator, createAddLangsMacro, addCustomMessageFileInclude, nsisTemplatesDir } = eb;
  const generator = new NsisScriptGenerator();
  const langs = new LangConfigurator({});
  generator.include(join(nsisTemplatesDir, 'include', 'StdUtils.nsh'));
  generator.addIncludeDir(join(nsisTemplatesDir, 'include'));
  generator.flags(FLAG_NAMES);
  createAddLangsMacro(generator, langs);
  // Les greffons d'`nsis-resources` (`UAC.dll` en tête), que le gabarit assisté
  // appelle : sans ce `!addplugindir`, makensis s'arrête sur « Plugin not found,
  // cannot call UAC::_ » (mesuré) — c'est exactement ce qu'electron-builder ajoute
  // au même endroit de l'en-tête.
  const pluginsPath = await eb.getNsisPluginsPath(undefined, undefined);
  generator.addPluginDir(UNICODE_PLUGIN_ARCH, join(pluginsPath, UNICODE_PLUGIN_ARCH));
  // `getTempFile` est la seule chose que le générateur de messages demande au
  // packager : un fichier temporaire où écrire les LangString. Il doit être
  // DIFFÉRENT à chaque appel, comme chez electron-builder (`2-messages.nsh`,
  // `3-messages.nsh`) — mesuré : un même nom donné aux deux fichiers fait écrire
  // le second sur le premier, le script inclut alors deux fois le même contenu, et
  // makensis refuse (`warning 6030: LangString … set multiple times`, promu en
  // erreur par `-WX`, exactement comme en production).
  let messageFileCount = 0;
  const packagerStub = { getTempFile: async (name) => join(messagesDir, `${(messageFileCount += 1)}-${name}`) };
  await addCustomMessageFileInclude('messages.yml', packagerStub, generator, langs);
  await addCustomMessageFileInclude('assistedMessages.yml', packagerStub, generator, langs);
  if (app.customInclude) {
    generator.addIncludeDir(join(root, 'build'));
    generator.include(join(root, app.customInclude));
  }
  return `${generator.build()}${readFileSync(join(eb.nsisTemplatesDir, 'installer.nsi'), 'utf8')}`;
}

/**
 * Les noms PROPRES AU BANC. Le banc porte le nom de l'application, jamais son
 * identité : le désinstalleur silencieux cherche et ferme un processus par le nom
 * de son exécutable (`APP_EXECUTABLE_FILENAME`, engendré par `common.nsh` depuis
 * `PRODUCT_FILENAME` — mesuré : le redéfinir par `-D` est refusé, « already
 * defined »), et `WinShell::UninstAppUserModelId` défait l'enregistrement AUMID de
 * l'`APP_ID`. Laisser ces deux-là à l'application réelle ferait fermer son
 * application à une école qui travaille, et déferait son enregistrement, pour un
 * contrôle qui n'a besoin que de compiler et d'exécuter.
 */
export function benchNaming(app) {
  const productName = `${app.productName}Bench`;
  return { productName, productFilename: productName, appId: `${app.appId}.bench` };
}

/**
 * Les définitions du banc. Elles reprennent celles qu'electron-builder calcule
 * pour cette configuration (`oneClick: false`, `allowToChangeInstallationDirectory`,
 * `deleteAppDataOnUninstall: false`) — et le `GUID` est celui du BANC.
 *
 * @param {{ app: object, benchDir: string, templatesDir: string, buildResourcesDir: string,
 *   uninstallerOut?: string|null, installerOut?: string|null, buildUninstaller?: boolean }} input
 * @returns {Record<string, string|null>} une entrée nulle devient un `-D` nu
 */
export function benchDefines({
  app,
  benchDir,
  templatesDir,
  buildResourcesDir,
  uninstallerOut = null,
  installerOut = null,
  buildUninstaller = false,
}) {
  const naming = benchNaming(app);
  const defines = {
    APP_ID: naming.appId,
    APP_GUID: BENCH_GUID,
    UNINSTALL_APP_KEY: BENCH_GUID,
    INSTALL_REGISTRY_KEY: `Software\\${BENCH_GUID}`,
    UNINSTALL_REGISTRY_KEY: `Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\${BENCH_GUID}`,
    PRODUCT_NAME: naming.productName,
    // C'est de ce nom qu'`common.nsh` engendre `APP_EXECUTABLE_FILENAME` (le
    // processus que le désinstalleur silencieux cherche et ferme) : il porte donc
    // le suffixe du banc, jamais celui de l'application.
    PRODUCT_FILENAME: naming.productFilename,
    APP_FILENAME: naming.productFilename,
    APP_PACKAGE_NAME: app.packageName,
    APP_DESCRIPTION: app.description,
    VERSION: app.version,
    SHORTCUT_NAME: app.shortcutName || app.productName,
    PROJECT_DIR: benchDir,
    BUILD_RESOURCES_DIR: buildResourcesDir,
    NSIS_STAGING: templatesDir,
    UNINSTALL_DISPLAY_NAME: `${naming.productName} ${app.version}`,
    MULTIUSER_EXECUTIONLEVEL: 'Highest',
    // `!oneClick` : l'installeur assisté exige ces trois-là (sans quoi le gabarit
    // n'appelle jamais `setInstallModePerAllUsers`, et makensis refuse le fichier).
    INSTALL_MODE_PER_ALL_USERS_REQUIRED: null,
    MULTIUSER_INSTALLMODE_ALLOW_ELEVATION: null,
    allowToChangeInstallationDirectory: null,
  };
  if (buildUninstaller) defines.BUILD_UNINSTALLER = null;
  if (uninstallerOut) defines.UNINSTALLER_OUT_FILE = uninstallerOut;
  if (installerOut) defines.INSTALLER_OUT_FILE = installerOut;
  return defines;
}

/**
 * Les commandes `-X`, dans l'ordre où `executeMakensis` les passe, et avec la
 * MÊME forme que `computeVersionKey()` : les cinq clés standards préfixées du
 * langage (1033), `LegalCopyright` comprise. Mesuré : sans elle, makensis avertit
 * (`warning 9100: Generating version information … without standard key
 * "LegalCopyright"`) et `-WX` — l'option qu'electron-builder emploie — en fait une
 * erreur, donc le banc ne compilerait même pas ce que la production compile.
 *
 * @param {{ outFile: string, app: object }} input
 * @returns {{ OutFile: string, VIProductVersion: string, VIAddVersionKey: string[], Unicode: boolean }}
 */
export function benchCommands({ outFile, app }) {
  const naming = benchNaming(app);
  const lang = '/LANG=1033';
  return {
    OutFile: `"${outFile}"`,
    VIProductVersion: windowsVersion(app.version),
    VIAddVersionKey: [
      `${lang} ProductName "${naming.productName}"`,
      `${lang} ProductVersion "${app.version}"`,
      `${lang} LegalCopyright "${app.copyright || 'MAMA THERA'}"`,
      `${lang} FileDescription "${app.description}"`,
      `${lang} FileVersion "${app.version}"`,
      `${lang} CompanyName "MAMA THERA"`,
    ],
    Unicode: true,
  };
}

/**
 * Les arguments de makensis, dans l'ordre EXACT de `NsisTarget.executeMakensis` :
 * le script n'est pas un fichier, il arrive par l'entrée standard (dernier `-`).
 *
 * @param {{ eb: { nsisEscapeString: (value: string) => string }, defines: Record<string, string|null>, commands: object }} input
 * @returns {string[]}
 */
export function makensisArguments({ eb, defines, commands }) {
  const args = ['-WX', '-INPUTCHARSET', 'UTF8'];
  for (const [name, value] of Object.entries(defines)) {
    args.push(value == null ? `-D${name}` : `-D${name}=${eb.nsisEscapeString(String(value))}`);
  }
  for (const [name, value] of Object.entries(commands)) {
    for (const one of Array.isArray(value) ? value : [value]) args.push(`-X${name} ${one}`);
  }
  args.push('-');
  return args;
}

/** Un processus lancé, attendu, rendu avec son code RÉEL (décimal signé). */
export function runProcess(exe, args, { timeoutMs = 60_000, stdin = null, env = process.env, cwd = undefined } = {}) {
  return new Promise((resolve) => {
    const child = spawn(exe, args, { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true, env, cwd });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      try {
        spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true });
      } catch {
        /* le processus est peut-être déjà parti : le verdict, lui, est déjà « bloqué » */
      }
    }, timeoutMs);
    child.stdout.on('data', (d) => (stdout += d));
    child.stderr.on('data', (d) => (stderr += d));
    child.on('error', (error) => {
      clearTimeout(timer);
      resolve({ code: null, error: String(error?.message ?? error), stdout, stderr, timedOut });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code: code === null ? null : code | 0, error: null, stdout, stderr, timedOut });
    });
    child.stdin.end(stdin === null ? '' : stdin);
  });
}

/**
 * Compile un script NSIS avec le makensis d'electron-builder (mêmes arguments,
 * même dossier courant, même entrée standard que `executeMakensis`).
 */
export async function compileNsis({ eb, makensis, script, args, timeoutMs = 180_000 }) {
  const result = await runProcess(makensis.path, args, {
    timeoutMs,
    stdin: script,
    env: { ...process.env, ...(makensis.env ?? {}) },
    cwd: eb.nsisTemplatesDir,
  });
  if (result.code !== 0) {
    // Les deux flux : makensis écrit ses AVERTISSEMENTS sur la sortie standard et
    // l'erreur qui les conclut sur la sortie d'erreur — n'en garder qu'un laissait
    // « warning treated as error » sans le dire quel avertissement.
    throw new Error(
      `makensis a refusé le script (sortie ${describeExit(result.code)}) :\n` +
        `${(result.stdout || '').trim().slice(-3000)}\n${(result.stderr || '').trim().slice(-1000)}`,
    );
  }
  return result;
}

/** Lance un exécutable déjà compilé (l'émetteur, le désinstalleur). */
export const runExecutable = (exe, args, options = {}) => runProcess(exe, args, options);

/** Le code de sortie, tel qu'un humain et une comparaison le lisent. */
export function describeExit(code) {
  if (code === null) return 'aucun (processus tué ou jamais démarré)';
  const signed = code | 0;
  const hex = (code >>> 0)
    .toString(16)
    .toUpperCase()
    .padStart(8, '0');
  return `${signed} (0x${hex})`;
}

/**
 * Le verdict du banc — PUR, donc jugé par un test au lieu d'être cru.
 *
 * @param {{ measurable?: boolean, reason?: string, code?: number|null, timedOut?: boolean,
 *           emitterCode?: number|null, uninstallerWritten?: boolean, filesLeft?: number }} input
 * @returns {{ ok: boolean, verdict: string, reason: string }}
 */
export function benchVerdict(input = {}) {
  const {
    measurable = true,
    reason = '',
    code = null,
    timedOut = false,
    emitterCode = null,
    uninstallerWritten = true,
    filesLeft = 0,
  } = input;
  if (!measurable) {
    // « Je n'ai pas pu regarder » n'est pas un vert : c'est le refus de ce dépôt
    // partout ailleurs, et celui qui a coûté le plus cher ici.
    return { ok: false, verdict: 'NON MESURÉ', reason: reason || 'le banc n’a pas pu mesurer' };
  }
  if (timedOut) {
    return { ok: false, verdict: 'BLOQUÉ', reason: 'le désinstalleur n’est pas sorti seul — tué par le délai' };
  }
  if (emitterCode !== null && emitterCode !== 0) {
    return {
      ok: false,
      verdict: 'ÉMETTEUR EN ÉCHEC',
      reason: `l’exécutable qui écrit le désinstalleur est sorti en ${describeExit(emitterCode)}`,
    };
  }
  if (!uninstallerWritten) {
    return { ok: false, verdict: 'AUCUN DÉSINSTALLEUR ÉMIS', reason: 'l’émetteur n’a écrit aucun désinstalleur' };
  }
  if (code !== 0) {
    const crashed = code === CRASH_EXIT_CODE;
    return {
      ok: false,
      verdict: crashed ? 'LE PLANTAGE EST REVENU' : 'SORTIE NON NULLE',
      reason:
        `le désinstalleur émis sort en ${describeExit(code)}` +
        (crashed ? ' — c’est exactement 0xC0000374, STATUS_HEAP_CORRUPTION' : ''),
    };
  }
  if (filesLeft > 0) {
    return {
      ok: false,
      verdict: 'ARBRE NON RETIRÉ',
      reason: `sorti en 0 mais ${filesLeft} entrée(s) restent dans l’arbre de banc : le désinstalleur n’a pas fait son travail`,
    };
  }
  return { ok: true, verdict: 'SORTIE 0', reason: 'le désinstalleur émis sort en 0 et a vidé l’arbre de banc' };
}

/** L'arbre de banc : ce que le désinstalleur doit retirer. */
export function writeBenchTree(treeDir, app) {
  const files = [
    [`${benchNaming(app).productFilename}.exe`, 'MZ'],
    [join('resources', 'app.asar'), 'asar'],
    [join('resources', 'app.asar.unpacked', 'index.js'), 'x'],
    [join('locales', 'fr.pak'), 'fr'],
  ];
  for (const [rel, content] of files) {
    const target = join(treeDir, rel);
    mkdirSync(join(target, '..'), { recursive: true });
    writeFileSync(target, content);
  }
  return files.map(([rel]) => rel);
}

/** Compte ce qui reste dans un dossier (récursif). */
export function countEntries(dir) {
  if (!existsSync(dir)) return 0;
  let total = 0;
  const walk = (current) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      total += 1;
      if (entry.isDirectory()) walk(join(current, entry.name));
    }
  };
  try {
    walk(dir);
  } catch {
    // Un dossier illisible se dit par un compte non nul : jamais « vide ».
    return Math.max(total, 1);
  }
  return total;
}

/**
 * Pose le registre du banc (sous `HKCU`, GUID de banc) : `initMultiUser` y relit
 * `InstallLocation`, donc c'est LUI qui décide quel arbre le désinstalleur visera.
 */
export async function writeBenchRegistry({ guid, treeDir, app }) {
  const uninstallKey = `HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\${guid}`;
  const naming = benchNaming(app);
  const entries = [
    [`HKCU\\Software\\${guid}`, 'InstallLocation', treeDir],
    [`HKCU\\Software\\${guid}`, 'KeepShortcuts', 'true'],
    [`HKCU\\Software\\${guid}`, 'ShortcutName', app.shortcutName || app.productName],
    [uninstallKey, 'DisplayName', naming.productName],
    [uninstallKey, 'UninstallString', `"${join(treeDir, `Uninstall ${naming.productFilename}.exe`)}" /currentuser`],
  ];
  for (const [key, name, value] of entries) {
    const result = await runProcess('reg', ['add', key, '/v', name, '/t', 'REG_SZ', '/d', value, '/f'], { timeoutMs: 15_000 });
    if (result.code !== 0) {
      throw new Error(`registre de banc : « reg add ${key} /v ${name} » est sorti en ${describeExit(result.code)}`);
    }
  }
}

/** Retire les deux clés du banc. Silencieux : elles peuvent ne pas exister. */
export async function clearBenchRegistry(guid) {
  for (const path of benchRegistryPaths(guid)) {
    await runProcess('reg', ['delete', path, '/f'], { timeoutMs: 15_000 });
  }
}

/** Efface le dossier de banc — sauf si l'appelant veut l'inspecter. */
export function removeBenchDir(benchDir, { keep = false } = {}) {
  if (keep) return false;
  rmSync(benchDir, { recursive: true, force: true });
  return true;
}

/** Un dossier de banc neuf, sous le temporaire du système. */
export function newBenchDir(tmpRoot) {
  const dir = join(tmpRoot, `mama-uninstaller-bench-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

/** Le nom du désinstalleur que le banc écrit et exécute. */
export const benchUninstallerName = (app) => `Uninstall ${benchNaming(app).productFilename}.exe`;

/** La taille d'un fichier, ou `null` s'il n'existe pas (0 octet se dit aussi). */
export function fileSize(path) {
  try {
    return statSync(path).size;
  } catch {
    return null;
  }
}
