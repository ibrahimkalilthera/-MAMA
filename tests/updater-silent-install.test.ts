// Suite de la décision « l'installation d'une mise à jour ne demande RIEN ».
//
// Mesuré le 2026-10-15, poste de 1.0.35 : au milieu de la barre de progression,
// « MamaTheraFinance ne peut pas être fermé. Veuillez la fermer manuellement et
// cliquez sur Réessayer pour continuer. » — avec deux boutons, « Recommencer » et
// « Annuler » : recommencer ne débloque rien, seul « Annuler » fait continuer. La cause n'était pas dans l'installeur : elle
// était dans `quitAndInstall()` appelé SANS argument, donc `install(false, …)`
// (`BaseUpdater.js`), donc l'assistant et ses pages — alors que chacune des
// boîtes qui peuvent retenir une installation porte, dans le gabarit
// d'`app-builder-lib`, un défaut `/SD` qui n'est lu QU'en mode silencieux.
//
// Les cas ci-dessous verrouillent la décision ET ses hypothèses. Les derniers
// lisent le gabarit INSTALLÉ (`node_modules/app-builder-lib/templates/nsis`) et
// le runtime de la dépendance (`node_modules/electron-updater/out`) : ce sont
// les faits sur lesquels la décision repose, et ils appartiennent à des
// dépendances — une montée de version peut les retirer sans que rien d'autre ne
// rougisse, et l'installation se remettrait alors à attendre un clic, cette fois
// sans même une boîte visible pour le dire (en mode silencieux, une boîte sans
// défaut n'affiche rien : l'installation s'arrête, muette).
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

import { maskComments } from '../scripts/lib/source-text.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel: string) => readFileSync(join(root, rel), 'utf8');
const NSIS_TEMPLATES = 'node_modules/app-builder-lib/templates/nsis';

// Le gabarit réellement installé, récursivement (include/ compris).
const templateFiles = (dir = NSIS_TEMPLATES, found: string[] = []): string[] => {
  for (const entry of readdirSync(join(root, dir), { withFileTypes: true })) {
    if (entry.isDirectory()) templateFiles(join(dir, entry.name), found);
    else if (/\.(nsh|nsi)$/.test(entry.name)) found.push(join(dir, entry.name));
  }
  return found;
};

// Les lignes de CODE d'un script NSIS (`#` commente jusqu'en fin de ligne) : sans
// ce blanchiment, la prose du gabarit — qui cite ses propres boîtes — répondrait
// aux vérifications à la place du code.
const nsisCode = (text: string) =>
  text
    .split(/\r?\n/)
    .filter((line) => !line.trimStart().startsWith('#'))
    .join('\n');

// Ce que le build de CE projet ne compile PAS. Les deux gardes sont lues dans sa
// configuration, elles ne sont pas supposées : `oneClick: false` (donc pas de
// `ONE_CLICK`) et aucun `APP_PACKAGE_URL` (l'application est EMBARQUÉE dans
// l'installeur, elle n'est pas téléchargée à l'installation).
const OUT_OF_BUILD_GUARDS = ['ONE_CLICK', 'APP_PACKAGE_URL'];

// Chargé seulement sous `APP_PACKAGE_URL` (voir le contrôle qui suit) : ses
// lignes ne sont donc précédées d'aucun `!ifdef` à l'intérieur du fichier.
const OUT_OF_BUILD_FILES = new Set([join(NSIS_TEMPLATES, 'include', 'webPackage.nsh')]);

/** Lignes comprises dans un bloc `!ifdef <garde>` que ce projet ne définit pas. */
const linesOutOfBuild = (text: string): boolean[] => {
  const stack: boolean[] = [];
  return text.split(/\r?\n/).map((line) => {
    const open = line.match(/^\s*!ifdef\s+(\w+)/);
    const close = /^\s*!endif\b/.test(line);
    if (open) stack.push(OUT_OF_BUILD_GUARDS.includes(open[1]));
    else if (close) stack.pop();
    return stack.some(Boolean);
  });
};

