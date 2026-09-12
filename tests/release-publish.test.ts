// Suite for scripts/lib/release-publish.mjs — LE PLAN de publication.
//
// POURQUOI CETTE SUITE EXISTE
// ---------------------------
// Le dépôt a publié deux fois de la même façon cassée : `electron-builder
// --publish always` ouvre **un release par cible**, donc deux brouillons pour un
// même tag, l'un portant le blockmap, l'autre `latest.yml` et les exe. Les
// artefacts se retrouvaient répartis entre deux releases, et promouvoir le
// mauvais publiait un release SANS `latest.yml` — une mise à jour que personne
// ne voit. Les deux fois, la réparation a été une main humaine sur l'API.
//
// La correction ne pouvait pas être « mieux consolider après coup » : elle est
// « ne plus laisser un outil tiers décider de la forme du release ». Ce module
// porte cette décision, pure et testable sans réseau, et la suite vérifie les
// trois propriétés dont dépend la promesse :
//
//   • UN SEUL release, quel que soit l'état trouvé (rien, un brouillon partiel,
//     deux brouillons hérités) — et à la fin il contient les octets vérifiés et
//     RIEN d'autre (ce qui est en trop sort) ;
//   • un numéro DÉJÀ publié est refusé, parce que republier n'atteint aucun
//     poste et laisserait deux binaires sous un même numéro ;
//   • le côté sûr est toujours de TÉLÉVERSER : on ne saute un téléversement que
//     si l'API a donné un digest qui correspond à l'empreinte locale. Sans
//     digest, « je ne sais pas » se traite comme « il faut téléverser » —
//     l'inverse publierait les mauvais octets sans le dire.
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

import {
  assetMatchesLocal,
  pickConsolidationTarget,
  publicationPlan,
} from '../scripts/lib/release-publish.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel: string) => readFileSync(join(root, rel), 'utf8');

const VERSION = '1.0.5';
const SETUP = `MamaTheraFinance-${VERSION}-setup.exe`;
const PORTABLE = `MamaTheraFinance-${VERSION}-portable.exe`;
const BLOCKMAP = `MamaTheraFinance-${VERSION}-setup.exe.blockmap`;
const EXPECTED = ['latest.yml', SETUP, BLOCKMAP, PORTABLE];

interface RemoteAsset {
  id?: number;
  name: string;
  size?: number;
  digest?: string;
}

interface RemoteRelease {
  id: number;
  tag_name?: string;
  draft: boolean;
  created_at?: string;
  assets: RemoteAsset[];
}

/**
 * Les octets d'un artefact : ce que le disque dit, et ce que l'API en dit.
 *
 * `digest` peut être explicitement nul — c'est le cas qui compte le plus, celui
 * où l'API ne permet pas de conclure et où il faut donc retéléverser.
 */
interface AssetBytes {
  size: number;
  sha256: string;
  digest?: string | null;
}

/**
 * Un release distant tel que l'API le rend.
 *
 * `digest` est ce que GitHub renvoie pour un actif (`sha256:…`) : c'est la
 * SEULE chose qui autorise à sauter un téléversement, donc il est présent par
 * défaut — les cas qui l'omettent le font exprès.
 */
function remote(
  id: number,
  { draft = true, assets = {}, createdAt = '2026-09-12T10:00:00Z' }: {
    draft?: boolean;
    assets?: Record<string, AssetBytes>;
    createdAt?: string;
  } = {},
): RemoteRelease {
  return {
    id,
    tag_name: `v${VERSION}`,
    draft,
    created_at: createdAt,
    assets: Object.entries(assets).map(([name, info], index) => ({
      id: id * 100 + index,
      name,
      size: info.size,
      ...(info.digest === null ? {} : { digest: `sha256:${info.digest ?? info.sha256}` }),
    })),
  };
}

