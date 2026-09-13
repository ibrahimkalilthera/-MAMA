// Suite for scripts/lib/unpacked-manifest.mjs + scripts/write-unpacked-manifest.mjs.
//
// WHY THIS EXISTS
// ---------------
// `release/win-unpacked` pèse 507 Mo mesurés et n'avait NI numéro NI empreinte :
// le canal ne pouvait donc rien dire de lui, et son sort restait une décision
// humaine — garder 507 Mo par prudence, ou les jeter en espérant. Le manifeste
// lui donne une empreinte PUBLIABLE, et rend la décision condamnable par une
// preuve : le canal publie le manifeste, l'atelier recompose le sien, deux
// empreintes égales = ces octets-là sont déjà servis.
//
// Toute la preuve repose donc sur UNE propriété : deux arbres identiques doivent
// produire DEUX FOIS LES MÊMES OCTETS — sinon l'empreinte ne veut rien dire, et la
// comparaison devient un faux négatif permanent (l'atelier garderait 507 Mo en
// croyant qu'aucune preuve n'existe). C'est cette propriété, et elle seule, qui
// est verrouillée ici : canonicalité, indépendance au lieu, sensibilité à un octet
// changé, et les quatre refus (brouillon, actif qui n'est pas un manifeste,
// empreinte absente, empreinte qui ne correspond pas).
import { strict as assert } from 'node:assert';
import { createHash } from 'node:crypto';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, describe, it } from 'node:test';

import {
  MANIFEST_SUFFIX,
  buildManifest,
  hashTree,
  isManifestAsset,
  manifestAssetName,
  manifestOfTree,
  manifestText,
  matchingManifestAsset,
  publishedManifests,
  sha256,
} from '../scripts/lib/unpacked-manifest.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SCRATCH = `tmp-unpacked-manifest-${process.pid}`;

after(() => rmSync(join(ROOT, SCRATCH), { recursive: true, force: true }));

/** Un arbre réel sur le disque : c'est le seul moyen d'exercer le parcours. */
function tree(name: string, files: Record<string, string>) {
  const dir = join(ROOT, SCRATCH, name);
  mkdirSync(dir, { recursive: true });
  for (const [rel, content] of Object.entries(files)) {
    const full = join(dir, rel);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, content);
  }
  return dir;
}

const file = (path: string, content: string) => ({
  path,
  size: Buffer.byteLength(content),
  sha256: createHash('sha256').update(content).digest('hex'),
});

describe('l’empreinte d’une arborescence est une fonction de son contenu', () => {
  it('le manifeste se trie par chemin, et son poids est la somme des fichiers', () => {
    // Le tri n'est pas cosmétique : deux sérialisations d'un même contenu
    // donneraient deux empreintes, donc aucune preuve. `readdirSync` ne promet
    // aucun ordre — c'est donc ici que l'ordre est décidé, une fois.
    const manifest = buildManifest({
      dir: 'win-unpacked',
      files: [file('z.bin', 'zz'), file('a.bin', 'a'), file('m/b.bin', 'bbb')],
    });
    assert.deepEqual(
      manifest.files.map((f) => f.path),
      ['a.bin', 'm/b.bin', 'z.bin'],
    );
    assert.equal(manifest.bytes, 6, 'le poids est la somme, pas un chiffre recopié');
    assert.equal(manifest.dir, 'win-unpacked');
  });

  it('un séparateur Windows ne change pas l’empreinte — sinon la preuve serait locale à un OS', () => {
    const win = buildManifest({ dir: 'win-unpacked', files: [file('resources\\app.asar', 'x')] });
    const posix = buildManifest({ dir: 'win-unpacked', files: [file('resources/app.asar', 'x')] });
    assert.equal(manifestText(win), manifestText(posix));
    assert.equal(win.files[0].path, 'resources/app.asar', 'et les octets publiés portent la forme canonique');
  });

  it('deux arbres IDENTIQUES, à deux endroits différents, donnent la même empreinte', () => {
    // C'est la propriété qui porte toute la preuve : le manifeste décrit ce que
    // l'arbre CONTIENT, pas où il vit — sinon l'atelier d'ici et le runner de la
    // CI ne seraient jamais d'accord, et la comparaison ne mordrait jamais.
    const one = manifestOfTree(tree('identique/a', { 'app.bin': 'AAA', 'locales/fr.pak': 'FR' }), { label: 'win-unpacked' });
    const two = manifestOfTree(tree('identique/b', { 'app.bin': 'AAA', 'locales/fr.pak': 'FR' }), { label: 'win-unpacked' });
    assert.equal(one.digest, two.digest);
    assert.equal(one.text, two.text);
    assert.equal(one.digest, sha256(one.text), 'l’empreinte EST celle des octets publiés — pas une autre');
  });

  it('un seul octet changé change l’empreinte — sinon rien ne serait jamais condamné', () => {
    const base = manifestOfTree(tree('octet/a', { 'app.bin': 'AAA' }), { label: 'win-unpacked' });
    const changed = manifestOfTree(tree('octet/b', { 'app.bin': 'AAB' }), { label: 'win-unpacked' });
    const added = manifestOfTree(tree('octet/c', { 'app.bin': 'AAA', 'extra.bin': '' }), { label: 'win-unpacked' });
    assert.notEqual(base.digest, changed.digest, 'un octet de différence ne peut pas passer pour le même arbre');
    assert.notEqual(base.digest, added.digest, 'un fichier de plus non plus');
  });

  it('le parcours part de la racine décrite, et n’y met pas son propre manifeste', () => {
    // L'atelier écrit le manifeste À CÔTÉ de l'arborescence, pas dedans : s'il y
    // entrait, l'empreinte dépendrait du manifeste qui la décrit, donc ne
    // pourrait plus jamais correspondre à celle du canal.
    const dir = tree('racine', { 'app.bin': 'A', 'nested/deep.bin': 'BB' });
    const files = hashTree(dir);
    assert.deepEqual(files.map((f) => f.path).sort(), ['app.bin', join('nested', 'deep.bin')].sort());
    assert.equal(files.every((f) => !f.path.includes(SCRATCH)), true, 'les chemins sont relatifs à l’arbre');
    // Le parcours rend ce que l'OS donne (séparateur compris) : la forme
    // canonique a UN propriétaire, `buildManifest`, et c'est pour ça que les deux
    // OS produisent la même empreinte — pas parce que chaque appelant y pense.
    assert.deepEqual(
      buildManifest({ files }).files.map((f) => f.path),
      ['app.bin', 'nested/deep.bin'],
    );
  });

  it('le libellé dit à quelle arborescence ce manifeste appartient', () => {
    const { manifest } = manifestOfTree(tree('libelle', { 'a.bin': 'a' }), { label: 'win-unpacked' });
    assert.equal(manifest.dir, 'win-unpacked');
    assert.equal(JSON.parse(manifestText(manifest)).dir, 'win-unpacked');
  });
});

