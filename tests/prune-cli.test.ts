// Suite for scripts/prune-release-dir.mjs — le CLI, LANCÉ POUR DE VRAI.
//
// WHY THIS EXISTS
// ---------------
// Cette suite remplace cinq assertions qui lisaient la SOURCE du CLI avec des
// expressions régulières (« assert.match(source, /const apply = .../) »). Elles
// valaient zéro couverture de comportement : deux des trois défauts du rappel
// (le dossier absent de la commande, la phrase fausse sur un atelier vide) les
// ont traversées sans être vus, parce qu'aucune ne regardait le CLI tourner.
//
// Le canal est lu depuis un FICHIER (`--channel=`) au lieu de l'API : c'est la
// seule couture nécessaire, et elle est explicite. Sans elle, exercer le vrai
// CLI demanderait le réseau, et la suite redeviendrait une lecture de texte.
//
// Ce qui est vérifié ici est le comportement OBSERVABLE : les octets sur le
// disque, le code de sortie, et ce que le CLI accepte de dire.
import { strict as assert } from 'node:assert';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, describe, it } from 'node:test';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CLI = join(ROOT, 'scripts', 'prune-release-dir.mjs');
// Un atelier de travail doit vivre SOUS la racine : `--dir` et `--channel` sont
// résolus depuis elle, et c'est aussi ce que fait un vrai lancement.
const SCRATCH = `tmp-prune-cli-${process.pid}`;

after(() => rmSync(join(ROOT, SCRATCH), { recursive: true, force: true }));

/** Le CLI lancé pour de vrai, sans jeton et sans réseau. */
function runCli(args: string[], env: Record<string, string> = {}) {
  const result = spawnSync(process.execPath, [CLI, ...args], {
    cwd: ROOT,
    encoding: 'utf8',
    env: { ...process.env, GH_TOKEN: '', GITHUB_TOKEN: '', WORKSHOP_SOFT_OFFLINE: '', ...env },
  });
  return { code: result.status, out: String(result.stdout), err: String(result.stderr) };
}

/** Un atelier jetable : des octets nommés, et les dossiers demandés. */
function atelier(caseName: string, files: Record<string, string>, dirs: string[] = []) {
  const dir = join(SCRATCH, caseName, 'atelier');
  mkdirSync(join(ROOT, dir), { recursive: true });
  for (const [name, content] of Object.entries(files)) {
    writeFileSync(join(ROOT, dir, name), content);
  }
  for (const name of dirs) {
    mkdirSync(join(ROOT, dir, name), { recursive: true });
    writeFileSync(join(ROOT, dir, name, 'app.bin'), 'x'.repeat(2048));
  }
  return dir;
}

/** Un canal réduit à ce qu'un release déclare — et rien de plus. */
function canal(caseName: string, releases: { tag: string; assets: { name: string; bytes?: string }[] }[]) {
  const rel = join(SCRATCH, caseName, 'canal.json');
  mkdirSync(dirname(join(ROOT, rel)), { recursive: true });
  const payload = releases.map((r) => ({
    tag_name: r.tag,
    draft: false,
    assets: r.assets.map((a) => {
      const bytes = Buffer.from(a.bytes ?? '');
      return { name: a.name, size: bytes.length, digest: `sha256:${createHash('sha256').update(bytes).digest('hex')}` };
    }),
  }));
  writeFileSync(join(ROOT, rel), JSON.stringify(payload));
  return rel;
}

const listed = (dir: string) => readdirSync(join(ROOT, dir)).sort();

