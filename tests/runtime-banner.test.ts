// Suite for scripts/lib/runtime-banner.mjs — the dev-server runtime banner.
//
// The banner answers two questions at the one moment they are cheap to answer:
// which runtime is serving, and whether a DIFFERENT node major sits in the
// environment. Both are otherwise discovered much later (a red `build` in CI, a
// lockfile installed by another runtime), which is why the suite asserts the
// FORMAT of the warning — the two majors, the remedy — and not only that
// something was printed.
//
// Nothing here spawns: the version runner is injected, so every filtering rule
// (project-owned paths, same major, unreadable version, cap) is asserted as a
// decision. The one integration case calls the plugin's `configureServer` with a
// captured logger, on the real repository root — that is the wiring the dev
// server actually goes through.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  ROOT,
  bannerLines,
  devRuntimeBanner,
  isProjectOwned,
  otherNodes,
  pathNodeCandidates,
  pinnedMajorOrNull,
  versionOf,
} from '../scripts/lib/runtime-banner.mjs';
import { majorOf } from '../scripts/lib/node-runtime.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

describe('bannerLines — ce que le serveur dit de lui-même, et ce qu’il prévient', () => {
  it('majeur conforme : une ligne, le runtime nommé, le pin cité', () => {
    const lines = bannerLines({ pinned: 22, runVersion: '22.23.2', execPath: 'C:\\rt\\node.exe' });
    assert.equal(lines.length, 1);
    assert.match(lines[0], /^🟢 dev : Node 22\.23\.2/);
    assert.match(lines[0], /majeur 22 attendu/);
    assert.match(lines[0], /\.nvmrc/);
    assert.match(lines[0], /C:\\rt\\node\.exe/, 'le chemin exact du runtime est la preuve, pas un nom');
  });

  it('majeur DIFFÉRENT : les deux majors et le remède, pas un simple « attention »', () => {
    const lines = bannerLines({ pinned: 22, runVersion: '24.20.0' });
    assert.equal(lines.length, 2);
    assert.match(lines[0], /^⚠️ {2}dev : ce serveur tourne sur Node 24\.20\.0/);
    assert.match(lines[0], /épingle le majeur 22/);
    assert.match(lines[1], /npm run dev/);
    assert.match(lines[1], /casse plus loin/, 'la raison, pas seulement la règle');
  });

  it('.nvmrc illisible : le bandeau le DIT au lieu d’inventer un majeur', () => {
    const lines = bannerLines({ pinned: null, runVersion: '24.20.0' });
    assert.equal(lines.length, 1);
    assert.match(lines[0], /\.nvmrc` illisible/);
    assert.doesNotMatch(lines[0], /🟢/, 'pas de vert sans référence');
  });

  it('un autre Node de l’environnement est nommé, version et chemin', () => {
    const lines = bannerLines({
      pinned: 22,
      runVersion: '22.23.2',
      others: [{ path: 'C:\\Program Files\\nodejs\\node.exe', version: 'v24.20.0', major: 24 }],
    });
    assert.equal(lines.length, 2);
    assert.match(lines[1], /autre Node dans l'environnement : v24\.20\.0/);
    assert.match(lines[1], /C:\\Program Files\\nodejs\\node\.exe/);
    assert.match(lines[1], /entrées du projet, non/, 'la conséquence est dite, pas sous-entendue');
  });
});

describe('otherNodes — l’autre majeur, et seulement lui', () => {
  it('écarte le runtime du projet (l’épinglage lui-même) et le même majeur', () => {
    const probed: string[] = [];
    const runVersion = (p: string) => {
      probed.push(p);
      return p.includes('Program Files') ? 'v24.20.0' : 'v22.23.2';
    };
    const others = otherNodes({
      candidates: [
        'C:\\repo\\node_modules\\.bin\\node.cmd',
        'C:\\Users\\u\\AppData\\Local\\npm-cache\\_npx\\52027\\node_modules\\node\\bin\\node.exe',
        'C:\\Program Files\\nodejs\\node.exe',
        'C:\\tools\\node22\\node.exe',
      ],
      runVersion,
      pinned: 22,
    });
    assert.deepEqual(others.map((o) => o.major), [24]);
    assert.deepEqual(probed, ['C:\\Program Files\\nodejs\\node.exe', 'C:\\tools\\node22\\node.exe']);
    assert.equal(probed.some((p) => p.includes('node_modules')), false, 'le pin n’est pas sondé du tout');
  });

  it('une version illisible n’est jamais transformée en « autre majeur »', () => {
    const others = otherNodes({
      candidates: ['C:\\a\\node.exe', 'C:\\b\\node.exe', ''],
      runVersion: (p) => (p.endsWith('a\\node.exe') ? '' : 'pas une version'),
      pinned: 22,
    });
    assert.deepEqual(others, []);
  });

  it('sans pin lisible, tout autre Node est signalé (mais toujours borné)', () => {
    const others = otherNodes({
      candidates: ['C:\\1\\node.exe', 'C:\\2\\node.exe', 'C:\\3\\node.exe', 'C:\\4\\node.exe'],
      runVersion: () => 'v24.20.0',
      pinned: null,
      limit: 2,
    });
    assert.equal(others.length, 2, 'le nombre de sous-processus lancés reste borné');
  });

  it('un chemin sous node_modules est « au projet », où qu’il soit', () => {
    assert.equal(isProjectOwned('C:\\repo\\node_modules\\.bin\\node.cmd'), true);
    assert.equal(isProjectOwned('/usr/lib/node_modules/node/bin/node'), true);
    assert.equal(isProjectOwned('C:\\Program Files\\nodejs\\node.exe'), false);
    assert.equal(isProjectOwned(''), false);
  });
});

describe('lecture de la machine — jamais fatale', () => {
  it('le majeur épinglé vient du fichier, pas d’une constante', () => {
    assert.equal(pinnedMajorOrNull(root), majorOf(readFileSync(join(root, '.nvmrc'), 'utf8')));
    assert.equal(pinnedMajorOrNull(join(root, 'dossier-qui-nexiste-pas')), null);
  });

  it('un `where`/`which` indisponible rend une liste vide, pas une exception', () => {
    const boom = () => {
      throw new Error('pas de where ici');
    };
    assert.deepEqual(pathNodeCandidates({ spawn: boom as never }), []);
    assert.deepEqual(pathNodeCandidates({ platform: 'linux', spawn: (() => ({ stdout: '' })) as never }), []);
  });

  it('un node qui ne répond pas (ou un .cmd non spawnable) ne prétend rien', () => {
    assert.equal(versionOf('C:\\x\\node.exe', { spawn: (() => ({ status: 1, stdout: 'x' })) as never }), '');
    assert.equal(
      versionOf('C:\\x\\node.cmd', {
        spawn: (() => {
          throw new Error('EINVAL');
        }) as never,
      }),
      '',
    );
    assert.equal(versionOf('C:\\x\\node.exe', { spawn: (() => ({ status: 0, stdout: 'v22.23.2\n' })) as never }), 'v22.23.2');
  });
});

describe('câblage — le bandeau part vraiment au démarrage du serveur de dev', () => {
  it('le plugin se branche sur configureServer et imprime sur le logger de Vite', () => {
    const seen: string[] = [];
    const server = {
      config: {
        logger: {
          info: (line: string) => seen.push(line),
          warn: (line: string) => seen.push(`WARN ${line}`),
        },
      },
    };
    const plugin = devRuntimeBanner({ root: ROOT });
    assert.equal(plugin.name, 'mama-dev-runtime-banner');
    assert.equal(typeof plugin.configureServer, 'function');
    plugin.configureServer(server as never);

    // La suite tourne elle aussi sur un Node : `npm test` l'épinglé, un appel
    // direct sur celui du poste. Les deux sont des cas légitimes, et le bandeau
    // doit dire la VÉRITÉ dans les deux — c'est justement ce que ce test vérifie,
    // pas un vert obtenu seulement sur la machine qui a le bon majeur.
    const pinned = pinnedMajorOrNull(ROOT);
    const running = process.versions.node;
    const matches = majorOf(running) === pinned;
    assert.ok(seen.length >= 1, 'le démarrage doit dire quelque chose');
    assert.match(
      seen[0],
      matches ? /^🟢 dev : Node/ : /^⚠️ {2}dev : ce serveur tourne sur Node/,
      `première ligne inattendue sur Node ${running} avec un pin à ${pinned}`,
    );
    assert.ok(seen[0].includes(running), 'le runtime réellement utilisé est nommé, dans tous les cas');

    // Et aucun autre Node n’est inventé : chaque ligne « autre Node » désigne un
    // chemin réellement listé par le système, hors du runtime du projet, et un
    // majeur réellement différent du pin.
    //
    // La règle se juge LIGNE PAR LIGNE, pas globalement : « le majeur courant
    // correspond au pin » (cas de `npm test`, qui tourne sous le runtime épinglé)
    // n’implique PAS que l’environnement soit propre — c’est même exactement
    // quand le processus est correct qu’un node du poste, lui, ne l’est pas, et
    // c’est ce que le bandeau doit dire. Un test qui exigerait zéro ligne "autre
    // Node" dès que le processus est épinglé interdirait la seule alerte utile.
    const printed = seen.filter((l) => l.includes("autre Node dans l'environnement"));
    for (const line of printed) {
      const path = line.match(/autre Node dans l'environnement : \S+ \((.+)\) —/)?.[1] ?? '';
      assert.ok(path, `ligne sans chemin : ${line}`);
      assert.ok(
        pathNodeCandidates().includes(path),
        `${path} n’est pas listé par where/which : le bandeau ne doit pas inventer de chemin`,
      );
      assert.equal(isProjectOwned(path), false, 'le runtime du projet n’est pas un avertissement');
      assert.notEqual(majorOf(versionOf(path)), pinned, 'un même majeur n’est pas un avertissement');
    }
  });

  it('un bandeau qui ne peut plus s’exécuter ne casse pas `npm run dev`', () => {
    const plugin = devRuntimeBanner({ root: ROOT });
    assert.doesNotThrow(() => plugin.configureServer({} as never), 'aucun serveur : silence, pas une panne');
    assert.doesNotThrow(() =>
      plugin.configureServer({
        config: {
          logger: {
            info: () => {
              throw new Error('logger cassé');
            },
            warn: () => {},
          },
        },
      } as never),
    );
  });

  it('vite.config.ts l’enregistre dans ses plugins (sinon le module est mort)', () => {
    const config = readFileSync(join(root, 'vite.config.ts'), 'utf8');
    assert.match(config, /import \{devRuntimeBanner\} from '\.\/scripts\/lib\/runtime-banner\.mjs'/);
    assert.match(config, /plugins: \[react\(\), tailwindcss\(\), devRuntimeBanner\(\)\]/);
  });
});