/** Ce que le publieur a calculé sur le disque, pour les artefacts attendus. */
function localFor(expected: string[] = EXPECTED) {
  const map = new Map<string, { size: number; sha256: string }>();
  for (const name of expected) map.set(name, { size: 100 + name.length, sha256: `hash-${name}` });
  return map;
}

/** Le release complet et cohérent : tout est en place, mêmes octets. */
function fullAssets(): Record<string, AssetBytes> {
  const assets: Record<string, AssetBytes> = {};
  for (const [name, info] of localFor()) assets[name] = info;
  return assets;
}

/**
 * L'identifiant d'un release du plan.
 *
 * Le module est écrit en JSDoc (`target` y est un `object`) : plutôt que de
 * relâcher son typage pour la suite de tests, on rétrécit ici, à un seul endroit.
 */
function idOf(release: object | null): number | undefined {
  return (release as { id?: number } | null)?.id;
}

describe('reconnaître des octets déjà publiés', () => {
  it('taille ET digest concordants : c’est bien ces octets', () => {
    const local = { size: 10, sha256: 'abc123' };
    assert.equal(assetMatchesLocal({ size: 10, digest: 'sha256:abc123' }, local), true);
  });

  it('sans digest, on ne peut RIEN affirmer — donc on retéléverse', () => {
    // C'est le point qui a failli publier les mauvais octets : une taille égale
    // n'est pas une preuve d'octets égaux. L'API qui ne renvoie pas de digest
    // doit coûter un téléversement, pas une confiance.
    assert.equal(assetMatchesLocal({ size: 10 }, { size: 10, sha256: 'abc123' }), false);
    assert.equal(assetMatchesLocal({ size: 10, digest: '' }, { size: 10, sha256: 'abc123' }), false);
  });

  it('un digest d’un AUTRE algorithme n’autorise pas à conclure', () => {
    const local = { size: 10, sha256: 'abc123' };
    assert.equal(assetMatchesLocal({ size: 10, digest: 'md5:abc123' }, local), false);
  });

  it('une taille qui diffère suffit à refuser, même avec un digest', () => {
    assert.equal(assetMatchesLocal({ size: 11, digest: 'sha256:abc123' }, { size: 10, sha256: 'abc123' }), false);
  });

  it('un actif ou un état local absent n’est jamais « identique »', () => {
    assert.equal(assetMatchesLocal(null, { size: 10, sha256: 'abc123' }), false);
    assert.equal(assetMatchesLocal({ size: 10, digest: 'sha256:abc123' }, null), false);
  });
});

describe('consolider plusieurs brouillons', () => {
  it('garde celui qui porte déjà le PLUS d’artefacts attendus', () => {
    const poor = remote(1, { assets: { [BLOCKMAP]: { size: 1, sha256: 'x' } } });
    const rich = remote(2, { assets: { 'latest.yml': { size: 1, sha256: 'y' }, [SETUP]: { size: 2, sha256: 'z' } } });
    assert.equal(idOf(pickConsolidationTarget([poor, rich], EXPECTED)), 2);
    assert.equal(idOf(pickConsolidationTarget([rich, poor], EXPECTED)), 2, 'l’ordre de l’API ne décide pas de la cible');
  });

  it('à égalité, le PLUS ANCIEN — le plus récent est celui qu’une passe vient d’ouvrir', () => {
    const old = remote(7, { createdAt: '2026-09-11T10:00:00Z' });
    const recent = remote(8, { createdAt: '2026-09-12T10:00:00Z' });
    assert.equal(idOf(pickConsolidationTarget([recent, old], EXPECTED)), 7);
  });

  it('à égalité parfaite, l’identifiant : deux exécutions gardent la même cible', () => {
    const a = remote(9, { createdAt: '2026-09-12T10:00:00Z' });
    const b = remote(4, { createdAt: '2026-09-12T10:00:00Z' });
    assert.equal(idOf(pickConsolidationTarget([a, b], EXPECTED)), 4);
  });

  it('aucun brouillon : il n’y a rien à choisir', () => {
    assert.equal(pickConsolidationTarget([], EXPECTED), null);
  });
});

