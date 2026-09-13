// Suite for the decision that empties `release/` of everything the channel
// already holds (scripts/lib/release-prune.mjs + scripts/prune-release-dir.mjs).
//
// WHY THIS EXISTS
// ---------------
// `release/` accumule : chaque build y ajoute un installeur, un portable et un
// blockmap, et rien ne les enlève. Mesuré le 13/09 : sept versions, 2,2 Go,
// vingt et un `.exe` au même niveau — donc vingt et une occasions de reprendre
// le mauvais fichier à la main, et un avertissement (« des installeurs d'une
// autre version traînent là ») qu'on lit tous les jours finit par ne plus se
// lire.
//
// Ces cas protègent la seule chose qui rend une suppression acceptable : elle
// doit être PROUVÉE. Ce qui est vérifié ici n'est donc pas « le ménage
// fonctionne » mais « rien ne part sans que le canal ne l'ait déclaré, octet pour
// octet » — parce qu'une version ancienne peut n'avoir jamais été publiée, et
// que sa copie locale est alors l'unique au monde.
import { strict as assert } from 'node:assert';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

import {
  artifactVersion,
  formatBytes,
  noRemovalMessage,
  pruneCommand,
  prunePlan,
} from '../scripts/lib/release-prune.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel: string) => readFileSync(join(root, rel), 'utf8');
const sha256 = (seed: string) => createHash('sha256').update(seed).digest('hex');

/** Un artefact local tel que le disque le donne : des octets, et leur empreinte. */
const local = (name: string, seed: string, size = 1000) => ({ name, size, sha256: sha256(seed) });

/** Le même artefact, tel que le CANAL le déclare (digest calculé par GitHub). */
const held = (name: string, seed: string, size = 1000) => ({
  name,
  size,
  digest: `sha256:${sha256(seed)}`,
});

const release = (version: string, assets: { name: string; size: number; digest: string | null }[], draft = false) => ({
  version,
  tag: `v${version}`,
  draft,
  assets,
});

const setup = (v: string) => `MamaTheraFinance-${v}-setup.exe`;
const portable = (v: string) => `MamaTheraFinance-${v}-portable.exe`;
const blockmap = (v: string) => `MamaTheraFinance-${v}-setup.exe.blockmap`;

describe('le nom est la seule source de version', () => {
  it('les trois formes d’artefact portent leur version', () => {
    assert.equal(artifactVersion(setup('1.0.4')), '1.0.4');
    assert.equal(artifactVersion(portable('1.0.4')), '1.0.4');
    assert.equal(artifactVersion(blockmap('1.0.4')), '1.0.4');
  });

  it('ce qui n’est pas un artefact versionné n’a pas de version', () => {
    for (const name of ['latest.yml', 'builder-debug.yml', 'win-unpacked', 'MamaTheraFinance.exe']) {
      assert.equal(artifactVersion(name), null, `${name} ne doit pas se faire passer pour un artefact`);
    }
  });
});

