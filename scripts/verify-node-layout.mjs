/**
 * Vérifie, SUR LA MACHINE qui l'exécute, que la résolution npm/node tombe sur
 * le vrai layout de sa plateforme — pas sur une arborescence fabriquée.
 *
 * POURQUOI CE SCRIPT EXISTE
 * -------------------------
 * Les tests fabriquent des arbres temporaires pour couvrir les deux layouts
 * (`<prefix>/node_modules/npm` pour Windows, `<prefix>/lib/node_modules/npm`
 * pour Unix). Ces cas valident la LISTE DES CANDIDATS — et ils ne peuvent, par
 * construction, rien dire de ce qu'une machine a réellement installé. Le jour
 * où la recherche ne connaissait que le layout Windows, les tests étaient verts
 * et le runner ubuntu rouge : `resolveNpmCliJs` levait là-bas pendant que la
 * suite locale l'approuvait.
 *
 * D'où une matrice CI, une OS par platform, qui exécute ce script sur un vrai
 * runner : `ubuntu-latest` prouve le layout Unix, `windows-latest` le layout
 * Windows. Le noyau de décision est pur (`evaluateLayout`) et les sondes sont
 * injectées, donc les branches sont assertables ; mais la preuve des DEUX
 * layouts vient des runners, pas d'une arborescence de test.
 *
 * Ce qui est vérifié, et pourquoi chaque point :
 *   1. la résolution aboutit, et le fichier existe ;
 *   2. ce fichier EXÉCUTE npm (`node npm-cli.js --version` → une version) — un
 *      chemin qui existe n'est pas forcément npm ;
 *   3. si npm est réellement à côté de node, la résolution doit tomber sur CE
 *      fichier-là, dans le layout attendu pour la plateforme : c'est le point
 *      qui ferme le trou « vert ici, rouge là-bas » ;
 *   4. si npm n'est PAS à côté de node (distribution `node@` du registre, qui
 *      ne l'embarque pas), le dire et se contenter d'un chemin explicite — les
 *      deux cas sont distincts et ne doivent pas être confondus.
 *
 * Usage : npm run check:node-layout   (CI : matrice ubuntu + windows)
 */