describe('le plan de publication', () => {
  const plan = (releases: RemoteRelease[], over: { expected?: string[]; local?: Map<string, { size: number; sha256: string }> } = {}) =>
    publicationPlan({
      version: VERSION,
      releases,
      expected: over.expected ?? EXPECTED,
      local: over.local ?? localFor(),
    });

  it('aucun release pour ce tag : on en crée un, en brouillon, avec tout', () => {
    const p = plan([]);
    assert.equal(p.action, 'create');
    assert.deepEqual(p.upload, EXPECTED);
    assert.deepEqual(p.deleteIds, []);
    assert.deepEqual(p.problems, []);
  });

  it('un brouillon complet et identique : rien à téléverser, rien à retirer', () => {
    const p = plan([remote(1, { assets: fullAssets() })]);
    assert.equal(p.action, 'reuse');
    assert.deepEqual(p.upload, [], 'aucun octet ne bouge : ce sont les mêmes');
    assert.deepEqual(p.skip, EXPECTED);
    assert.deepEqual(p.remove, []);
  });

  it('un brouillon partiel : on ne téléverse QUE ce qui manque', () => {
    const assets = fullAssets();
    delete assets[PORTABLE];
    const p = plan([remote(1, { assets })]);
    assert.equal(p.action, 'reuse');
    assert.deepEqual(p.upload, [PORTABLE]);
    assert.deepEqual(p.skip, ['latest.yml', SETUP, BLOCKMAP]);
  });

  it('un artefact d’une AUTRE version est retiré : le release finit avec les octets vérifiés et RIEN d’autre', () => {
    const assets = { ...fullAssets(), 'MamaTheraFinance-1.0.4-setup.exe': { size: 5, sha256: 'old' } };
    const p = plan([remote(1, { assets })]);
    assert.deepEqual(p.remove, ['MamaTheraFinance-1.0.4-setup.exe'], 'sinon c’est le fichier qu’un humain télécharge à la main');
    assert.deepEqual(p.upload, [], 'et ce retrait ne coûte aucun téléversement');
  });

  it('DEUX brouillons (l’héritage d’electron-builder) : une cible, l’autre supprimé', () => {
    const good = localFor();
    // Le cas réel : electron-builder ouvre un release pour le NSIS (blockmap) et
    // un pour le portable (latest.yml + les deux exe). Les octets sont BONS des
    // deux côtés — c’est bien pourquoi la consolidation conserve les deux au lieu
    // d’en retéléverser un.
    const nsiss = remote(11, { assets: { [BLOCKMAP]: good.get(BLOCKMAP)! } });
    const portable = remote(12, {
      assets: {
        'latest.yml': good.get('latest.yml')!,
        [SETUP]: good.get(SETUP)!,
        [PORTABLE]: good.get(PORTABLE)!,
      },
    });
    const p = plan([nsiss, portable]);
    assert.equal(p.action, 'consolidate');
    assert.equal(idOf(p.target), 12, 'la cible est le brouillon le plus complet');
    assert.deepEqual(p.deleteIds, [11], 'et l’autre disparaît, pour qu’il n’en reste qu’UN');
    assert.deepEqual(p.upload, [BLOCKMAP], 'seul ce que la cible n’avait pas est téléversé');
  });

  it('le brouillon qui a les BONS NOMS mais d’AUTRES OCTETS est retéléversé', () => {
    // Le cas qui justifie de ne pas se fier à la seule taille : un installeur
    // reconstruit porte le même nom et une taille proche.
    const assets = fullAssets();
    assets[SETUP] = { size: 100 + SETUP.length, sha256: 'autre-chose', digest: null };
    const p = plan([remote(1, { assets })]);
    assert.deepEqual(p.upload, [SETUP]);
    assert.deepEqual(p.skip, ['latest.yml', BLOCKMAP, PORTABLE]);
  });

  it('un numéro DÉJÀ publié est refusé : republier n’atteint aucun poste', () => {
    const p = plan([remote(1, { draft: false, assets: fullAssets() })]);
    assert.equal(p.action, 'refuse');
    assert.match(p.problems.join(' '), /DÉJÀ publié/);
    assert.match(p.problems.join(' '), /Montez la version/);
    assert.deepEqual(p.upload, [], 'rien n’est planifié sur un release publié');
  });

  it('rien à publier n’est pas un succès : un release vide n’apporte rien à un poste', () => {
    const p = publicationPlan({ version: VERSION, releases: [], expected: [], local: new Map() });
    assert.equal(p.action, 'refuse');
    assert.match(p.problems.join(' '), /aucun artefact à publier/);
  });

  it('un artefact annoncé mais absent du disque fait REFUSER, en le nommant', () => {
    const local = localFor();
    local.delete(PORTABLE);
    const p = plan([], { local });
    assert.equal(p.action, 'refuse');
    assert.match(p.problems.join(' '), new RegExp(PORTABLE));
  });

  it('le tag du plan suit la version, et ne se devine pas', () => {
    assert.equal(publicationPlan({ version: VERSION, expected: [SETUP], local: localFor([SETUP]) }).tag, `v${VERSION}`);
  });
});

