// Suite de la réparation « §1 » de `build/installer.nsh` : le désinstalleur des
// versions déjà installées ne sort plus en `0xC0000374`
// (STATUS_HEAP_CORRUPTION), donc il ne plante plus APRÈS avoir vidé le dossier
// d'installation — et une mise à jour de poste ne s'arrête plus là.
//
// La cause n'est pas le runtime NSIS, et elle a été ISOLÉE avant d'être réparée :
// c'est `StdUtils.TestParameter`, le greffon qu'`app-builder-lib` emploie pour lire
// ses sept drapeaux (`isUpdated`, `isForceRun`, …). Mesuré le 2026-10-15, makensis
// 3.0.4.1 livré par `electron-builder`, sur un script minimal : six appels → sortie
// `0xC0000374`, zéro appel → sortie `0`, et un installeur sans greffon → `0`. Mesuré
// aussi sur le désinstalleur RÉELLEMENT ÉMIS, même banc, mêmes arguments
// (`/S /KEEP_APP_DATA /currentuser --updated _?=<dossier>`, ceux d'`installUtil.nsh`) :
// sans le remède, sortie `-1073740940` ; avec, sortie `0` et arbre vidé.
//
// Ce fichier verrouille ce que la réparation doit garder pour rester une
// réparation, et chaque vérification porte sur une contrainte MESURÉE — les quatre
// suivantes ne sont pas des préférences de style :
//   • la redirection doit viser les sept `!define` d'`app-builder-lib`, et le fichier
//     doit être inclus APRÈS eux (`NsisTarget.computeCommonInstallerScriptHeader` :
//     StdUtils, les drapeaux, puis `nsis.include`) — sinon le greffon reste dans le
//     chemin compilé ;
//   • le jeton doit être cherché précédé d'une espace et sous les deux formes
//     acceptées par le greffon (`/drapeau`, `--drapeau`) : sans l'espace, un chemin
//     comme `C:\un/updated` passerait pour `--updated` ;
//   • la sonde ne doit contenir AUCUN `Call` : makensis refuse un `Call` vers une
//     fonction non `un.` dans la section du désinstalleur (« Call must be used with
//     function names starting with "un." in the uninstall section. »), et
//     `app-builder-lib` lit ces drapeaux LÀ (`PAGE_INSTALL_MODE`, `uninstaller.nsh`) ;
//     `${GetOptions}`/`${GetParameters}` sont écartés pour cette raison même ;
//   • ses étiquettes doivent être NUMÉROTÉES par insertion : sans compteur,
//     `_CHECK_APP_RUNNING` teste le même drapeau deux fois dans la même fonction et
//     makensis s'arrête (« label "mamaUpdatedScan:" already declared in function »).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel: string) => readFileSync(join(root, rel), 'utf8');

// Les lignes de CODE d'un script NSIS : `#` commente jusqu'à la fin de la ligne. Un
// lecteur de commentaires NSIS n'est pas une copie du blanchiment partagé
// (`maskComments` connaît TypeScript), et il est indispensable ici : la prose du
// dépôt cite toujours la valeur exacte des choses, donc une sonde CITÉE en commentaire
// satisferait les vérifications ci-dessous.
const nsisCode = (text: string): string[] =>
  text.split(/\r?\n/).filter((line) => !line.trimStart().startsWith('#'));

// Les sept drapeaux, dans l'ordre de `NsisTarget` (`scriptGenerator.flags([...])`),
// avec le suffixe de macro et le nom de ligne de commande de chacun.
const FLAGS: Array<[string, string, string]> = [
  ['isUpdated', 'Updated', 'updated'],
  ['isForceRun', 'ForceRun', 'force-run'],
  ['isKeepShortcuts', 'KeepShortcuts', 'keep-shortcuts'],
  ['isNoDesktopShortcut', 'NoDesktopShortcut', 'no-desktop-shortcut'],
  ['isDeleteAppData', 'DeleteAppData', 'delete-app-data'],
  ['isForAllUsers', 'ForAllUsers', 'allusers'],
  ['isForCurrentUser', 'ForCurrentUser', 'currentuser'],
];

const body = (text: string, suffix: string): string => {
  const match = text.match(new RegExp(`!macro _mama${suffix} _a _b _t _f\\n([\\s\\S]*?)!macroend`));
  assert.ok(match, `la macro _mama${suffix} doit exister`);
  return match[1];
};