import { existsSync, realpathSync, statSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { NPM_NESTED_LAYOUTS, explainNpmCliJs } from './lib/npm-cli.mjs';

/**
 * Le layout que chaque plateforme utilise RÉELLEMENT pour un install standard.
 * Un `null` veut dire « plateforme inconnue » : on rapporte, on ne prétend pas.
 * @param {string} platform
 * @returns {string | null}
 */
export function expectedLayout(platform) {
  if (platform === 'win32') return 'node_modules';
  if (platform === 'linux' || platform === 'darwin')
    return NPM_NESTED_LAYOUTS.find((l) => l.includes('lib')) ?? null;
  return null;
}

/**
 * Le verdict, pur : tout ce qui dépend de la machine arrive en paramètre.
 *
 * @param {object} input
 * @param {string} input.platform `process.platform`
 * @param {{ path: string | null, source: string | null, layout: string | null }} input.resolved
 * @param {{ path: string | null, layout: string | null }} input.beside npm trouvé BESIDE node, sinon null
 * @param {boolean} input.resolvedExists le chemin résolu existe-t-il sur le disque ?
 * @param {string | null} input.cliVersion sortie de `node <cli> --version`, sinon null
 * @returns {{ ok: boolean, lines: string[] }} lignes préfixées ✅ / ❌ / ℹ️
 */
export function evaluateLayout({ platform, resolved, beside, resolvedExists, cliVersion }) {
  const lines = [];
  const expected = expectedLayout(platform);
  const source = resolved?.source ?? null;

  if (!resolved?.path) {
    lines.push('❌ aucune résolution : npm-cli.js est introuvable sur cette machine.');
    return { ok: false, lines };
  }
  if (!resolvedExists) {
    lines.push(`❌ le chemin résolu n'existe pas : ${resolved.path}`);
    return { ok: false, lines };
  }
  if (!/^\d+\.\d+\.\d+/.test(String(cliVersion ?? ''))) {
    lines.push(
      `❌ le chemin résolu n'exécute pas npm (${resolved.path} → ${cliVersion ?? 'aucune sortie'}).`,
    );
    return { ok: false, lines };
  }

  lines.push(`ℹ️  npm réellement installé : ${beside?.path ?? 'absent de l’arbre node'} (source : ${source})`);
  lines.push(`ℹ️  ce chemin exécute npm ${String(cliVersion).trim()}`);

  if (!beside?.path) {
    // Une distribution `node@<majeur>` du registre n'embarque pas npm : exiger
    // le layout de la plateforme ici serait exiger quelque chose que la machine
    // n'a pas. Ce qui compte est que le chemin soit EXPLICITE (déclaré ou trouvé
    // sur le PATH), jamais deviné au hasard.
    if (source === 'declared' || source === 'path') {
      lines.push(
        `✅ ce node n'embarque pas npm (${source}) : le layout de la plateforme n'est pas applicable ici.`,
      );
      return { ok: true, lines };
    }
    lines.push(`❌ résolution sans npm à côté de node et sans provenance explicite (source : ${source}).`);
    return { ok: false, lines };
  }

  if (beside.layout !== expected) {
    lines.push(
      `❌ npm est installé dans « ${beside.layout} » alors que ${platform} utilise « ${expected} » — ` +
        `le contrat des layouts et la machine ont divergé.`,
    );
    return { ok: false, lines };
  }
  if (resolved.path !== beside.path) {
    lines.push(
      source === 'declared'
        ? `❌ MAMA_NPM_CLI_JS court-circuite la recherche (${resolved.path}) alors que cette machine ` +
            `a son npm dans ${beside.path} : le layout réel de la plateforme n'est pas vérifié ici.`
        : `❌ la résolution n'a PAS trouvé le npm de la machine (attendu ${beside.path}, obtenu ` +
            `${resolved.path}, source : ${source}) — c'est le trou « vert localement, rouge sur le runner ».`,
    );
    return { ok: false, lines };
  }

  lines.push(`✅ layout réel de ${platform} prouvé : ${beside.layout} → ${resolved.path}`);
  return { ok: true, lines };
}

/** `node <cli> --version`, sans shell (un shell est ce que la panique de fork tue). */
function npmVersionVia(npmNode, cliPath) {
  try {
    const r = spawnSync(npmNode, [cliPath, '--version'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    return r.status === 0 ? String(r.stdout).trim().split(/\r?\n/).pop() || null : null;
  } catch {
    return null;
  }
}

/**
 * L'état réel de cette machine, lu sans aucune injection :
 *   • la résolution telle que la chaîne l'obtiendra (déclaré inclus) ;
 *   • ce que node a VRAIMENT à côté de lui (repli et override désactivés).
 */
export function inspectMachine({ execPath = process.execPath, platform = process.platform } = {}) {
  const resolved = explainNpmCliJs(execPath);
  const besideRaw = explainNpmCliJs(execPath, { declared: '', which: () => null });
  return {
    platform,
    execPath,
    resolved,
    beside: { path: besideRaw.path, layout: besideRaw.layout },
    resolvedExists: Boolean(resolved.path) && existsSync(resolved.path) && statSync(resolved.path).isFile(),
    cliVersion: resolved.path ? npmVersionVia(execPath, resolved.path) : null,
  };
}

function main() {
  const machine = inspectMachine();
  console.log(
    `🔎 Layout npm réel — ${machine.platform}, Node ${process.version} (${machine.execPath})`,
  );
  const { ok, lines } = evaluateLayout(machine);
  for (const line of lines) console.log(line);
  if (!ok) {
    console.error(
      '\nLe layout npm de cette plateforme n’est pas celui que la résolution trouve — ' +
        'la chaîne tournerait avec un npm qui n’est pas celui de la machine.',
    );
    process.exitCode = 1;
  }
}

/** N'exécuter le rapport que si le fichier est lancé, jamais à l'import (tests). */
function invokedDirectly() {
  try {
    const self = realpathSync(fileURLToPath(import.meta.url));
    return Boolean(process.argv[1]) && realpathSync(process.argv[1]) === self;
  } catch {
    return false;
  }
}

if (invokedDirectly()) main();