describe('l’installation d’une mise à jour ne demande plus rien à personne', () => {
  const main = read('electron/main.cjs');
  const mainCode = maskComments(main);

  it('le clic demande une installation SILENCIEUSE et une relance', () => {
    // Sans argument, `quitAndInstall()` vaut `install(false, autoRunAppAfterInstall)`
    // (`BaseUpdater.js`) : l'installeur part en mode assisté, ses boîtes
    // s'affichent, et leurs défauts `/SD` — écrits pour le cas silencieux — ne
    // sont jamais lus. Les deux `true` sont donc la réparation elle-même, pas un
    // réglage de confort.
    //
    // Combien de portes mènent à `quitAndInstall()` est la propriété d'une autre
    // suite (`tests/updater-policy.test.ts`, « un seul propriétaire »). Celle-ci
    // n'exige qu'une chose : QUEL QUE SOIT l'appel présent, il demande ce mode-là.
    const calls = [...mainCode.matchAll(/quitAndInstall\s*\(([^)]*)\)/g)].map((m) => m[1].trim());
    assert.ok(calls.length > 0, 'aucun appel à `quitAndInstall()` : cette suite vérifierait un mode que personne ne demande');
    assert.deepEqual(
      [...new Set(calls)],
      ['true, true'],
      'sans argument l’installeur part en mode ASSISTÉ : c’est là que le bouton de relance (« Recommencer » sur la capture) tourne en rond (mesuré, 1.0.35)',
    );
  });

  it('garde la demande unique par process et la sentinelle AVANT la relance', () => {
    // Ce qui n'est pas retesté ici : que le verrou existe (installClaim) — il est
    // déjà couvert ailleurs. Ce qui l'est : que la réparation n'a pas emporté les
    // deux gestes qui l'entourent, et que la sentinelle est POSÉE avant que
    // l'application meure — c'est elle qui fait purger le cache partagé si le
    // poste revient sur la même version, donc l'ordre compte.
    const start = mainCode.indexOf('function requestInstall(');
    const end = mainCode.indexOf('async function askToInstall(');
    assert.ok(start > 0 && end > start, 'requestInstall() doit rester la seule porte d’installation');
    const body = mainCode.slice(start, end);
    assert.match(body, /installClaim\(\{ claimed: installClaimed \}\)/, 'le verrou de la demande doit rester dans le chemin');
    assert.match(body, /autoInstallOnAppQuit = false/, 'l’installation à la fermeture doit rester révoquée une fois la demande posée');
    assert.ok(
      body.indexOf('installPendingFlag()') < body.indexOf('quitAndInstall('),
      'la sentinelle doit être écrite AVANT la relance : après, l’application n’existe plus pour l’écrire',
    );
  });
});