describe('le désinstalleur des versions déjà installées ne sort plus en 0xC0000374', () => {
  const text = read('build/installer.nsh');
  const code = nsisCode(text).join('\n');

  it('redirige les SEPT drapeaux d’app-builder-lib, un par un', () => {
    // Sept, parce qu'`app-builder-lib` en engendre sept et en lit sept : un drapeau
    // laissé au gabarit d'origine garderait l'appel au greffon dans le chemin
    // compilé, donc le plantage dans la branche correspondante — c'est-à-dire, pour
    // `isDeleteAppData`, la décision d'effacer ou d'épargner les données du poste.
    for (const [flag, suffix] of FLAGS) {
      assert.match(
        code,
        new RegExp(`!insertmacro mamaRedirectFlag ${flag} ${suffix}\\b`),
        `sans redirection pour ${flag}, le gabarit _${flag} reste actif`,
      );
    }
    // Et la redirection REDÉFINIT le `!define` du gabarit, en gardant sa forme :
    // LogicLib ne retient que le deuxième mot de `"" mamaX ""` et insère `_mamaX`.
    assert.match(code, /!define \$\{FLAG\} `"" mama\$\{SUFFIX\} ""`/);
    assert.match(code, /!ifdef \$\{FLAG\}[\s\S]*?!undef \$\{FLAG\}/, 'redéfinir sans `!undef` est une erreur fatale (mesuré)');
  });

  it('cherche le jeton précédé d’une espace, dans les DEUX formes que le greffon accepte', () => {
    for (const [, suffix, param] of FLAGS) {
      const macro = body(code, suffix);
      // L'espace de tête est la frontière du jeton : sans elle, `C:\un/updated`
      // (un chemin) serait lu comme `--updated`.
      assert.match(macro, new RegExp(`StrLen \\$R6 " /${param}"`), `${suffix} : forme /${param} sans frontière`);
      assert.match(macro, new RegExp(`StrLen \\$R4 " --${param}"`), `${suffix} : forme --${param} sans frontière`);
      assert.match(macro, new RegExp(`StrCmp \\$R5 " /${param}"`));
      assert.match(macro, new RegExp(`StrCmp \\$R5 " --${param}"`));
      // `-drapeau` (un seul tiret) n'est pas retenu, comme chez le greffon : mesuré,
      // `-updated` est faux des deux côtés.
      assert.doesNotMatch(macro, new RegExp(`StrCmp \\$R5 " -${param}"`));
    }
  });

  it('n’appelle plus AUCUN greffon dans le chemin compilé', () => {
    // C'est la réparation elle-même : le fichier ne doit plus jamais citer StdUtils.
    // Mesuré : un script qui inclut ce fichier compile encore quand `StdUtils.nsh`
    // n'est même pas inclus — donc le gabarit du greffon n'est plus inséré nulle part.
    assert.doesNotMatch(code, /StdUtils/, 'le greffon corrompait le tas : il ne doit plus être cité');
    for (const [, suffix] of FLAGS) {
      assert.match(body(code, suffix), /StrCmp "\$R9" "true"/, `${suffix} : le verdict doit être celui de la sonde`);
    }
  });

  it('ne fait AUCUN `Call` : la section du désinstalleur l’interdit', () => {
    // Mesuré : « Call must be used with function names starting with "un." in the
    // uninstall section. » — la compilation du désinstalleur s'arrête là. C'est ce qui
    // écarte `${GetOptions}` / `${GetParameters}` (des macros qui appellent) et une
    // fonction avec l'idiome `Exch`.
    for (const [, suffix] of FLAGS) {
      assert.doesNotMatch(body(code, suffix), /\bCall\b/, `${suffix} : un Call ne compile pas dans la section du désinstalleur`);
    }
  });

  it('numérote ses étiquettes par insertion', () => {
    // Mesuré sur le désinstalleur émis : sans numérotation, `_CHECK_APP_RUNNING` teste
    // le même drapeau deux fois dans la même fonction et makensis refuse la
    // compilation (« label "mamaUpdatedScan:" already declared in function »).
    assert.match(code, /!macro mamaProbeId/, 'le compteur doit exister');
    assert.match(code, /!define \/redef \/math MAMA_PROBE_COUNTER/, 'la numérotation passe par le préprocesseur (comme LogicLib)');
    for (const [, suffix] of FLAGS) {
      const macro = body(code, suffix);
      assert.match(macro, /!insertmacro mamaProbeId/, `${suffix} : la sonde doit prendre un numéro à chaque insertion`);
      assert.match(macro, /mamaProbe\$\{MAMA_PROBE_COUNTER\}Scan:/, `${suffix} : étiquettes non numérotées`);
      assert.match(macro, /mamaProbe\$\{MAMA_PROBE_COUNTER\}Absent:/);
    }
  });

  it('porte le verdict dans $R9 et rétablit tout le reste', () => {
    // `$R9` est le registre que le gabarit d'origine clobbe déjà (il y reçoit la
    // réponse du greffon), donc s'y fier ne casse rien de plus. Le verdict doit y être
    // ENCORE au moment du `StrCmp` final : restaurer `$R9` avant le verdict a été
    // mesuré — la sonde répondait alors « faux » à tous les drapeaux.
    for (const [, suffix] of FLAGS) {
      const macro = body(code, suffix);
      assert.doesNotMatch(macro, /\b(Push|Pop)\s+\$R9\b/, `${suffix} : $R9 porte le verdict, il ne se sauvegarde pas`);
      assert.doesNotMatch(macro, /\b(Push|Pop)\s+\$R8\b/, `${suffix} : $R8 est utilisé par les gabarits alentour`);
      assert.doesNotMatch(macro, /\b(Push|Pop)\s+\$R0\b/, `${suffix} : $R0 porte le code du désinstalleur (handleUninstallResult)`);
      const pops = macro.lastIndexOf('Pop ');
      const compare = macro.indexOf('StrCmp "$R9" "true"');
      assert.ok(compare > pops, `${suffix} : le verdict doit être lu APRÈS le rétablissement des registres`);
    }
  });

  it('laisse la tolérance de §2 en place, et elle seule', () => {
    // §1 répare les désinstalleurs CONSTRUITS À PARTIR DE MAINTENANT ; celui qui plante
    // sur un poste est déjà installé, et c'est encore lui que l'installeur neuf lance
    // en premier. Tant que le parc n'a pas traversé une version réparée, §2 doit donc
    // rester — et elle doit rester le SEUL code toléré (voir
    // `tests/installer-uninstall-tolerance.test.ts`, qui verrouille la valeur).
    assert.match(code, /!macro customUnInstallCheck\b/);
    assert.match(code, /!macro customUnInstallCheckCurrentUser\b/);
    assert.match(code, /\$R0 == -1073740940/);
  });
});