describe('le nom de l’actif publié dit de quelle arborescence il parle', () => {
  it('le nom porte le produit ET la version, comme un installeur', () => {
    const asset = manifestAssetName('MamaTheraFinance', '1.0.6');
    assert.equal(asset, `MamaTheraFinance-1.0.6${MANIFEST_SUFFIX}`);
    assert.equal(isManifestAsset(asset), true);
    assert.equal(isManifestAsset('MamaTheraFinance-1.0.6-setup.exe'), false);
  });

  it('un manifeste se reconnaît à son suffixe, jamais à une version devinée', () => {
    for (const name of ['latest.yml', 'MamaTheraFinance-1.0.6-setup.exe', 'win-unpacked']) {
      assert.equal(isManifestAsset(name), false, `${name} n’est pas un manifeste d’arborescence`);
    }
  });

  it('seuls les releases PUBLIÉS comptent — un brouillon est invisible pour un poste', () => {
    const found = publishedManifests([
      { draft: true, assets: [{ name: manifestAssetName('MamaTheraFinance', '1.0.7'), digest: 'sha256:brouillon' }] },
      { draft: false, assets: [{ name: manifestAssetName('MamaTheraFinance', '1.0.6'), digest: 'sha256:publie' }] },
      { draft: false, assets: [{ name: 'MamaTheraFinance-1.0.6-setup.exe', digest: 'sha256:setup' }] },
    ]);
    assert.deepEqual(found, [
      { name: manifestAssetName('MamaTheraFinance', '1.0.6'), digest: 'sha256:publie', version: '1.0.6' },
    ]);
  });
});

describe('la comparaison d’empreintes ne mord que sur une preuve', () => {
  const published = publishedManifests([
    { draft: false, assets: [{ name: manifestAssetName('MamaTheraFinance', '1.0.5'), digest: 'sha256:egale' }] },
  ]);

  it('empreinte égale → la preuve nomme l’actif, et sa VERSION', () => {
    // La version est indispensable : « ça correspond » ne suffit pas à décider,
    // il faut encore savoir si ces octets sont la sortie du build en cours ou
    // celle d'un build antérieur — deux sorts différents.
    assert.deepEqual(matchingManifestAsset(published, 'egale'), {
      name: manifestAssetName('MamaTheraFinance', '1.0.5'),
      digest: 'sha256:egale',
      version: '1.0.5',
    });
  });

  it('empreinte différente → aucune preuve, donc aucune condamnation', () => {
    assert.equal(matchingManifestAsset(published, 'autre-chose'), null);
  });

  it('une empreinte absente ne vaut pas une empreinte qui correspond', () => {
    assert.equal(matchingManifestAsset(published, ''), null);
    assert.equal(matchingManifestAsset([{ name: manifestAssetName('MamaTheraFinance', '1.0.5'), digest: null }], 'egale'), null);
  });

  it('un actif qui n’est pas un manifeste ne peut pas servir de preuve', () => {
    assert.equal(matchingManifestAsset([{ name: 'MamaTheraFinance-1.0.5-setup.exe', digest: 'sha256:egale' }], 'egale'), null);
  });
});