describe('release:prune, lancé pour de vrai — sans --yes, il ne touche à RIEN', () => {
  it('détecte un fichier prouvé redondant, l’annonce, et le laisse sur le disque', () => {
    const dir = atelier('plan', { 'MamaTheraFinance-1.0.4-setup.exe': 'octets-1.0.4' });
    const channel = canal('plan', [{ tag: 'v1.0.4', assets: [{ name: 'MamaTheraFinance-1.0.4-setup.exe', bytes: 'octets-1.0.4' }] }]);

    const { code, out } = runCli([`--dir=${dir}`, `--channel=${channel}`]);

    assert.equal(code, 0);
    assert.match(out, /à supprimer \(1\)/);
    assert.match(out, /le canal déclare ces octets exacts/);
    assert.deepEqual(listed(dir), ['MamaTheraFinance-1.0.4-setup.exe'], 'le plan ne supprime rien');
  });

  it('un dossier VIDE se dit vide, au lieu de plaider sur ce qu’il contient', () => {
    const dir = atelier('vide', {});
    const channel = canal('vide', []);
    const { code, out } = runCli([`--dir=${dir}`, `--channel=${channel}`]);
    assert.equal(code, 0);
    assert.match(out, /rien à décider — le dossier est vide/);
  });

  it('un atelier plein mais sans départ n’invente aucune raison', () => {
    // La phrase précédente affirmait « ne contient que ce que le canal ne détient
    // pas encore » — pendant que la ligne suivante disait que le fichier est la
    // sortie du build. Le canal détient la 1.0.6 : c'est sa tête.
    const dir = atelier('courant', { 'MamaTheraFinance-1.0.6-setup.exe': 'octets-1.0.6' });
    const channel = canal('courant', []);
    const { out } = runCli([`--dir=${dir}`, `--channel=${channel}`]);
    assert.match(out, /rien à supprimer/);
    assert.doesNotMatch(out, /ne contient que ce que le canal ne détient pas encore/);
  });

  it('la sortie de build décompressée est NOMMÉE — 507 Mo ne peuvent plus être muets', () => {
    const dir = atelier('dossiers', { 'MamaTheraFinance-1.0.6-setup.exe': 'x' }, ['win-unpacked', '.icon-ico']);
    const channel = canal('dossiers', []);
    const { out } = runCli([`--dir=${dir}`, `--channel=${channel}`]);

    assert.match(out, /📦 nommés sans être jugés \(2\)/);
    assert.match(out, /win-unpacked\s+2\.0 Ko — sortie de build DÉCOMPRESSÉE/);
    assert.match(out, /\.icon-ico\s+2\.0 Ko — dossier de build/);
    assert.deepEqual(listed(dir), ['MamaTheraFinance-1.0.6-setup.exe', '.icon-ico', 'win-unpacked'].sort());
  });

  it('la commande rappelée PORTE le dossier — recopiée, elle n’agit pas ailleurs', () => {
    const dir = atelier('rappel', { 'MamaTheraFinance-1.0.4-setup.exe': 'octets-1.0.4' });
    const channel = canal('rappel', [{ tag: 'v1.0.4', assets: [{ name: 'MamaTheraFinance-1.0.4-setup.exe', bytes: 'octets-1.0.4' }] }]);

    const { out } = runCli([`--dir=${dir}`, `--channel=${channel}`]);

    assert.match(
      out,
      new RegExp(`Applique-le : npm run release:prune -- --dir=${dir.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} --yes`),
      'sans le dossier, la ligne recopiée aurait supprimé dans release/',
    );
  });
});

