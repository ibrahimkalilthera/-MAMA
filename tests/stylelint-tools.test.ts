// Suite for scripts/lib/stylelint-tools.mjs — le maillon CSS qui tourne depuis
// l'arbre ISOLÉ `tools/csslint/`.
//
// POURQUOI ELLE EXISTE
// --------------------
// `stylelint` était une devDependency RACINE, et sa dernière version embarque
// encore `micromatch → braces@3.0.3` : `braces` n'a AUCUNE version corrigée en
// amont (`<= 3.0.3`, patched: none), donc un `overrides` ne peut pas viser un
// correctif qui n'existe pas, et le seul « remède » que npm propose est un
// DOWNGRADE (stylelint 7.7.0) qui casserait le gate CSS. Le linter a donc
// déménagé dans un manifeste isolé, `tools/csslint/`, hors du lockfile racine —
// le même remède que le CLI Vercel avant lui. Les 7 avis `high` sortent ainsi du
// gate d'audit de l'APPLICATION, tandis que l'arbre isolé reste audité en
// avertissement seul à chaque push (`scripts/report-tools-audit.mjs`).
//
// Ce qui ne doit PAS bouger avec lui, c'est le gate : même version de stylelint,
// même `stylelint.config.js`, mêmes règles. Deux propriétés seraient des
// régressions SILENCIEUSES si elles cassaient, et chacune est asserée ici :
//
//   1. l'entrée est LUE dans le `bin` DÉCLARÉ du paquet isolé — jamais un chemin
//      recopié, jamais un repli sur le `node_modules` racine (qui n'existe plus,
//      et c'est justement le but) ;
//   2. les PLUGINS du config (`stylelint-order`, `stylelint-scss`) se résolvent
//      depuis l'arbre isolé, où ils vivent maintenant — sans `--config-basedir`,
//      stylelint mourrait sur une erreur de résolution de plugin.
//
// Chaque branche d'échec est ASSERÉE, pas espérée : arbre absent, manifeste
// illisible, `bin` manquant ou malformé, entrée déclarée mais absente du disque,
// et le remède que le message d'échec nomme — qui doit exister pour de vrai.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, isAbsolute, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const {
  INSTALL_SCRIPT,
  ISOLATED_DIR,
  ISOLATED_TOOL,
  isolatedManifest,
  isolatedModules,
  missingTreeMessage,
  stylelintArgv,
  stylelintEntry,
} = await import('../scripts/lib/stylelint-tools.mjs');

const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));

// Un arbre isolé FABRIQUÉ : seuls comptent les chemins présents et le manifeste
// lu. C'est la couture injectable du module (exists / readPackage) qui rend
// chaque branche prouvable sans toucher au vrai `node_modules`.
const PACKAGE_DIR = join(isolatedModules('/projet'), ISOLATED_TOOL);
const MANIFEST = join(PACKAGE_DIR, 'package.json');
const ENTRY = join(PACKAGE_DIR, 'bin', 'stylelint.mjs');

const fakeFs = (paths: string[], manifest: unknown | 'unreadable') => ({
  exists: (p: string) => paths.includes(p),
  readPackage: () => {
    if (manifest === 'unreadable') throw new Error('EACCES');
    return manifest;
  },
});

const DECLARED = { bin: { stylelint: 'bin/stylelint.mjs' } };

describe('résolution — l’entrée est LUE dans le `bin` déclaré, jamais devinée', () => {
  it('lit l’entrée déclarée par le paquet isolé', () => {
    const found = stylelintEntry({ root: '/projet', ...fakeFs([MANIFEST, ENTRY], DECLARED) });
    assert.deepEqual(found, { entry: ENTRY, packageDir: PACKAGE_DIR });
  });

  it('un arbre absent rend null — jamais un repli sur le node_modules racine', () => {
    // C'est LE cas qui compte : retomber sur un stylelint racine rouvrirait le
    // chemin `braces` que l'isolement a fermé, en silence.
    const found = stylelintEntry({ root: '/projet', ...fakeFs([], DECLARED) });
    assert.equal(found, null);
  });

  it('un manifeste illisible rend null, pas une exception', () => {
    const found = stylelintEntry({ root: '/projet', ...fakeFs([MANIFEST, ENTRY], 'unreadable') });
    assert.equal(found, null);
  });

  it('un `bin` qui ne déclare pas stylelint (ou pas un objet) rend null', () => {
    for (const manifest of [
      { bin: './cli.js' }, // bin chaîne : la commande est le nom du paquet
      { bin: { autre: 'bin/x.mjs' } },
      { bin: 42 },
      {},
    ]) {
      const found = stylelintEntry({ root: '/projet', ...fakeFs([MANIFEST, ENTRY], manifest) });
      assert.equal(found, null, JSON.stringify(manifest));
    }
  });

  it('déclaré mais absent du disque = non résolu', () => {
    const found = stylelintEntry({ root: '/projet', ...fakeFs([MANIFEST], DECLARED) });
    assert.equal(found, null);
  });
});