describe('ce qui autorise une suppression est une preuve, pas une date', () => {
  it('le canal déclare les mêmes octets → le fichier part, et on sait quoi libérer', () => {
    const plan = prunePlan({
      currentVersion: '1.0.6',
      local: [local(setup('1.0.1'), 'octets-1.0.1')],
      published: [release('1.0.1', [held(setup('1.0.1'), 'octets-1.0.1')])],
    });
    assert.deepEqual(
      plan.remove.map((r) => r.name),
      [setup('1.0.1')],
    );
    assert.equal(plan.bytesFreed, 1000);
    assert.match(plan.remove[0].reason, /octets exacts/, 'le plan dit POURQUOI il ose');
    assert.equal(plan.remove[0].kind, 'digest', 'et par quoi : trois autorisations ne se résument pas d’une phrase');
  });

  it('le canal dit la même TAILLE mais d’autres octets → conservé, et c’est un rouge', () => {
    // Le piège « un même numéro ne se voit pas changer » : des octets locaux sous
    // un numéro publié qui ne sont pas ceux du canal. Les supprimer effacerait la
    // seule trace de la divergence.
    const plan = prunePlan({
      currentVersion: '1.0.6',
      local: [local(setup('1.0.1'), 'octets-reconstruits', 1000)],
      published: [release('1.0.1', [held(setup('1.0.1'), 'octets-publies', 1000)])],
    });
    assert.deepEqual(plan.remove, []);
    assert.equal(plan.divergences.length, 1);
    assert.equal(plan.keep.length, 1);
    assert.match(plan.divergences[0].reason, /AUTRES octets/);
  });

  it('--stale enlève une reconstruction d’un numéro publié, et la NOMME quand même', () => {
    // Mesuré le 13/09 : la 1.0.3 et la 1.0.5 locales datent d'APRÈS leur
    // publication (19:53 contre 18:56, 23:06 contre 22:31) — le même numéro en
    // deux exemplaires, indistinguables à l'œil. Ces octets-ci ne seront jamais
    // livrés, mais leur sort se décide par « le numéro est pris », pas par une
    // empreinte : deux justifications, donc deux actes.
    const plan = prunePlan({
      currentVersion: '1.0.6',
      stale: true,
      local: [local(setup('1.0.5'), 'octets-reconstruits-locaux')],
      published: [release('1.0.5', [held(setup('1.0.5'), 'octets-du-canal')])],
    });
    assert.deepEqual(
      plan.remove.map((r) => r.name),
      [setup('1.0.5')],
    );
    assert.match(plan.remove[0].reason, /ne peuvent plus être livrés/, 'la raison dit que le numéro est pris');
    assert.equal(plan.divergences.length, 1, 'la divergence reste visible : c’est aussi l’alarme du canal');
    assert.equal(plan.remove[0].kind, 'stale');
    assert.equal(plan.bytesFreed, 1000);
  });

  it('sans --stale, la divergence est conservée : c’est l’alarme, on ne l’efface pas', () => {
    const plan = prunePlan({
      currentVersion: '1.0.6',
      local: [local(setup('1.0.5'), 'octets-reconstruits-locaux')],
      published: [release('1.0.5', [held(setup('1.0.5'), 'octets-du-canal')])],
    });
    assert.deepEqual(plan.remove, []);
    assert.equal(plan.divergences.length, 1);
  });

  it('une taille qui diffère suffit à refuser, même avec l’empreinte annoncée', () => {
    const plan = prunePlan({
      currentVersion: '1.0.6',
      local: [local(setup('1.0.2'), 'octets-1.0.2', 1001)],
      published: [release('1.0.2', [held(setup('1.0.2'), 'octets-1.0.2', 1000)])],
    });
    assert.deepEqual(plan.remove, []);
    assert.equal(plan.divergences.length, 1);
  });

  it('une empreinte ABSENTE n’est pas une empreinte qui correspond', () => {
    // Une taille seule n'identifie pas des octets : la suppression ne peut pas
    // s'appuyer sur une promesse incomplète.
    const plan = prunePlan({
      currentVersion: '1.0.6',
      local: [local(setup('1.0.3'), 'octets-1.0.3')],
      published: [release('1.0.3', [{ name: setup('1.0.3'), size: 1000, digest: null }])],
    });
    assert.deepEqual(plan.remove, []);
    assert.deepEqual(plan.divergences, []);
    assert.match(plan.keep[0].reason, /pas d’empreinte/);
  });

  it('un actif que le canal ne déclare pas reste sur le disque', () => {
    const plan = prunePlan({
      currentVersion: '1.0.6',
      local: [local(portable('1.0.4'), 'octets-portable')],
      published: [release('1.0.4', [held(setup('1.0.4'), 'octets-1.0.4')])],
    });
    assert.deepEqual(plan.remove, []);
    assert.match(plan.keep[0].reason, /ne déclare pas/);
  });

  it('un BROUILLON ne peut rien autoriser — il est invisible pour un poste', () => {
    const plan = prunePlan({
      currentVersion: '1.0.6',
      local: [local(setup('0.0.9'), 'octets-fixture')],
      published: [release('0.0.9', [held(setup('0.0.9'), 'octets-fixture')], true)],
    });
    assert.deepEqual(plan.remove, [], 'un brouillon ne « détient » pas les octets là où un poste les lit');
    assert.match(plan.keep[0].reason, /jamais publiée/);
    assert.match(
      plan.keep[0].reason,
      /le canal ne détient RIEN de comparable/,
      'un brouillon ne rend donc personne mort non plus : il ne prouve rien dans un sens ni dans l’autre',
    );
  });

  it('sans --unpublished, une version jamais livrée reste — mais elle est NOMMÉE, et l’acte est dit', () => {
    // Le canal ne l'a jamais eue, donc aucune empreinte ne peut autoriser quoi
    // que ce soit sur elle : la décision est humaine. Un plan qui garde sans le
    // dire ne laisse pas la décision à l'humain, il la lui cache.
    const plan = prunePlan({
      currentVersion: '1.0.6',
      local: [local(portable('1.0.0'), 'octets-1.0.0')],
      published: [release('1.0.1', [held(setup('1.0.1'), 'x')])],
    });
    assert.deepEqual(plan.remove, []);
    assert.deepEqual(
      plan.unpublishedCandidates.map((c) => c.version),
      ['1.0.0'],
      'le candidat est nommé même quand l’acte n’est pas demandé',
    );
    assert.match(plan.keep[0].reason, /un acte humain explicite \(--unpublished\) est requis/);
  });

  it('--unpublished enlève un build mort, et dit les DEUX comparaisons qui le rendent mort', () => {
    const plan = prunePlan({
      currentVersion: '1.0.6',
      unpublished: true,
      local: [local(portable('1.0.0'), 'octets-1.0.0')],
      published: [release('1.0.1', [held(setup('1.0.1'), 'x')])],
    });
    assert.deepEqual(
      plan.remove.map((r) => r.name),
      [portable('1.0.0')],
    );
    assert.match(plan.remove[0].reason, /plus basse que la version en préparation \(1\.0\.6\)/);
    assert.match(plan.remove[0].reason, /DESCENDRE la tête/, 'la raison dit pourquoi il ne peut plus atteindre personne');
    assert.equal(plan.remove[0].kind, 'unpublished');
    assert.equal(plan.bytesFreed, 1000);
  });

  it('--unpublished ne touche JAMAIS un build au moins aussi haut que celui qu’on prépare', () => {
    // C'est peut-être celui qui attend sa publication, et sa copie locale en est
    // l'unique exemplaire : aucun drapeau ne peut l'enlever.
    const plan = prunePlan({
      currentVersion: '1.0.6',
      unpublished: true,
      local: [local(setup('1.1.0'), 'octets-futurs'), local(setup('1.0.6'), 'octets-courants')],
      published: [release('1.0.5', [held(setup('1.0.5'), 'x')])],
    });
    assert.deepEqual(plan.remove, []);
    assert.equal(plan.unpublishedCandidates.length, 0, 'un build en attente de publication n’est même pas un candidat');
    assert.match(plan.keep.map((k) => k.reason).join('\n'), /au moins aussi haute/);
    assert.match(plan.keep.map((k) => k.reason).join('\n'), /aucun drapeau ne peut autoriser sa suppression/);
  });

  it('--unpublished ne touche pas non plus un build plus haut que TOUT ce que le canal détient', () => {
    // Plus bas que ce qu'on prépare (donc pas le build courant) mais plus haut
    // que la tête : le publier ne ferait pas descendre la tête, donc il est
    // encore livrable. Sa copie locale n'est pas morte.
    const plan = prunePlan({
      currentVersion: '1.1.0',
      unpublished: true,
      local: [local(setup('1.0.7'), 'octets-1.0.7')],
      published: [release('1.0.6', [held(setup('1.0.6'), 'x')])],
    });
    assert.deepEqual(plan.remove, []);
    assert.equal(plan.unpublishedCandidates.length, 0);
  });

  it('un canal dont aucune version n’est lisible ne rend personne mort', () => {
    // On ne devine pas un ordre à partir d'une chaîne libre : sans version
    // comparable, « plus basse que » est faux, donc on ne supprime pas.
    const plan = prunePlan({
      currentVersion: '1.0.6',
      unpublished: true,
      local: [local(setup('1.0.0'), 'octets-1.0.0')],
      published: [release('nightly', [held(setup('nightly'), 'x')])],
    });
    assert.deepEqual(plan.remove, []);
    assert.equal(plan.unpublishedCandidates.length, 0);
  });

  it('un release publié mais aux actifs illisibles ne prouve rien', () => {
    const plan = prunePlan({
      currentVersion: '1.0.6',
      local: [local(setup('1.0.5'), 'octets-1.0.5')],
      published: [release('1.0.5', [])],
    });
    assert.deepEqual(plan.remove, []);
    assert.match(plan.keep[0].reason, /illisibles|doute/);
  });
});