describe('le câblage du publieur', () => {
  it('les artefacts publiés viennent de latest.yml, pas d’une liste écrite à la main', () => {
    const source = read('scripts/publish-release.mjs');
    assert.match(source, /assetsToPublish/, 'la liste des octets à publier est celle que les postes lisent');
    assert.match(source, /publicationPlan/, 'et la forme du release est décidée par le plan testable');
  });

  it('publier est une ÉCRITURE : sans jeton, rien n’est touché', () => {
    const source = read('scripts/publish-release.mjs');
    const tokenCheck = source.indexOf('publier demande un jeton d’écriture');
    const upload = source.indexOf('await uploadAsset(');
    assert.ok(tokenCheck > 0 && upload > tokenCheck, 'le refus précède tout appel d’écriture');
    assert.match(source, /process\.env\.GH_TOKEN \|\| process\.env\.GITHUB_TOKEN/, 'le jeton vient de l’environnement, jamais d’un fichier');
  });

  it('la preuve finale est SANS jeton : un canal relu authentifié ne prouve rien pour un poste', () => {
    const source = read('scripts/publish-release.mjs');
    assert.match(source, /withoutToken: true/, 'le flux publié est relu sans autorisation');
    assert.match(source, /GH_TOKEN: '', GITHUB_TOKEN: ''/, 'et le jeton est réellement retiré de l’environnement du gate');
    assert.match(source, /runGate\('--channel'/, 'le canal vivant et le frein sont vérifiés dans le même geste que la promotion');
  });

  it('le brouillon est un SAS : sa vérification précède la promotion', () => {
    const source = read('scripts/publish-release.mjs');
    const draftGate = source.indexOf("runGate('--draft'");
    const promote = source.indexOf('draft: false');
    assert.ok(draftGate > 0 && promote > draftGate, 'un gate rouge laisse le release en brouillon, donc invisible');
    assert.match(source, /if \(!PROMOTE\)[\s\S]*?process\.exit\(0\)/, 'publier et promouvoir sont deux gestes distincts');
  });

  it('une propagation d’API est reprise, jamais ignorée', () => {
    // Mesuré : juste après la promotion, la liste PUBLIQUE des releases n’est
    // pas encore à jour. Le remède est une reprise bornée — pas de sauter le
    // verdict, qui est ce qui rend le gate utile.
    const source = read('scripts/publish-release.mjs');
    assert.match(source, /attempts: 6/, 'la relecture réessaie un nombre fini de fois');
    assert.match(source, /je n'ai pas pu lire|je n’ai pas pu lire|n’est pas « c’est bon »|pas « c’est bon »/i, 'ce qui reste illisible après la dernière tentative est un échec');
  });
});
