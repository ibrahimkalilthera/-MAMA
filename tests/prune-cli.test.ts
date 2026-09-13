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
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
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
    // `WORKSHOP_TREE_PROOF` est NEUTRALISÉ par défaut : la suite tourne aussi
    // dans le hook de commit, qui pose `WORKSHOP_TREE_PROOF=0` — héritée, elle
    // ferait passer pour « conforme » un contrôle qui n'a rien tenté.
    env: {
      ...process.env,
      GH_TOKEN: '',
      GITHUB_TOKEN: '',
      WORKSHOP_SOFT_OFFLINE: '',
      WORKSHOP_TREE_PROOF: '',
      ...env,
    },
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

// La version en cours vient du PAQUET, pas d'un littéral : un test qui écrirait
// « 1.0.6 » deviendrait faux au prochain numéro, et pire, il continuerait de
// passer en ne mesurant plus ce qu'il croit mesurer.
const CURRENT = String(JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).version);
const PREVIOUS = CURRENT.replace(/\.(\d+)$/, (_, patch: string) => `.${Number(patch) === 0 ? 1 : Number(patch) - 1}`);
const MANIFEST_SUFFIX = '-unpacked.manifest.json';

/**
 * Le manifeste d'une arborescence, écrit À LA MAIN.
 *
 * Volontairement sans passer par le module : c'est un ORACLE indépendant. Si la
 * forme canonique changeait, ce cas tomberait au lieu de suivre la dérive — une
 * empreinte qui s'accorde avec elle-même ne prouve rien.
 */
function manifeste(label: string, files: [path: string, content: string][]) {
  const entries = files
    .map(([path, content]) => ({
      path,
      size: Buffer.byteLength(content),
      sha256: createHash('sha256').update(content).digest('hex'),
    }))
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  return JSON.stringify({ dir: label, bytes: entries.reduce((sum, f) => sum + f.size, 0), files: entries });
}