describe('release:prune --yes — l’acte, et seulement lui', () => {
  it('supprime l’entrée prouvée, et laisse le reste intact', () => {
    const dir = atelier('acte', {
      'MamaTheraFinance-1.0.4-setup.exe': 'octets-1.0.4',
      'MamaTheraFinance-1.0.6-setup.exe': 'octets-courants',
      'latest.yml': 'version: 1.0.6',
    });
    const channel = canal('acte', [{ tag: 'v1.0.4', assets: [{ name: 'MamaTheraFinance-1.0.4-setup.exe', bytes: 'octets-1.0.4' }] }]);

    const { code, out } = runCli([`--dir=${dir}`, `--channel=${channel}`, '--yes']);

    assert.equal(code, 0);
    assert.match(out, /1 entrée\(s\) supprimée\(s\)/);
    assert.deepEqual(listed(dir), ['MamaTheraFinance-1.0.6-setup.exe', 'latest.yml'].sort());
  });

  it('un dossier de build ne part QUE sur l’acte --unpacked', () => {
    const dir = atelier('unpacked', { 'MamaTheraFinance-1.0.6-setup.exe': 'x' }, ['win-unpacked']);
    const channel = canal('unpacked', []);

    // Sans l'acte : nommé, et intact.
    runCli([`--dir=${dir}`, `--channel=${channel}`, '--yes']);
    assert.deepEqual(listed(dir), ['MamaTheraFinance-1.0.6-setup.exe', 'win-unpacked'].sort());

    // Avec l'acte : le dossier part, et lui seul.
    const { code, out } = runCli([`--dir=${dir}`, `--channel=${channel}`, '--yes', '--unpacked']);
    assert.equal(code, 0);
    assert.match(out, /1 entrée\(s\) supprimée\(s\)/);
    assert.deepEqual(listed(dir), ['MamaTheraFinance-1.0.6-setup.exe']);
  });

  it('une reconstruction locale reste ROUGE sans --stale, et part avec', () => {
    const dir = atelier('stale', { 'MamaTheraFinance-1.0.5-setup.exe': 'octets-reconstruits' });
    const channel = canal('stale', [{ tag: 'v1.0.5', assets: [{ name: 'MamaTheraFinance-1.0.5-setup.exe', bytes: 'octets-du-canal' }] }]);

    const sans = runCli([`--dir=${dir}`, `--channel=${channel}`, '--yes']);
    assert.equal(sans.code, 1, 'un même numéro aux autres octets est un refus, pas un ménage');
    assert.match(sans.err, /portent un numéro PUBLIÉ avec d'AUTRES octets/);
    assert.deepEqual(listed(dir), ['MamaTheraFinance-1.0.5-setup.exe'], 'et rien n’a été supprimé');

    const avec = runCli([`--dir=${dir}`, `--channel=${channel}`, '--yes', '--stale']);
    assert.equal(avec.code, 0);
    assert.deepEqual(listed(dir), []);
  });
});

describe('release:prune --check — l’objection automatique', () => {
  it('OBJECTE (exit 1) dès qu’un octet prouvé redondant traîne, sans rien supprimer', () => {
    const dir = atelier('check-rouge', { 'MamaTheraFinance-1.0.4-setup.exe': 'octets-1.0.4' });
    const channel = canal('check-rouge', [{ tag: 'v1.0.4', assets: [{ name: 'MamaTheraFinance-1.0.4-setup.exe', bytes: 'octets-1.0.4' }] }]);

    const { code, err } = runCli([`--dir=${dir}`, `--channel=${channel}`, '--check']);

    assert.equal(code, 1);
    assert.match(err, /que le canal sert DÉJÀ, octet pour octet/);
    assert.match(err, /reprendre le mauvais fichier à la main/);
    assert.match(err, /L'acte qui les enlève/, 'et il dit l’acte exact');
    assert.deepEqual(listed(dir), ['MamaTheraFinance-1.0.4-setup.exe'], 'l’objection ne supprime rien');
  });

  it('ne condamne PAS ce qu’aucune preuve ne condamne — une décision n’est pas un échec', () => {
    const dir = atelier('check-jaune', { 'MamaTheraFinance-1.0.0-setup.exe': 'build-jamais-livre' });
    const channel = canal('check-jaune', [{ tag: 'v1.0.6', assets: [] }]);

    const { code, err } = runCli([`--dir=${dir}`, `--channel=${channel}`, '--check']);

    assert.equal(code, 0, 'jamais publié = acte humain, donc pas une objection');
    assert.match(err, /aucune preuve ne condamne/);
    assert.match(err, /--yes --unpublished/);
  });

  it('sans atelier, il le DIT — un vert muet n’est pas un vert', () => {
    const { code, out } = runCli(['--check', `--dir=${SCRATCH}/inexistant`]);
    assert.equal(code, 0);
    assert.match(out, /atelier non applicable .* n'existe pas ici/);
  });

  it('hors ligne, le hook se tait EN LE DISANT ; sans la dérogation, c’est un échec', () => {
    // L’atelier doit EXISTER : sur un runner, `release/` n’est pas là, et le CLI
    // répond alors « atelier non applicable » AVANT de lire le canal — donc en 0.
    // La première version de ce cas poussait le défaut par un `--dir` implicite et
    // passait sur un poste de travail pour échouer en CI : un test qui dépend de
    // l’état ambiant mesure la machine, pas le comportement.
    const dir = atelier('check-hors-ligne', { 'MamaTheraFinance-1.0.0-setup.exe': 'octets' });
    const strict = runCli([`--dir=${dir}`, '--check', '--channel=absent-partout.json']);
    assert.equal(strict.code, 2, '« je n’ai pas pu regarder » n’est jamais un vert');
    assert.match(strict.err, /canal illisible/);

    const hook = runCli([`--dir=${dir}`, '--check', '--channel=absent-partout.json'], { WORKSHOP_SOFT_OFFLINE: '1' });
    assert.equal(hook.code, 0);
    assert.match(hook.err, /atelier NON jugé/, 'et la dégradation est nommée, jamais silencieuse');
    assert.match(hook.err, /la redondance n’est PAS prouvée/);
  });
});

describe('le câblage, vérifié là où il compte', () => {
  it('les commandes sont branchées, et le maillon est dans la chaîne', () => {
    const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
    assert.equal(pkg.scripts['release:prune'], 'node scripts/prune-release-dir.mjs');
    assert.equal(pkg.scripts['check:release:workshop'], 'node scripts/prune-release-dir.mjs --check');

    const chain = readFileSync(join(ROOT, 'scripts', 'quality-chain.mjs'), 'utf8');
    assert.match(chain, /workshop: \(\) =>/, 'le maillon existe');
    const hook = readFileSync(join(ROOT, 'scripts', 'hook-quality-chain.mjs'), 'utf8');
    assert.match(hook, /DEFAULT_STEPS = \[[^\]]*'workshop'[^\]]*\]/, 'et il tourne par défaut');
    assert.match(
      readFileSync(join(ROOT, '.husky', 'pre-commit'), 'utf8'),
      /WORKSHOP_SOFT_OFFLINE=1/,
      'le hook de commit ne doit pas dépendre du réseau',
    );
    assert.ok(existsSync(CLI));
  });

  it('le job de PUBLICATION le lance, et strictement — c’est le seul runner où release/ existe', () => {
    const workflow = readFileSync(join(ROOT, '.github', 'workflows', 'desktop-release.yml'), 'utf8');
    assert.match(workflow, /run: npm run check:release:workshop/, 'le pas existe');
    assert.doesNotMatch(
      workflow,
      /WORKSHOP_SOFT_OFFLINE/,
      'un job de publication ne peut pas déclarer l’atelier propre sans avoir lu le canal',
    );
    // L’ordre est le fond du sujet : juger AVANT le build ne regarderait que les
    // restes de la veille, et jamais ce que ce build vient d’écrire.
    const build = workflow.indexOf('id: build');
    const workshop = workflow.indexOf('run: npm run check:release:workshop');
    assert.ok(build >= 0 && workshop > build, 'le contrôle suit le build, il ne le précède pas');
  });

  it('aucun rappel de commande n’est écrit en dur dans le CLI', () => {
    const source = readFileSync(CLI, 'utf8');
    const literals = source.match(/['`][^'`\n]*npm run release:prune[^'`\n]*['`]/g) ?? [];
    assert.deepEqual(literals, [], 'elles viennent toutes du module pur — sinon le dossier se reperd');
  });
});