describe('argv — la base de résolution des PLUGINS suit les arguments', () => {
  it('l’entrée, les arguments reçus, puis `--config-basedir` sur l’arbre isolé', () => {
    const argv = stylelintArgv({ entry: ENTRY, args: ['src/**/*.css', '--cache'], root: '/projet' });
    assert.deepEqual(argv, [
      ENTRY,
      'src/**/*.css',
      '--cache',
      '--config-basedir',
      isolatedModules('/projet'),
    ]);
    // Le drapeau est en DERNIER et vise le node_modules de l'arbre isolé : c'est
    // ce qui permet à `stylelint-order`/`stylelint-scss` d'être trouvés là où
    // ils vivent désormais, et nulle part ailleurs.
    assert.equal(argv.at(-2), '--config-basedir');
    assert.equal(argv.at(-1), join('/projet', ISOLATED_DIR, 'node_modules'));
  });

  it('sans argument, seul le drapeau de base reste', () => {
    assert.deepEqual(stylelintArgv({ entry: ENTRY, root: '/projet' }), [
      ENTRY,
      '--config-basedir',
      isolatedModules('/projet'),
    ]);
  });
});

describe('l’échec nommé — ce qui manque, où, et le remède', () => {
  it('le message nomme le dossier absent, l’avis sans correctif et la commande qui répare', () => {
    const message = missingTreeMessage({ root: '/projet' });
    assert.match(message, /tools[\\/]csslint[\\/]node_modules/, 'le dossier absent doit être nommé');
    assert.match(message, /braces/, 'la raison de l’isolement doit être dite');
    assert.match(message, new RegExp(`npm run ${INSTALL_SCRIPT}`), 'le remède doit être nommé');
    assert.ok(
      message.includes(isolatedModules('/projet')),
      'le chemin ABSENT doit figurer tel quel dans le message',
    );
  });
});

describe('le dépôt réel — l’arbre INSTALLÉ, et la racine bien nettoyée', () => {
  const found = stylelintEntry({ root });

  it('stylelint est résolu DEPUIS l’arbre isolé', () => {
    assert.ok(found, `tools/csslint/ doit être installé : npm run ${INSTALL_SCRIPT}`);
    assert.ok(isAbsolute(found.entry), found.entry);
    assert.ok(existsSync(found.entry), `l’entrée résolue doit exister : ${found.entry}`);
    assert.ok(
      found.entry.includes(join(ISOLATED_DIR, 'node_modules', ISOLATED_TOOL)),
      `l’entrée doit vivre dans ${ISOLATED_DIR}/node_modules/${ISOLATED_TOOL} : ${found.entry}`,
    );
  });

  it('stylelint n’est PLUS un paquet racine — c’est ce qui retire `braces` du gate', () => {
    assert.equal(
      existsSync(join(root, 'node_modules', ISOLATED_TOOL)),
      false,
      'stylelint ne doit plus exister à la racine : sa présence y ramènerait `braces`',
    );
    assert.ok(!(pkg.dependencies ?? {})[ISOLATED_TOOL], 'dependencies ne doit plus déclarer stylelint');
    assert.ok(!(pkg.devDependencies ?? {})[ISOLATED_TOOL], 'devDependencies ne doit plus déclarer stylelint');
  });

  it('le remède annoncé existe vraiment comme script npm', () => {
    // Un message qui conseille une commande inexistante est un faux remède : le
    // script doit être déclaré ET viser l'arbre isolé.
    const install = pkg.scripts?.[INSTALL_SCRIPT];
    assert.ok(install, `scripts.${INSTALL_SCRIPT} doit exister`);
    assert.match(install, /npm ci --prefix/);
    assert.ok(install.includes(ISOLATED_DIR), `l’installation doit viser ${ISOLATED_DIR} : ${install}`);
  });

  it('la chaîne atteint le CSS par le script isolé, plus par un binaire racine', () => {
    assert.match(pkg.scripts['lint:chain'], /node scripts\/stylelint-tools\.mjs/);
    // Aucun `stylelint "…"` nu : le seul `stylelint` restant est le nom du
    // script (`stylelint-tools.mjs`), suivi d’un tiret, pas d’un espace.
    assert.doesNotMatch(pkg.scripts['lint:chain'], /(^|\s)stylelint\s/);
  });
});

describe('le maillon CLI — le code de sortie de stylelint est PRÉSERVÉ', () => {
  const LINK = join(root, 'scripts', 'stylelint-tools.mjs');
  const runLink = (args: string[], input?: string) =>
    spawnSync(process.execPath, [LINK, ...args], { cwd: root, input, encoding: 'utf8' });

  it('un CSS fautif rend un ÉCHEC, avec le nom de la règle et du plugin', () => {
    // Aucun fichier écrit : le code passe par stdin sous un nom VIRTUEL dans
    // `src/`, si bien que c'est la config du DÉPÔT qui s'applique — et c'est le
    // jeu de règles réel qui doit mordre. Si `reportNeedlessDisables` ou le
    // chargement des plugins cassait, ce cas rougirait.
    const out = runLink(
      ['--stdin-filename', 'src/probe.css'],
      '.probe { color: red !important; background: blue; }\n',
    );
    const text = `${out.stdout}${out.stderr}`;
    assert.notEqual(out.status, 0, `un CSS fautif ne peut pas sortir 0 —\n${text}`);
    assert.match(text, /declaration-no-important/);
    // `order/properties-alphabetical-order` vient d’un PLUGIN : sa présence prouve
    // que la base de résolution pointe bien vers l'arbre isolé.
    assert.match(text, /order\/properties-alphabetical-order/);
  });

  it('un CSS propre sort 0 — le gate reste un gate, pas un refus systématique', () => {
    const out = runLink(['--stdin-filename', 'src/probe.css'], '.probe { background: blue; color: red; }\n');
    assert.equal(out.status, 0, `${out.stdout}${out.stderr}`);
  });
});