/** Les octets exacts que `dirs: ['win-unpacked']` de `atelier()` écrit. */
const APPBIN = 'x'.repeat(2048);

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

  it('le poids des entrées « hors sujet » est écrit, et le volume se vérifie comme une somme', () => {
    // Avant, elles étaient listées SANS taille : un `latest.yml` de 300 octets et
    // une archive oubliée de 400 Mo se lisaient pareil, donc le plus gros volume
    // du dossier pouvait être « hors sujet » sans que personne le voie.
    const dir = atelier('volume-1', {
      'MamaTheraFinance-1.0.0-setup.exe': 'octets-1.0.0',
      'archive-oubliee.zip': 'z'.repeat(4096),
    });
    const channel = canal('volume-1', [{ tag: 'v1.0.6', assets: [] }]);

    const { code, out } = runCli([`--dir=${dir}`, `--channel=${channel}`, '--check']);

    assert.equal(code, 0, 'un volume nommé n’est pas une objection : il est dit, pesé, et compté');
    assert.match(out, /➖ hors sujet \(1\) : archive-oubliee\.zip \(\d/, 'le poids est écrit, pas seulement le nom');
    assert.match(out, /⚖️ {2}volume : \d[^\n]*dans /, 'le total est confronté au dossier');
    assert.match(out, /hors sujet \(1\)/, 'et la case « hors sujet » y figure avec son compte');
  });

  it('une entrée ni fichier ni dossier est nommée, pesée, et reste dans le total', () => {
    const dir = atelier('volume-lien', { 'MamaTheraFinance-1.0.0-setup.exe': 'octets-1.0.0' });
    const channel = canal('volume-lien', [{ tag: 'v1.0.6', assets: [] }]);
    // @platform-guard : un lien symbolique de fichier demande des droits sur
    // certaines installations Windows. Ne pas pouvoir en créer un est une limite
    // du POSTE, pas un comportement du contrôle — le cas s'arrête donc là plutôt
    // que d'échouer sur une capacité de l'environnement.
    let linked = true;
    try {
      symlinkSync('cible-absente', join(ROOT, dir, 'lien-casse'));
    } catch {
      linked = false;
    }
    if (!linked) return;

    const { code, out } = runCli([`--dir=${dir}`, `--channel=${channel}`, '--check']);

    assert.equal(code, 0);
    assert.match(out, /🔗 ni fichier ni dossier \(1\)/, 'l’entrée que le plan ne classe pas est nommée');
    assert.match(out, /lien-casse/, 'nommément');
    assert.match(out, /ni fichier ni dossier \(1\)/, 'et elle compte dans une case du volume');
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

describe('une arborescence PROUVÉE par un manifeste publié', () => {
  /** Un atelier avec son arborescence de build, et le même nom de lot pour tous. */
  const atelierArbre = (name: string) =>
    atelier(name, { 'MamaTheraFinance-1.0.6-setup.exe': 'octets-courants' }, ['win-unpacked']);

  /** Un release qui publie le manifeste d'une arborescence donnée. */
  const manifesteDe = (version: string, content: string) => ({
    tag: `v${version}`,
    assets: [
      { name: `MamaTheraFinance-${version}${MANIFEST_SUFFIX}`, bytes: manifeste('win-unpacked', [['app.bin', content]]) },
    ],
  });

  const nomManifeste = (version: string) => `MamaTheraFinance-${version}${MANIFEST_SUFFIX}`;

  it('--check OBJECTE (exit 1) sans rien supprimer, et nomme le manifeste qui le prouve', () => {
    // C'est la demande d'origine, au mot près : 507 Mo ne pouvaient être ni
    // jugés ni condamnés. Maintenant l'objection tombe seule, et elle dit sur
    // quoi elle s'appuie.
    const dir = atelierArbre('arbre-propre');
    const channel = canal('arbre-propre', [manifesteDe(PREVIOUS, APPBIN)]);

    const { code, out, err } = runCli([`--dir=${dir}`, `--channel=${channel}`, '--check']);

    assert.equal(code, 1, 'un octet prouvé redondant est un ROUGE, pas un commentaire');
    assert.match(out, /🔐 arborescences \(1\)/);
    assert.match(
      out,
      new RegExp(`✅ win-unpacked.*${nomManifeste(PREVIOUS).replace(/\./g, '\\.')}`),
      'la preuve nomme l’actif du canal',
    );
    assert.match(err, /que le canal sert DÉJÀ, octet pour octet/);
    assert.match(err, /win-unpacked \(\d/, 'et la ligne ne laisse pas une virgule de version orpheline');
    assert.equal(existsSync(join(ROOT, dir, 'win-unpacked')), true, 'l’objection ne supprime rien');
  });

  it('--yes la fait partir SANS --unpacked : une empreinte l’autorise', () => {
    const dir = atelierArbre('arbre-acte');
    const channel = canal('arbre-acte', [manifesteDe(PREVIOUS, APPBIN)]);

    const { code, out } = runCli([`--dir=${dir}`, `--channel=${channel}`, '--yes']);

    assert.equal(code, 0);
    assert.match(out, /1 entrée\(s\) supprimée\(s\)/);
    assert.equal(existsSync(join(ROOT, dir, 'win-unpacked')), false, 'le dossier est parti');
    assert.deepEqual(listed(dir), ['MamaTheraFinance-1.0.6-setup.exe'], 'et rien d’autre n’a bougé');
  });

  it('l’arborescence de la version EN COURS n’est pas condamnée : c’est la sortie du build', () => {
    // Même règle que pour les fichiers : le build d'aujourd'hui est lu par les
    // preuves locales (preuve bureau, rejeu de mise à jour). Et le canal publie
    // AUSSI un manifeste antérieur — sans lui, rien ne serait haché, et le cas
    // ne mesurerait pas la règle qu'il prétend mesurer.
    const dir = atelierArbre('arbre-courante');
    const channel = canal('arbre-courante', [
      manifesteDe(PREVIOUS, `${APPBIN}-autre-build`),
      manifesteDe(CURRENT, APPBIN),
    ]);

    const { code, out } = runCli([`--dir=${dir}`, `--channel=${channel}`, '--check']);

    assert.equal(code, 0, 'publier puis garder sa propre sortie de build n’est pas une objection');
    assert.match(out, /➖ win-unpacked/);
    assert.match(out, /porte la version EN COURS/);
    assert.equal(existsSync(join(ROOT, dir, 'win-unpacked')), true);
  });

  it('aucun manifeste ne décrit cet arbre → elle est NOMMÉE, et rien n’est condamné', () => {
    // L'arborescence a changé depuis ce que le canal a décrit. Une preuve qui ne
    // correspond pas ne condamne rien, et le plan le DIT — avec l'empreinte
    // recomposée, pour qu'on puisse voir que la comparaison a bien eu lieu.
    const dir = atelierArbre('arbre-autre');
    const channel = canal('arbre-autre', [manifesteDe(PREVIOUS, `${APPBIN}-different`)]);

    const { code, out } = runCli([`--dir=${dir}`, `--channel=${channel}`, '--check']);

    assert.equal(code, 0);
    assert.match(out, /➖ win-unpacked/);
    assert.match(out, /aucun manifeste publié ne décrit cette arborescence/);
    assert.match(out, /jamais condamnée sur un doute/);
    assert.equal(existsSync(join(ROOT, dir, 'win-unpacked')), true);
  });

  it('sans manifeste au canal, il le dit et ne hache RIEN', () => {
    const dir = atelierArbre('arbre-sans-manifeste');
    const channel = canal('arbre-sans-manifeste', [
      { tag: 'v1.0.4', assets: [{ name: 'MamaTheraFinance-1.0.4-setup.exe', bytes: 'x' }] },
    ]);

    const { code, out } = runCli([`--dir=${dir}`, `--channel=${channel}`, '--check']);

    assert.equal(code, 0);
    assert.match(out, /le canal ne publie aucun manifeste d’arborescence/);
    assert.match(out, /rien à comparer, donc rien à hacher/);
  });

  it('quand seul le manifeste de la version en cours est publié, il ne hache pas pour rien', () => {
    // Aucune arborescence antérieure ne peut être prouvée : le manifeste de la
    // version en cours décrit la sortie du build, qui n'est jamais condamnée. Le
    // hachage coûterait ~6 s pour ne rien pouvoir changer — et le plan le dit,
    // au lieu de laisser croire qu'il a comparé quelque chose.
    const dir = atelierArbre('arbre-courant-seul');
    const channel = canal('arbre-courant-seul', [manifesteDe(CURRENT, APPBIN)]);

    const { code, out } = runCli([`--dir=${dir}`, `--channel=${channel}`, '--check']);

    assert.equal(code, 0);
    assert.match(out, /ne publie de manifeste que pour la version en cours/);
    assert.match(out, /rien n’est haché/);
  });

  it('le hook peut s’en dispenser — et le DIT, sinon la dispense serait un faux vert', () => {
    const dir = atelierArbre('arbre-hook');
    const channel = canal('arbre-hook', [manifesteDe(PREVIOUS, APPBIN)]);

    const { code, out } = runCli([`--dir=${dir}`, `--channel=${channel}`, '--check'], { WORKSHOP_TREE_PROOF: '0' });

    assert.equal(code, 0, 'sans preuve, aucune condamnation : le dossier reste');
    assert.match(out, /preuve d’arborescence non tentée \(WORKSHOP_TREE_PROOF=0\)/);
    assert.match(out, /la CI la lance, elle, strictement/);
    assert.equal(existsSync(join(ROOT, dir, 'win-unpacked')), true);
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

  it('le manifeste d’arborescence est ÉCRIT par le build, et la CI le prouve SANS dispense', () => {
    const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
    assert.equal(pkg.scripts['manifest:unpacked'], 'node scripts/write-unpacked-manifest.mjs');
    assert.match(
      pkg.scripts['electron:build'],
      /&& npm run manifest:unpacked$/,
      'un manifeste écrit à la main décrirait un arbre d’avant-hier',
    );
    assert.ok(existsSync(join(ROOT, 'scripts', 'write-unpacked-manifest.mjs')));

    // La dispense du hook est DÉCLARÉE là où elle est accordée — et le job de
    // publication ne la connaît pas : sinon le seul contexte qui juge vraiment
    // l'atelier serait aussi celui qui ne hache rien.
    for (const hook of ['pre-commit', 'pre-push']) {
      assert.match(
        readFileSync(join(ROOT, '.husky', hook), 'utf8'),
        /WORKSHOP_TREE_PROOF=0/,
        `${hook} : 6 s de hachage à chaque commit ne se paient pas sans le dire`,
      );
    }
    assert.doesNotMatch(
      readFileSync(join(ROOT, '.github', 'workflows', 'desktop-release.yml'), 'utf8'),
      /WORKSHOP_TREE_PROOF/,
      'la CI n’a aucune raison de renoncer à la seule preuve qui condamne 507 Mo',
    );
  });

  it('aucun rappel de commande n’est écrit en dur dans le CLI', () => {
    const source = readFileSync(CLI, 'utf8');
    const literals = source.match(/['`][^'`\n]*npm run release:prune[^'`\n]*['`]/g) ?? [];
    assert.deepEqual(literals, [], 'elles viennent toutes du module pur — sinon le dossier se reperd');
  });
});