describe('ce que le plan ne touche jamais', () => {
  it('la version en cours de construction reste, même déjà publiée', () => {
    // C'est la sortie du build : `check:release`, la preuve bureau et le rejeu de
    // mise à jour la lisent. Et c'est aussi la seule entrée dont l'empreinte ne
    // décide rien, donc le CLI ne hache pas ces octets.
    const plan = prunePlan({
      currentVersion: '1.0.6',
      local: [local(setup('1.0.6'), 'octets-1.0.6')],
      published: [release('1.0.6', [held(setup('1.0.6'), 'octets-1.0.6')])],
    });
    assert.deepEqual(plan.remove, []);
    assert.equal(plan.bytesFreed, 0);
    assert.match(plan.keep[0].reason, /en cours de construction/);
  });

  it('le flux et les fichiers de configuration sont hors sujet, et le plan le DIT', () => {
    const plan = prunePlan({
      currentVersion: '1.0.6',
      local: [{ name: 'latest.yml', size: 361, sha256: null }, { name: 'builder-debug.yml', size: 6226, sha256: null }],
      published: [],
    });
    assert.deepEqual(plan.remove, []);
    assert.equal(plan.ignored.length, 2, 'un plan qui ignore en silence ferait croire qu’il a tout vu');
  });

  it('le plan couvre un dossier entier : les trois anciennes partent, la courante et l’inédite restent', () => {
    const plan = prunePlan({
      currentVersion: '1.0.6',
      local: [
        ...[setup('1.0.0'), portable('1.0.0'), blockmap('1.0.0')].map((n) => local(n, `1.0.0-${n}`)),
        ...[setup('1.0.4'), portable('1.0.4'), blockmap('1.0.4')].map((n) => local(n, `1.0.4-${n}`)),
        ...[setup('1.0.6'), portable('1.0.6'), blockmap('1.0.6')].map((n) => local(n, `1.0.6-${n}`)),
      ],
      published: [
        release('1.0.4', [setup('1.0.4'), portable('1.0.4'), blockmap('1.0.4')].map((n) => held(n, `1.0.4-${n}`))),
        release('1.0.6', [setup('1.0.6'), portable('1.0.6'), blockmap('1.0.6')].map((n) => held(n, `1.0.6-${n}`))),
      ],
    });
    assert.deepEqual(
      plan.remove.map((r) => r.name),
      [setup('1.0.4'), portable('1.0.4'), blockmap('1.0.4')],
      'seule la version que le canal détient part',
    );
    assert.equal(plan.keep.length, 6, 'la 1.0.0 inédite et la 1.0.6 en cours restent');
  });

  it('une taille lisible, pour que le plan se lise sans compter des zéros', () => {
    assert.equal(formatBytes(512), '512 o');
    assert.equal(formatBytes(129080968), '123 Mo');
  });
});