describe('les hypothèses de cette décision, dans les dépendances installées', () => {
  it('`install(true, true)` devient bien `--updated /S --force-run`', () => {
    // C'est la traduction que NI l'installeur NI nous ne faisons : elle est dans
    // `electron-updater`. Si elle change, les deux `true` de `main.cjs` ne
    // voudront plus dire la même chose — et rien d'autre ne le dirait.
    const nsisUpdater = read('node_modules/electron-updater/out/NsisUpdater.js');
    assert.match(nsisUpdater, /const args = \["--updated"\];/, '`--updated` doit rester l’en-tête de la ligne de commande');
    assert.match(
      nsisUpdater,
      /if \(options\.isSilent\) \{\s*args\.push\("\/S"\);/,
      '`/S` ne doit sortir que du premier argument de `quitAndInstall`',
    );
    assert.match(
      nsisUpdater,
      /if \(options\.isForceRunAfter\) \{\s*args\.push\("--force-run"\);/,
      '`--force-run` ne doit sortir que du second : sans lui la relance ne vient d’aucune page',
    );
  });

  it('la fermeture du soir installe déjà en silencieux, sans relance', () => {
    // La moitié qui rend la décision défendable : le chemin éprouvé sur le canal
    // réel (`autoInstallOnAppQuit` → `install(true, false)`) est DÉJÀ silencieux.
    // Le clic ne change donc pas de doctrine, il cesse de lancer un installeur
    // d'un autre mode pour les mêmes octets — et n'ajoute que la relance.
    const baseUpdater = read('node_modules/electron-updater/out/BaseUpdater.js');
    assert.match(
      baseUpdater,
      /this\.install\(true, false\);/,
      'la fermeture de l’application doit continuer d’installer en silencieux et sans relancer',
    );
  });

  it('aucune boîte qui peut RETENIR une installation n’est sans défaut `/SD`', () => {
    // La propriété qui compte, et elle est version-indépendante : une boîte sans
    // `/SD` en mode silencieux n'affiche rien (NSIS la garde muette) et attend un
    // clic qui ne viendra jamais. C'est la panne d'origine, en pire — sans même
    // une boîte à montrer du doigt.
    const offenders: string[] = [];
    const blocking = /MessageBox\s+(?:MB_OKCANCEL|MB_RETRYCANCEL|MB_YESNO|MB_YESNOCANCEL|MB_ABORTRETRYIGNORE)\b/i;
    for (const file of templateFiles()) {
      if (OUT_OF_BUILD_FILES.has(file)) continue;
      const text = readFileSync(join(root, file), 'utf8');
      const skipped = linesOutOfBuild(text);
      nsisCode(text)
        .split(/\r?\n/)
        .forEach((line, i) => {
          if (skipped[i]) return;
          if (blocking.test(line) && !/\/SD\b/.test(line)) offenders.push(`${file}:${i + 1}  ${line.trim().slice(0, 90)}`);
        });
    }
    assert.deepEqual(
      offenders,
      [],
      'une boîte qui peut retenir une installation doit porter un défaut `/SD` — en mode silencieux, sans lui, elle ne s’affiche pas et l’installation s’arrête sans un mot',
    );
  });

  it('les deux boîtes exemptées par la propriété vivent vraiment hors de notre build', () => {
    // La propriété ci-dessus est fausse si l'on se contente de regarder ailleurs.
    // Deux boîtes du gabarit sont sans `/SD` : la confirmation de désinstallation
    // MANUELLE (`$(areYouSureToUninstall)`, dans un bloc `!ifdef ONE_CLICK`) et
    // celle du téléchargement du paquet (`webPackage.nsh`, dont l'INCLUDE est
    // sous `!ifdef APP_PACKAGE_URL`). Ce projet ne définit ni l'un ni l'autre —
    // et c'est ce qu'on vérifie ici, pour que l'exemption ne devienne pas une
    // croyance recopiée.
    assert.match(read('electron-builder.yml'), /^\s*oneClick:\s*false\s*$/m, 'ce projet construit un installeur assisté : `ONE_CLICK` n’est pas défini');
    assert.ok(!/packageUrl/.test(read('electron-builder.yml')), 'aucune URL de paquet : `APP_PACKAGE_URL` n’est pas défini');

    const uninstaller = read(`${NSIS_TEMPLATES}/uninstaller.nsh`);
    const askLine = uninstaller.split(/\r?\n/).findIndex((l) => /MessageBox MB_OKCANCEL "\$\(areYouSureToUninstall\)"/.test(l));
    assert.ok(askLine > 0, 'la confirmation de désinstallation doit rester là où on la croit — sinon la propriété a changé de sens');
    assert.equal(linesOutOfBuild(uninstaller)[askLine], true, 'elle doit rester dans son bloc `!ifdef ONE_CLICK` pour rester hors de notre build');

    const include = read(`${NSIS_TEMPLATES}/include/installer.nsh`);
    const includeLine = include.split(/\r?\n/).findIndex((l) => /!include\s+"?webPackage\.nsh"?/.test(l));
    assert.ok(includeLine > 0, 'l’include du paquet distant doit rester là où on la croit');
    assert.equal(linesOutOfBuild(include)[includeLine], true, 'son `!include` doit rester sous `!ifdef APP_PACKAGE_URL`');
  });

  it('la boîte du vieux désinstalleur répond « Annuler » quand personne ne peut cliquer', () => {
    // Celle de la capture du propriétaire. `/SD IDCANCEL` est le seul défaut qui
    // termine : « Réessayer » repart dans `OneMoreAttempt`, relance le
    // désinstalleur de la version en place UNE fois de plus, et le compteur
    // `$R5` — jamais redescendu sous cinq — ramène la MÊME boîte. C'est
    // précisément ce que le propriétaire a décrit.
    const util = nsisCode(read(`${NSIS_TEMPLATES}/include/installUtil.nsh`));
    const boxes = util.split(/\r?\n/).filter((l) => /MessageBox\s+MB_RETRYCANCEL/.test(l) && /appCannotBeClosed/.test(l));
    assert.equal(boxes.length, 1, 'la boucle du vieux désinstalleur doit garder une seule boîte');
    assert.match(
      boxes[0],
      /\/SD IDCANCEL IDRETRY OneMoreAttempt/,
      'le défaut silencieux doit être IDCANCEL (continuer) — IDRETRY ferait tourner la boucle sans fin',
    );
    assert.match(util, /^\s*OneMoreAttempt:/m, 'le libellé du bouton « Réessayer » doit rester le point d’entrée de la boucle');
  });

  it('la boîte de l’extraction retombe sur le dernier recours', () => {
    // Celle-ci ne bloque personne en silencieux, mais pour une AUTRE raison que
    // celle du dessus, et la confondre serait une erreur de lecture : `/SD
    // IDRETRY` n'est pas « recommencer », c'est ne PAS prendre la branche
    // `IDCANCEL AbortExtract7za` — donc tomber dans le `Nsis7z::Extract` en place
    // (dernier recours, erreurs ignorées) et CONTINUER.
    const extract = nsisCode(read(`${NSIS_TEMPLATES}/include/extractAppPackage.nsh`));
    const boxes = extract.split(/\r?\n/).filter((l) => /MessageBox\s+MB_RETRYCANCEL/.test(l) && /appCannotBeClosed/.test(l));
    assert.equal(boxes.length, 1, 'l’extraction doit garder une seule boîte');
    assert.match(boxes[0], /\/SD IDRETRY IDCANCEL AbortExtract7za/, 'le défaut silencieux doit tomber sur le dernier recours, pas sur `Quit`');
  });

  it('la relance de l’installeur assisté n’existe qu’en mode silencieux', () => {
    // L'autre moitié de la décision : c'est CE branchement qui rend le second
    // `true` nécessaire. Sur un installeur assisté, la relance vient sinon de la
    // case de la page finale — qu'une installation silencieuse n'a pas.
    assert.match(
      nsisCode(read(`${NSIS_TEMPLATES}/installSection.nsh`)),
      /\$\{if\}\s+\$\{isForceRun\}\s*\n\s*\$\{andIf\}\s+\$\{Silent\}/,
      'la relance assistée doit rester conditionnée à `${isForceRun}` ET `${Silent}` : sans `--force-run`, l’application ne reviendrait pas',
    );
  });
});