describe('le rappel du plan applique VRAIMENT ce plan', () => {
  /** Les actes qu'un plan demande — l'entrée réelle de la ligne de commande. */
  const acts = (plan: { remove: { kind: string }[] }) => plan.remove.map((r) => r.kind);

  it('un plan de reconstructions redemande --stale : --yes seul n’enlèverait rien', () => {
    // Mesuré le 13/09 sur le dossier réel : le plan de la 1.0.0 seule annonçait
    // « Applique-le : npm run release:prune -- --yes » — or `--yes` seul n'applique
    // que les départs qu'une empreinte autorise, donc l'exécuter n'aurait rien
    // enlevé. Un plan qu'on croit appliqué et qui n'a rien fait ne se relit pas
    // comme un plan vide : il se relit comme un ménage fait.
    const plan = prunePlan({
      currentVersion: '1.0.6',
      stale: true,
      local: [local(setup('1.0.5'), 'octets-reconstruits-locaux')],
      published: [release('1.0.5', [held(setup('1.0.5'), 'octets-du-canal')])],
    });
    assert.match(plan.remove[0].reason, /le canal sert DÉJÀ 1\.0\.5/, 'le motif est bien celui de la reconstruction locale');
    assert.equal(pruneCommand(acts(plan)), 'npm run release:prune -- --yes --stale');
  });

  it('un plan de builds jamais livrés redemande --unpublished', () => {
    const plan = prunePlan({
      currentVersion: '1.0.6',
      unpublished: true,
      local: [local(portable('1.0.0'), 'octets-1.0.0')],
      published: [release('1.0.1', [held(setup('1.0.1'), 'x')])],
    });
    assert.equal(plan.remove[0].kind, 'unpublished');
    assert.equal(pruneCommand(acts(plan)), 'npm run release:prune -- --yes --unpublished');
  });

  it('un plan mixte demande LES DEUX drapeaux — un seul oubli laisserait la moitié en place', () => {
    const plan = prunePlan({
      currentVersion: '1.0.6',
      stale: true,
      unpublished: true,
      local: [
        local(setup('1.0.5'), 'octets-reconstruits-locaux'),
        local(portable('1.0.0'), 'octets-1.0.0'),
        local(setup('1.0.4'), 'octets-1.0.4'),
      ],
      published: [
        release('1.0.5', [held(setup('1.0.5'), 'octets-du-canal')]),
        release('1.0.4', [held(setup('1.0.4'), 'octets-1.0.4')]),
      ],
    });
    assert.deepEqual([...new Set(plan.remove.map((r) => r.kind))].sort(), ['digest', 'stale', 'unpublished']);
    assert.equal(pruneCommand(acts(plan)), 'npm run release:prune -- --yes --stale --unpublished');
  });

  it('un plan vide ne propose que l’acte nu : rien à autoriser, rien à ajouter', () => {
    assert.equal(pruneCommand([]), 'npm run release:prune -- --yes');
  });

  it('la commande PORTE le dossier — sans quoi un plan de sonde proposait d’agir sur release/', () => {
    // Mesuré en montrant le plan d'un dossier de sonde : la ligne ne portait pas
    // le dossier, donc un plan calculé sur `release-probe/` proposait de supprimer
    // dans `release/`. Aidant, et faux — la seule façon dont un rappel peut être
    // pire que rien, parce qu'il est recopié tel quel.
    const probe = prunePlan({
      currentVersion: '1.0.6',
      unpublished: true,
      local: [local(portable('1.0.0'), 'octets-1.0.0')],
      published: [release('1.0.1', [held(setup('1.0.1'), 'x')])],
    });
    assert.equal(
      pruneCommand(acts(probe), { dir: 'release-probe' }),
      'npm run release:prune -- --dir=release-probe --yes --unpublished',
    );
    assert.equal(
      pruneCommand(['digest', 'stale'], { dir: 'release-test' }),
      'npm run release:prune -- --dir=release-test --yes --stale',
    );
  });

  it('le dossier par DÉFAUT se tait : la ligne de la documentation reste la sienne', () => {
    assert.equal(pruneCommand(['digest'], { dir: 'release' }), 'npm run release:prune -- --yes');
    assert.equal(pruneCommand(['digest']), 'npm run release:prune -- --yes');
  });

  it('aucune commande n’est écrite en dur dans le CLI : un seul site peut la produire', () => {
    // Le bug du dossier n'existait que parce que la ligne était recopiée à TROIS
    // endroits : le corriger à un seul laissait les deux autres mentir.
    const source = read('scripts/prune-release-dir.mjs');
    const literals = source.match(/['`][^'`\n]*npm run release:prune[^'`\n]*['`]/g) ?? [];
    assert.deepEqual(literals, [], 'la commande ne s’écrit qu’à un endroit — le module pur');
    // Le NOMBRE de sites n'est pas la propriété : il a déjà changé deux fois.
    // Ce qui compte est qu'aucun d'eux n'écrive la ligne lui-même.
    assert.ok((source.match(/pruneCommand\(/g) ?? []).length >= 3, 'le plan, les candidats et le refus y passent');
  });
});

describe('un plan sans départ dit ce qu’il sait, sans plaider', () => {
  it('un dossier VIDE ne se voit pas reprocher ce qu’il contient', () => {
    // La phrase précédente affirmait « ne contient que ce que le canal ne détient
    // pas encore » — y compris à propos d'un dossier vide, donc à propos de rien.
    assert.equal(noRemovalMessage(0), '✅ rien à décider — le dossier est vide.');
  });

  it('un dossier plein mais sans départ n’invente pas de raison', () => {
    // Fausse sur le dossier RÉEL : elle l'affirmait pendant que le bloc suivant
    // nommait la 1.0.6 comme sortie du build — or le canal la détient, c'est sa tête.
    // Deux lignes du même rapport se contredisaient.
    const line = noRemovalMessage(3);
    assert.match(line, /rien à supprimer/);
    assert.doesNotMatch(line, /ne détient pas encore/, 'elle ne plaide plus pour le dossier');
  });

  it('le CLI dit la phrase du module au lieu de la réinventer', () => {
    const source = read('scripts/prune-release-dir.mjs');
    assert.match(source, /noRemovalMessage\(local\.length\)/);
    assert.doesNotMatch(source, /ne contient que ce que le canal ne détient pas encore/);
  });
});
